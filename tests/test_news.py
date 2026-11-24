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
            {"name": "Wire", "home": "https://example-wire.test", "urls": ["https://wire.test/broken", "https://wire.test/feed"]},
            {"name": "Biz", "home": "https://example-business.test", "urls": ["https://biz.test/atom"]},
            {"name": "Minnie", "home": "https://example-minnie.test", "urls": ["https://minnie.test/sitemap-google-news.xml"]},
            {"name": "Dead", "urls": ["https://dead.test/rss"]},
            {"name": "SciWire", "kind": "science", "max_per_day": 1, "home": "https://example-sci.test", "urls": ["https://sci.test/feed"]},
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


def test_promotional_posts_excluded(env, monkeypatch):
    base = build_news.load_yaml("news.yaml")
    cfg = dict(base, exclude="gift guide|\\bdeals\\b|fee schedule")
    monkeypatch.setattr(build_news, "load_yaml", lambda name: cfg)
    out = build_news.run(env, NOW)
    sci = [i for i in out["items"] if i["kind"] == "science"]
    ind = [i for i in out["items"] if i["kind"] == "industry"]
    assert all("fee schedule" not in i["title"].lower() for i in sci)      # filtered outside industry
    assert any("fee schedule" in i["title"].lower() for i in ind)          # industry untouched


def test_tuning_knobs_and_settings_block(env, monkeypatch):
    base = build_news.load_yaml("news.yaml")
    tuned = dict(base, settings={"keep_days": 120, "top_stories": {"min_outlets": 4, "days": 7},
                                 "trending": {"phrases": 1}})
    monkeypatch.setattr(build_news, "load_yaml", lambda name: tuned)
    out = build_news.run(env, NOW)
    assert out["top_stories"]["industry"] == []            # the fee story had 3 outlets, 4 now required
    assert len(out["trending"]["industry"]["week"]["terms"]) <= 1
    s = out["settings"]
    assert s["top_stories"]["min_outlets"] == 4 and s["outlets"] == 5 and s["trending"]["week"] == [7, 28]


def test_skip_https_upgrade_and_stale_outlets():
    feed = """<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>A review of a novel</title><link>http://mag.test/non-fiction/review/</link><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>A poem</title><link>http://mag.test/poetry/a-poem/</link><pubDate>Sun, 22 Nov 2026 11:00:00 GMT</pubDate></item>
      <item><title>Elsewhere</title><link>http://other.test/x</link><pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>"""
    old = feed.replace("2026", "2023")
    pages = {"https://www.mag.test/feed": feed, "https://old.test/feed": old}
    http = Http(transport=lambda m, u, p: (200, pages[u]) if u in pages else (404, ""), sleep=lambda s: None, retries=1)
    got, st = build_news.fetch_source(http, {"name": "Mag", "urls": ["https://www.mag.test/feed"], "skip": "/poetry/"}, NOW)
    links = sorted(i["link"] for i in got)
    assert links == ["https://mag.test/non-fiction/review/"]     # poem skipped; same-site link upgraded; other site dropped
    assert st["ok"] and not st["stale"] and st["offsite"] == 1
    _, st2 = build_news.fetch_source(http, {"name": "Old", "home": "https://mag.test", "urls": ["https://old.test/feed"]}, NOW)
    assert st2["ok"] and st2["stale"]


def test_trending_ignores_archived_promos(env, monkeypatch, tmp_path):
    import json
    arch = {f"g{i}": [f"2026-11-2{i % 3}T10:00:00Z", f"Gift guide {i}: best telescopes", f"Outlet{i % 4}", "science"] for i in range(8)}
    (tmp_path / "cache").mkdir(exist_ok=True)
    (tmp_path / "cache" / "news_archive.json").write_text(json.dumps(arch))
    base = build_news.load_yaml("news.yaml")
    monkeypatch.setattr(build_news, "load_yaml", lambda name: dict(base, exclude="gift guide"))
    out = build_news.run(env, NOW)
    terms = [t["term"].lower() for t in out["trending"]["science"]["week"]["terms"]]
    assert not any("gift" in t for t in terms)


def test_episodes_sharing_one_link_stay_separate():
    feed = """<?xml version="1.0"?><rss version="2.0"><channel><title>Show</title>""" + "".join(
        f"<item><title>Episode {i}</title><link>https://show.test/</link><pubDate>Sun, {15 + i} Nov 2026 10:00:00 GMT</pubDate>"
        f"<enclosure url='https://cdn.test/{i}.mp3' type='audio/mpeg'/></item>" for i in range(4)) + "</channel></rss>"
    got = news.parse_feed(feed, "Show", NOW)
    assert len({i["id"] for i in got}) == 4


def test_skip_rule_clears_stored_stories(env, monkeypatch):
    out = build_news.run(env, NOW)
    assert any(i["source"] == "Wire" for i in out["items"])
    base = build_news.load_yaml("news.yaml")
    srcs = [dict(s, skip=".") if s["name"] == "Wire" else s for s in base["sources"]]
    monkeypatch.setattr(build_news, "load_yaml", lambda name: dict(base, sources=srcs))
    out2 = build_news.run(env, NOW)
    assert not any(i["source"] == "Wire" for i in out2["items"])


def test_top_stories_do_not_chain_unrelated_headlines():
    def it(i, src, title):
        return {"id": f"x{i}", "source": src, "title": title, "date": f"2026-11-2{i % 3}T10:00:00Z", "summary": ""}
    items = [it(1, "A", "First hormone therapy approved for early breast cancer in over 20 years"),
             it(2, "B", "FDA approves first hormone therapy for early breast cancer"),
             it(3, "C", "Can AI improve breast cancer diagnosis?"),
             it(4, "D", "HPV viral load may improve risk assessment for cervical cancer"),
             it(5, "E", "Game Awards 2026 nominees"), it(6, "F", "Xingyun Awards 2026 winners"),
             it(7, "G", "Voyager 1 reaches a historic milestone: one light-day from Earth"),
             it(8, "H", "Voyager 1 is now one 'light day' from Earth"),
             it(9, "I", "Voyager 1 is a full light-day away, and still going")]
    got = {st["title"][:20]: st["sources"] for st in news.top_stories(items, NOW)}
    assert len(got) == 2
    assert sorted(next(v for k, v in got.items() if "Voyager" in k)) == ["G", "H", "I"]
    assert sorted(next(v for k, v in got.items() if "hormone" in k.lower() or "FDA" in k)) == ["A", "B"]


def test_only_web_links_reach_the_app():
    feed = """<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>Hostile</title><link>javascript:alert(1)</link><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Relative</title><link>/news/relative-story</link><pubDate>Sun, 22 Nov 2026 11:00:00 GMT</pubDate></item>
      <item><title>Odd audio</title><link>https://site.test/ep</link><pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate>
        <enclosure url="data:audio/mpeg;base64,AAAA" type="audio/mpeg"/></item>
    </channel></rss>"""
    http = Http(transport=lambda m, u, p: (200, feed), sleep=lambda s: None, retries=1)
    got, _ = build_news.fetch_source(http, {"name": "S", "urls": ["https://site.test/feed"]}, NOW)
    links = sorted(i["link"] for i in got)
    assert links == ["https://site.test/ep", "https://site.test/news/relative-story"]
    assert not any(i.get("audio") for i in got)


def test_google_news_titles_credit_the_publisher():
    feed = """<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>ACR outlines 2027 fee schedule impact - Radiology Business</title><link>https://news.google.com/rss/articles/abc</link>
        <description>&lt;a href="x"&gt;ACR outlines 2027 fee schedule impact&lt;/a&gt;&amp;nbsp;&lt;font&gt;Radiology Business&lt;/font&gt;</description>
        <pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item>
    </channel></rss>"""
    http = Http(transport=lambda m, u, p: (200, feed), sleep=lambda s: None, retries=1)
    got, _ = build_news.fetch_source(http, {"name": "ACR", "kind": "societies", "google_news": True,
                                            "urls": ["https://news.google.com/rss/search?q=x"]}, NOW)
    assert got[0]["title"] == "ACR outlines 2027 fee schedule impact"
    assert got[0]["summary"] == "Reported by Radiology Business"


def test_summary_boilerplate():
    from pipeline.news import teaser
    assert teaser("<p>Galaxy survey results.</p>\n<p>The post <a href='x'>What Makes\nUp the Cosmos?</a> first appeared on <a>Quanta Magazine</a>.</p>") == \
        "Galaxy survey results."
    assert teaser("(MedPage Today) -- Weight loss may alter breast density.") == "Weight loss may alter breast density."
    assert teaser("Listen and subscribe on Apple Podcasts , Spotify , and all major podcast apps. In this episode we explore caves.") == \
        "In this episode we explore caves."
    assert teaser("Readers who listen to experts do better.") == "Readers who listen to experts do better."


def test_hacked_feed_cannot_add_links_or_entity_tricks():
    from pipeline import news
    feed = """<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>Real story</title><link>https://www.outlet.test/a</link><pubDate>Sun, 22 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Phishing</title><link>https://outlet-login.test/verify</link><pubDate>Sun, 22 Nov 2026 11:00:00 GMT</pubDate></item>
      <item><title>Partner page</title><link>https://partner.test/ep</link><pubDate>Sun, 22 Nov 2026 12:00:00 GMT</pubDate></item>
    </channel></rss>"""
    http = Http(transport=lambda m, u, p: (200, feed), sleep=lambda s: None, retries=1)
    got, st = build_news.fetch_source(http, {"name": "O", "home": "https://outlet.test", "link_domains": ["partner.test"],
                                             "urls": ["https://feeds.outlet.test/rss"]}, NOW)
    assert sorted(i["title"] for i in got) == ["Partner page", "Real story"] and st["offsite"] == 1
    assert news.site_of("https://news.bbc.co.uk/x") == "bbc.co.uk" and news.site_of("https://www.nature.com/a") == "nature.com"
    bomb = """<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]>
      <rss version="2.0"><channel><item><title>&lol2;</title><link>https://outlet.test/b</link></item></channel></rss>"""
    http2 = Http(transport=lambda m, u, p: (200, bomb), sleep=lambda s: None, retries=1)
    got2, st2 = build_news.fetch_source(http2, {"name": "O", "home": "https://outlet.test", "urls": ["https://outlet.test/rss"]}, NOW)
    assert got2 == [] and "entities" in st2["tried"][0]
