"""Alerts as notifications: the setup check, what gets sent, and when — offline (no push library)."""
import json
from datetime import datetime, timezone

import pytest

from pipeline import notify
from pipeline.common import read_json, write_json

NOW = datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc)
GOOD = {"v": 1, "sub": {"endpoint": "https://web.push.apple.com/QAbc-123_x", "keys": {"p256dh": "B" + "a" * 86, "auth": "c" * 22}},
        "key": "k" * 43, "groups": ["fda", "trials"]}


def test_parse_setup():
    s = notify.parse_setup(json.dumps(GOOD))
    assert s["host"] == "web.push.apple.com" and s["groups"] == ["fda", "trials"]
    for bad in ["nope", json.dumps({**GOOD, "v": 2}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "endpoint": "https://evil.test/push"}}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "endpoint": "http://web.push.apple.com/x"}}),
                json.dumps({**GOOD, "key": "short"}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "keys": {"p256dh": "x", "auth": "y"}}})]:
        with pytest.raises(notify.SetupError):
            notify.parse_setup(bad)


def _data(tmp_path, news_alerts=(), watch_events=()):
    write_json(tmp_path / "news.json", {"alerts": list(news_alerts)})
    write_json(tmp_path / "feed.json", {"alerts": []})
    write_json(tmp_path / "watch.json", {"events": list(watch_events)})


def test_first_run_learns_then_sends_each_new_alert_once(tmp_path):
    data, cache = tmp_path / "data", tmp_path / "cache"
    data.mkdir(); cache.mkdir()
    a1 = {"id": "n:1", "title": "FDA approves new PSMA tracer", "label": "FDA", "group": "fda", "date": "2026-11-25T10:00:00Z"}
    _data(data, [a1])
    sent = []
    sender = lambda setup, m: sent.append(m) or 201
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    assert sent == [] and st["ok"] and st["sent_total"] == 0                 # the first run only learns what's there
    a2 = {"id": "n:2", "title": "USPSTF drafts new screening advice", "label": "USPSTF", "group": "uspstf", "date": "2026-11-26T09:00:00Z"}
    w = {"id": "trial:NCT1:results-2026-11-26", "kind": "trial", "level": "alert", "title": "Lu-177 in mCRPC", "acr": "SPLASH",
         "what": "Results posted", "date": "2026-11-26", "seen": "2026-11-26"}
    _data(data, [a1, a2], [w])
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    # a2's group (uspstf) is off in the setup; the trial result goes out, once
    assert [m["body"] for m in sent] == ["SPLASH: Lu-177 in mCRPC (Results posted)"] and sent[0]["title"] == "Readout · Trial results"
    assert st["sent_total"] == 1 and st["last_sent"]
    notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    assert len(sent) == 1
    assert "endpoint" not in json.dumps(read_json(data / "notify.json")) and "push.apple" not in json.dumps(read_json(data / "notify.json"))


def test_many_new_alerts_summarize_and_expiry_is_reported(tmp_path):
    data, cache = tmp_path / "data", tmp_path / "cache"
    data.mkdir(); cache.mkdir()
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    _data(data, [{"id": f"n:{i}", "title": f"Story {i}", "label": "FDA", "group": "fda", "date": "2026-11-26"} for i in range(6)])
    sent = []
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, lambda s, m: sent.append(m) or 201)
    assert len(sent) == 3 and sent[-1]["body"] == "4 more new alerts this week"
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    st = notify.run(json.dumps(GOOD), True, NOW, data, cache, lambda s, m: 410)
    assert st["expired"] and not st["ok"] and "Turn notifications on again" in st["error"]


def test_bad_setup_is_reported_not_used(tmp_path):
    st = notify.run("{}", True, NOW, tmp_path, tmp_path, lambda s, m: pytest.fail("sent with a bad setup"))
    assert not st["ok"] and "PUSH_SETUP" in st["error"]
