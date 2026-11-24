"""Weekly job: topic trends over 1, 2 and 5 years → docs/data/explore.json

For each curated topic and window it computes
  • papers in the window vs the window before, adjusted for the growth of
    imaging literature overall (the "baseline" query)
  • an evidence ladder (guidelines/consensus, meta-analyses, RCTs, prospective)
  • the most-cited papers (NIH iCite), with their conclusions verbatim
  • guideline / consensus papers ("reaching practice")
  • newly registered trials (ClinicalTrials.gov), where configured
plus emerging/fading title phrases across the body-imaging journals.

    python -m pipeline.build_explore
"""
from __future__ import annotations

import json
import statistics
from datetime import date, timedelta
from typing import Optional

from . import ctgov, icite, terms
from .abstracts import compile_systems, is_guideline, is_notice, to_card
from .common import CACHE, DATA, fill, load_yaml, now_iso, read_json, today, write_json
from .http import Http, default_http, log
from .pubmed import PubMed

WINDOWS = {1: 365, 2: 730, 5: 1826}
MIN_RECENT = {1: 15, 2: 25, 5: 40}      # fewer papers than this → too small to call a trend
# defaults for the trend rules; config/topics.yaml → settings overrides them
RULES = {"min_papers": MIN_RECENT, "breakout": 1.0, "rising": 0.15, "cooling": -0.15,
         "influential": 8, "title_phrases": 15}


def rules_from(tcfg: dict) -> dict:
    s = (tcfg or {}).get("settings") or {}
    mp = {int(k): int(v) for k, v in (s.get("min_papers") or {}).items()}
    return {
        "min_papers": {w: mp.get(w, RULES["min_papers"][w]) for w in WINDOWS},
        "breakout": float(s.get("breakout", RULES["breakout"])),
        "rising": float(s.get("rising", RULES["rising"])),
        "cooling": float(s.get("cooling", RULES["cooling"])),
        "influential": int(s.get("influential", RULES["influential"])),
        "title_phrases": int(s.get("title_phrases", RULES["title_phrases"])),
    }

EVIDENCE = {
    "guideline": '(Guideline[pt] OR "Practice Guideline"[pt] OR "Consensus Statement"[pt] OR '
                 '"consensus statement"[ti] OR "consensus recommendations"[ti] OR "expert consensus"[ti] OR '
                 '"delphi consensus"[ti] OR "international consensus"[ti] OR "practice guideline"[ti] OR '
                 '"practice guidelines"[ti] OR "guidelines for"[ti] OR "guidelines on"[ti] OR "white paper"[ti] OR '
                 '"position statement"[ti] OR "position paper"[ti] OR "appropriateness criteria"[ti] OR '
                 '"practice recommendations"[ti])',
    "meta": '("Meta-Analysis"[pt] OR "Systematic Review"[pt] OR "meta-analysis"[ti] OR "systematic review"[ti])',
    "rct": '("Randomized Controlled Trial"[pt] OR randomized[ti] OR randomised[ti])',
    "prospective": '(prospectiv*[tiab])',
}


def windows_for(t: date) -> dict:
    out = {}
    for w, d in WINDOWS.items():
        out[w] = {"start": t - timedelta(days=d - 1), "end": t,
                  "prior_start": t - timedelta(days=2 * d - 1), "prior_end": t - timedelta(days=d)}
    return out


def _adj_growth(r: int, p: int, R: int, P: int) -> Optional[float]:
    if p <= 0 or R <= 0 or P <= 0:
        return None
    return round((r / R) / (p / P) - 1, 3)


def _paper(card: dict, m: Optional[dict] = None) -> dict:
    keep = ("pmid", "title", "journal", "authors", "added", "epub", "ppub", "doi", "pmcid", "pub_types", "design",
            "sample", "conclusion", "extras", "sections", "retracted", "concern", "translated", "language")
    out = {k: card.get(k) for k in keep if k not in ("translated", "language") or card.get(k)}
    if m:
        out["metrics"] = m
    return out


def topic_block(pm: PubMed, http: Http, tp: dict, win: dict, years: list[int], base: dict,
                compiled: dict, t: date, papers: dict) -> dict:
    q = " ".join(tp["query"].split())
    year_counts = [pm.count(q, date(y, 1, 1), min(date(y, 12, 31), t)) for y in years]

    per_w: dict[int, dict] = {}
    ids_by_w: dict[int, list[str]] = {}
    for w, wd in win.items():
        n_recent, ids = pm.ids(q, wd["start"], wd["end"])
        n_prior = pm.count(q, wd["prior_start"], wd["prior_end"])
        ids_by_w[w] = ids
        ev = {k: pm.count(f"({q}) AND {f}", wd["start"], wd["end"]) for k, f in EVIDENCE.items()}
        ev["total"] = n_recent
        R, P = base["windows"][str(w)]["recent"], base["windows"][str(w)]["prior"]
        per_w[w] = {
            "recent": n_recent, "prior": n_prior,
            "growth": _adj_growth(n_recent, n_prior, R, P),
            "raw_growth": round(n_recent / n_prior - 1, 3) if n_prior else None,
            "evidence": ev,
        }

    # guideline / consensus papers in the 5-year window, newest first
    w5 = win[5]
    _, gids = pm.esearch(f"({q}) AND {EVIDENCE['guideline']}", datetype="pdat",
                         mindate=w5["start"], maxdate=w5["end"], retmax=30, sort="pub_date")

    # citations for everything in the 5-year window (1- and 2-year are subsets)
    all_ids = set(ids_by_w[5]) | set(ids_by_w[2]) | set(ids_by_w[1])
    met = icite.metrics(http, all_ids)

    tops: dict[int, list[str]] = {}
    for w in win:
        scored = [(pmid, met.get(pmid, {})) for pmid in ids_by_w[w]]
        if w == 1:
            key = lambda x: (x[1].get("cites", 0), x[1].get("rcr") or 0)
        else:
            key = lambda x: (x[1].get("cpy", 0), x[1].get("rcr") or 0, x[1].get("cites", 0))
        scored.sort(key=key, reverse=True)
        tops[w] = [p for p, m in scored[:5] if m.get("cites", 0) > 0]
        top10 = [m.get("cpy", 0) for _, m in scored[:10]]
        rcrs = [m["rcr"] for _, m in scored if m.get("rcr") is not None]
        per_w[w]["influence"] = round(statistics.mean(top10), 2) if top10 else 0
        per_w[w]["high_rcr"] = sum(1 for r in rcrs if r >= 2)
        per_w[w]["cited_share"] = (round(sum(1 for _, m in scored if m.get("cites", 0) > 0) / len(scored), 2)
                                   if scored else 0)

    want = list(dict.fromkeys([p for w in win for p in tops[w]] + gids))
    recs = {r["pmid"]: r for r in pm.fetch(want)} if want else {}
    cards = {pmid: to_card(r, compiled) for pmid, r in recs.items() if not is_notice(r)}
    for pmid, c in cards.items():
        papers[pmid] = _paper(c, met.get(pmid))

    for w, wd in win.items():
        per_w[w]["top"] = [p for p in tops[w] if p in cards]
        g_in = []
        for p in gids:
            c = cards.get(p)
            # PubMed's title-word search is broad ("guideline-defined"); keep real guidance only
            if not c or not is_guideline(recs[p]):
                continue
            d = (c.get("epub") or c.get("ppub") or c.get("added") or "")[:10]
            if d and d >= wd["start"].isoformat()[: len(d)]:
                g_in.append(p)
        per_w[w]["guidelines"] = g_in[:6]

    if tp.get("trials"):
        for w, wd in win.items():
            r = ctgov.new_studies(http, tp["trials"], wd["start"], wd["end"])
            p = ctgov.new_studies(http, tp["trials"], wd["prior_start"], wd["prior_end"])
            per_w[w]["trials"] = {"recent": r, "prior": p}

    return {
        "id": tp["id"], "name": tp["name"], "system": tp["system"], "query": q,
        "trials_term": tp.get("trials"), "years": year_counts,
        "windows": {str(w): v for w, v in per_w.items()},
    }


def lists_for(topics: list[dict], rules: Optional[dict] = None) -> dict:
    """Breakouts / rising / cooling / influential / practice per window.
    The app repeats these rules on the phone, so keep the two in step (docs/app.js trendLists)."""
    r = rules or RULES
    out = {}
    for w in WINDOWS:
        k = str(w)
        mp = r["min_papers"][w]
        ok = [tp for tp in topics if tp.get("windows", {}).get(k, {}).get("recent", 0) >= mp]
        g = lambda tp: tp["windows"][k]["growth"]
        new = [tp for tp in ok if g(tp) is None]
        breakouts = new + sorted([tp for tp in ok if g(tp) is not None and g(tp) >= r["breakout"]], key=g, reverse=True)
        rising = sorted([tp for tp in ok if g(tp) is not None and r["rising"] <= g(tp) < r["breakout"]], key=g, reverse=True)
        # cooling: judged on the earlier window, since a fading topic may now be small
        was_big = [tp for tp in topics if tp.get("windows", {}).get(k, {}).get("prior", 0) >= mp]
        cooling = sorted([tp for tp in was_big if g(tp) is not None and g(tp) <= r["cooling"]], key=g)
        influential = sorted(ok, key=lambda tp: tp["windows"][k].get("influence", 0), reverse=True)[:r["influential"]]
        practice = sorted([tp for tp in topics if tp.get("windows", {}).get(k, {}).get("guidelines")],
                          key=lambda tp: (len(tp["windows"][k]["guidelines"]),
                                          tp["windows"][k]["evidence"].get("guideline", 0)), reverse=True)
        out[k] = {name: [tp["id"] for tp in lst] for name, lst in (
            ("breakouts", breakouts), ("rising", rising), ("influential", influential),
            ("practice", practice), ("cooling", cooling))}
    return out


def build_corpus(pm: PubMed, cfg: dict, t: date) -> list[dict]:
    """Titles from the body-imaging journal stream, 10 years, cached."""
    stream = next(s for s in cfg["streams"] if s["id"] == "body_journals")
    q = fill(stream["query"], cfg)
    # plain, sorted, one record per line: git stores weekly changes as small deltas
    path = CACHE / "corpus.json"
    cache: dict = read_json(path, {}) or {}
    first = t.year - 10
    all_ids: list[str] = []
    for y in range(first, t.year + 1):
        _, ids = pm.ids(q, date(y, 1, 1), min(date(y, 12, 31), t))
        all_ids.extend(ids)
    missing = [p for p in all_ids if p not in cache]
    log(f"  corpus: {len(all_ids)} titles, fetching {len(missing)} new")
    for s in pm.summaries(missing):
        if s["date"]:
            cache[s["pmid"]] = [s["date"], s["title"], s["journal"]]
    keep = set(all_ids)
    cache = {k: v for k, v in cache.items() if k in keep}
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, sort_keys=True, indent=0, separators=(",", ":"))
    return [{"pmid": k, "date": v[0], "title": v[1], "journal": v[2]} for k, v in cache.items()]


def run(http: Optional[Http] = None) -> dict:
    cfg = load_yaml("feeds.yaml")
    tcfg = load_yaml("topics.yaml")
    http = http or default_http()
    pm = PubMed(http)
    t = today()
    win = windows_for(t)
    years = list(range(t.year - 10, t.year + 1))
    compiled = compile_systems(cfg["systems"])
    rules = rules_from(tcfg)
    old = read_json(DATA / "explore.json", {}) or {}
    old_topics = {tp["id"]: tp for tp in old.get("topics", [])}
    old_papers = old.get("papers", {})
    papers: dict[str, dict] = {}

    log("Explore: baseline")
    bq = " ".join(tcfg["baseline_query"].split())
    base = {
        "years": [pm.count(bq, date(y, 1, 1), min(date(y, 12, 31), t)) for y in years],
        "windows": {str(w): {"recent": pm.count(bq, wd["start"], wd["end"]),
                             "prior": pm.count(bq, wd["prior_start"], wd["prior_end"])}
                    for w, wd in win.items()},
    }

    topics_out = []
    for i, tp in enumerate(tcfg["topics"], 1):
        log(f"Explore: [{i}/{len(tcfg['topics'])}] {tp['name']}")
        try:
            topics_out.append(topic_block(pm, http, tp, win, years, base, compiled, t, papers))
        except Exception as exc:
            log(f"  failed ({exc}); keeping last week's numbers")
            prev = old_topics.get(tp["id"])
            if prev and all(isinstance(p, str) for w in prev.get("windows", {}).values()
                            for p in w.get("top", []) + w.get("guidelines", [])):
                topics_out.append(dict(prev, stale=True))
                for w in prev["windows"].values():
                    for p in w.get("top", []) + w.get("guidelines", []):
                        if p in old_papers:
                            papers.setdefault(p, old_papers[p])

    log("Explore: emerging terms")
    try:
        term_data = terms.analyze(build_corpus(pm, cfg, t), t, top_n=rules["title_phrases"])
    except Exception as exc:
        log(f"  terms failed ({exc}); keeping last week's")
        term_data = old.get("terms", {})

    out = {
        "generated": now_iso(),
        "today": t.isoformat(),
        "windows": {str(w): {k: v.isoformat() for k, v in wd.items()} for w, wd in win.items()},
        "years": years,
        "baseline": base,
        "systems": {k: v["label"] for k, v in cfg["systems"].items()},
        "topics": topics_out,
        "papers": papers,
        "lists": lists_for(topics_out, rules),
        "terms": term_data,
        "min_recent": {str(k): v for k, v in rules["min_papers"].items()},
        "settings": dict(rules, min_papers={str(k): v for k, v in rules["min_papers"].items()},
                         topics=len(tcfg["topics"])),
        "query_notes": {term[:160]: notes for term, notes in pm.warnings.items()},
    }
    write_json(DATA / "explore.json", out)
    for term, notes in pm.warnings.items():
        log(f"  PubMed note for «{term[:80]}…»: {'; '.join(notes)}")
    log(f"Explore: done — {len(topics_out)} topics, {http.calls} API calls")
    return out


if __name__ == "__main__":
    run()
