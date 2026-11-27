from datetime import date, datetime, timezone

from pipeline import sky
from pipeline.common import load_yaml


def _near(name, iso, phases):
    want = datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)
    got = min((w for w, n in phases if n == name), key=lambda w: abs((w - want).total_seconds()))
    return abs((got - want).total_seconds()) / 60


def test_moon_phases_match_published_times():
    # new and full moons at the eclipses of 2025–26 and two ordinary ones (USNO times, UTC)
    ph = sky.moon_phases(date(2025, 11, 1), date(2026, 9, 1))
    for name, iso in (("new", "2025-11-20T06:47"), ("full", "2025-12-04T23:14"), ("new", "2026-02-17T12:01"),
                      ("full", "2026-03-03T11:38"), ("new", "2026-08-12T17:37")):
        assert _near(name, iso, ph) < 3, (name, iso)
    days = [w.astimezone(sky.PT).date() for w, _ in sky.moon_phases(date(2026, 12, 1), date(2026, 12, 31))]
    assert days == [date(2026, 12, 8), date(2026, 12, 23)]
    assert sky.moon_lit(datetime(2026, 3, 3, 11, 38, tzinfo=timezone.utc)) > 0.98
    assert sky.moon_lit(datetime(2026, 2, 17, 12, 1, tzinfo=timezone.utc)) < 0.01


def test_meteor_showers_carry_the_moon():
    cfg = load_yaml("horizon.yaml")["sky"]
    ev = {e["title"]: e for e in sky.meteor_events(cfg["meteors"], date(2026, 12, 1), date(2027, 1, 31))}
    gem = ev["Geminids meteor shower peaks"]
    assert gem["start"] == "2026-12-13" and gem["sub"].startswith("Night of Dec 13–14 · Moon") and gem["approx"] == "about"
    assert "Jan 3–4" in ev["Quadrantids meteor shower peaks"]["sub"] and "dark skies" in ev["Quadrantids meteor shower peaks"]["sub"]
    assert all(e["kind"] == "sky" for e in ev.values())


def test_aurora_from_either_kp_format():
    now = datetime(2026, 11, 27, 20, tzinfo=timezone.utc)
    old = [["time_tag", "kp", "observed", "noaa_scale"], ["2026-11-27 00:00:00", "8.00", "observed", "G4"],
           ["2026-11-28 06:00:00", "7.33", "predicted", "G3"], ["2026-11-28 21:00:00", "7.67", "predicted", "G3"],
           ["2026-11-29 06:00:00", "5.00", "predicted", "G1"]]
    got = sky.aurora_events(old, now)
    # observed isn't a forecast; 1 PM in Reno is daylight; Kp 5 is too weak to reach Reno
    assert [(e["start"], e["sub"]) for e in got] == [("2026-11-27", "NOAA forecasts a strong geomagnetic storm (Kp 7.3, G3)")]
    new = [{"time_tag": "2026-11-29T12:00:00", "kp": 8.0, "observed": "predicted", "noaa_scale": "G4"}, {"bad": 1}]
    got = sky.aurora_events(new, now)
    assert got[0]["start"] == "2026-11-28" and "severe" in got[0]["sub"]      # 4 AM belongs to the night before
    assert sky.aurora_events({"oops": 1}, now) == [] and sky.kp_min({"aurora_kp": 99}) == 7.0
