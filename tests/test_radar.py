from datetime import date, datetime, timedelta, timezone

from pipeline import radar as R
from pipeline.common import load_yaml

NOW = datetime(2026, 11, 26, 18, tzinfo=timezone.utc)
TODAY = NOW.date()


def _h(i, title, source, days_ago, kind="science", summary=""):
    d = (NOW - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"id": f"h{i}", "title": title, "source": source, "date": d, "kind": kind, "summary": summary, "link": f"https://example.org/{i}"}


def _topics():
    return [R.compile_topic(t) for t in load_yaml("radar.yaml")["topics"]]


def test_topic_words_match_whole_words_and_acronyms_only_in_capitals():
    t = {x["id"]: x for x in _topics()}
    assert R.matches(t["fusion"], "Commonwealth Fusion's SPARC tokamak nears first plasma")
    assert not R.matches(t["fusion"], "Fusion protein therapy shows promise")
    assert not R.matches(t["fusion"], "Spinal fusion outcomes improve")
    assert R.matches(t["fusion"], "ITER delays first plasma") and not R.matches(t["fusion"], "The iter function in Python")
    assert R.matches(t["smr"], "NuScale wins approval for its SMR design")
    assert not R.matches(t["smr"], "SMR mortality ratio rises")                  # SMR needs a nuclear word too
    assert R.matches(t["quantum"], "Google’s Willow chip hits a quantum error correction milestone")
    assert not R.matches(t["quantum"], "Quantum dots light up cells")
    assert R.matches(t["space-elevator"], "Carbon nanotube fibers get strong enough for a space elevator")


def test_developments_keep_credible_single_sources_and_mark_the_rest():
    credible = {"Phys.org research", "Nature"}
    items = [
        _h(1, "Stellarator holds plasma for a record 43 seconds", "Phys.org research", 3),
        _h(2, "Record stellarator plasma lasts 43 seconds in German experiment", "Nature", 2),
        _h(3, "You won't believe this fusion startup's wild claim", "Popular Science", 1),
        _h(4, "Fusion startup claims net energy in a garage reactor", "Live Science", 1),
        _h(5, "Old tokamak result", "Phys.org research", 200),
    ]
    devs = R.developments(items, NOW, 120, credible)
    first = next(d for d in devs if "stellarator" in d["title"].lower())
    assert first["n"] == 2 and first["credible"] and first["label"] == "research" and first["id"] == "d:h1"
    hype = [d for d in devs if not d["credible"]]
    assert len(hype) == 1 and hype[0]["n"] == 2 and hype[0]["label"] == "other"   # two hype sites: corroborated, not credible
    assert not any("Old tokamak" in d["title"] for d in devs)                     # past the window


def test_momentum_heating_steady_quiet():
    iso = lambda days: (NOW - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    since = iso(300)
    hot = R.momentum([iso(d) for d in (1, 2, 5, 9, 20, 25, 40, 80)], NOW, since=since)
    assert hot["month"] == 6 and hot["usual"] == 0.7 and hot["status"] == "heating" and len(hot["weeks"]) == 26
    steady = R.momentum([iso(d) for d in (10, 45, 70, 100)], NOW, since=since)
    assert steady["status"] == "steady"
    assert R.momentum([iso(90)], NOW, since=since)["status"] == "quiet"


def test_research_trend_and_established_fields():
    t = R.research_trend({"2022": 40, "2023": 50, "2024": 60, "2025": 90, "2026": 70}, TODAY)
    assert t["last"] == 90 and t["prev"] == 60 and t["growth"] == 1.49 and t["rising"] and t["accel"]
    assert t["years"][0] == [2021, 0] and t["years"][-1] == [2026, 70]
    big_flat = R.research_trend({"2023": 9000, "2024": 9100, "2025": 9050}, TODAY)
    assert R.established(big_flat) and not R.established(t) and not R.established(None)


def test_spotting_new_phrases_and_not_names_or_formats():
    known = _topics()
    heads = [_h(i, f"Solid-state batteries {x}", s, d) for i, (x, s, d) in enumerate([
        ("hit a new record", "Phys.org research", 2), ("near production", "Tech Xplore", 5), ("could power EVs", "Ars Technica", 9)])]
    heads += [_h(10 + i, f"Jensen Huang {x}", s, d, "business") for i, (x, s, d) in enumerate([
        ("speaks", "WSJ Business", 1), ("again", "MarketWatch", 2), ("returns", "NPR Business", 3)])]
    heads += [_h(20 + i, f"Space photo: {x}", s, d) for i, (x, s, d) in enumerate([
        ("a nebula", "Space.com", 1), ("a galaxy", "Live Science", 2), ("a comet", "NASA", 3)])]
    heads += [_h(30 + i, f"Tokamak {x}", s, d) for i, (x, s, d) in enumerate([
        ("upgrade", "Phys.org research", 1), ("record", "Nature", 2), ("startup", "Ars Technica", 3)])]   # already a topic
    heads += [_h(40, "Perovskite solar cells improve", "Phys.org research", 2), _h(41, "Perovskite solar cells again", "Nature", 3),
              _h(42, "Perovskite solar cells", "Ars Technica", 4), _h(43, "Perovskite solar cells in 2025", "Nature", 60),
              _h(44, "Perovskite solar cells before", "Ars Technica", 70)]                                   # not new
    spotted = R.spot(heads, NOW, load_yaml("radar.yaml")["spot"], known, {"Phys.org research": "sciencex", "Tech Xplore": "sciencex"})
    terms = [c["term"].lower() for c in spotted]
    assert any("solid-state batteries" in t for t in terms)
    assert not any("jensen" in t or "photo" in t or "tokamak" in t or "perovskite" in t for t in terms)


def test_lifecycle_adds_after_weeks_and_retires_ones_that_never_pick_up():
    cfg = load_yaml("radar.yaml")
    cand = {"key": "solid state batteries", "term": "Solid-state batteries", "kind": "science"}
    state = {}
    for w in range(3):
        state = R.lifecycle(state, [cand], {}, cfg, TODAY + timedelta(weeks=w))
    assert "auto-solid-state-batteries" in state["auto"] and "solid state batteries" not in state["candidates"]
    # an established field is never added, however long it's in the headlines
    flat = {"solid state batteries": R.research_trend({"2023": 5000, "2024": 5000, "2025": 5000}, TODAY)}
    s2 = {}
    for w in range(4):
        s2 = R.lifecycle(s2, [cand], {}, cfg, TODAY + timedelta(weeks=w), flat)
    assert not s2.get("auto")
    # 18 months on, never heated: retired
    later = TODAY + timedelta(days=600)
    s3 = R.lifecycle(state, [], {"auto-solid-state-batteries": {"status": "steady", "last_hit": (later - timedelta(days=10)).isoformat()}}, cfg, later)
    assert "auto-solid-state-batteries" in s3["retired"] and "pick up" in s3["retired"]["auto-solid-state-batteries"]["reason"]
    # one that heated up stays
    s4 = R.lifecycle(state, [], {"auto-solid-state-batteries": {"status": "heating", "last_hit": TODAY.isoformat()}}, cfg, TODAY + timedelta(days=30))
    s4 = R.lifecycle(s4, [], {"auto-solid-state-batteries": {"status": "steady", "last_hit": (later - timedelta(days=10)).isoformat()}}, cfg, later)
    assert "auto-solid-state-batteries" in s4["auto"]


ARXIV_XML = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2611.01234v2</id>
    <published>2026-11-20T18:00:00Z</published>
    <title>Logical qubits below threshold
      on a neutral-atom array</title>
    <summary>We demonstrate ...</summary>
    <author><name>A. One</name></author><author><name>B. Two</name></author>
  </entry>
  <entry><id>http://example.com/not-arxiv</id><published>2026-11-20T18:00:00Z</published><title>x</title></entry>
</feed>"""


def test_arxiv_entries():
    e = R.arxiv_entries(ARXIV_XML)
    assert len(e) == 1 and e[0]["id"] == "arxiv:2611.01234" and e[0]["link"] == "https://arxiv.org/abs/2611.01234"
    assert e[0]["title"] == "Logical qubits below threshold on a neutral-atom array" and e[0]["authors"] == "A. One, B. Two"


class FakeHttp:
    def __init__(self):
        self.calls = []

    def get_json(self, url, params):
        self.calls.append((url, dict(params)))
        if "group_by" in params:
            return {"group_by": [{"key": "2024", "count": 60}, {"key": "2025", "count": 90}]}
        return {"results": [{"id": "https://openalex.org/W1", "doi": "https://doi.org/10.1/x", "display_name": "A fusion paper",
                             "publication_date": "2026-03-01", "cited_by_count": 40, "primary_location": {"source": {"display_name": "Nature"}}}]}

    def get_text(self, url, params):
        self.calls.append((url, dict(params)))
        return ARXIV_XML

    def request(self, method, url, params, expect_json=False):
        self.calls.append((url, {}))
        return """<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
          <item><title>Tokamak sets a record</title><link>https://phys.org/news/2026-11-tokamak.html</link>
          <pubDate>Wed, 25 Nov 2026 10:00:00 EST</pubDate><description>Fusion plasma held.</description></item></channel></rss>"""


def test_build_end_to_end(monkeypatch):
    from pipeline import build_radar
    cfg = load_yaml("radar.yaml")
    cfg["sources"] = cfg["sources"][:1]
    http = FakeHttp()
    news_data = {"items": [{"id": "n1", "title": "Helion starts building its fusion power plant", "source": "Ars Technica",
                            "date": "2026-11-24T12:00:00Z", "link": "https://arstechnica.com/x", "summary": ""}]}
    data, state, archive = build_radar.build(http, cfg, news_data, {}, {}, {}, NOW, have_key=False)
    fusion = next(t for t in data["topics"] if t["id"] == "fusion")
    titles = [d["title"] for d in fusion["developments"]]
    assert any("Tokamak" in x for x in titles) and any("Helion" in x for x in titles)
    assert fusion["preprints"] and data["sources"][-2]["name"] == "OpenAlex"
    # without a key only a couple of topics get research counts a day
    with_research = [t for t in data["topics"] if t["research"]]
    assert 1 <= len(with_research) <= 2 and with_research[0]["research"]["last"] == 90
    assert all("api_key" not in str(c) for c in http.calls)
    assert "n1" in archive and state["openalex"]
