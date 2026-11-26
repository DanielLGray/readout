"""Coming up: read official calendars into events, and write events back out as iCalendar.

Every event is a dict:
    id, kind (markets | medicine | science | news), title, sub, about, start, end, allDay,
    approx (a word like "about" when the date is an estimate), place, url, src
`start`/`end` are ISO dates ("2026-12-09") for all-day events, ISO datetimes with an offset otherwise.
"""
from __future__ import annotations

import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
MONTH_RE = "|".join(MONTHS)


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def event(id_: str, kind: str, title: str, start, end=None, *, sub: str = "", about: str = "", url: str = "",
          src: str = "", place: str = "", approx: str = "") -> dict:
    all_day = not isinstance(start, datetime)
    out = {"id": slug(id_) if not re.fullmatch(r"[a-z0-9-]+", id_) else id_, "kind": kind, "title": title,
           "start": start.isoformat(), "allDay": all_day}
    if end is not None and end != start:
        out["end"] = end.isoformat()
    for k, v in (("sub", sub), ("about", about), ("url", url), ("src", src), ("place", place), ("approx", approx)):
        if v:
            out[k] = v
    return out


def start_date(ev: dict) -> date:
    return date.fromisoformat(ev["start"][:10])


def end_date(ev: dict) -> date:
    return date.fromisoformat((ev.get("end") or ev["start"])[:10])


# ── iCalendar in ─────────────────────────────────────────────────────────────

def ics_events(text: str) -> list[dict]:
    """The VEVENTs of a calendar file, each as {PROPERTY: (value, {param: value})}."""
    out, cur = [], None
    for line in re.sub(r"\r?\n[ \t]", "", text or "").splitlines():
        if line.strip() == "BEGIN:VEVENT":
            cur = {}
        elif line.strip() == "END:VEVENT":
            if cur is not None:
                out.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            name, val = line.split(":", 1)
            key, *params = name.split(";")
            cur.setdefault(key.upper(), (val, dict(p.split("=", 1) for p in params if "=" in p)))
    return out


def ics_text(v: str) -> str:
    return re.sub(r"\s+", " ", v.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",")
                  .replace("\\;", ";").replace("\\\\", "\\")).strip()


def ics_time(val: str, params: dict, tz=ET):
    """A DTSTART as a date (all-day) or an aware datetime; floating times and unknown zone names
    are read in `tz` (the agencies' own: Eastern)."""
    v = val.strip()
    if params.get("VALUE", "").upper() == "DATE" or re.fullmatch(r"\d{8}", v):
        return date(int(v[:4]), int(v[4:6]), int(v[6:8]))
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)", v)
    if not m:
        return None
    dt = datetime(*(int(x) for x in m.groups()[:5]), int(m.group(6) or 0))
    if m.group(7):
        return dt.replace(tzinfo=timezone.utc)
    zone = tz
    tzid = params.get("TZID", "").strip('"')
    if tzid:
        try:
            zone = ZoneInfo(tzid)
        except Exception:          # "US-Eastern" and the like
            zone = tz
    return dt.replace(tzinfo=zone)


def releases(text: str, rules: list[dict], src: str, url: str, start: date, stop: date) -> list[dict]:
    """Agency release-calendar entries (BLS, BEA) whose titles match `rules`."""
    out, seen = [], set()
    for ve in ics_events(text):
        summary = ics_text(ve.get("SUMMARY", ("", {}))[0])
        if not summary or "DTSTART" not in ve:
            continue
        when = ics_time(*ve["DTSTART"])
        if when is None:
            continue
        day = when if not isinstance(when, datetime) else when.astimezone(ET).date()
        if not (start <= day <= stop):
            continue
        for r in rules:
            if re.search(r["match"], summary, re.I):
                key = (r["title"], day)
                if key in seen:
                    break
                seen.add(key)
                desc = ics_text(ve.get("DESCRIPTION", ("", {}))[0])
                period = re.search(r"\bfor ((?:%s) \d{4}|(?:first|second|third|fourth) quarter \d{4})" % MONTH_RE,
                                   f"{summary} {desc}", re.I)
                gdp = re.search(r"\((Advance|Second|Third) Estimate\).*?\b(\d)(?:st|nd|rd|th) Quarter(?: and Year)? (\d{4})", summary, re.I)
                month = re.search(r",\s*((?:%s) \d{4})\s*$" % MONTH_RE, summary, re.I)
                sub = (f"{gdp.group(1).capitalize()} estimate for Q{gdp.group(2)} {gdp.group(3)}" if gdp
                       else f"{period.group(1)} numbers" if period else f"{month.group(1)} numbers" if month else summary)
                out.append(event(f"{src.lower()}-{slug(r['title'])}-{day}", "markets", r["title"], when, sub=sub,
                                 about=r.get("about", ""), url=url, src=src))
                break
    return out


# ── Federal Reserve ──────────────────────────────────────────────────────────

FOMC_RE = re.compile(r"\b(%s)(?:/(%s))?\s+(\d{1,2})\s*-\s*(\d{1,2})(\*)?" % (MONTH_RE, MONTH_RE), re.I)


def fomc_meetings(page: str) -> list[tuple[date, date, bool]]:
    """(first day, decision day, with projections) for each regular meeting on the Fed's calendar page.
    Regular meetings are two days ("27-28", "April/May 30-1"); a trailing * marks new projections."""
    text = clean(page)
    heads = list(re.finditer(r"\b(\d{4}) FOMC Meetings\b", text))
    out = []
    for i, h in enumerate(heads):
        year = int(h.group(1))
        block = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        for m in FOMC_RE.finditer(block):
            m1 = MONTHS.index(m.group(1).lower()) + 1
            m2 = MONTHS.index(m.group(2).lower()) + 1 if m.group(2) else m1
            d1, d2 = int(m.group(3)), int(m.group(4))
            try:
                first = date(year, m1, d1)
                second = date(year + (1 if m2 < m1 else 0), m2, d2)
            except ValueError:
                continue
            if 0 < (second - first).days <= 2:
                out.append((first, second, bool(m.group(5))))
    return sorted(set(out))


def fomc_events(meetings: Iterable[tuple[date, date, bool]], no_decision: set, start: date, stop: date) -> list[dict]:
    out = []
    url = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
    for first, second, sep in meetings:
        if not (start <= second <= stop):
            continue
        span = f"{first:%b} {first.day}–{second.day}" if first.month == second.month else f"{first:%b} {first.day} – {second:%b} {second.day}"
        if second in no_decision:
            out.append(event(f"fomc-{second}", "markets", "Fed strategy meeting", first, second,
                             sub=f"FOMC, {span}. No rate decision at this one.",
                             about="The Federal Open Market Committee meets to discuss its longer-run strategy.", url=url, src="Federal Reserve"))
            continue
        when = datetime(second.year, second.month, second.day, 14, 0, tzinfo=ET)
        out.append(event(f"fomc-{second}", "markets", "Fed rate decision", when,
                         sub=f"FOMC meeting {span}. Statement at 2:00 pm ET, press conference at 2:30"
                         + (", with new economic projections." if sep else "."),
                         about="The Federal Reserve's interest-rate decision.", url=url, src="Federal Reserve"))
    return out


# ── stock market holidays (NYSE rules) ───────────────────────────────────────

def easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return date(y, month, day)


def _nth(y: int, month: int, weekday: int, n: int) -> date:
    d = date(y, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last(y: int, month: int, weekday: int) -> date:
    d = date(y, month + 1, 1) - timedelta(days=1) if month < 12 else date(y, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: date, saturday_rule: bool = True) -> Optional[date]:
    if d.weekday() == 5:
        return d - timedelta(days=1) if saturday_rule else None
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def market_days(y: int) -> list[tuple[date, str, str]]:
    """(day, "closed" | "early", why) for NYSE in year y. A holiday on Saturday closes the Friday
    before (except New Year's Day), on Sunday the Monday after; early closes are 1:00 pm ET."""
    out = []
    ny = _observed(date(y, 1, 1), saturday_rule=False)
    if ny:
        out.append((ny, "closed", "New Year's Day"))
    out += [(_nth(y, 1, 0, 3), "closed", "Martin Luther King Jr. Day"),
            (_nth(y, 2, 0, 3), "closed", "Washington's Birthday"),
            (easter(y) - timedelta(days=2), "closed", "Good Friday"),
            (_last(y, 5, 0), "closed", "Memorial Day"),
            (_observed(date(y, 6, 19)), "closed", "Juneteenth"),
            (_observed(date(y, 7, 4)), "closed", "Independence Day"),
            (_nth(y, 9, 0, 1), "closed", "Labor Day")]
    thanks = _nth(y, 11, 3, 4)
    out += [(thanks, "closed", "Thanksgiving"), (thanks + timedelta(days=1), "early", "the day after Thanksgiving"),
            (_observed(date(y, 12, 25)), "closed", "Christmas")]
    if date(y, 7, 3).weekday() < 4:
        out.append((date(y, 7, 3), "early", "the day before Independence Day"))
    if date(y, 12, 24).weekday() < 4:
        out.append((date(y, 12, 24), "early", "Christmas Eve"))
    return sorted(out)


def market_events(start: date, stop: date) -> list[dict]:
    out = []
    for y in range(start.year, stop.year + 1):
        for d, kind, why in market_days(y):
            if start <= d <= stop:
                if kind == "closed":
                    out.append(event(f"nyse-{d}", "markets", "Stock market closed", d, sub=why, src="NYSE holiday rules",
                                     url="https://www.nyse.com/markets/hours-calendars"))
                else:
                    out.append(event(f"nyse-{d}", "markets", "Stock market closes early", d, sub=f"1:00 pm ET, {why}",
                                     src="NYSE holiday rules", url="https://www.nyse.com/markets/hours-calendars"))
    return out


def season_events(start: date, stop: date) -> list[dict]:
    """Earnings season, roughly: the big banks open it about two weeks after each quarter ends.
    The app replaces this with the banks' real dates when it has them."""
    out = []
    labels = {1: "Q4", 4: "Q1", 7: "Q2", 10: "Q3"}
    for y in range(start.year, stop.year + 1):
        for month, q in labels.items():
            d = date(y, month, 14)
            while d.weekday() > 4:
                d += timedelta(days=1)
            if start <= d <= stop:
                out.append(event(f"season-{d:%Y-%m}", "markets", f"{q} earnings season begins", d, approx="about",
                                 sub="The big banks report first; the largest tech companies follow in the last week of the month.",
                                 src="Readout estimate"))
    return out


# ── FDA advisory committees ─────────────────────────────────────────────────

FDA_LINK = re.compile(r'<a\b[^>]*href="((?:https://www\.fda\.gov)?/advisory-committees/advisory-committee-calendar/[^"#?]+)"[^>]*>(.*?)</a>', re.S | re.I)


def fda_date(href: str, title: str) -> Optional[tuple[date, date]]:
    for s in (href.rsplit("/", 1)[-1].replace("-", " "), title):
        m = re.search(r"\b(%s) (\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?,? (\d{4})\b" % MONTH_RE, s, re.I)
        if m:
            mo, y = MONTHS.index(m.group(1).lower()) + 1, int(m.group(4))
            try:
                return date(y, mo, int(m.group(2))), date(y, mo, int(m.group(3) or m.group(2)))
            except ValueError:
                pass
    m = re.search(r"(\d{2})(\d{2})(\d{4})$", href)
    if m:
        try:
            d = date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            return d, d
        except ValueError:
            pass
    return None


def fda_meetings(page: str, include: str, start: date, stop: date) -> list[dict]:
    out, seen = [], set()
    inc = re.compile(include, re.I)
    for href, inner in FDA_LINK.findall(page or ""):
        title = clean(inner)
        if not title or href in seen or re.search(r"postponed|cancel", f"{title} {href}", re.I):
            continue
        seen.add(href)
        if not inc.search(title):
            continue
        dates = fda_date(href, title)
        if not dates or not (start <= dates[1] and dates[0] <= stop):
            continue
        name = re.sub(r"^(?:updated[^:]*:\s*)?(?:%s)[^:]*:\s*" % MONTH_RE, "", title, flags=re.I)
        name = re.sub(r"\s*(?:of the Medical Devices Advisory Committee)?\s*(?:Advisory Committee\s*)?Meeting Announcement.*$", "", name, flags=re.I)
        name = re.sub(r"\s+-\s+\d{2}/\d{2}/\d{4}.*$", "", name).strip() or title
        url = href if href.startswith("http") else f"https://www.fda.gov{href}"
        out.append(event(f"fda-{dates[0]}-{slug(name)}", "medicine", f"FDA panel: {name}", dates[0], dates[1],
                         sub="Public advisory committee meeting", about="FDA's outside experts discuss and vote on a product or question; FDA usually follows their advice.",
                         url=url, src="FDA"))
    return out


def fr_meetings(data: dict, include: str, start: date, stop: date) -> list[dict]:
    """FDA advisory committee meetings from Federal Register notices (each notice's DATES section
    says when the meeting is: "The meeting will take place virtually on December 3, 2025, ...")."""
    out, seen = [], set()
    inc = re.compile(include, re.I)
    for d in (data or {}).get("results", []):
        title = clean(d.get("title") or "")
        if not inc.search(title) or not re.search(r"notice of meeting", title, re.I) or re.search(r"cancel|postpone", title, re.I):
            continue
        m = re.search(r"\b(%s) (\d{1,2})(?:\s*(?:-|–|and|through)\s*(\d{1,2}))?,? (\d{4})" % MONTH_RE, d.get("dates") or "", re.I)
        if not m:
            continue
        mo, y = MONTHS.index(m.group(1).lower()) + 1, int(m.group(4))
        try:
            first, last = date(y, mo, int(m.group(2))), date(y, mo, int(m.group(3) or m.group(2)))
        except ValueError:
            continue
        if last < start or first > stop:
            continue
        name = re.split(r";", title)[0]
        name = re.sub(r"\s+of the (?:Medical Devices )?Advisory Committee$", "", name, flags=re.I).strip()
        key = (name, first)
        if key in seen:
            continue
        seen.add(key)
        topic = re.split(r"--|—", title)[-1].strip() if re.search(r"--|—", title) else ""
        out.append(event(f"fda-{first}-{slug(name)}", "medicine", f"FDA panel: {name}", first, last,
                         sub=topic or "Public advisory committee meeting",
                         about="FDA's outside experts discuss and vote on a product or question; FDA usually follows their advice.",
                         url=d.get("html_url") or "", src="FDA"))
    return out


# ── launches (Launch Library 2, The Space Devs) ──────────────────────────────

PRECISE = {"second", "minute", "hour", "day"}


def launch_events(data: dict, rules: dict, start: date, stop: date) -> list[dict]:
    out = []
    rockets = re.compile(rules.get("rockets") or "^$", re.I)
    types = re.compile(rules.get("mission_types") or "^$", re.I)
    skip = re.compile(rules.get("skip_names") or "^$", re.I)
    for r in (data or {}).get("results", []):
        name = r.get("name") or ""
        rocket = (((r.get("rocket") or {}).get("configuration") or {}).get("name")) or ""
        mission = r.get("mission") or {}
        mtype = mission.get("type") or ""
        crewed = bool(re.search(r"crew|human", f"{mtype} {name}", re.I))
        if skip.search(name) and not rockets.search(rocket):
            continue
        if not (rockets.search(rocket) or types.search(mtype) or crewed):
            continue
        net = r.get("net") or ""
        try:
            when = datetime.fromisoformat(net.replace("Z", "+00:00"))
        except ValueError:
            continue
        day = when.astimezone(ET).date()
        if not (start <= day <= stop):
            continue
        prec = str(((r.get("net_precision") or {}).get("name")) or "").lower()
        mname = (mission.get("name") or name.split("|")[-1]).strip()
        provider = ((r.get("launch_service_provider") or {}).get("name")) or ""
        place = (((r.get("pad") or {}).get("location") or {}).get("name")) or ""
        status = ((r.get("status") or {}).get("abbrev")) or ""
        exact = prec in {"second", "minute", "hour"} or (not prec and status == "Go")
        start_v = when if exact else day
        approx = "" if prec in PRECISE or not prec else "no earlier than"
        out.append(event(f"launch-{r.get('id') or slug(name)}", "science", f"Launch: {mname}", start_v,
                         sub=" · ".join(x for x in (rocket, provider) if x), place=place, approx=approx,
                         about=clean(mission.get("description") or "")[:400],
                         url=f"https://ll.thespacedevs.com/2.3.0/launches/{r['id']}/" if r.get("id") else "",
                         src="Launch Library 2 (The Space Devs)"))
    return out[: int(rules.get("max", 12))]


# ── your meetings, and dates from the config ─────────────────────────────────

def _d(v) -> date:
    return v if isinstance(v, date) else date.fromisoformat(str(v))


def meeting_events(meetings: list[dict], start: date, stop: date) -> list[dict]:
    out = []
    for m in meetings or []:
        try:
            s, e = _d(m["start"]), _d(m.get("end") or m["start"])
        except (KeyError, ValueError):
            continue
        if e < start or s > stop:
            continue
        ev = event(f"meeting-{m['id']}", "medicine", m.get("name") or m["id"], s, e, sub=m.get("full", ""),
                   place=m.get("place", ""), url=m.get("url", ""), src="Your meetings")
        ev["meeting"] = m["id"]
        out.append(ev)
    return out


def config_events(items: list[dict], start: date, stop: date) -> list[dict]:
    out = []
    for it in items or []:
        try:
            s, e = _d(it["start"]), _d(it.get("end") or it["start"])
        except (KeyError, ValueError):
            continue
        if e < start or s > stop:
            continue
        out.append(event(it.get("id") or f"{slug(it['title'])}-{s}", it.get("kind", "news"), it["title"], s, e,
                         sub=it.get("sub", ""), about=it.get("about", ""), place=it.get("place", ""), url=it.get("url", ""),
                         src=it.get("src", "Checked by hand"), approx=it.get("approx", "")))
    return out


# ── iCalendar out ────────────────────────────────────────────────────────────

def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line: str) -> str:
    out, cur = [], ""
    for ch in line:
        if len((cur + ch).encode()) > 74:
            out.append(cur)
            cur = " " + ch
        else:
            cur += ch
    out.append(cur)
    return "\r\n".join(out)


def vevent(ev: dict) -> list[str]:
    if ev["allDay"]:
        s, e = start_date(ev), end_date(ev) + timedelta(days=1)
        times = [f"DTSTART;VALUE=DATE:{s:%Y%m%d}", f"DTEND;VALUE=DATE:{e:%Y%m%d}"]
        stamp = f"{s:%Y%m%d}T000000Z"
    else:
        s = datetime.fromisoformat(ev["start"]).astimezone(timezone.utc)
        e = datetime.fromisoformat(ev["end"]).astimezone(timezone.utc) if ev.get("end") and "T" in ev["end"] else s + timedelta(hours=1)
        times = [f"DTSTART:{s:%Y%m%dT%H%M%SZ}", f"DTEND:{e:%Y%m%dT%H%M%SZ}"]
        stamp = f"{s:%Y%m%dT%H%M%SZ}"
    desc = " ".join(x for x in (ev.get("sub"), ev.get("about"), f"({ev['approx']} this date)" if ev.get("approx") else "",
                                f"Source: {ev['src']}." if ev.get("src") else "") if x)
    lines = ["BEGIN:VEVENT", f"UID:{ev['id']}@readout", f"DTSTAMP:{stamp}", *times, f"SUMMARY:{_esc(ev['title'])}"]
    if desc:
        lines.append(f"DESCRIPTION:{_esc(desc)}")
    if ev.get("place"):
        lines.append(f"LOCATION:{_esc(ev['place'])}")
    if ev.get("url"):
        lines.append(f"URL:{ev['url']}")
    if ev.get("approx"):
        lines.append("STATUS:TENTATIVE")
    lines.append("TRANSP:TRANSPARENT")
    lines.append("END:VEVENT")
    return lines


def calendar(events: list[dict], name: str = "Readout: Coming up") -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Readout//Coming up//EN", "CALSCALE:GREGORIAN",
             f"X-WR-CALNAME:{_esc(name)}", "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H"]
    for ev in events:
        lines += vevent(ev)
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"
