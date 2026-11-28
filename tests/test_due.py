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
    fresh = _data(tmp_path, "2026-11-25T04:20:00Z")
    assert round(age_hours(fresh, NOW), 2) == 2.45
    assert not is_due(fresh, "5", "schedule", NOW)
    assert is_due(_data(tmp_path, "2026-11-24T22:00:00Z"), "5", "schedule", NOW)
    assert is_due(fresh, "5", "workflow_dispatch", NOW)                 # a run by hand always works
    assert is_due(str(tmp_path / "missing.json"), "5", "schedule", NOW)


def test_daily_rule(tmp_path):
    assert not is_due(_data(tmp_path, "2026-11-25T04:20:00Z"), "daily", "schedule", NOW)     # done today
    assert not is_due(_data(tmp_path, "2026-11-25T00:47:00Z"), "daily", "schedule", NOW)     # a manual run after midnight
    assert is_due(_data(tmp_path, "2026-11-24T23:30:00Z"), "daily", "schedule", NOW)         # late yesterday: still due


def test_heavy_jobs_wait_for_off_peak(tmp_path, monkeypatch, capsys):
    from datetime import datetime, timezone
    from pipeline import due
    assert due.off_peak(datetime(2026, 11, 24, 3, 0, tzinfo=timezone.utc))          # Mon 10 PM Eastern
    assert not due.off_peak(datetime(2026, 11, 24, 16, 17, tzinfo=timezone.utc))     # Tue 11:17 AM Eastern: the late run
    assert due.off_peak(datetime(2026, 11, 28, 16, 0, tzinfo=timezone.utc))         # a Saturday
    out = tmp_path / "out.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    monkeypatch.setattr(due, "off_peak", lambda now=None: False)
    for event, want in (("schedule", "run=false"), ("workflow_dispatch", "run=true")):
        monkeypatch.setenv("GITHUB_EVENT_NAME", event)
        out.write_text("")
        due.main(["due", str(tmp_path / "missing.json"), "120", "offpeak"])
        assert out.read_text().strip() == want
    monkeypatch.setenv("GITHUB_EVENT_NAME", "schedule")
    out.write_text("")
    due.main(["due", str(tmp_path / "missing.json"), "120"])                          # jobs without offpeak run any time
    assert out.read_text().strip() == "run=true"
