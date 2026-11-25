"""Backup scheduled runs skip when the data is already fresh."""
import json
from datetime import datetime, timezone

from pipeline.due import age_hours, is_due

NOW = datetime(2026, 11, 25, 6, 47, tzinfo=timezone.utc)


def _data(tmp_path, generated):
    p = tmp_path / "x.json"
    p.write_text(json.dumps({"generated": generated}))
    return str(p)


def test_hours_rule(tmp_path):
    fresh, stale = _data(tmp_path, "2026-11-25T04:20:00Z"), None
    assert round(age_hours(fresh, NOW), 2) == 2.45
    assert not is_due(fresh, "5", "schedule", NOW)
    assert is_due(_data(tmp_path, "2026-11-24T22:00:00Z"), "5", "schedule", NOW)
    assert is_due(fresh, "5", "workflow_dispatch", NOW)                 # a run by hand always works
    assert is_due(str(tmp_path / "missing.json"), "5", "schedule", NOW)


def test_daily_rule(tmp_path):
    assert not is_due(_data(tmp_path, "2026-11-25T04:20:00Z"), "daily", "schedule", NOW)     # done today
    assert not is_due(_data(tmp_path, "2026-11-25T00:47:00Z"), "daily", "schedule", NOW)     # a manual run after midnight
    assert is_due(_data(tmp_path, "2026-11-24T23:30:00Z"), "daily", "schedule", NOW)         # late yesterday: still due
