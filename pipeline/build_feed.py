"""Daily job: pull new PubMed records for each stream, turn them into cards,
merge into docs/data/feed.json.

    python -m pipeline.build_feed
"""
from __future__ import annotations

import os

from datetime import date, timedelta
from typing import Optional

from . import abstract_store
from .abstracts import area_require, compile_systems, is_notice, passes, refresh, to_card

NO_ABSTRACT_DAYS = 21      # PubMed adds late abstracts within days; after three weeks none is coming
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
    stored = abstract_store.load(DATA / "abstracts", "f")
    for pmid, it in items.items():                   # abstracts live beside feed.json
        if not it.get("sections") and pmid in stored:
            it["sections"] = stored[pmid]
    areas_cfg = cfg.get("areas") or {}
    area_of = {s["id"]: s.get("area", "body") for s in cfg["streams"]}
    have = {s for it in items.values() for s in it.get("streams", [])}
    rules = area_require(areas_cfg)
    def areas_for(card: dict) -> list:
        return sorted(a for a in {area_of.get(s, "body") for s in card.get("streams", [])}
                      if a not in rules or passes(card, rules[a]))
    recheck, first = int(settings.get("recheck_days", 10)), int(settings.get("first_run_days", 45))

    # 1 — which PMIDs belong to which stream (a stream new to the feed looks further back)
    found: dict[str, set] = {}
    days = recheck
    failed = []
    for s in cfg["streams"]:
        q = fill(s["query"], cfg)
        sd = recheck if s["id"] in have else first
        days = max(days, sd)
        try:
            n, ids = pm.esearch(q, datetype="edat", reldate=sd, retmax=MAX_IDS)
        except Exception as exc:     # one rejected search shouldn't hold back the others; its cards stay
            log(f"  {s['id']} skipped: {exc}")
            failed.append(s["id"])
            continue
        log(f"  {s['id']}: {n} records in {sd} days")
        for pmid in ids:
            found.setdefault(pmid, set()).add(s["id"])

    if failed and len(failed) == len(cfg["streams"]):
        raise RuntimeError("every PubMed search failed; keeping yesterday's feed")

    # 2 — re-check recent cards whose abstract wasn't in PubMed yet, and fetch once more any card
    #     stored before cards carried citation details (volume, issue, pages, up to six authors)
    for pmid, it in items.items():
        if (it.get("conclusion", {}).get("kind") == "none" and _age_days(it.get("added"), t) <= 30) or "cite" not in it:
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
        if is_notice(rec):          # erratum / correction / retraction notices
            items.pop(pmid, None)
            continue
        prev = items.get(pmid, {})
        card = to_card(rec, compiled)
        card["streams"] = sorted(found.get(pmid, set()) | set(prev.get("streams", [])))
        card["areas"] = areas_for(card)
        if not card["areas"]:                         # e.g. a SPECT paper that only reached the cardiac CT search
            items.pop(pmid, None)
            continue
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
            it["areas"] = areas_for(it)

    # 5 — prune and sort
    keep_days = int(settings.get("keep_days", 180))
    keep_for = lambda it: max([int((areas_cfg.get(a) or {}).get("keep_days", keep_days)) for a in it.get("areas", [])]
                              or [keep_days])
    kept = [it for it in items.values()
            if _age_days(it.get("added") or it.get("seen"), t) <= keep_for(it) and not is_notice(it) and it.get("areas")
            and not ((it.get("conclusion") or {}).get("kind") == "none"
                     and _age_days(it.get("added") or it.get("seen"), t) > NO_ABSTRACT_DAYS)]
    kept.sort(key=lambda it: (it.get("added") or "", it.get("seen") or "", int(it["pmid"])), reverse=True)
    kept = kept[: int(settings.get("max_items", 2500))]
    abstract_store.save(DATA / "abstracts", "f", abstract_store.split_out(kept, "f"))

    out = {
        "generated": now_iso(),
        "systems": {k: v["label"] for k, v in cfg["systems"].items()},
        "topics": {tp["id"]: {"name": tp["name"], "system": tp["system"]} for tp in tcfg.get("topics", [])},
        "streams": {s["id"]: s["name"] for s in cfg["streams"]},
        "areas": {a: {"label": v.get("label", a), "short": v.get("short", v.get("label", a)), "about": v.get("about", ""),
                      "keep_days": int(v.get("keep_days", keep_days)),
                      "streams": [s["id"] for s in cfg["streams"] if s.get("area", "body") == a],
                      "count": sum(1 for it in kept if a in it.get("areas", []))}
                  for a, v in areas_cfg.items()},
        "settings": {
            "first_run_days": int(settings.get("first_run_days", 45)),
            "recheck_days": int(settings.get("recheck_days", 10)),
            "keep_days": keep_days,
            "max_items": int(settings.get("max_items", 2500)),
            "journals": len(cfg.get("journals", [])),
            "nm_journals": len(cfg.get("nm_journals", [])),
            "general_journals": len(cfg.get("general_journals", [])),
            "general_radiology_journals": len(cfg.get("general_radiology_journals", [])),
            "cardiac_journals": len(cfg.get("cardiac_journals", [])) + len(cfg.get("interventional_journals", [])),
            "topics": len(tcfg.get("topics", [])),
            "ncbi_contact": bool(os.environ.get("NCBI_EMAIL", "").strip()),
        },
        "items": kept,
    }
    if failed:
        out["failed_streams"] = failed
    write_json(path, out)
    for term, notes in pm.warnings.items():
        log(f"  PubMed note for query «{term[:80]}…»: {'; '.join(notes)}")
    log(f"Feed: {new} new cards, {len(kept)} total, {http.calls} API calls")
    return out


if __name__ == "__main__":
    run()
