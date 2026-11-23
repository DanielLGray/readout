"""News parsing, story grouping and trends — offline."""
from datetime import datetime, timezone
from pathlib import Path

import pytest

from pipeline import build_news, news
from pipeline.http import Http

FIX = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc)


def test_parse_rss_atom_sitemap():
    rss = news.parse_feed((FIX / "news_rss.xml").read_text(), "Wire", NOW)
    assert rss[0]["title"] == "CMS finalizes 2027 fee schedule cut for radiology"
    assert "utm_" not in rss[0]["link"]
    assert rss[0]["date"] == "2026-11-22T14:00:00Z"
    assert len(rss[0]["summary"]) <= 221 and rss[0]["summary"].endswith("…")
    assert "appeared first" not in rss[0]["summary"] and "&amp;" not in rss[0]["summary"]
    atom = news.parse_feed((FIX / "news_atom.xml").read_text(), "Biz", NOW)
    assert atom[0]["link"] == "https://example-business.test/news/fee-schedule-cut"
    sm = news.parse_feed((FIX / "news_sitemap.xml").read_text(), "Minnie", NOW)
    assert sm[0]["title"].startswith("CMS fee schedule final rule") and sm[0]["date"] == "2026-11-22T20:04:31Z"
    assert news.parse_feed("<html><body>Not a feed</body></html>", "X", NOW) == []


def test_categories():
    cfg = {"policy": {"label": "P", "words": ["CMS", "fee schedule"]},
           "deals": {"label": "D", "words": ["acquires"]},
           "ai": {"label": "A", "words": ["AI"]}}
    comp = news.compile_categories(cfg)
    assert news.categorize({"title": "CMS finalizes fee schedule", "summary": ""}, comp) == ["policy"]
    assert set(news.categorize({"title": "Vendor acquires AI startup", "summary": ""}, comp)) == {"deals", "ai"}
    assert news.categorize({"title": "Said the chair", "summary": ""}, comp) == []      # "ai" inside a word


@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(build_news, "DATA", tmp_path / "data")
    monkeypatch.setattr(build_news, "CACHE", tmp_path / "cache")
    monkeypatch.setattr(build_news, "load_yaml", lambda name: {
        "settings": {"keep_days": 120},
        "sources": [
            {"name": "Wire", "urls": ["https://wire.test/broken", "https://wire.test/feed"]},
            {"name": "Biz", "urls": ["https://biz.test/atom"]},
            {"name": "Minnie", "urls": ["https://minnie.test/sitemap-google-news.xml"]},
            {"name": "Dead", "urls": ["https://dead.test/rss"]},
            {"name": "SciWire", "kind": "science", "max_per_day": 1, "urls": ["https://sci.test/feed"]},
        ],
        "categories": {"policy": {"label": "Policy", "words": ["CMS", "Medicare", "fee schedule"]}},
    })
    pages = {"https://wire.test/feed": (FIX / "news_rss.xml").read_text(),
             "https://biz.test/atom": (FIX / "news_atom.xml").read_text(),
             "https://minnie.test/sitemap-google-news.xml": (FIX / "news_sitemap.xml").read_text(),
             "https://sci.test/feed": (FIX / "news_atom.xml").read_text().replace("example-business", "example-sci")}
    def transport(method, url, params):
        return (200, pages[url]) if url in pages else (404, "not found")
    return Http(transport=transport, sleep=lambda s: None, retries=1)


def test_build_news(env):
    out = build_news.run(env, NOW)
    by = {s["name"]: s for s in out["sources"]}
    assert by["Wire"]["ok"] and by["Wire"]["url"] == "https://wire.test/feed"     # fell back to 2nd address
    assert not by["Dead"]["ok"]
    sci = [i for i in out["items"] if i["kind"] == "science"]
    assert len(sci) == 2 and all(not i["categories"] for i in sci)   # 1 per day cap; 2 different days
    assert len(out["items"]) == 8
    assert out["items"] == sorted(out["items"], key=lambda i: i["date"], reverse=True)
    fee = [i for i in out["items"] if "fee schedule" in i["title"].lower() and i["kind"] == "industry"]
    assert all("policy" in i["categories"] for i in fee)
    # the fee-schedule story ran in three outlets: it leads the top stories
    top = out["top_stories"]["industry"][0]
    assert len(top["sources"]) == 3 and "fee schedule" in top["title"].lower()
    # no history yet: trending is ranked by coverage across outlets
    week = out["trending"]["industry"]["week"]
    assert week["basis"] == "coverage"
    terms = [t["term"].lower() for t in week["terms"]]
    assert any("fee schedule" in t for t in terms) and any("photon-counting" in t for t in terms)
    # second run: stable ids, no duplicates
    out2 = build_news.run(env, NOW)
    assert len(out2["items"]) == 8
    assert all("systems" in i for i in out2["items"])
    assert out2["top_stories"]["science"] == []        # one science outlet: nothing "covered by several"


def test_double_escaped_html_and_sister_sites():
    assert news.clean_text("&lt;p&gt;About 35% of beneficiaries&lt;/p&gt;") == "About 35% of beneficiaries"
    now = NOW
    a = {"id": "1", "title": "Older patients with MS may not need frequent MRI monitoring", "link": "a", "source": "AuntMinnie", "date": "2026-11-23T10:00:00Z", "summary": ""}
    b = dict(a, id="2", link="b", source="AuntMinnie Europe")
    groups = {"AuntMinnie": "am", "AuntMinnie Europe": "am"}
    assert news.top_stories([a, b], now, group_of=groups) == []       # same publisher: not "covered by 2"
    c = dict(a, id="3", link="c", source="Radiology Business", title="MRI monitoring may be unnecessary in older MS patients")
    assert len(news.top_stories([a, b, c], now, group_of=groups)) == 1


def test_trending_merges_halves_of_one_headline():
    arch = []
    for n, src in enumerate(["A", "B", "C"]):
        arch.append({"id": f"m{n}", "title": "US loses measles elimination status after 25 years", "source": src,
                     "date": "2026-11-22T10:00:00Z"})
    terms = [t["term"] for t in news.trending(arch, NOW, 7, 28)["terms"]]
    assert sum("measles" in t or "elimination" in t for t in terms) == 1, terms


def test_podcast_episodes_keep_audio():
    eps = news.parse_feed((FIX / "news_podcast.xml").read_text(), "Short", NOW)
    assert eps[0]["audio"].startswith("https://example-npr.test/audio/cats.mp3")
    assert eps[0]["duration"] == 13
    assert news._duration("754") == 13 and news._duration("1:02:03") == 62 and news._duration("") is None
    rss = news.parse_feed((FIX / "news_rss.xml").read_text(), "Wire", NOW)
    assert "audio" not in rss[0]
