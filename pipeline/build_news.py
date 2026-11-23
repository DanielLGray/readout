"""News job: pull radiology industry & business headlines → docs/data/news.json

    python -m pipeline.build_news
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import news
from .common import CACHE, DATA, load_yaml, now_iso, read_json, write_json
from .http import Http, HttpError, log


def news_http() -> Http:
    # outlets are separate hosts; be polite but don't spend minutes retrying a blocked feed
    return Http(intervals={}, retries=2)


def fetch_source(http: Http, src: dict, now: datetime) -> "tuple[list[dict], dict]":
    """Try the outlet's addresses in order; the first that returns stories wins
    (or, with merge: true, every address that works is used)."""
    status = {"name": src["name"], "home": src.get("home", ""), "ok": False, "url": None, "count": 0,
              "newest": None, "tried": []}
    need = re.compile(src["require"], re.I) if src.get("require") else None
    found: dict[str, dict] = {}
    used = []
    for url in src.get("urls", []):
        try:
            text = http.request("GET", url, {}, expect_json=False)
            items = news.parse_feed(text, src["name"], now)
        except (HttpError, Exception) as exc:      # bad address, block, or unreadable feed: try the next
            status["tried"].append(f"{url} → {type(exc).__name__}: {str(exc)[:80]}")
            continue
        if items:
            status["ok"] = True                    # the feed works, even if nothing passes the filter today
        if need:
            items = [i for i in items if need.search(i["title"] + " " + i.get("summary", ""))]
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
    if found:
        got = list(found.values())
        status.update(ok=True, url=" + ".join(used), count=len(got), newest=max(i["date"] for i in got))
    elif status["ok"]:
        status["url"] = "works; no imaging stories right now"
    return list(found.values()), status


def run(http: Optional[Http] = None, now: Optional[datetime] = None) -> dict:
    cfg = load_yaml("news.yaml")
    settings = cfg.get("settings", {})
    http = http or news_http()
    now = now or datetime.now(timezone.utc)
    path = DATA / "news.json"
    old = read_json(path, {}) or {}
    items = {i["id"]: i for i in old.get("items", [])}
    compiled = news.compile_categories(cfg.get("categories", {}))

    statuses = []
    for src in cfg.get("sources", []):
        got, status = fetch_source(http, src, now)
        statuses.append(status)
        log(f"  {src['name']}: {status['count']} stories" + (f" via {status['url']}" if status["ok"] else " — no working feed"))
        for it in got:
            prev = items.get(it["id"])
            if prev:                       # keep the first date we saw; refresh text
                it["date"] = min(prev["date"], it["date"])
            it["categories"] = news.categorize(it, compiled)
            items[it["id"]] = it

    # one copy per headline per publisher (sister sites syndicate): keep the one with a summary
    group_of = {src["name"]: src.get("group", src["name"]) for src in cfg.get("sources", [])}
    best: dict[tuple, dict] = {}
    for it in sorted(items.values(), key=lambda i: i["date"]):
        key = (group_of.get(it["source"], it["source"]), it["title"].lower())
        if key not in best or len(it.get("summary", "")) > len(best[key].get("summary", "")):
            best[key] = it
    unique = sorted(best.values(), key=lambda i: i["date"], reverse=True)

    cutoff = news._utc(now - timedelta(days=int(settings.get("keep_days", 120))))
    kept = [i for i in unique if i["date"] >= cutoff][: int(settings.get("max_items", 1500))]

    # titles-only archive for trends, kept longer than the tab
    apath = CACHE / "news_archive.json"
    archive = read_json(apath, {}) or {}
    for i in kept:
        archive[i["id"]] = [i["date"], i["title"], i["source"]]
    acut = news._utc(now - timedelta(days=int(settings.get("archive_days", 730))))
    archive = {k: v for k, v in archive.items() if v[0] >= acut}
    write_json(apath, archive, compact=False)
    arch = [{"id": k, "date": v[0], "title": v[1], "source": v[2]} for k, v in archive.items()]

    out = {
        "generated": now_iso(),
        "sources": statuses,
        "categories": {k: v["label"] for k, v in cfg.get("categories", {}).items()},
        "top_stories": news.top_stories(kept, now, group_of=group_of),
        "trending": {"week": news.trending(arch, now, 7, 28, group_of=group_of),
                     "month": news.trending(arch, now, 30, 90, group_of=group_of)},
        "items": kept,
    }
    write_json(path, out)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        rows = ["| outlet | stories | newest | address used / problems |", "|---|---|---|---|"]
        for st in statuses:
            detail = st["url"] if st["ok"] else "; ".join(st["tried"])[:300]
            rows.append(f"| {st['name']} | {st['count']} | {(st['newest'] or '')[:10]} | {detail} |")
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Readout news feeds\n\n" + "\n".join(rows) + "\n")
    ok = sum(1 for s in statuses if s["ok"])
    log(f"News: {len(kept)} stories from {ok}/{len(statuses)} outlets, {len(out['top_stories'])} top stories")
    return out


if __name__ == "__main__":
    run()
