"""Chain controls over the Sierra between Reno and the Bay Area, from Caltrans.

Caltrans posts every chain-control sign's status in its Commercial Wholesale Web Portal (CWWP2),
updated every minute, free for use in other applications; Caltrans's website information is in the
public domain unless marked otherwise (dot.ca.gov/conditions-of-use). District 3 covers I-80 over
Donner Summit, US-50 over Echo Summit and the roads around Lake Tahoe and Truckee.

The phone asks Caltrans itself when it can; this file is the fallback the roads job writes
(docs/data/roads.json), so both read the feed the same way."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional

CC_D3 = "https://cwwp2.dot.ca.gov/data/d3/cc/ccStatusD03.json"
# I-80 Donner Summit, US-50 Echo Summit, Tahoe and Truckee roads, SR-20 to the west
ROUTES = ("I-80", "US-50", "SR-89", "SR-267", "SR-28", "SR-20")
NONE = re.compile(r"^R-?0$", re.I)


def _s(v, n: int = 80) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _num(v) -> Optional[float]:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def parse_controls(data) -> list[dict]:
    """The signs on those routes with a chain control (or closure) in effect, R-1 the mildest."""
    out = []
    for row in (data or {}).get("data") or [] if isinstance(data, dict) else []:
        cc = (row or {}).get("cc") if isinstance(row, dict) else None
        if not isinstance(cc, dict):
            continue
        loc = cc.get("location") or {}
        route = _s(loc.get("route"), 12)
        if route not in ROUTES or str(cc.get("inService", "true")).lower() != "true":
            continue
        st = cc.get("statusData") or {}
        status, desc = _s(st.get("status"), 12), _s(st.get("statusDescription"), 240)
        if not status or NONE.match(status) or desc.lower().startswith("no chain controls"):
            continue
        ts = st.get("statusTimestamp") or {}
        when = f"{_s(ts.get('statusDate'), 10)}T{_s(ts.get('statusTime'), 8)}"
        out.append({"r": route, "dir": _s(loc.get("direction"), 12), "loc": _s(loc.get("locationName")),
                    "near": _s(loc.get("nearbyPlace"), 40), "pm": _num(loc.get("postmile")),
                    "s": status, "d": desc,
                    "t": when if re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", when) else ""})
    return sorted(out, key=lambda c: (ROUTES.index(c["r"]), c["dir"], c["pm"] if c["pm"] is not None else 0))


def snapshot(controls: list[dict], old: Optional[dict], now: datetime, heartbeat_hours: float = 6) -> Optional[dict]:
    """The file to write, or None to leave the last one: only when something changed, and every
    few hours anyway, so the app can tell the job is still checking."""
    stamp = now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if old and old.get("controls") == controls:
        try:
            last = datetime.fromisoformat(str(old.get("checked", "")).replace("Z", "+00:00"))
        except ValueError:
            last = None
        if last and now - last < timedelta(hours=heartbeat_hours):
            return None
    return {"generated": stamp, "checked": stamp, "source": "Caltrans CWWP2, District 3", "url": CC_D3,
            "routes": list(ROUTES), "controls": controls}
