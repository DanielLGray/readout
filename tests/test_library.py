"""Pictures, meetings, Foundations and classics."""
import io
import json
from datetime import date, datetime, timezone

import pytest

from pipeline import build_feed, build_library, build_news, figures
from pipeline.http import Http
from tests.fake_services import FakeWorld

TODAY = date(2026, 11, 23)

JATS = """<?xml version="1.0"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD v1.3 20210610//EN" "JATS-archivearticle1-3.dtd">
<article xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ali="http://www.niso.org/schemas/ali/1.0/"><front><article-meta>
<permissions><license><ali:license_ref>https://creativecommons.org/licenses/by/4.0/</ali:license_ref><license-p>Open access</license-p></license></permissions>
</article-meta></front><body>
<fig id="Figa"><graphic xlink:href="x_Figa_HTML.webp"/></fig>
<fig id="Fig1"><label>Fig. 1</label><caption><p>Flowchart of patient selection.</p></caption><graphic xlink:href="x_Fig1_HTML.webp"/></fig>
<fig id="Fig2"><label>Fig. 2</label><caption><p>ROC curves for the three readers.</p></caption><graphic xlink:href="x_Fig2_HTML.webp"/></fig>
<fig id="Fig3"><label>Fig. 3</label><caption><title>A 64-year-old man with HCC.</title><p>Axial arterial phase CT image (<bold>a</bold>) shows a mass.</p></caption><graphic xlink:href="x_Fig3_HTML"/></fig>
</body></article>"""


def _png(w=2000, h=1500) -> bytes:
    from PIL import Image
    b = io.BytesIO()
    Image.new("RGB", (w, h), (90, 90, 90)).save(b, "PNG")
    return b.getvalue()


def test_figure_choice_prefers_images_over_charts():
    figs, lic = figures.parse_figures(JATS)
    assert lic == "https://creativecommons.org/licenses/by/4.0/"
    assert [f["label"] for f in figs] == ["", "Fig. 1", "Fig. 2", "Fig. 3"]
    best = figures.pick(figs)
    assert best["label"] == "Fig. 3" and "64-year-old" in best["caption"]
    assert figures.pick(figs[:3]) is None                       # flowchart and ROC curve: no picture
    charts = ["Bar plots show ICCs with 95% confidence intervals for five ADC ROI methods",
              "Number of PMMRI scans with corresponding body part per case",
              "Distribution of PROMISE PSMA scores on PET, displayed as pie charts"]
    assert figures.pick([{"label": "Fig. 2", "caption": c, "href": "x"} for c in charts]) is None
    with pytest.raises(ValueError):
        figures.parse_figures('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')
    assert figures.media_for("x_Fig3_HTML", ["s3://pmc-oa-opendata/PMC1.1/x_Fig3_HTML.webp?md5=1"]).endswith("/PMC1.1/x_Fig3_HTML.webp")


def test_shrink_makes_a_small_webp():
    from PIL import Image
    data, w, h = figures.shrink(_png())
    assert (w, h) == (960, 720) and len(data) < 60_000
    assert Image.open(io.BytesIO(data)).format == "WEBP"
    with pytest.raises(Exception):
        figures.shrink(b"<html>not an image</html>")


class FakePMC:
    """S3 listing, metadata, article XML, one image; and PMC's ID converter."""
    def __init__(self, license_code="CC BY"):
        self.license = license_code
        self.calls = []

    def text(self, method, url, params):
        self.calls.append(url)
        if "idconv" in url:
            return 200, json.dumps({"records": [{"pmid": int(p), "pmcid": "PMC900" + p[-1]} for p in params["ids"].split(",")]})
        if url.endswith(".amazonaws.com/") and params.get("prefix", "").startswith("metadata/PMC"):
            pmc = params["prefix"].split("/")[1].rstrip(".")
            return 200, f"<ListBucketResult><Key>metadata/{pmc}.1.json</Key><Key>metadata/{pmc}.2.json</Key></ListBucketResult>"
        if "/metadata/" in url:
            pmc = url.rsplit("/", 1)[1].split(".")[0]
            return 200, json.dumps({"license_code": self.license, "is_manuscript": False, "xml_url": f"s3://pmc-oa-opendata/{pmc}.2/{pmc}.2.xml?md5=a",
                                    "media_urls": [f"s3://pmc-oa-opendata/{pmc}.2/x_Fig{i}_HTML.webp?md5=b" for i in (1, 2, 3)]})
        if url.endswith(".xml"):
            return 200, JATS
        return 404, "no"

    def raw(self, method, url, params):
        self.calls.append(url)
        return (200, _png()) if url.endswith("x_Fig3_HTML.webp") else (404, b"no")


def test_attach_and_prune(tmp_path, monkeypatch):
    monkeypatch.setenv("READOUT_TODAY", TODAY.isoformat())
    pmc = FakePMC()
    http = Http(transport=pmc.text, bytes_transport=pmc.raw, sleep=lambda s: None)
    cards = [{"pmid": "41000001", "pmcid": "PMC123", "added": "2026-11-20"},
             {"pmid": "41000002", "pmcid": "", "added": "2026-11-20"},          # PMCID found through PMC's converter
             {"pmid": "41000003", "pmcid": "", "added": "2019-01-01"}]          # too old to look up
    st = figures.attach(http, cards, data=tmp_path / "data", cache_dir=tmp_path / "cache")
    assert st["new"] == 2 and st["pmcids_found"] == 1 and cards[1]["pmcid"] == "PMC9002"
    fig = cards[0]["fig"]
    assert fig["src"] == "figs/PMC123.webp" and fig["n"] == "Fig. 3" and fig["lic"] == "CC BY"
    assert fig["lu"] == "https://creativecommons.org/licenses/by/4.0/" and (fig["w"], fig["h"]) == (960, 720)
    assert (tmp_path / "data" / "figs" / "PMC123.webp").exists() and "fig" not in cards[2]
    assert any("PMC123.2.json" in c for c in pmc.calls)               # the highest version
    # the second run asks nothing new
    pmc.calls.clear()
    figures.attach(http, cards, data=tmp_path / "data", cache_dir=tmp_path / "cache")
    assert all("amazonaws" not in c for c in pmc.calls) and cards[0]["fig"] == fig
    # choices made under older picking rules are made again (and kept on show until then)
    cache = json.loads((tmp_path / "cache" / "figures-feed.json").read_text())
    cache["figs"]["PMC123"]["v"] = 1
    (tmp_path / "cache" / "figures-feed.json").write_text(json.dumps(cache))
    figures.attach(http, cards, data=tmp_path / "data", cache_dir=tmp_path / "cache", budget=0)
    assert cards[0]["fig"] == fig and all("amazonaws" not in c for c in pmc.calls)
    figures.attach(http, cards, data=tmp_path / "data", cache_dir=tmp_path / "cache")
    assert any("PMC123.2.json" in c for c in pmc.calls) and cards[0]["fig"] == fig
    # a figure no data file uses any more is deleted; nothing is deleted while a data file is missing
    (tmp_path / "data" / "feed.json").write_text(json.dumps({"items": [cards[0]]}))
    assert figures.prune(tmp_path / "data") == 0
    for name in ("important.json", "library.json"):
        (tmp_path / "data" / name).write_text("{}")
    assert figures.prune(tmp_path / "data") == 1
    assert (tmp_path / "data" / "figs" / "PMC123.webp").exists() and not (tmp_path / "data" / "figs" / "PMC9002.webp").exists()


def test_no_figure_without_a_creative_commons_license(tmp_path, monkeypatch):
    monkeypatch.setenv("READOUT_TODAY", TODAY.isoformat())
    pmc = FakePMC("TDM")
    http = Http(transport=pmc.text, bytes_transport=pmc.raw, sleep=lambda s: None)
    cards = [{"pmid": "41000001", "pmcid": "PMC123", "added": "2026-11-20"}]
    st = figures.attach(http, cards, data=tmp_path / "data", cache_dir=tmp_path / "cache")
    assert st["none"] == 1 and "fig" not in cards[0]
    assert not any(c.endswith(".webp") for c in pmc.calls)             # never downloads the image


def test_meetings_tag_stories_near_their_dates(monkeypatch):
    cfg = {"meetings": [{"id": "rsna2026", "name": "RSNA 2026", "start": date(2026, 11, 29), "end": date(2026, 12, 3),
                         "match": r"\bRSNA\b"},
                        {"id": "old", "name": "Old", "start": date(2025, 1, 1), "end": date(2025, 1, 3), "match": "x"}]}
    monkeypatch.setattr(build_news, "load_yaml", lambda name: cfg)
    ms = build_news.load_meetings(datetime(2026, 11, 24, tzinfo=timezone.utc))
    assert [m["id"] for m in ms] == ["rsna2026"]                       # long-past meetings drop out
    near = {"title": "What to see at RSNA this year", "summary": "", "date": "2026-11-20T10:00:00Z"}
    far = {"title": "RSNA names a new president", "summary": "", "date": "2026-06-01T10:00:00Z"}
    other = {"title": "Photon-counting CT in practice", "summary": "", "date": "2026-11-30T10:00:00Z"}
    for it in (near, far, other):
        build_news.tag_meetings(it, ms)
    assert near["meetings"] == ["rsna2026"] and "meetings" not in far and "meetings" not in other


@pytest.fixture()
def lib_env(tmp_path, monkeypatch):
    monkeypatch.setenv("READOUT_TODAY", TODAY.isoformat())
    for mod in (build_library, build_feed):
        monkeypatch.setattr(mod, "DATA", tmp_path / "data")
        monkeypatch.setattr(mod, "CACHE", tmp_path / "cache")
    world = FakeWorld(TODAY)
    return world, Http(transport=world.transport, sleep=lambda s: None)


def test_library(lib_env, monkeypatch):
    world, http = lib_env
    real = build_library.load_yaml
    pinned = sorted(world.papers, key=lambda p: -world.papers[p]["cites"])[:2]
    fd = {"title": "Body imaging foundations", "groups": [
        {"id": "start", "name": "Start here", "items": [
            {"label": "A pinned paper", "why": "Because.", "pmid": pinned[0]},
            {"label": "Found by searching", "why": "Also.", "find": '"Radiology"[ta]'},
            {"label": "Nothing matches", "find": "no such thing[ti]"}]}],
        "classics": {"from_year": 2016, "min_age_years": 2, "per_area": 6, "per_year": 2, "exclude": "^$|NEVER-MATCHES"}}
    monkeypatch.setattr(build_library, "load_yaml", lambda name: fd if name == "foundations.yaml" else real(name))
    out = build_library.run(http)
    g = out["foundations"]["groups"][0]
    assert g["items"][0] == pinned[0] and len(g["items"]) == 2
    found = g["items"][1]
    assert world.papers[found]["journal"] == "Radiology"
    first = [p for p in world.papers.values() if p["journal"] == "Radiology"][:50]        # what one search returns
    assert world.papers[found]["cites"] == max(p["cites"] for p in first)
    card = out["papers"][pinned[0]]
    assert card["fd"]["label"] == "A pinned paper" and card["cites"]["n"] == world.papers[pinned[0]]["cites"]
    assert card["abs"] == "l" and "sections" not in card
    # classics: old enough, a few per year, best first, never a foundation paper
    for area, ids in out["classics"].items():
        assert len(ids) <= 6 and not set(ids) & set(g["items"])
        years = [out["papers"][p]["cites"]["year"] for p in ids]
        assert all(y <= TODAY.year - 2 for y in years) and all(years.count(y) <= 2 for y in years)
        cpy = [out["papers"][p]["cites"]["cpy"] for p in ids]
        assert cpy == sorted(cpy, reverse=True)
        assert all(area in out["papers"][p]["areas"] and out["papers"][p]["conclusion"]["kind"] != "none" for p in ids)
    assert out["classics"]["body"]
    # a search that stops matching keeps last month's paper
    fd["groups"][0]["items"][1]["find"] = "no such thing either[ti]"
    out2 = build_library.run(http)
    assert out2["foundations"]["groups"][0]["items"][1] == found


def test_real_meetings_file_loads():
    ms = build_news.load_meetings(datetime(2026, 11, 24, tzinfo=timezone.utc))
    ids = {m["id"]: m for m in ms}
    assert "rsna2026" in ids and ids["rsna2026"]["start"] == "2026-11-29" and not ids["rsna2026"]["off"]
    assert ids["ismrm2027"]["off"] is True                      # `muted: true` (YAML would read a key named off as False)
    assert all(m["_re"] is not None and m["url"].startswith("https://") for m in ms)


def test_real_foundations_file_is_well_formed():
    from pipeline.common import load_yaml
    fd = load_yaml("foundations.yaml")
    labels = [it["label"] for g in fd["groups"] for it in g["items"]]
    assert len(labels) == len(set(labels)) >= 40
    for g in fd["groups"]:
        for it in g["items"]:
            assert it.get("why") and (it.get("find") or it.get("pmid")), it["label"]
            assert not it.get("pmid") or str(it["pmid"]).isdigit()


def test_classics_exclude(lib_env, monkeypatch):
    world, http = lib_env
    real = build_library.load_yaml
    fd = {"groups": [], "classics": {"from_year": 2016, "min_age_years": 2, "per_area": 6, "per_year": 2, "exclude": "."}}
    monkeypatch.setattr(build_library, "load_yaml", lambda name: fd if name == "foundations.yaml" else real(name))
    out = build_library.run(http)
    assert out["classics"] and all(not ids for ids in out["classics"].values())       # every title matches "."
    assert "exclude" not in out["settings"]
