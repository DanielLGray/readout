"""Daily job: Coming up → docs/data/horizon.json, docs/data/horizon.ics and docs/data/ics/<event>.ics

Reads the Federal Reserve's FOMC calendar, the BLS and BEA release calendars, the FDA advisory
committee calendar and Launch Library 2, adds stock-market holidays (NYSE rules), your meetings
(config/meetings.yaml) and the hand-checked dates in config/horizon.yaml. A source that can't be
read keeps its events from the last good run, and the app says which one is behind.

    python -m pipeline.build_horizon
"""
from __future__ import annotations

import os
import re
from datetime import date, datetime, timedelta, timezone

from . import horizon as H
from . import http as http_mod
from .common import DATA, load_yaml, now_iso, read_json, write_json
from .http import Http, log

FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
BLS = "https://www.bls.gov/schedule/news_release/bls.ics"
BLS_PAGE = "https://www.bls.gov/schedule/news_release/"
BEA_PAGE = "https://www.bea.gov/news/schedule"
FDA = "https://www.fda.gov/advisory-committees/advisory-committee-calendar"
FED_REG = "https://www.federalregister.gov/api/v1/documents.json"
LL2 = ["https://ll.thespacedevs.com/2.3.0/launches/upcoming/", "https://ll.thespacedevs.com/2.2.0/launch/upcoming/"]

SOURCES = {          # source name → the `src` its events carry, to keep them when it can't be read
    "fed": "Federal Reserve", "bls": "BLS", "bea": "BEA", "fda": "FDA", "launches": "Launch Library 2 (The Space Devs)",
}


def bea_calendar(http: Http) -> str:
    page = http.get_text(BEA_PAGE, {})
    links = re.findall(r'href="([^"]+\.ics[^"]*)"', page)
    if not links:
        raise RuntimeError("no calendar file linked from BEA's release schedule")
    url = links[0] if links[0].startswith("http") else "https://www.bea.gov" + ("" if links[0].startswith("/") else "/") + links[0]
    return http.get_text(url, {})


def launches(http: Http) -> dict:
    last = None
    for url in LL2:
        try:
            return http.get_json(url, {"limit": 100, "mode": "normal"})
        except Exception as exc:          # an older API version as a fallback
            last = exc
    raise RuntimeError(f"Launch Library 2: {last}")


def build(http: Http, cfg: dict, meetings: list, prev: dict, now: datetime) -> dict:
    today = now.astimezone(H.ET).date()
    start, stop = today - timedelta(days=1), today + timedelta(days=int(cfg.get("days_ahead", 120)))
    events: list[dict] = []
    status: dict = {}

    def source(name: str, fn):
        try:
            got = fn()
            status[name] = {"ok": True, "n": len(got)}
            events.extend(got)
            log(f"  {name}: {len(got)} events")
        except Exception as exc:
            msg = f"{type(exc).__name__}: {exc}"[:240]
            status[name] = {"ok": False, "error": msg}
            kept = [e for e in prev.get("events", []) if e.get("src") == SOURCES.get(name) and H.end_date(e) >= start]
            events.extend(kept)
            log(f"  {name}: FAILED ({msg}); keeping {len(kept)} from the last run")

    fomc = cfg.get("fomc") or {}
    no_decision = {H._d(d) for d in fomc.get("no_decision") or []}

    def fed():
        meetings_ = H.fomc_meetings(http.get_text(FED, {}))
        if not [m for m in meetings_ if m[1] >= today]:
            raise RuntimeError("no upcoming meetings found on the Fed's calendar page")
        return H.fomc_events(meetings_, no_decision, start, stop)

    source("fed", fed)
    if not status["fed"]["ok"] and not any(e.get("src") == "Federal Reserve" for e in events):
        fb = [(H._d(m[0]), H._d(m[1]), len(m) > 2 and m[2] == "sep") for m in fomc.get("fallback") or []]
        events.extend(H.fomc_events(fb, no_decision, start, stop))
        status["fed"]["fallback"] = True
    source("bls", lambda: H.releases(http.get_text(BLS, {}), cfg.get("bls") or [], "BLS", BLS_PAGE, start, stop))
    if not status["bls"]["ok"] and cfg.get("bls_fallback"):      # BLS's published schedule, from the config
        events[:] = [e for e in events if e.get("src") != "BLS"]
        rules = {r["title"]: r for r in cfg.get("bls") or []}
        for title, days in (cfg.get("bls_fallback") or {}).items():
            for d in days:
                when = datetime.combine(H._d(d), datetime.min.time().replace(hour=8, minute=30), tzinfo=H.ET)
                if start <= when.date() <= stop:
                    prev_month = (when.date().replace(day=1) - timedelta(days=1))      # each report covers the month before
                    events.append(H.event(f"bls-{H.slug(title)}-{when.date()}", "markets", title, when, sub=f"{prev_month:%B %Y} numbers",
                                          about=rules.get(title, {}).get("about", ""), url=BLS_PAGE, src="BLS"))
        status["bls"]["fallback"] = True
    source("bea", lambda: H.releases(bea_calendar(http), cfg.get("bea") or [], "BEA", BEA_PAGE, start, stop))
    def fda():
        # the Federal Register carries every FDA advisory committee meeting notice, with an API for exactly this
        data = http.get_json(FED_REG, {"conditions[agencies][]": "food-and-drug-administration", "conditions[type][]": "NOTICE",
                                       "conditions[term]": '"Notice of Meeting" "Advisory Committee"', "order": "newest", "per_page": 100,
                                       "conditions[publication_date][gte]": (today - timedelta(days=150)).isoformat(),
                                       "fields[]": ["title", "dates", "html_url", "publication_date"]})
        if not isinstance(data, dict) or "results" not in data:
            raise RuntimeError("the Federal Register sent something unexpected")
        got = H.fr_meetings(data, cfg.get("fda_include") or "^$", start, stop)
        log(f"  fda: {len(data.get('results') or [])} FDA meeting notices, {len(got)} upcoming on imaging or heart devices")
        return got

    source("fda", fda)
    source("launches", lambda: H.launch_events(launches(http), cfg.get("launches") or {}, start, stop))
    for name, got in (("markets", H.market_events(start, stop)), ("seasons", H.season_events(start, stop)),
                      ("meetings", H.meeting_events(meetings, start, stop)), ("dates", H.config_events(cfg.get("events"), start, stop))):
        status[name] = {"ok": True, "n": len(got)}
        events.extend(got)

    by_id = {}
    for e in events:
        by_id.setdefault(e["id"], e)
    out = sorted(by_id.values(), key=lambda e: (e["start"][:10], e["start"], e["title"]))
    unscheduled = [u for u in cfg.get("unscheduled") or [] if u.get("title") and u.get("when")]
    return {"generated": now_iso(), "days": int(cfg.get("days_ahead", 120)), "events": out,
            "unscheduled": unscheduled, "sources": status, "calendar": "data/horizon.ics"}


def write_calendars(data: dict) -> None:
    ics_dir = DATA / "ics"
    ics_dir.mkdir(parents=True, exist_ok=True)
    keep = set()
    for ev in data["events"]:
        name = f"{ev['id']}.ics"
        keep.add(name)
        body = H.calendar([ev], name=ev["title"])
        path = ics_dir / name
        if not path.exists() or path.read_text(encoding="utf-8") != body:
            path.write_text(body, encoding="utf-8", newline="")
    for old in ics_dir.glob("*.ics"):
        if old.name not in keep:
            old.unlink()
    (DATA / "horizon.ics").write_text(H.calendar(data["events"]), encoding="utf-8", newline="")


def main() -> int:
    cfg = load_yaml("horizon.yaml")
    meetings = (load_yaml("meetings.yaml") or {}).get("meetings") or []
    prev = read_json(DATA / "horizon.json", {}) or {}
    email = os.environ.get("NCBI_EMAIL", "").strip()
    if "@" in email:            # BLS asks automated requests to carry a contact email
        http_mod.HOST_AGENTS["www.bls.gov"] = f"{http_mod.USER_AGENT} contact: {email}"
    http = Http(intervals={"ll.thespacedevs.com": 5.0, "www.bls.gov": 2.0, "www.bea.gov": 1.0, "www.federalregister.gov": 1.0}, retries=3)
    data = build(http, cfg, meetings, prev, datetime.now(timezone.utc))
    write_json(DATA / "horizon.json", data)
    write_calendars(data)
    bad = [k for k, v in data["sources"].items() if not v.get("ok")]
    log(f"Coming up: {len(data['events'])} events" + (f"; couldn't read {', '.join(bad)}" if bad else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
