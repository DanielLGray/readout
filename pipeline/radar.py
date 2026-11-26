"""Radar: emerging topics before they're mainstream.

Topics (yours from config/radar.yaml, plus ones the job spots itself) gather developments from
research news, preprints and the news job's outlets. Each development records who reported it, so
the app can keep the early-but-credible ones and drop the dross. Momentum comes from headline
counts (this month against the usual) and from research output (OpenAlex works per year).

Spotting: phrases that are new in science, health and business headlines, from at least two
publishers, are candidates; one that keeps turning up for a few weeks becomes a topic by itself,
and a spotted topic that never heats up is retired after a year and a half.
"""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Optional

from . import news
from .terms import _contains, display, phrases

# ── topics ───────────────────────────────────────────────────────────────────

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48]


def compile_topic(t: dict, origin: str = "you") -> dict:
    """Words match whole words, any case; short all-capital acronyms (SMR, ITER) match only in
    capitals, so "iter" or "smr" in other senses don't count."""
    words = [str(w).strip() for w in t.get("words") or [] if str(w).strip()]
    caps = [w for w in words if re.fullmatch(r"[A-Z][A-Z0-9-]{1,5}s?", w)]
    rest = [w for w in words if w not in caps]
    alt = lambda ws: r"(?<![\w-])(?:" + "|".join(re.escape(w) for w in sorted(ws, key=len, reverse=True)) + r")(?![\w-])"
    return {
        "id": t["id"], "name": t.get("name") or t["id"], "origin": origin,
        "words": words,
        "re_ci": re.compile(alt(rest), re.I) if rest else None,
        "re_cs": re.compile(alt(caps)) if caps else None,
        "require": re.compile(t["require"], re.I) if t.get("require") else None,
        "exclude": re.compile(t["exclude"], re.I) if t.get("exclude") else None,
        "arxiv": t.get("arxiv") or " OR ".join(f'abs:"{w}"' for w in words[:6]),
        "openalex": t.get("openalex") or " OR ".join(f'"{w}"' for w in words[:6]),
    }


def matches(topic: dict, text: str) -> bool:
    if not text:
        return False
    if topic["exclude"] and topic["exclude"].search(text):
        return False
    if not ((topic["re_ci"] and topic["re_ci"].search(text)) or (topic["re_cs"] and topic["re_cs"].search(text))):
        return False
    return not topic["require"] or bool(topic["require"].search(text))


# ── developments: one story, however many outlets ran it ─────────────────────

def label_for(sources: set, credible: set) -> str:
    if sources and sources <= {"arXiv"}:
        return "preprint"
    if sources & {"Phys.org", "Phys.org research", "Tech Xplore"}:
        return "research"
    if sources & credible:
        return "newsroom"
    return "other"


def developments(items: list[dict], now: datetime, days: int, credible: set, group_of: Optional[dict] = None,
                 limit: int = 30) -> list[dict]:
    """Group a topic's items into developments. Each keeps its first headline's id, so it keeps
    its identity as more outlets pick it up."""
    group_of = group_of or {}
    cutoff = news._utc(now - timedelta(days=days))
    recent = [i for i in items if i.get("date", "") >= cutoff]
    by_id = {i["id"]: i for i in recent}
    clusters = news.top_stories(recent, now, days=days, limit=10 ** 6, group_of=group_of, min_outlets=1)
    seen, out = set(), []
    groups = [[by_id[x] for x in c["items"] if x in by_id] for c in clusters]
    groups += [[i] for i in recent if not any(i["id"] in c["items"] for c in clusters)]     # too short to cluster
    for members in groups:
        members = [m for m in members if m["id"] not in seen]
        if not members:
            continue
        seen.update(m["id"] for m in members)
        members.sort(key=lambda m: m["date"])
        first, last = members[0], members[-1]
        sources = {m["source"] for m in members}
        lead = next((m for m in members if m["source"] in credible), first)
        out.append({
            "id": f"d:{first['id']}", "title": lead["title"], "date": first["date"], "updated": last["date"],
            "sources": sorted(sources), "n": len({group_of.get(s, s) for s in sources}),
            "credible": bool(sources & credible), "label": label_for(sources, credible),
            "items": [{k: m[k] for k in ("title", "source", "date", "link") if m.get(k)}
                      for m in sorted(members, key=lambda m: m["date"], reverse=True)[:6]],
        })
    out.sort(key=lambda d: d["updated"], reverse=True)
    return out[:limit]


# ── momentum ─────────────────────────────────────────────────────────────────

def momentum(dates: list[str], now: datetime, heating: float = 2.0, since: Optional[str] = None) -> dict:
    """Headlines in the last 30 days against the usual (the 90 days before, per 30 days), 26 weekly
    counts, and a status: heating (well above usual), steady, or quiet (none in 60 days)."""
    def ago(d: str) -> float:
        when = news.parse_date(d)
        return (now - when).total_seconds() / 86400 if when else 9999
    days = [ago(d) for d in dates]
    month = sum(1 for x in days if 0 <= x < 30)
    prior = sum(1 for x in days if 30 <= x < 120)
    tracked = ago(since) if since else 9999
    span = max(30.0, min(90.0, tracked - 30)) if tracked < 120 else 90.0
    usual = round(prior * 30 / span, 1) if tracked >= 60 else None
    weeks = [sum(1 for x in days if w * 7 <= x < (w + 1) * 7) for w in range(25, -1, -1)]
    if not any(0 <= x < 60 for x in days):
        status = "quiet"
    elif month >= 3 and (usual is None and month >= 6 or usual is not None and month >= heating * max(usual, 1)):
        status = "heating"
    else:
        status = "steady"
    return {"month": month, "usual": usual, "weeks": weeks, "status": status}


def research_trend(years: dict, today: date) -> dict:
    """Works per year (OpenAlex): the last six years, and last full year's change on the year before."""
    y = today.year
    c = {int(k): int(v) for k, v in (years or {}).items() if str(k).isdigit()}
    last, prev = c.get(y - 1, 0), c.get(y - 2, 0)
    growth = round((last + 1) / (prev + 1), 2)
    before = round((prev + 1) / (c.get(y - 3, 0) + 1), 2)
    return {"years": [[k, c.get(k, 0)] for k in range(y - 5, y + 1)], "last": last, "prev": prev,
            "growth": growth, "accel": growth > before and growth >= 1.1, "rising": growth >= 1.2 and last >= 10}


# ── preprints (arXiv, metadata CC0) ──────────────────────────────────────────

def arxiv_entries(text: str) -> list[dict]:
    import feedparser
    out = []
    for e in feedparser.parse(news.check_xml(text)).entries:
        link = str(e.get("id") or e.get("link") or "")
        m = re.search(r"arxiv\.org/abs/([\w.\-/]+?)(?:v\d+)?$", link)
        if not m:
            continue
        aid = m.group(1)
        title = re.sub(r"\s+", " ", str(e.get("title") or "")).strip()
        when = str(e.get("published") or e.get("updated") or "")[:19]
        if not title or not re.match(r"\d{4}-\d{2}-\d{2}", when):
            continue
        summary = re.sub(r"\s+", " ", str(e.get("summary") or "")).strip()
        out.append({"id": f"arxiv:{aid}", "title": title, "source": "arXiv", "date": when + "Z",
                    "link": f"https://arxiv.org/abs/{aid}", "summary": news.teaser(summary, 300),
                    "authors": ", ".join(a.get("name", "") for a in (e.get("authors") or [])[:3])
                               + (" et al." if len(e.get("authors") or []) > 3 else "")})
    return out


# ── spotting new topics ──────────────────────────────────────────────────────

FIRST_NAMES = set("""
james john robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald
steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric
jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry
tyler aaron jose adam nathan henry douglas zachary peter kyle noah ethan jeremy walter christian keith roger terry austin
sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan alan juan albert willie
elijah wayne randy vincent mason roy ralph bobby russell bradley philip eugene mary patricia jennifer linda elizabeth
barbara susan jessica sarah karen lisa nancy betty sandra margaret ashley kimberly emily donna michelle carol amanda
melissa deborah stephanie dorothy rebecca sharon laura cynthia amy kathleen angela shirley brenda emma anna pamela
nicole samantha katherine christine helen debra rachel carolyn janet maria catherine heather diane olivia julie joyce
victoria ruth virginia lauren kelly christina joan evelyn judith andrea hannah megan cheryl jacqueline martha madison
teresa gloria sara janice ann kathryn abigail sophia frances jean alice judy isabella julia grace amber denise danielle
marilyn beverly charlotte natalie theresa diana brittany doris kayla alexis lori marie elon jensen sam mark satya sundar
tim jeff bill warren jerome janet kamala nancy chuck mitch rishi keir emmanuel xi vladimir volodymyr benjamin
""".split())


def _looks_like_a_name(key: str) -> bool:
    w = key.lower().split()
    return (len(w) == 2 and w[0] in FIRST_NAMES) or bool({"jr", "sr"} & set(w))


# words that make a phrase about the format, not the subject ("space photo", "this week")
_FORMAT = set("photo photos picture pictures video videos image images podcast quiz live update updates today tonight "
              "week weeks year years day days month months watch review guide explainer "
              "next-generation next-gen new latest first".split())


def established(trend: Optional[dict]) -> bool:
    """A big research field that isn't growing ("climate change", "black holes") isn't emerging,
    however often it's in this month's headlines."""
    return bool(trend) and trend["last"] >= 200 and trend["growth"] < 1.1


def spot(headlines: list[dict], now: datetime, cfg: dict, known: list[dict], group_of: Optional[dict] = None) -> list[dict]:
    """Phrases new to the headlines: enough mentions from enough publishers lately, and next to
    none before. headlines: [{id, date, title, source, kind}]."""
    group_of = group_of or {}
    win, prior_days = int(cfg.get("window_days", 30)), int(cfg.get("prior_days", 120))
    r_cut, p_cut = news._utc(now - timedelta(days=win)), news._utc(now - timedelta(days=win + prior_days))
    skip = re.compile(cfg.get("skip") or "^$", re.I)
    edge = news.NEWS_GENERIC | news.HEADLINE_VERBS | news.STORY_GENERIC
    rc, pc, pubs, kinds, refs = Counter(), Counter(), defaultdict(set), defaultdict(Counter), defaultdict(list)
    surfaces: dict[str, Counter] = defaultdict(Counter)
    for h in headlines:
        if h["date"] < p_cut:
            continue
        ph = {k: v for k, v in phrases(h["title"]).items()
              if not any(w in edge or w in _FORMAT for w in (k.split()[0], k.split()[-1]))
              and len(k) >= 4 and not any(len(w) == 1 for w in k.split())}
        recent = h["date"] >= r_cut
        for k, v in ph.items():
            if recent:
                rc[k] += 1
                pubs[k].add(group_of.get(h["source"], h["source"]))
                kinds[k][h.get("kind") or "radar"] += 1
                refs[k].append(h)
                surfaces[k][v] += 1
            else:
                pc[k] += 1
    out = []
    for k, n in rc.items():
        if n < int(cfg.get("min_headlines", 3)) or len(pubs[k]) < int(cfg.get("min_publishers", 2)):
            continue
        if pc[k] > int(cfg.get("max_prior", 1)) or skip.search(k):
            continue
        term = display(k, surfaces[k])
        if _looks_like_a_name(k) or any(matches(t, term) for t in known):
            continue
        out.append({"key": k, "term": term, "count": n, "prior": pc[k], "publishers": len(pubs[k]),
                    "kind": kinds[k].most_common(1)[0][0],
                    "examples": [{x: h[x] for x in ("title", "source", "date", "link") if h.get(x)}
                                 for h in sorted(refs[k], key=lambda h: h["date"], reverse=True)[:5]],
                    "score": round((n - pc[k]) * math.log(len(pubs[k]) + 1), 2)})
    out.sort(key=lambda c: (-c["score"], c["key"]))
    chosen: list[dict] = []
    for c in out:
        if any(_contains(c["key"], x["key"]) for x in chosen):
            continue
        chosen.append(c)
        if len(chosen) >= int(cfg.get("max_candidates", 12)):
            break
    return chosen


def iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def lifecycle(state: dict, spotted: list[dict], statuses: dict, cfg: dict, today: date,
              cand_trends: Optional[dict] = None) -> dict:
    """Candidates collect the weeks they were seen; one seen in enough different weeks becomes a
    topic (while there's room); a spotted topic that never heated up, or went quiet, is retired.
    statuses: topic id → {"status": …, "research": {...} or None}. Returns the new state."""
    spot_cfg = cfg.get("spot") or {}
    st = cfg.get("settings") or {}
    cands = dict(state.get("candidates") or {})
    auto = dict(state.get("auto") or {})
    retired = dict(state.get("retired") or {})
    week = iso_week(today)
    keep_since = today - timedelta(weeks=int(spot_cfg.get("watch_within_weeks", 8)))
    for c in spotted:
        old = cands.get(c["key"]) or {"first": today.isoformat(), "weeks": []}
        weeks = sorted(set(old["weeks"]) | {week})
        cands[c["key"]] = {"term": c["term"], "kind": c["kind"], "first": old["first"], "last": today.isoformat(), "weeks": weeks}
    for k in list(cands):            # gone quiet: forget it
        if date.fromisoformat(cands[k]["last"]) < keep_since:
            del cands[k]
    for k, c in cands.items():
        c["weeks"] = [w for w in c["weeks"] if w >= iso_week(keep_since)]
    # promote
    need = int(spot_cfg.get("weeks_to_watch", 3))
    room = int(st.get("max_auto", 8)) - len(auto)
    for k in sorted(cands, key=lambda k: (-len(cands[k]["weeks"]), cands[k]["first"])):
        c = cands[k]
        tid = f"auto-{slug(c['term'])}"
        if room <= 0 or len(c["weeks"]) < need or tid in auto or tid in retired or established((cand_trends or {}).get(k)):
            continue
        auto[tid] = {"name": c["term"], "words": [c["term"]], "kind": c["kind"], "added": today.isoformat(),
                     "why": f"Spotted {c['first']}: kept turning up in {c['kind']} headlines for {len(c['weeks'])} weeks",
                     "heated": False}
        del cands[k]
        room -= 1
    # heat and retire
    months = lambda n: timedelta(days=round(30.44 * n))
    for tid, t in list(auto.items()):
        s = statuses.get(tid) or {}
        if s.get("status") == "heating" or (s.get("research") or {}).get("growth", 0) >= 1.5:
            t["heated"] = True
        if s.get("last_hit"):
            t["last_hit"] = s["last_hit"]
        added = date.fromisoformat(t["added"])
        last_hit = date.fromisoformat(t.get("last_hit") or t["added"])
        reason = None
        if not t["heated"] and today - added >= months(float(st.get("retire_months", 18))):
            reason = f"didn't pick up in {st.get('retire_months', 18)} months"
        elif today - last_hit >= months(float(st.get("quiet_retire_months", 6))) and today - added >= months(float(st.get("quiet_retire_months", 6))):
            reason = f"no headlines in {st.get('quiet_retire_months', 6)} months"
        if reason:
            retired[tid] = {"name": t["name"], "added": t["added"], "retired": today.isoformat(), "reason": reason}
            del auto[tid]
    cut = (today - timedelta(days=730)).isoformat()
    retired = {k: v for k, v in retired.items() if v["retired"] >= cut}
    return {**state, "candidates": cands, "auto": auto, "retired": retired}
