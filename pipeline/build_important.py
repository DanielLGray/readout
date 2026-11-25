"""Weekly job: the most important papers → docs/data/important.json

"Important" means cited far more than papers of the same age. Every paper from the feed's
journal streams over the last few years is compared with the others in its interest area
(nuclear medicine, body, cardiac CT, general) that first appeared in the same quarter
(citations from NIH iCite), and given a percentile. Each area gets its own lists. Papers too new to have citations
lean on their journal's record: the average percentile of its papers that are 1–3 years old.

Lists: New (last 6 months; early citations plus journal record), 1 year and 3 years (citations
only, papers at least a few months old). Original research by default; reviews, meta-analyses
and guidelines are kept apart so the app can mix them in.

    python -m pipeline.build_important
"""
from __future__ import annotations

import json
from bisect import bisect_left, bisect_right
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from . import abstract_store, figures, icite
from .abstracts import area_require, compile_systems, is_guideline, is_notice, passes, to_card
from .common import CACHE, DATA, fill, load_yaml, now_iso, read_json, today, write_json
from .http import Http, default_http, log
from .pubmed import PubMed

WINDOWS = {"6m": 183, "1y": 365, "3y": 1096}
DEFAULTS = {"years": 3, "per_window": {"6m": 30, "1y": 40, "3y": 60}, "other_per_window": 10,
            "min_age_months": 4, "journal_min_papers": 15}
# not papers to read for impact: notices, opinion, single cases
SKIP_TYPES = {"Case Reports", "Editorial", "Comment", "Letter", "News", "Newspaper Article", "Published Erratum",
              "Retraction of Publication", "Retraction Notice", "Expression of Concern", "Biography", "Interview",
              "Congress", "Lecture", "Portrait", "Historical Article", "Personal Narrative", "Video-Audio Media"}
OTHER_TYPES = {"Review", "Systematic Review", "Meta-Analysis", "Guideline", "Practice Guideline",
               "Consensus Development Conference", "Consensus Development Conference, NIH", "Consensus Statement"}


def settings_from(cfg: dict) -> dict:
    s = dict(DEFAULTS, **((cfg or {}).get("important") or {}))
    s["per_window"] = dict(DEFAULTS["per_window"], **(s.get("per_window") or {}))
    return s


def kind_of(types: list[str], research: Optional[bool], title: str = "") -> Optional[str]:
    t = set(types)
    if t & SKIP_TYPES:
        return None
    if t & OTHER_TYPES or is_guideline({"title": title, "pub_types": types}):    # "AASLD Practice Guideline on …"
        return "other"
    return None if research is False else "research"


def quarter(d: date) -> str:
    return f"{d.year} Q{(d.month - 1) // 3 + 1}"


def months(a: date, b: date) -> float:
    return max(0.0, (b - a).days / 30.44)


def score(rows: dict[str, dict], t: date, s: dict) -> dict[str, float]:
    """Adds pcts (citation percentile among same-area, same-quarter papers, per area), pct (the
    best of those), jpct (journal record) and score to each row. Returns the journal record table."""
    by_q: dict[tuple, list] = defaultdict(list)
    for r in rows.values():
        for a in r["areas"]:
            by_q[(a, quarter(r["date"]))].append(r["cites"])
    for lst in by_q.values():
        lst.sort()
    for r in rows.values():
        r["pcts"] = {}
        for a in r["areas"]:
            lst = by_q[(a, quarter(r["date"]))]
            below, upto = bisect_left(lst, r["cites"]), bisect_right(lst, r["cites"])
            r["pcts"][a] = round(100 * (below + 0.5 * (upto - below)) / len(lst), 1)
        r["pct"] = max(r["pcts"].values())
    per_journal: dict[str, list] = defaultdict(list)
    for r in rows.values():
        if 12 <= months(r["date"], t) <= 40:
            per_journal[r["journal"]].append(r["pct"])
    jtable = {j: round(sum(v) / len(v), 1) for j, v in per_journal.items() if len(v) >= s["journal_min_papers"]}
    for r in rows.values():
        age = months(r["date"], t)
        w = min(1.0, max(0.0, (age - 2) / 10))          # 0 at two months old, 1 from a year on
        r["jpct"] = jtable.get(r["journal"], 50.0)
        r["score"] = round(w * r["pct"] + (1 - w) * r["jpct"], 2)
    return jtable


def proven(r: dict, area: str, t: date) -> float:
    """The area percentile, pulled toward the middle for papers under a year old: leading a
    recent quarter with 6 citations is promising, not yet proven."""
    return 50 + (r["pcts"][area] - 50) * min(1.0, months(r["date"], t) / 12)


def pick(rows: dict[str, dict], t: date, s: dict, areas: list[str]) -> dict:
    """{window: {area: {research: [...], other: [...]}}}"""
    out: dict = {}
    for w, days in WINDOWS.items():
        start = t - timedelta(days=days)
        out[w] = {}
        for a in areas:
            pool = [r for r in rows.values() if a in r["areas"] and r["date"] >= start]
            if w == "6m":
                key = lambda r: (-r["score"], -r["cites"], r["pmid"])
            else:                                        # proven: citations only, old enough to judge
                pool = [r for r in pool if months(r["date"], t) >= s["min_age_months"]]
                key = lambda r, a=a: (-proven(r, a, t), -r["cites"], r["pmid"])
            pool.sort(key=key)
            room = 1.5          # some drop out once fetched (no abstract, a reply, or the area's rule)
            out[w][a] = {"research": [r["pmid"] for r in pool if r["kind"] == "research"][:int(s["per_window"][w] * room)],
                         "other": [r["pmid"] for r in pool if r["kind"] == "other"][:int(s["other_per_window"] * room)]}
    return out


def build_corpus(pm: PubMed, cfg: dict, t: date, s: dict) -> "tuple[dict[str, list], dict[str, set]]":
    """{pmid: [first date, journal, [types], title, 2]} for every stream paper in the last `years` years,
    cached. The date is when it first appeared, online or in print."""
    path = CACHE / "important_corpus.json"
    cache: dict = read_json(path, {}) or {}
    start = t - timedelta(days=round(365.25 * s["years"]) + 31)
    ids: list[str] = []
    areas_of: dict[str, set] = defaultdict(set)
    for st in cfg["streams"]:
        n, got = pm.ids(fill(st["query"], cfg), start, t, datetype="pdat")
        log(f"Important: {st['id']}: {n} papers since {start}")
        ids.extend(got)
        for p in got:
            areas_of[p].add(st.get("area", "body"))
    ids = list(dict.fromkeys(ids))
    missing = [p for p in ids if len(cache.get(p) or []) < 5]          # 5 fields: the current format
    log(f"Important: {len(ids)} papers, {len(missing)} new to the cache")
    for r in pm.summaries(missing):
        if r["first"] or r["date"]:
            cache[r["pmid"]] = [r["first"] or r["date"], r["journal"], r["types"], r["title"], 2]
    keep = set(ids)
    cache = {k: v for k, v in cache.items() if k in keep}
    # one record per line, sorted: weekly changes stay small in git
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("{\n" + ",\n".join(f"{json.dumps(k)}:{json.dumps(cache[k], ensure_ascii=False)}"
                                        for k in sorted(cache, key=int)) + "\n}\n", encoding="utf-8")
    return cache, areas_of


def run(http: Optional[Http] = None) -> dict:
    cfg = load_yaml("feeds.yaml")
    s = settings_from(cfg)
    http = http or default_http()
    pm = PubMed(http)
    t = today()
    compiled = compile_systems(cfg["systems"])

    corpus, areas_of = build_corpus(pm, cfg, t, s)
    areas = list((cfg.get("areas") or {"body": {}}).keys())
    log(f"Important: citations for {len(corpus)} papers (iCite)")
    cites = icite.metrics(http, corpus.keys())
    rows: dict[str, dict] = {}
    skipped = 0
    for pmid, (d, journal, types, *rest) in corpus.items():
        rest = [x for x in rest if isinstance(x, str)]
        m = cites.get(pmid, {})
        kind = kind_of(types, m.get("research") if m else None, rest[0] if rest else "")
        if kind is None:
            skipped += 1
            continue
        try:
            when = date.fromisoformat(d)
        except ValueError:
            continue
        rows[pmid] = {"pmid": pmid, "date": when, "journal": journal, "kind": kind,
                      "areas": sorted(areas_of.get(pmid) or {"body"}),
                      "cites": m.get("cites", 0), "cpy": m.get("cpy", 0), "rcr": m.get("rcr"), "clin": m.get("clin", 0)}
    jtable = score(rows, t, s)
    rules = area_require(cfg.get("areas"))
    windows = pick(rows, t, s, areas)

    chosen = list(dict.fromkeys(p for w in windows.values() for per in w.values() for lst in per.values() for p in lst))
    log(f"Important: fetching {len(chosen)} papers for cards")
    papers = {}
    for rec in pm.fetch(chosen):
        card = to_card(rec, compiled)
        if is_notice(card) or rec["pmid"] not in rows or (card.get("conclusion") or {}).get("kind") == "none":
            continue
        r = rows[rec["pmid"]]
        card["areas"] = [a for a in r["areas"] if a not in rules or passes(rec, rules[a])]
        if not card["areas"]:
            continue
        pcts = {a: v for a, v in r["pcts"].items() if a in card["areas"]}     # only areas the paper is shown in
        card["impact"] = {"pct": max(pcts.values()), "pcts": pcts, "jpct": r["jpct"], "cites": r["cites"], "cpy": r["cpy"], "rcr": r["rcr"],
                          "clin": r["clin"], "age": round(months(r["date"], t), 1), "q": quarter(r["date"]),
                          "kind": r["kind"], "score": r["score"]}
        papers[rec["pmid"]] = card
    cap = {"research": lambda w: s["per_window"][w], "other": lambda w: s["other_per_window"]}
    windows = {w: {a: {k: [p for p in lst if p in papers and a in papers[p]["areas"]][:cap[k](w)] for k, lst in per.items()}
                   for a, per in v.items()}
               for w, v in windows.items()}
    figures.attach(http, papers.values(), data=DATA, cache_dir=CACHE, budget=150, job="important")
    abstract_store.save(DATA / "abstracts", "i", abstract_store.split_out(list(papers.values()), "i"))

    out = {
        "generated": now_iso(),
        "today": t.isoformat(),
        "settings": {k: s[k] for k in ("years", "per_window", "other_per_window", "min_age_months")},
        "stats": {
            "checked": len(corpus), "kept": len(rows), "skipped": skipped,
            "research": sum(1 for r in rows.values() if r["kind"] == "research"),
            "other": sum(1 for r in rows.values() if r["kind"] == "other"),
            "with_citations": sum(1 for r in rows.values() if r["cites"] > 0),
            "areas": {a: sum(1 for r in rows.values() if a in r["areas"]) for a in areas},
            "journals": sorted(([j, p, sum(1 for r in rows.values() if r["journal"] == j)] for j, p in jtable.items()),
                               key=lambda x: -x[1])[:15],
        },
        "systems": {k: v["label"] for k, v in cfg["systems"].items()},
        "windows": windows,
        "papers": papers,
    }
    write_json(DATA / "important.json", out)
    log(f"Important: {len(papers)} papers; checked {len(corpus)}, {out['stats']['research']} original research, "
        f"{out['stats']['other']} reviews/guidelines, {skipped} skipped")
    return out


if __name__ == "__main__":
    run()
