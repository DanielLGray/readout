"""News job: pull radiology industry & business headlines → docs/data/news.json

    python -m pipeline.build_news
"""
from __future__ import annotations

import os
import re
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urljoin, urlparse

from . import alerts, news
from .abstracts import compile_systems, tag_systems
from .common import CACHE, DATA, load_yaml, now_iso, read_json, write_json
from .http import Http, HttpError, log


def news_http() -> Http:
    # outlets are separate hosts; be polite but don't spend minutes retrying a blocked feed
    return Http(intervals={}, retries=2)


STALE_DAYS = 30
DEAL_KINDS = ("industry", "business")     # where "deal" means an acquisition, not a sale: no shopping filter
MEETING_BEFORE, MEETING_AFTER = 45, 14      # days around a meeting when stories that mention it are tagged


def load_meetings(now: datetime) -> list[dict]:
    """Meetings from config/meetings.yaml that haven't long ended, each with its compiled pattern."""
    try:
        cfg = load_yaml("meetings.yaml") or {}
    except FileNotFoundError:
        return []
    out = []
    for m in cfg.get("meetings") or []:
        try:
            start, end = date.fromisoformat(str(m["start"])), date.fromisoformat(str(m["end"]))
            pat = re.compile(m["match"]) if m.get("match") else None
        except (KeyError, ValueError, re.error) as exc:
            log(f"  meeting {m.get('id')!r} skipped: {exc}")
            continue
        if end < now.date() - timedelta(days=MEETING_AFTER) or start > now.date() + timedelta(days=400):
            continue
        out.append({"id": str(m["id"]), "name": m.get("name", m["id"]), "full": m.get("full", ""), "start": start.isoformat(),
                    "end": end.isoformat(), "place": m.get("place", ""), "url": m.get("url", ""),
                    "off": bool(m.get("muted")), "_re": pat})
    return sorted(out, key=lambda m: m["start"])


def tag_meetings(it: dict, meetings: list[dict]) -> None:
    it.pop("meetings", None)
    text = f"{it['title']} {it.get('summary', '')}"
    day = it["date"][:10]
    for m in meetings:
        lo = (date.fromisoformat(m["start"]) - timedelta(days=MEETING_BEFORE)).isoformat()
        hi = (date.fromisoformat(m["end"]) + timedelta(days=MEETING_AFTER)).isoformat()
        if m["_re"] and lo <= day <= hi and m["_re"].search(text):
            it.setdefault("meetings", []).append(m["id"])


def drop_shared_images(items: list[dict]) -> None:
    """A picture on most of an outlet's stories is its logo or a podcast's show art, not the story's."""
    imgs = Counter(i["img"] for i in items if i.get("img"))
    if not imgs or len(items) < 3:
        return
    common, n = imgs.most_common(1)[0]
    if n >= 3 and n > len(items) / 3:
        for i in items:
            if i.get("img") == common:
                del i["img"]


def fetch_source(http: Http, src: dict, now: datetime, dated: Optional[dict] = None) -> "tuple[list[dict], dict]":
    """Try the outlet's addresses in order; the first that returns stories wins
    (or, with merge: true, every address that works is used).
    dated: link → date for style: listing (a newsroom page without a feed), kept between runs so each
    story's own page is read once."""
    dated = {} if dated is None else dated
    status = {"name": src["name"], "home": src.get("home", ""), "ok": False, "url": None, "count": 0,
              "newest": None, "tried": []}
    need = re.compile(src["require"], re.I) if src.get("require") else None
    skip = re.compile(src["skip"], re.I) if src.get("skip") else None     # e.g. a magazine's poetry section
    found: dict[str, dict] = {}
    used = []
    for url in src.get("urls", []):
        try:
            text = http.request("GET", url, {}, expect_json=False)
            if src.get("style") == "listing":
                items = news.parse_listing(text, url, src["name"], str(src.get("links") or "."), now, str(src.get("scan") or ""))
            else:
                items = news.parse_feed(text, src["name"], now, verbatim=bool(src.get("verbatim")), style=str(src.get("style") or ""))
        except (HttpError, Exception) as exc:      # bad address, block, or unreadable feed: try the next
            status["tried"].append(f"{url} → {type(exc).__name__}: {str(exc)[:80]}")
            continue
        if items:
            status["ok"] = True                    # the feed works, even if nothing passes the filter today
        host = (urlparse(url).hostname or "").removeprefix("www.")
        safe = []
        sites = news.link_sites(src)
        for i in items:                            # web links only ("javascript:" never reaches the app)
            i["link"] = urljoin(url, i["link"])
            if urlparse(i["link"]).scheme not in ("http", "https"):
                continue
            # and only to the outlet's own site (or partners it names): a hacked feed can't
            # slip in a link to somewhere else
            if news.site_of(i["link"]) not in sites:
                status["offsite"] = status.get("offsite", 0) + 1
                continue
            if i.get("audio"):                     # episodes play over https only, so they can't be altered on the way
                a = urljoin(url, i["audio"])
                scheme = urlparse(a).scheme
                if scheme == "http":
                    a = "https:" + a[5:]
                if scheme in ("http", "https"):
                    i["audio"] = a
                else:
                    del i["audio"]
            safe.append(i)
        items = safe
        for i in ([] if src.get("verbatim") else items):    # same site, fetched over https: link over https too
            u = urlparse(i["link"])
            if url.startswith("https:") and u.scheme == "http" and (u.hostname or "").removeprefix("www.") == host:
                i["link"] = "https:" + i["link"][5:]
        if skip:
            items = [i for i in items if not skip.search(i["link"] + " " + i["title"])]
        if src.get("google_news") or "news.google.com" in url:   # "Headline - Publisher": keep the headline, credit the publisher
            for i in items:
                m = re.match(r"^(.*\S)\s+[-–]\s+([^-–]{2,60})$", i["title"])
                if m:
                    i["title"], i["summary"] = m.group(1), f"Reported by {m.group(2).strip()}"
                elif i.get("summary", "").lower().startswith(i["title"].lower()[:40]):
                    i["summary"] = ""
        if need:
            items = [i for i in items if need.search(i["title"] + " " + i.get("summary", ""))]
        if src.get("style") == "listing":
            items = date_listing(http, items, dated, int(src.get("pages_per_run", 12)), now)
        if not items:
            status["tried"].append(f"{url} → no {'matching ' if need else ''}stories")
            continue
        used.append(url)
        for i in items:
            key = i["title"].lower()
            if key not in found or len(i.get("summary", "")) > len(found[key].get("summary", "")):
                found[key] = i
        if not src.get("merge"):
            break
    cap = src.get("max_per_day")
    if cap and found:                              # busy outlets: keep the newest few per day
        by_day: dict[str, list] = {}
        for i in sorted(found.values(), key=lambda i: i["date"], reverse=True):
            by_day.setdefault(i["date"][:10], []).append(i)
        found = {i["title"].lower(): i for day in by_day.values() for i in day[:int(cap)]}
    if found:
        got = list(found.values())
        for i in got:
            if src.get("link_only"):
                headline_only(i)
            elif src.get("no_pictures"):           # photos it may not let others show (wire photos)
                i.pop("img", None)
        status.update(ok=True, url=" + ".join(used), count=len(got), newest=max(i["date"] for i in got))
        # answers, but nothing new in a month: the outlet probably moved its feed
        status["stale"] = status["newest"] < news._utc(now - timedelta(days=int(src.get("stale_days", STALE_DAYS))))
    elif status["ok"]:
        status["url"] = "works; no matching stories right now"
    return list(found.values()), status


def date_listing(http: Http, items: list[dict], dated: dict, budget: int, now: datetime) -> list[dict]:
    """Each story from a newsroom page gets the date its own page gives (read once, then kept in
    `dated` with the page's headline); one that can't be read waits for the next run. A page without
    a date: first seen. A link that held only a picture or a few words takes the page's headline;
    under five words it's a section of the site, not a story."""
    out = []
    for i in items:
        seen = dated.get(i["link"])
        if isinstance(seen, str):              # kept before headlines were
            seen = {"d": seen, "t": ""}
        if not isinstance(seen, dict):
            if budget <= 0:
                continue
            budget -= 1
            try:
                page = http.request("GET", i["link"], {}, expect_json=False)
            except Exception:                  # its page didn't answer: try again next run
                continue
            seen = {"d": news._utc(news.page_date(page, now) or now), "t": news.page_title(page)}
        dated[i["link"]] = seen
        title = i["title"] if len(i["title"].split()) >= 5 else seen.get("t") or ""
        if len(title.split()) < 5:
            continue
        i["title"], i["date"] = title, seen["d"]
        out.append(i)
    return out


def headline_only(item: dict) -> dict:
    """For an outlet that allows links with credit but not its content shown here (link_only: true in
    config/news.yaml): the headline, the byline and the link, nothing else (no summary, picture or audio)."""
    item["summary"] = ""
    for k in ("img", "audio", "duration", "fig"):
        item.pop(k, None)
    return item


def run(http: Optional[Http] = None, now: Optional[datetime] = None) -> dict:
    cfg = load_yaml("news.yaml")
    settings = cfg.get("settings", {})
    http = http or news_http()
    now = now or datetime.now(timezone.utc)
    path = DATA / "news.json"
    old = read_json(path, {}) or {}
    items = {i["id"]: i for i in old.get("items", [])}
    compiled = news.compile_categories(cfg.get("categories", {}))
    local = news.compile_local(cfg.get("local"))
    systems = compile_systems((load_yaml("feeds.yaml") or {}).get("systems", {}))

    statuses = []
    junk = re.compile(cfg["exclude"], re.I) if cfg.get("exclude") else None
    dpath = CACHE / "page_dates.json"
    dated = read_json(dpath, {}) or {}
    for src in cfg.get("sources", []):
        got, status = fetch_source(http, src, now, dated)
        if junk and src.get("kind", "industry") not in DEAL_KINDS:    # shopping / promotional posts
            got = [i for i in got if not junk.search(i["title"])]
        drop_shared_images(got)
        status["kind"] = src.get("kind", "industry")
        if isinstance(src.get("everything_per_day"), int):
            status["feed_cap"] = max(0, src["everything_per_day"])     # how many a day Everything shows
        statuses.append(status)
        log(f"  {src['name']}: {status['count']} stories" + (f" via {status['url']}" if status["ok"] else " — no working feed"))
        for it in got:
            prev = items.get(it["id"])
            if prev:                       # keep the first date we saw; refresh text
                it["date"] = min(prev["date"], it["date"])
            it["kind"] = src.get("kind", "industry")
            items[it["id"]] = it

    # an outlet's skip/require rules also clear out stories stored before the rule existed
    if dated:                                  # newsroom pages' dates: the newest 600 links
        when = lambda v: v.get("d", "") if isinstance(v, dict) else str(v)
        write_json(dpath, dict(sorted(dated.items(), key=lambda kv: when(kv[1]), reverse=True)[:600]), compact=False)
    rules = {src["name"]: (re.compile(src["skip"], re.I) if src.get("skip") else None,
                           # headline-only outlets keep no summary, so their require was checked on arrival
                           re.compile(src["require"], re.I) if src.get("require") and not src.get("link_only") else None)
             for src in cfg.get("sources", [])}
    sites = {src["name"]: news.link_sites(src) for src in cfg.get("sources", [])}
    def allowed(it):
        if it["source"] not in sites:
            return False                       # outlet taken off the list: its stories go with it
        if news.site_of(it["link"]) not in sites[it["source"]]:
            return False                       # stored before the outlet's links were checked
        skip, need = rules.get(it["source"], (None, None))
        return not (skip and skip.search(it["link"] + " " + it["title"])) and \
            not (need and not need.search(it["title"] + " " + it.get("summary", "")))
    items = {k: v for k, v in items.items() if allowed(v)}
    # an outlet's daily limit applies to stories stored before it was lowered, too
    caps = {src["name"]: int(src["max_per_day"]) for src in cfg.get("sources", []) if src.get("max_per_day")}
    per_day: dict[tuple, list] = {}
    for it in items.values():
        if it["source"] in caps:
            per_day.setdefault((it["source"], it["date"][:10]), []).append(it)
    for (name, _), lst in per_day.items():
        if len(lst) > caps[name]:
            for it in sorted(lst, key=lambda i: i["date"], reverse=True)[caps[name]:]:
                items.pop(it["id"], None)
    mentions = re.compile(cfg["society_mentions"]) if cfg.get("society_mentions") else None
    meetings = load_meetings(now)
    kind_of = {src["name"]: src.get("kind", "industry") for src in cfg.get("sources", [])}
    by_source: dict[str, list] = {}
    for it in items.values():
        by_source.setdefault(it["source"], []).append(it)
    for lst in by_source.values():             # stored stories too: logos and show art out, phone-sized pictures
        drop_shared_images(lst)
    link_only = {src["name"] for src in cfg.get("sources", []) if src.get("link_only")}
    no_pictures = {src["name"] for src in cfg.get("sources", []) if src.get("no_pictures")}
    for it in items.values():                  # every run, so word-list changes reach stored stories too
        it["kind"] = kind_of.get(it["source"], it.get("kind", "industry"))     # an outlet moved to another kind
        if it["source"] in link_only:
            headline_only(it)
        elif it["source"] in no_pictures:
            it.pop("img", None)
        if it.get("img") and it.get("audio") and "brightspotcdn.com" not in it["img"]:
            del it["img"]
        if it.get("img"):
            it["img"] = news.resize_image(it["img"])
        tag_meetings(it, meetings)
        it.pop("also", None)
        if mentions and it.get("kind", "industry") in ("industry", "health") and \
                mentions.search(it["title"] + " " + it.get("summary", "")):
            it["also"] = ["societies"]         # an industry story about ACR, SNMMI, RSNA…: under societies too
        if it.get("summary"):                  # and summary clean-up changes (already a teaser: just tidy it)
            it["summary"] = news.clean_text(it["summary"])
        it["categories"] = news.categorize(it, compiled) if it.get("kind", "industry") == "industry" else []
        it.pop("place", None)
        if it.get("kind") in local["kinds"]:   # Reno & Nevada: its topics, and where it is
            it["categories"], place = news.tag_local(it, local)
            if place:
                it["place"] = place
        it["systems"] = tag_systems({"title": it["title"], "sections": [{"text": it.get("summary", "")}]}, systems)

    # one copy per headline per publisher (sister sites syndicate): keep the one with a summary
    group_of = {src["name"]: src.get("group", src["name"]) for src in cfg.get("sources", [])}
    releases = frozenset(cfg.get("releases") or [])          # copies of one press release count once
    best: dict[tuple, dict] = {}
    for it in sorted(items.values(), key=lambda i: i["date"]):
        key = (group_of.get(it["source"], it["source"]), it["title"].lower())
        if key not in best or len(it.get("summary", "")) > len(best[key].get("summary", "")):
            best[key] = it
    unique = sorted(best.values(), key=lambda i: i["date"], reverse=True)
    again = news.near_duplicates(unique, group_of)             # one outlet's re-worded headline for the same story
    unique = [i for i in unique if i["id"] not in again]

    kinds = list((cfg.get("kinds") or {"industry": "Industry news", "science": "Science & health"}).keys())
    other_days = int(settings.get("other_keep_days", settings.get("science_keep_days", 30)))
    cut_industry = news._utc(now - timedelta(days=int(settings.get("keep_days", 120))))
    cut_other = news._utc(now - timedelta(days=other_days))
    cut_kind = {k: news._utc(now - timedelta(days=int(d))) for k, d in (settings.get("kind_keep_days") or {}).items()}
    cut_for = lambda k: cut_kind.get(k) or (cut_industry if k == "industry" else cut_other)
    kept = [i for i in unique
            if i["date"] >= cut_for(i.get("kind", "industry"))
            and not (junk and i.get("kind", "industry") not in DEAL_KINDS and junk.search(i["title"]))]
    kept = kept[: int(settings.get("max_items", 4000))]

    # titles-only archive for trends, kept longer than the tab
    apath = CACHE / "news_archive.json"
    archive = read_json(apath, {}) or {}
    for i in kept:
        archive[i["id"]] = [i["date"], i["title"], i["source"], i.get("kind", "industry")]
    acut = news._utc(now - timedelta(days=int(settings.get("archive_days", 730))))
    listed = {src["name"] for src in cfg.get("sources", [])}
    archive = {k: v for k, v in archive.items() if v[0] >= acut and v[2] in listed}   # removed outlets' titles go too
    for v in archive.values():                 # and an outlet that moved kind takes its old titles along
        if len(v) > 3:
            v[3] = kind_of.get(v[2], v[3])
        else:
            v.append(kind_of.get(v[2], "industry"))
    write_json(apath, archive, compact=False)
    arch = [{"id": k, "date": v[0], "title": v[1], "source": v[2], "kind": v[3] if len(v) > 3 else "industry"}
            for k, v in archive.items()]
    if junk:                                   # headlines saved before the promo filter existed
        arch = [a for a in arch if a["kind"] in DEAL_KINDS or not junk.search(a["title"])]

    obits = news.mark_obituaries(kept, arch + [{"date": i["date"], "title": i["title"], "source": i["source"]} for i in kept], group_of)

    ts = settings.get("top_stories") or {}
    top_cfg = {"days": int(ts.get("days", 7)), "limit": int(ts.get("per_kind", 8)),
               "min_outlets": int(ts.get("min_outlets", 2)), "match": float(ts.get("match", 0.5))}
    tr = settings.get("trending") or {}
    spans = {"week": [int(x) for x in tr.get("week", [7, 28])], "month": [int(x) for x in tr.get("month", [30, 90])]}
    n_terms = int(tr.get("phrases", 12))
    out = {
        "generated": now_iso(),
        "settings": {
            "keep_days": int(settings.get("keep_days", 120)), "other_keep_days": other_days,
            "max_items": int(settings.get("max_items", 4000)), "archive_days": int(settings.get("archive_days", 730)),
            "outlets": len(cfg.get("sources", [])), "promo_filter": bool(junk),
            "top_stories": {"days": top_cfg["days"], "per_kind": top_cfg["limit"],
                            "min_outlets": top_cfg["min_outlets"], "match": top_cfg["match"]},
            "trending": {"week": spans["week"], "month": spans["month"], "phrases": n_terms},
        },
        "sources": statuses,
        "categories": {**{k: v["label"] for k, v in cfg.get("categories", {}).items()},
                       **{k: v["label"] for k, v in ((cfg.get("local") or {}).get("topics") or {}).items()},
                       **({"nv_opinion": "Opinion & commentary"} if (cfg.get("local") or {}).get("opinion") else {})},
        "local": {"kinds": sorted(local["kinds"]), "topics": list(((cfg.get("local") or {}).get("topics") or {}).keys())
                  + (["nv_opinion"] if (cfg.get("local") or {}).get("opinion") else [])},
        "kinds": cfg.get("kinds") or {"industry": "Industry news", "science": "Science & health"},
        "meetings": [{k: v for k, v in m.items() if not k.startswith("_")} for m in meetings],
        "top_stories": {k: news.top_stories([i for i in kept if i.get("kind", "industry") == k], now,
                                            group_of=group_of, releases=releases, **top_cfg)
                        for k in kinds},
        "trending": {k: {span: news.trending([a for a in arch if a["kind"] == k], now, d, p,
                                             top_n=n_terms, group_of=group_of)
                         for span, (d, p) in spans.items()}
                     for k in kinds},
        "items": kept,
    }
    try:
        out["alerts"] = alerts.news_alerts(kept, cfg, now, group_of, releases)
    except Exception as exc:          # alerts are a bonus; the news still goes out
        log(f"Alerts: failed ({exc})")
        out["alerts"] = []
    write_json(path, out)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        rows = ["| outlet | stories | newest | address used / problems |", "|---|---|---|---|"]
        for st in statuses:
            detail = (("NOT UPDATING: " if st.get("stale") else "") + st["url"]) if st["ok"] else "; ".join(st["tried"])[:300]
            rows.append(f"| {st['name']} | {st['count']} | {(st['newest'] or '')[:10]} | {detail} |")
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Readout news feeds\n\n" + "\n".join(rows) + "\n")
    ok = sum(1 for s in statuses if s["ok"] and not s.get("stale"))
    log(f"News: {len(kept)} stories from {ok}/{len(statuses)} outlets, "
        f"{sum(len(v) for v in out['top_stories'].values())} top stories, {len(out['alerts'])} alerts, {obits} death notices")
    return out


if __name__ == "__main__":
    run()
