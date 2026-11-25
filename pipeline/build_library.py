"""Monthly job: Foundations and the classics → docs/data/library.json

Foundations: the reading path in config/foundations.yaml. Each entry is a pinned PMID or a
PubMed search whose most-cited match (NIH iCite) is used.

Classics: the "classic of the day". Every paper the feed's searches find from `from_year` up
to `min_age_years` ago, ranked by citations per year within each interest area, a few per
publication year so one busy year can't crowd out the rest. Original research, reviews and
guidelines; never case reports, letters or notices. Papers already in Foundations are left out.

    python -m pipeline.build_library
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from typing import Optional

from . import abstract_store, figures, icite
from .abstracts import area_require, compile_systems, is_notice, passes, to_card
from .build_important import kind_of
from .common import CACHE, DATA, fill, load_yaml, now_iso, read_json, today, write_json
from .http import Http, default_http, log
from .pubmed import PubMed

NOT_PAPERS = 'NOT (Letter[pt] OR Comment[pt] OR "Published Erratum"[pt] OR Editorial[pt])'
DEFAULTS = {"from_year": 2000, "min_age_years": 5, "per_area": 60, "per_year": 4, "exclude": ""}


def resolve(pm: PubMed, http: Http, item: dict, previous: dict) -> Optional[str]:
    """The PMID for one Foundations entry: pinned, else the most-cited match, else last month's."""
    pinned = str(item.get("pmid") or "").strip()
    if pinned.isdigit():
        return pinned
    try:
        _, ids = pm.esearch(f"({item['find']}) {NOT_PAPERS}", retmax=50)
    except Exception as exc:          # one search PubMed rejects shouldn't cost the rest
        log(f"  Foundations: search for {item.get('label')!r} failed ({exc})")
        ids = []
    if ids:
        m = icite.metrics(http, ids)
        return max(ids, key=lambda p: (m.get(p, {}).get("cites", 0), -int(p)))
    return previous.get(item.get("label", ""))


def classic_candidates(pm: PubMed, http: Http, cfg: dict, s: dict, t: date, skip: set) -> "tuple[dict, dict]":
    """{area: [pmid, …] best first} and {pmid: iCite row}."""
    start, end = date(int(s["from_year"]), 1, 1), date(t.year - int(s["min_age_years"]), 12, 31)
    by_area: dict[str, set] = defaultdict(set)
    for st in cfg["streams"]:
        try:
            n, ids = pm.ids(fill(st["query"], cfg), start, end, datetype="pdat")
        except Exception as exc:
            log(f"  Classics: {st['id']} skipped ({exc})")
            continue
        log(f"Classics: {st['id']}: {n} papers {start.year}–{end.year}")
        by_area[st.get("area", "body")].update(ids)
    every = sorted(set().union(*by_area.values()) - skip, key=int) if by_area else []
    log(f"Classics: citations for {len(every)} papers (iCite)")
    m = icite.metrics(http, every)
    out = {}
    room = 2.2          # some fall out once fetched: no abstract, a case report, the area's rule
    for a, ids in by_area.items():
        rows = [p for p in ids if p in m and m[p]["cites"] > 0 and (m[p].get("year") or 0) <= end.year and p not in skip]
        rows.sort(key=lambda p: (-m[p]["cpy"], -m[p]["cites"], int(p)))
        per_year: dict = defaultdict(int)
        keep = []
        for p in rows:
            y = m[p].get("year")
            if per_year[y] >= int(s["per_year"]) * room:
                continue
            per_year[y] += 1
            keep.append(p)
            if len(keep) >= int(s["per_area"] * room):
                break
        out[a] = keep
    return out, m


def run(http: Optional[Http] = None) -> dict:
    cfg = load_yaml("feeds.yaml")
    fcfg = load_yaml("foundations.yaml") or {}
    s = dict(DEFAULTS, **(fcfg.get("classics") or {}))
    http = http or default_http()
    pm = PubMed(http)
    t = today()
    compiled = compile_systems(cfg["systems"])
    rules = area_require(cfg.get("areas"))
    old = read_json(DATA / "library.json", {}) or {}
    previous = {v.get("label"): k for k, v in ((old.get("foundations") or {}).get("meta") or {}).items()}

    # 1 — Foundations
    groups, meta = [], {}
    for g in fcfg.get("groups", []):
        ids = []
        for it in g.get("items", []):
            pmid = resolve(pm, http, it, previous)
            if not pmid or pmid in meta:
                if not pmid:
                    log(f"  Foundations: nothing found for {it.get('label')!r}")
                continue
            ids.append(pmid)
            meta[pmid] = {"label": it.get("label", ""), "why": it.get("why", ""), "group": g["id"]}
        groups.append({"id": g["id"], "name": g.get("name", g["id"]), "items": ids})

    # 2 — classics
    cands, cites = classic_candidates(pm, http, cfg, s, t, set(meta))
    fd_cites = icite.metrics(http, list(meta))

    # 3 — cards
    want = list(meta) + [p for lst in cands.values() for p in lst]
    log(f"Library: fetching {len(set(want))} papers")
    recs = {r["pmid"]: r for r in pm.fetch(want)}
    papers: dict[str, dict] = {}
    for pmid, info in meta.items():
        rec = recs.get(pmid)
        if not rec:
            continue
        card = to_card(rec, compiled)
        c = fd_cites.get(pmid, {})
        card["fd"] = info
        card["cites"] = {"n": c.get("cites", 0), "cpy": c.get("cpy", 0), "rcr": c.get("rcr"), "year": c.get("year")}
        papers[pmid] = card
    classics: dict[str, list] = {}
    try:
        exclude = re.compile(s["exclude"]) if s.get("exclude") else None
    except re.error as exc:
        log(f"  Classics: exclude pattern ignored ({exc})")
        exclude = None
    for a, lst in cands.items():
        keep, per_year = [], defaultdict(int)
        for pmid in lst:
            rec = recs.get(pmid)
            if not rec or is_notice(rec) or rec.get("retracted"):
                continue
            if exclude and exclude.search(rec.get("title", "")):
                continue
            c = cites.get(pmid, {})
            if kind_of(rec.get("pub_types", []), c.get("research"), rec.get("title", "")) is None:
                continue
            if a in rules and not passes(rec, rules[a]):
                continue
            if per_year[c.get("year")] >= int(s["per_year"]):
                continue
            card = papers.get(pmid) or to_card(rec, compiled)
            if (card.get("conclusion") or {}).get("kind") == "none":
                continue                         # a classic is read from its abstract
            card["cites"] = {"n": c.get("cites", 0), "cpy": c.get("cpy", 0), "rcr": c.get("rcr"), "year": c.get("year")}
            card["areas"] = sorted(set(card.get("areas", [])) | {a})
            papers[pmid] = card
            per_year[c.get("year")] += 1
            keep.append(pmid)
            if len(keep) >= int(s["per_area"]):
                break
        classics[a] = keep
        log(f"Classics: {a}: {len(keep)} papers")

    figures.attach(http, papers.values(), data=DATA, cache_dir=CACHE, budget=120, lookup=False, job="library")
    abstract_store.save(DATA / "abstracts", "l", abstract_store.split_out(list(papers.values()), "l"))
    out = {
        "generated": now_iso(),
        "foundations": {"title": fcfg.get("title", "Foundations"), "about": fcfg.get("about", ""),
                        "groups": [g for g in groups if g["items"]], "meta": meta},
        "classics": classics,
        "settings": {k: s[k] for k in DEFAULTS if k != "exclude"},
        "papers": papers,
    }
    write_json(DATA / "library.json", out)
    log(f"Library: {sum(len(g['items']) for g in groups)} foundation papers, "
        f"{sum(len(v) for v in classics.values())} classics, {sum(1 for p in papers.values() if p.get('fig'))} with a picture")
    return out


if __name__ == "__main__":
    run()
