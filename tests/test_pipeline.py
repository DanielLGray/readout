"""End-to-end run of both jobs against the synthetic offline services."""
from datetime import date

import pytest

from pipeline import build_explore, build_feed
from pipeline.http import Http
from tests.fake_services import FakeWorld

TODAY = date(2026, 11, 23)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("READOUT_TODAY", TODAY.isoformat())
    monkeypatch.setattr(build_feed, "DATA", tmp_path / "data")
    monkeypatch.setattr(build_explore, "DATA", tmp_path / "data")
    monkeypatch.setattr(build_explore, "CACHE", tmp_path / "cache")
    world = FakeWorld(TODAY)
    return world, Http(transport=world.transport, sleep=lambda s: None)


def test_feed_first_run_then_update(env):
    world, http = env
    out = build_feed.run(http)
    items = out["items"]
    assert len(items) > 30
    assert all(it["added"] >= "2026-10-09" for it in items)          # 45-day first run
    assert items == sorted(items, key=lambda i: (i["added"], i["seen"], int(i["pmid"])), reverse=True)
    it = next(i for i in items if i["conclusion"]["kind"] == "structured")
    assert "©" not in it["conclusion"]["text"]
    assert any(i["topics"] for i in items)
    assert any(i["systems"] for i in items)
    from pipeline.common import load_yaml
    assert set(out["streams"]) == {s["id"] for s in load_yaml("feeds.yaml")["streams"]}
    # every card names its interest areas; NM-journal body papers are in both
    assert all(i["areas"] for i in items)
    assert any({"nm", "body"} <= set(i["areas"]) for i in items) and any(i["areas"] == ["general"] or "general" in i["areas"] for i in items)
    assert out["areas"]["nm"]["count"] > 0 and out["areas"]["nm"]["label"] == "Nuclear medicine"
    # abstracts live beside feed.json, not in it
    assert all("sections" not in i for i in items) and any(i.get("abs") == "f" for i in items)
    import json as _json
    some = next(i for i in items if i.get("abs"))
    bucket = _json.loads((build_feed.DATA / "abstracts" / f"f{int(some['pmid']) % 50:02d}.json").read_text())
    assert bucket[some["pmid"]][0]["text"]
    # second run merges, keeps 'seen', and still has every abstract
    out2 = build_feed.run(http)
    assert {i["pmid"] for i in items} <= {i["pmid"] for i in out2["items"]}
    assert sum(1 for i in out2["items"] if i.get("abs")) == sum(1 for i in items if i.get("abs"))


def test_explore(env):
    world, http = env
    out = build_explore.run(http)
    topics = {t["id"]: t for t in out["topics"]}
    assert len(topics) == len(world.tcfg["topics"])
    llm = topics["llm_radiology"]["windows"]
    assert llm["2"]["growth"] is not None and llm["2"]["growth"] > 1       # booming topic
    rad = topics["radiomics_body"]["windows"]["2"]["growth"]
    assert rad is not None and rad < 0                                      # fading topic
    lists = out["lists"]["2"]
    assert "llm_radiology" in lists["breakouts"] + lists["rising"]
    assert "radiomics_body" in out["lists"]["5"]["cooling"]
    assert topics["psma_pet"]["windows"]["5"]["top"], "top papers present"
    top = out["papers"][topics["psma_pet"]["windows"]["5"]["top"][0]]
    assert top["conclusion"]["text"] and top["metrics"]["cites"] > 0
    import json as _json                       # the full abstract sits beside explore.json for the Abstract button
    bucket = _json.loads((build_explore.DATA / "abstracts" / f"e{int(top['pmid']) % 50:02d}.json").read_text())
    assert top["abs"] == "e" and bucket[top["pmid"]]
    for t in out["topics"]:
        for w in t["windows"].values():
            assert all(p in out["papers"] for p in w["top"] + w["guidelines"])
    assert topics["psma_pet"]["windows"]["1"]["trials"]["recent"] is not None
    assert len(topics["lirads"]["years"]) == 11
    terms = out["terms"]["2"]["emerging"]
    names = " | ".join(t["term"].lower() for t in terms)
    assert "large language models" in names or "large language" in names
    fading = " | ".join(t["term"].lower() for t in out["terms"]["5"]["fading"])
    assert "radiomics" in fading or "texture" in fading


def test_check_queries(env):
    from pipeline import check_queries
    world, http = env
    report = check_queries.main(http)
    assert report.count("| topic |") == len(world.tcfg["topics"])
    assert "| stream | body_journals |" in report
    assert "| journal | Radiology |" in report


def test_fetch_retries_truncated_xml(env):
    from pipeline.pubmed import PubMed
    world, _ = env
    calls = {"n": 0}
    def flaky(method, url, params):
        if url.endswith("efetch.fcgi"):
            calls["n"] += 1
            if calls["n"] == 1:
                return 200, "<PubmedArticleSet><PubmedArticle><Medline"   # cut off mid-response
        return world.transport(method, url, params)
    pm = PubMed(Http(transport=flaky, sleep=lambda s: None))
    pmid = next(iter(world.papers))
    assert pm.fetch([pmid])[0]["pmid"] == pmid and calls["n"] == 2


def test_trend_rules_from_config():
    r = build_explore.rules_from({"settings": {"breakout": 2.0, "min_papers": {1: 5}}})
    assert r["breakout"] == 2.0 and r["min_papers"] == {1: 5, 2: 25, 5: 40} and r["rising"] == 0.15
    tps = [{"id": "a", "windows": {k: {"recent": 30, "prior": 10, "growth": 1.5, "evidence": {}} for k in ("1", "2", "5")}},
           {"id": "b", "windows": {k: {"recent": 30, "prior": 30, "growth": 0.5, "evidence": {}} for k in ("1", "2", "5")}}]
    assert build_explore.lists_for(tps)["2"]["breakouts"] == ["a"]
    tight = build_explore.lists_for(tps, r)["2"]
    assert tight["breakouts"] == [] and tight["rising"] == ["a", "b"]


def test_outputs_carry_settings(env):
    world, http = env
    feed = build_feed.run(http)
    assert feed["settings"]["keep_days"] == 180 and feed["settings"]["journals"] > 10
    out = build_explore.run(http)
    assert out["settings"]["breakout"] == 1.0 and out["settings"]["min_papers"]["2"] == 25


def test_overlapping_title_phrases_join():
    from pipeline import terms
    corpus = []
    for i in range(60):           # prior window: unrelated titles
        corpus.append({"pmid": f"p{i}", "date": f"2025-0{1 + i % 9}-15", "title": f"Liver MRI study number {i}", "journal": "J"})
    for i in range(60):           # recent window: the new score shows up in many titles
        t = "Clear cell likelihood score for small renal masses" if i < 30 else f"Kidney CT protocol {i}"
        corpus.append({"pmid": f"r{i}", "date": f"2026-0{1 + i % 9}-10", "title": t, "journal": "J"})
    out = terms.analyze(corpus, TODAY, windows=(1,))
    got = [t["term"].lower() for t in out["1"]["emerging"]]
    assert "clear cell likelihood score" in got
    assert "likelihood score" not in got and "clear cell likelihood" not in got


def test_important_papers(env, monkeypatch):
    from pipeline import build_important
    world, http = env
    monkeypatch.setattr(build_important, "DATA", build_feed.DATA)
    monkeypatch.setattr(build_important, "CACHE", build_explore.CACHE)
    out = build_important.run(http)
    st = out["stats"]
    assert st["checked"] > 500 and st["skipped"] > 0 and st["research"] > st["other"] > 0
    for w in ("6m", "1y", "3y"):
        for area in ("body", "nm"):
            lst = out["windows"][w][area]["research"]
            assert lst and all(p in out["papers"] for p in lst)
            assert all(out["papers"][p]["impact"]["kind"] == "research" and area in out["papers"][p]["areas"] for p in lst)
    # proven lists: ranked by citation percentile within the area and quarter, nothing too new to judge
    from pipeline.build_important import proven
    t = date.fromisoformat(out["today"])
    keys = [50 + (out["papers"][p]["impact"]["pcts"]["body"] - 50) * min(1, out["papers"][p]["impact"]["age"] / 12)
            for p in out["windows"]["3y"]["body"]["research"]]
    assert all(a >= b - 0.6 for a, b in zip(keys, keys[1:])) and keys[0] >= 90       # young papers count for less
    assert out["papers"][out["windows"]["3y"]["body"]["research"][0]]["impact"]["age"] >= 12
    assert all(out["papers"][p]["impact"]["age"] >= 4 for p in out["windows"]["1y"]["nm"]["research"])
    assert st["areas"]["nm"] > 0
    # cards carry the authors' conclusion like the feed; the abstract sits beside the file
    card = out["papers"][out["windows"]["1y"]["body"]["research"][0]]
    assert card["abs"] == "i" and "sections" not in card
    assert card["conclusion"]["text"] and card["impact"]["cites"] >= 0
    assert out["stats"]["journals"] and all(0 <= j[1] <= 100 for j in out["stats"]["journals"])
    # second run reuses the corpus cache
    out2 = build_important.run(http)
    assert out2["stats"]["checked"] == st["checked"]


def test_every_query_placeholder_is_filled():
    import pytest as _pt
    from pipeline.common import fill, load_yaml
    cfg = load_yaml("feeds.yaml")
    for s in cfg["streams"]:
        q = fill(s["query"], cfg)
        assert "{" not in q and "}" not in q, s["id"]
    assert "[majr]" in fill(next(s["query"] for s in cfg["streams"] if s["id"] == "general_imaging"), cfg)
    with _pt.raises(KeyError):
        fill("({no_such_block})", cfg)


def test_summaries_date_papers_by_first_appearance():
    from pipeline.pubmed import PubMed
    import json as _json
    body = {"result": {"uids": ["1"], "1": {"title": "t", "source": "J", "sortpubdate": "2026/06/01 00:00",
            "history": [{"pubstatus": "entrez", "date": "2025/08/14 06:00"}, {"pubstatus": "accepted", "date": "2025/07/01 00:00"}]}}}
    pm = PubMed(Http(transport=lambda m, u, p: (200, _json.dumps(body)), sleep=lambda s: None))
    s = pm.summaries(["1"])[0]
    assert s["first"] == "2025-08-14" and s["date"] == "2026-06-01"


def test_config_ids_are_unique_and_systems_exist():
    from collections import Counter
    from pipeline.common import load_yaml
    cfg, tcfg = load_yaml("feeds.yaml"), load_yaml("topics.yaml")
    for name, ids in (("topics", [t["id"] for t in tcfg["topics"]]), ("streams", [s["id"] for s in cfg["streams"]])):
        dup = [k for k, n in Counter(ids).items() if n > 1]
        assert not dup, f"duplicate {name}: {dup}"
    assert all(t["system"] in cfg["systems"] for t in tcfg["topics"])
    assert all(s.get("area", "body") in cfg["areas"] for s in cfg["streams"])


def test_feed_survives_one_rejected_search(env, monkeypatch):
    world, http = env
    from pipeline import pubmed
    real = pubmed.PubMed.esearch
    def picky(self, term, **kw):
        if "Nucl Med" in term and "Clin Nucl Med" in term:      # the NM journals stream
            raise RuntimeError("PubMed rejected query: test")
        return real(self, term, **kw)
    monkeypatch.setattr(pubmed.PubMed, "esearch", picky)
    out = build_feed.run(http)
    assert "nm_all" in out["failed_streams"] and len(out["items"]) > 30
    monkeypatch.setattr(pubmed.PubMed, "esearch", lambda self, term, **kw: (_ for _ in ()).throw(RuntimeError("down")))
    with pytest.raises(RuntimeError, match="every PubMed search failed"):
        build_feed.run(http)
