"""Daily job: pull new PubMed records for each stream, turn them into cards,
merge into docs/data/feed.json.

    python -m pipeline.build_feed
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from .abstracts import compile_systems, refresh, to_card
from .common import DATA, fill, load_yaml, now_iso, read_json, today, write_json
from .http import Http, default_http, log
from .pubmed import MAX_IDS, PubMed


def _age_days(d: Optional[str], ref: date) -> int:
    if not d:
        return 0
    try:
        y, m, dd = (d.split("-") + ["1", "1"])[:3]
        return (ref - date(int(y), int(m), int(dd))).days
    except ValueError:
        return 0


def run(http: Optional[Http] = None) -> dict:
    cfg = load_yaml("feeds.yaml")
    tcfg = load_yaml("topics.yaml")
    settings = cfg.get("settings", {})
    http = http or default_http()
    pm = PubMed(http)
    t = today()
    path = DATA / "feed.json"

    old = read_json(path, {}) or {}
    items: dict[str, dict] = {it["pmid"]: it for it in old.get("items", [])}
    days = int(settings.get("recheck_days", 10) if items else settings.get("first_run_days", 45))
    log(f"Feed: looking back {days} days ({'update' if items else 'first run'})")

    # 1 — which PMIDs belong to which stream
    found: dict[str, set] = {}
    for s in cfg["streams"]:
        q = fill(s["query"], cfg)
        n, ids = pm.esearch(q, datetype="edat", reldate=days, retmax=MAX_IDS)
        log(f"  {s['id']}: {n} records")
        for pmid in ids:
            found.setdefault(pmid, set()).add(s["id"])

    # 2 — re-check recent cards whose abstract wasn't in PubMed yet
    for pmid, it in items.items():
        if it.get("conclusion", {}).get("kind") == "none" and _age_days(it.get("added"), t) <= 30:
            found.setdefault(pmid, set()).update(it.get("streams", []))

    # 3 — topic tags (same query the Explore tab uses)
    topic_hits: dict[str, set] = {}
    if found:
        for tp in tcfg.get("topics", []):
            try:
                _, ids = pm.esearch(" ".join(tp["query"].split()), datetype="edat",
                                    reldate=max(days, 31), retmax=MAX_IDS)
            except Exception as exc:  # one bad query shouldn't sink the run
                log(f"  topic {tp['id']} skipped: {exc}")
                continue
            for pmid in set(ids) & found.keys():
                topic_hits.setdefault(pmid, set()).add(tp["id"])

    # 4 — fetch full records and build cards
    compiled = compile_systems(cfg["systems"])
    recs = pm.fetch(found.keys()) if found else []
    new = 0
    for rec in recs:
        pmid = rec["pmid"]
        prev = items.get(pmid, {})
        card = to_card(rec, compiled)
        card["streams"] = sorted(found.get(pmid, set()) | set(prev.get("streams", [])))
        card["topics"] = sorted(topic_hits.get(pmid, set()) | set(prev.get("topics", [])))
        card["seen"] = prev.get("seen") or t.isoformat()
        if not prev:
            new += 1
        items[pmid] = card

    # apply the current parser to cards fetched on earlier days
    fetched = {r["pmid"] for r in recs}
    for pmid, it in items.items():
        if pmid not in fetched:
            refresh(it, compiled)

    # 5 — prune and sort
    keep_days = int(settings.get("keep_days", 180))
    kept = [it for it in items.values() if _age_days(it.get("added") or it.get("seen"), t) <= keep_days]
    kept.sort(key=lambda it: (it.get("added") or "", it.get("seen") or "", int(it["pmid"])), reverse=True)
    kept = kept[: int(settings.get("max_items", 900))]

    out = {
        "generated": now_iso(),
        "systems": {k: v["label"] for k, v in cfg["systems"].items()},
        "topics": {tp["id"]: {"name": tp["name"], "system": tp["system"]} for tp in tcfg.get("topics", [])},
        "streams": {s["id"]: s["name"] for s in cfg["streams"]},
        "items": kept,
    }
    write_json(path, out)
    for term, notes in pm.warnings.items():
        log(f"  PubMed note for query «{term[:80]}…»: {'; '.join(notes)}")
    log(f"Feed: {new} new cards, {len(kept)} total, {http.calls} API calls")
    return out


if __name__ == "__main__":
    run()
