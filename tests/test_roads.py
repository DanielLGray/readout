from datetime import datetime, timedelta, timezone

from pipeline import build_roads, roads
from pipeline.common import read_json
from pipeline.http import Http


def _cc(route, status, desc, place="Truckee", d="West", pm="20.1", service="true"):
    return {"cc": {"index": f"3-NEV-{route}-{pm}", "location": {"district": "3", "locationName": f"near {place}", "nearbyPlace": place,
                                                              "direction": d, "route": route, "postmile": pm},
                   "inService": service, "statusData": {"statusTimestamp": {"statusDate": "2026-11-27", "statusTime": "14:05:00"},
                                                       "status": status, "statusDescription": desc}}}


FEED = {"data": [
    _cc("I-80", "R-2", "Chains are required on all vehicles except four wheel drive vehicles with snow tires on all four wheels.", pm="25.7"),
    _cc("I-80", "R-0", "No chain controls are in effect at this time.", place="Colfax", pm="3.0"),
    _cc("US-50", "R-1", "Chains are required on all vehicles except passenger vehicles and light-duty trucks with snow tires.", place="Echo Summit", d="East"),
    _cc("SR-49", "R-2", "Chains required", place="Sierra City"),                  # not a road we watch
    _cc("I-80", "R-3", "Chains required on all vehicles", place="Kingvale", service="false"),     # out of service
    {"cc": None}, "junk",
]}


def test_parse_keeps_active_controls_on_our_routes():
    got = roads.parse_controls(FEED)
    assert [(c["r"], c["s"], c["near"], c["dir"]) for c in got] == [("I-80", "R-2", "Truckee", "West"), ("US-50", "R-1", "Echo Summit", "East")]
    assert got[0]["t"] == "2026-11-27T14:05:00" and got[0]["pm"] == 25.7 and got[0]["d"].startswith("Chains are required")
    assert roads.parse_controls({"data": "x"}) == [] and roads.parse_controls(None) == []


def test_snapshot_writes_on_change_or_every_few_hours():
    now = datetime(2026, 11, 27, 22, tzinfo=timezone.utc)
    c = roads.parse_controls(FEED)
    first = roads.snapshot(c, None, now)
    assert first["checked"] == "2026-11-27T22:00:00Z" and first["controls"] == c
    assert roads.snapshot(c, first, now + timedelta(hours=2)) is None                  # same, and recent
    assert roads.snapshot(c, first, now + timedelta(hours=7))["checked"] == "2026-11-28T05:00:00Z"
    assert roads.snapshot(c[:1], first, now + timedelta(minutes=30)) is not None        # a change goes at once


def test_job_writes_the_file_and_keeps_it_when_caltrans_fails(tmp_path, monkeypatch):
    import json
    monkeypatch.setattr(build_roads, "DATA", tmp_path)
    http = Http(transport=lambda m, u, p: (200, json.dumps(FEED)), sleep=lambda s: None, retries=1)
    now = datetime(2026, 11, 27, 22, tzinfo=timezone.utc)
    assert build_roads.main(http, now) == 0
    saved = read_json(tmp_path / "roads.json")
    assert len(saved["controls"]) == 2 and saved["source"].startswith("Caltrans")
    bad = Http(transport=lambda m, u, p: (503, "busy"), sleep=lambda s: None, retries=1)
    assert build_roads.main(bad, now + timedelta(hours=8)) == 0
    assert read_json(tmp_path / "roads.json") == saved
