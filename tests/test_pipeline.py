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
    top = topics["psma_pet"]["windows"]["5"]["top"][0]
    assert top["conclusion"]["text"] and top["metrics"]["cites"] > 0
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
