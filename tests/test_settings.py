"""Job settings changed in the app: what may change, how it's laid over the files, and the settings job."""
import json
import re
import shutil

import pytest

from pipeline import common, overrides as O, settings as ST
from pipeline.common import load_base, read_json
from pipeline.radar import compile_topic, matches

BASE = {k: load_base(v) for k, v in O.FILES.items()}


def doc(**parts):
    return {"v": 1, **parts}


def test_only_what_the_schema_lists_and_within_limits():
    ok = O.validate(doc(news={"set": {"settings.top_stories.days": 5, "alerts.agents_more": ["Gozellix ", "gozellix", "flotufolastat"]},
                              "items": {"sources": {"STAT": {"off": True}, "AuntMinnie": {"max_per_day": 12}}}}), BASE)
    assert ok["news"]["set"] == {"settings.top_stories.days": 5, "alerts.agents_more": ["Gozellix", "flotufolastat"]}
    assert ok["news"]["items"]["sources"] == {"STAT": {"off": True}, "AuntMinnie": {"max_per_day": 12}}
    bad = [doc(nope={}), doc(news={"set": {"settings.max_items": 9}}), doc(news={"set": {"settings.top_stories.days": 40}}),
           doc(news={"set": {"settings.top_stories.days": True}}), doc(news={"set": {"alerts.agents_more": ["a{1,9}"]}}),
           doc(news={"set": {"alerts.agents_more": ["x\\b"]}}), doc(news={"items": {"sources": {"Not an outlet": {"off": True}}}}),
           doc(news={"items": {"sources": {"STAT": {"urls": ["https://evil.test"]}}}}), doc(watch={"set": {"devices.pma_codes": ["NPTX"]}}),
           doc(watch={"set": {"settings.results_alert": "all"}}), doc(radar={"set": {"credible": ["Some blog"]}}),
           doc(radar={"add": {"topics": [{"name": "Fusion", "words": []}]}}), {"v": 2}, "nope"]
    for d in bad:
        with pytest.raises(O.OverrideError):
            O.validate(d, BASE)
    with pytest.raises(O.OverrideError):                         # one of your own topics can't take a built-in one's place
        O.validate(doc(watch={"add": {"trials": [{"name": "rlt", "words": ["x"]}, {"name": "RLT", "words": ["y"]}]}}), BASE)


def test_news_changes_laid_over_the_file():
    d = O.validate(doc(news={"set": {"settings.top_stories.min_outlets": 3, "alerts.agents_more": ["flotufolastat"], "exclude_more": ["horoscope"]},
                             "items": {"sources": {"STAT": {"off": True}, "AuntMinnie": {"max_per_day": 12, "everything_per_day": 4}}}}), BASE)
    cfg = O.apply("news", BASE["news"], d["news"])
    assert cfg["settings"]["top_stories"]["min_outlets"] == 3 and BASE["news"]["settings"]["top_stories"]["min_outlets"] == 2
    assert "STAT" not in [s["name"] for s in cfg["sources"]] and len(cfg["sources"]) == len(BASE["news"]["sources"]) - 1
    am = next(s for s in cfg["sources"] if s["name"] == "AuntMinnie")
    assert am["max_per_day"] == 12 and am["everything_per_day"] == 4
    assert re.search(cfg["alerts"]["agents"], "FDA clears Flotufolastat F 18", re.I) and re.search(cfg["alerts"]["agents"], "new gadopiclenol label")
    assert re.search(cfg["exclude"], "Your horoscope for today") and re.search(cfg["exclude"], "Horoscopes, ranked")
    assert not re.search(cfg["exclude"], "horoscoped")


def test_watch_and_radar_changes_and_your_own_topics():
    d = O.validate(doc(
        watch={"set": {"settings.results_alert": "phase2", "devices.pma_codes": ["npt", "DXY"], "devices.panels": ["CV", "RA"]},
               "items": {"trials": {"rlt": {"phases": ["PHASE3", "PHASE2"], "min_n": 100, "intr_more": ["Pb-203"]}, "ai": {"off": True}},
                         "rules": {"nrc-35": {"alert_on": False}, "fda-892": {"alert_on": True}}},
               "add": {"trials": [{"name": "Hepatic MRI", "words": ["gadoxetate", "hepatobiliary MRI"], "phases": ["PHASE3"]}]}},
        radar={"set": {"spot.min_publishers": 3, "spot.skip_more": ["Black Friday deals"], "credible": ["Nature", "Science"]},
               "items": {"topics": {"quantum": {"off": True}, "fusion": {"words_more": ["Proxima Fusion"]}}},
               "add": {"topics": [{"name": "Solid-state batteries", "words": ["solid-state battery", "QuantumScape"], "require": ["battery", "batteries"],
                                   "exclude": ["phone"]}]}}), BASE)
    w = O.apply("watch", BASE["watch"], d["watch"])
    assert w["settings"]["results_alert"] == "phase2" and w["devices"]["pma_codes"] == ["DXY", "NPT"] and w["devices"]["panels"] == ["RA", "CV"]
    rlt = next(t for t in w["trials"] if t["id"] == "rlt")
    assert rlt["phases"] == ["PHASE2", "PHASE3"] and rlt["min_n"] == 100 and rlt["intr"].endswith('OR "Pb-203"') and rlt["intr"].startswith("(")
    assert "ai" not in [t["id"] for t in w["trials"]]
    mine = next(t for t in w["trials"] if t["id"] == "my-hepatic-mri")
    assert mine["intr"] == '"gadoxetate" OR "hepatobiliary MRI"' and mine["phases"] == ["PHASE3"]
    rules = {r["id"]: r for r in w["rules"]}
    assert "alert" not in rules["nrc-35"] and rules["fda-892"]["alert"] == "." and rules["cms-pfs"]["alert"] == BASE["watch"]["rules"][0]["alert"]
    r = O.apply("radar", BASE["radar"], d["radar"])
    assert r["spot"]["min_publishers"] == 3 and r["credible"] == ["Nature", "Science"]
    assert re.search(r["spot"]["skip"], "black friday deals") and re.search(r["spot"]["skip"], "thanksgiving") and not re.search(r["spot"]["skip"], "black friday deals now")
    assert "quantum" not in [t["id"] for t in r["topics"]] and "Proxima Fusion" in next(t for t in r["topics"] if t["id"] == "fusion")["words"]
    t = compile_topic(next(t for t in r["topics"] if t["id"] == "my-solid-state-batteries"))
    assert matches(t, "QuantumScape ships its first solid-state battery cells") and not matches(t, "QuantumScape phone battery recall")
    assert not matches(t, "QuantumScape shares jump")                                       # needs battery too
    ST.compile_check(BASE, d)


def test_the_settings_job(tmp_path, monkeypatch):
    cfg, data = tmp_path / "config", tmp_path / "data"
    shutil.copytree(common.CONFIG, cfg, ignore=shutil.ignore_patterns("overrides.json"))
    data.mkdir()
    r = ST.run("", cfg, data)
    out = read_json(data / "config.json")
    assert r["jobs"] == [] and not (cfg / "overrides.json").exists() and out["overrides"] == {"v": 1} and "last" not in out
    assert {f["path"] for f in out["files"]["news"]["fields"]} >= {"alerts.outlets", "settings.top_stories.days"}
    assert next(L for L in out["files"]["news"]["lists"] if L["key"] == "sources")["items"][0]["group"] == "Industry news"
    changes = json.dumps(doc(news={"set": {"alerts.outlets": 3}}, watch={"items": {"trials": {"ai": {"off": True}}}}))
    r = ST.run(changes, cfg, data)
    saved = json.loads((cfg / "overrides.json").read_text())
    assert r["jobs"] == ["news", "watch"] and saved["news"] == {"set": {"alerts.outlets": 3}} and saved["at"]
    out = read_json(data / "config.json")
    assert out["last"]["ok"] and out["overrides"]["news"] and out["sig"] == out["last"]["sig"]
    r = ST.run(json.dumps(doc(news={"set": {"alerts.outlets": 9}})), cfg, data)             # out of range: nothing changes
    assert r["jobs"] == [] and json.loads((cfg / "overrides.json").read_text()) == saved
    assert not read_json(data / "config.json")["last"]["ok"] and "outside" in read_json(data / "config.json")["last"]["error"]
    r = ST.run(json.dumps({"v": 1}), cfg, data)                                               # all back to the files
    assert r["jobs"] == ["news", "watch"] and not (cfg / "overrides.json").exists()
    # a job loading its settings gets the changes; a damaged file is ignored
    ST.run(changes, cfg, data)
    monkeypatch.setattr(common, "CONFIG", cfg)
    monkeypatch.setenv("READOUT_OVERRIDES", "on")
    assert common.load_yaml("news.yaml")["alerts"]["outlets"] == 3 and common.load_base("news.yaml")["alerts"]["outlets"] == 2
    (cfg / "overrides.json").write_text("{broken")
    assert common.load_yaml("news.yaml")["alerts"]["outlets"] == 2


def test_trial_results_alert_setting():
    from datetime import date
    from pipeline import watch as W
    t = {"nct": "NCT01234567", "title": "x", "acr": "", "status": "COMPLETED", "pcd": "", "pcdType": "", "first": "2020-01-01",
         "updated": "2026-11-20", "results": "2026-11-20", "phases": ["PHASE2"], "type": "INTERVENTIONAL", "n": 80, "sponsor": "Acme"}
    tp = {"id": "rlt"}
    lv = lambda mode: [e["level"] for e in W.trial_events(None, t, tp, date(2026, 11, 26), date(2026, 11, 1), 60, mode) if e["what"] == "Results posted"]
    assert lv("phase3") == ["update"] and lv("phase2") == ["alert"] and lv("none") == ["update"]
