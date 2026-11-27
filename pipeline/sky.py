"""The night sky for Coming up: full and new moons and meteor shower peaks, worked out here with no
source to ask, and strong geomagnetic storms from NOAA's 3-day Kp forecast (public domain).

Moon phases follow Meeus, Astronomical Algorithms (2nd ed.), chapter 49, without the small
planetary terms: good to a minute or two, plenty for a calendar."""
from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from .horizon import event

PT = ZoneInfo("America/Los_Angeles")         # Reno's clock
SYNODIC = 29.530588861
DELTA_T = 69.0                               # seconds, TT − UT around 2026 (it changes by well under a second a year)
SWPC_KP = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"
SWPC_PAGE = "https://www.swpc.noaa.gov/products/aurora-viewline-tonight-and-tomorrow-night"


def _jd_to_utc(jd: float) -> datetime:
    return datetime(2000, 1, 1, 12, tzinfo=timezone.utc) + timedelta(days=jd - 2451545.0)


def _utc_to_k(when: datetime) -> float:
    """The lunation number (Meeus's k) near a time: 0 is the new moon of January 6, 2000."""
    return (when - datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc)).total_seconds() / 86400 / SYNODIC


def phase_time(k: float) -> datetime:
    """The new moon (k a whole number) or full moon (k ending in .5) of lunation k, in UTC."""
    t = k / 1236.85
    jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * t**2 - 0.000000150 * t**3 + 0.00000000073 * t**4
    e = 1 - 0.002516 * t - 0.0000074 * t**2
    r = math.radians
    m = r(2.5534 + 29.10535670 * k - 0.0000014 * t**2 - 0.00000011 * t**3)
    mp = r(201.5643 + 385.81693528 * k + 0.0107582 * t**2 + 0.00001238 * t**3 - 0.000000058 * t**4)
    f = r(160.7108 + 390.67050284 * k - 0.0016118 * t**2 - 0.00000227 * t**3 + 0.000000011 * t**4)
    om = r(124.7746 - 1.56375588 * k + 0.0020672 * t**2 + 0.00000215 * t**3)
    full = abs(k - math.floor(k) - 0.5) < 0.01
    a, b, c, d = (-0.40614, 0.17302, 0.01614, 0.01043) if full else (-0.40720, 0.17241, 0.01608, 0.01039)
    g, h, i = (0.00734, -0.00515, 0.00209) if full else (0.00739, -0.00514, 0.00208)
    s = math.sin
    corr = (a * s(mp) + b * e * s(m) + c * s(2 * mp) + d * s(2 * f) + g * e * s(mp - m) + h * e * s(mp + m)
            + i * e * e * s(2 * m) - 0.00111 * s(mp - 2 * f) - 0.00057 * s(mp + 2 * f) + 0.00056 * e * s(2 * mp + m)
            - 0.00042 * s(3 * mp) + 0.00042 * e * s(m + 2 * f) + 0.00038 * e * s(m - 2 * f) - 0.00024 * e * s(2 * mp - m)
            - 0.00017 * s(om) - 0.00007 * s(mp + 2 * m) + 0.00004 * s(2 * mp - 2 * f) + 0.00004 * s(3 * m)
            + 0.00003 * s(mp + m - 2 * f) + 0.00003 * s(2 * mp + 2 * f) - 0.00003 * s(mp + m + 2 * f)
            + 0.00003 * s(mp - m + 2 * f) - 0.00002 * s(mp - m - 2 * f) - 0.00002 * s(3 * mp + m) + 0.00002 * s(4 * mp))
    return _jd_to_utc(jde + corr) - timedelta(seconds=DELTA_T)


def moon_phases(start: date, stop: date) -> list[tuple[datetime, str]]:
    """Every new and full moon whose Reno date falls from start to stop: (UTC time, "new" or "full")."""
    lo = datetime.combine(start, datetime.min.time(), tzinfo=PT) - timedelta(days=2)
    k = math.floor(_utc_to_k(lo.astimezone(timezone.utc))) - 1
    out = []
    while True:
        for kk, name in ((k, "new"), (k + 0.5, "full")):
            when = phase_time(kk)
            day = when.astimezone(PT).date()
            if day > stop:
                return out
            if day >= start:
                out.append((when, name))
        k += 1


def moon_lit(when: datetime) -> float:
    """How much of the Moon is lit at a time, 0 to 1, from its age since the last new moon."""
    k = math.floor(_utc_to_k(when)) + 1
    while phase_time(k) > when:
        k -= 1
    age = (when - phase_time(k)).total_seconds() / 86400
    return (1 - math.cos(2 * math.pi * age / SYNODIC)) / 2


def _clock(when: datetime) -> str:
    t = when.astimezone(PT)
    return f"{t:%-I:%M %p} Reno time"


def moon_events(start: date, stop: date) -> list[dict]:
    out = []
    for when, name in moon_phases(start, stop):
        day = when.astimezone(PT).date()
        if name == "full":
            out.append(event(f"moon-full-{day}", "sky", "Full moon", when, sub=f"Exactly full at {_clock(when)}",
                             about="Rises around sunset and is up all night. The bright nights around it wash out faint stars and meteors.",
                             src="Readout (Meeus's lunar phase method)"))
        else:
            out.append(event(f"moon-new-{day}", "sky", "New moon", when, sub=f"At {_clock(when)}: the darkest nights of the month for stargazing",
                             about="No moonlight on the nights around it: the best time for the Milky Way, faint stars and meteors away from city lights.",
                             src="Readout (Meeus's lunar phase method)"))
    return out


def meteor_events(showers: list[dict], start: date, stop: date) -> list[dict]:
    """Each shower's peak night (the evening it begins), with how bright the Moon will be."""
    out = []
    for y in range(start.year, stop.year + 1):
        for m in showers or []:
            try:
                night = date(y, int(m["month"]), int(m["day"]))
            except (KeyError, TypeError, ValueError):
                continue
            if not (start <= night <= stop):
                continue
            midnight = datetime.combine(night + timedelta(days=1), datetime.min.time(), tzinfo=PT)
            lit = moon_lit(midnight.astimezone(timezone.utc))
            pct = round(lit * 100)
            moon = (f"Moon {pct}% lit: dark skies" if lit < 0.25 else f"Moon {pct}% lit: only the brighter meteors"
                    if lit > 0.75 else f"Moon {pct}% lit")
            nxt = night + timedelta(days=1)
            span = f"{night:%b} {night.day}–{nxt.day}" if nxt.month == night.month else f"{night:%b} {night.day}–{nxt:%b} {nxt.day}"
            zhr = int(m.get("zhr") or 0)
            about = " ".join(x for x in (
                f"Up to about {zhr} an hour under ideal dark skies; fewer from town." if zhr else "",
                str(m.get("note") or "").strip()) if x)
            out.append(event(f"meteors-{night}", "sky", f"{m['name']} meteor shower peaks", night,
                             sub=f"Night of {span} · {moon}", about=about, approx="about",
                             url="https://www.imo.net/resources/calendar/", src="Readout (yearly peaks; the Moon worked out)"))
    return out


def parse_kp(data) -> list[tuple[datetime, float, str]]:
    """NOAA's 3-day Kp forecast: (UTC time, Kp, observed/estimated/predicted). Reads both its
    formats: a header row then value rows (until March 2026), and a list of objects (since)."""
    rows = data if isinstance(data, list) else []
    if rows and isinstance(rows[0], list):
        head = [str(h) for h in rows[0]]
        rows = [dict(zip(head, r)) for r in rows[1:] if isinstance(r, list)]
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            when = datetime.fromisoformat(str(r.get("time_tag", "")).replace(" ", "T").replace("Z", "")).replace(tzinfo=timezone.utc)
            kp = float(r.get("kp"))
        except (TypeError, ValueError):
            continue
        if 0 <= kp <= 9:
            out.append((when, kp, str(r.get("observed") or "").lower()))
    return out


def aurora_events(data, now: datetime, min_kp: float = 7) -> list[dict]:
    """A Coming up item for each Reno night NOAA forecasts a storm strong enough that the aurora
    may show low in the northern sky (Kp 7, a G3 storm; Kp 8 or more makes it likelier)."""
    nights: dict[date, float] = {}
    for when, kp, kind in parse_kp(data):
        if kind != "predicted" or when < now - timedelta(hours=3) or kp < min_kp:
            continue
        local = when.astimezone(PT)
        if 6 <= local.hour < 17:                     # daylight in Reno: only the dark hours count
            continue
        night = (local - timedelta(hours=12)).date()     # after midnight belongs to the evening before
        nights[night] = max(nights.get(night, 0), kp)
    out = []
    for night, kp in sorted(nights.items()):
        g = "G4 or stronger" if kp >= 8 else "G3"
        out.append(event(f"aurora-{night}", "sky", "Aurora possible from Reno", night,
                         sub=f"NOAA forecasts a {'severe' if kp >= 8 else 'strong'} geomagnetic storm (Kp {round(kp, 1):g}, {g})",
                         about="Look low in the northern sky after dark, away from city lights. Phone cameras often show it before your eyes do. Forecasts a day or more out often miss.",
                         url=SWPC_PAGE, src="NOAA Space Weather Prediction Center"))
    return out


def sky_events(cfg: dict, start: date, stop: date) -> list[dict]:
    return moon_events(start, stop) + meteor_events((cfg or {}).get("meteors") or [], start, stop)


def kp_min(cfg: Optional[dict]) -> float:
    v = (cfg or {}).get("aurora_kp", 7)
    return float(v) if isinstance(v, (int, float)) and 5 <= v <= 9 else 7.0
