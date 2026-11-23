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
    assert set(out["streams"]) == {"body_journals", "nm_body", "general_imaging"}
    # second run merges, keeps 'seen'
    out2 = build_feed.run(http)
    assert {i["pmid"] for i in items} <= {i["pmid"] for i in out2["items"]}


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
    assert top["sections"], "full abstract kept so the app's Abstract button works"
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
