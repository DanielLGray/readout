"""Free full text for paper cards (card["ft"]), from Europe PMC: an open-access copy in PubMed
Central, a free version on the publisher's site, or one Unpaywall found in a repository. No key.

Each job keeps its own notes (cache/fulltext-<job>.json): what was found and when, so a paper is
asked about again only after a while (papers often become free after an embargo).
"""
from __future__ import annotations

import re
from datetime import timedelta
from pathlib import Path
from typing import Iterable, Optional

from .common import CACHE, read_json, today, write_json
from .http import Http, log

EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
BATCH = 50
RECHECK_NONE = 30        # days before asking again about a paper with no free copy
RECHECK_FOUND = 180      # and about one that had one (links move)
_PMC = re.compile(r"^PMC\d{1,10}$")


def pmc_link(pmcid: str) -> str:
    return f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/"


def best_link(rec: dict) -> Optional[dict]:
    """The free copy to open: PubMed Central first (a readable page on a phone), then the publisher's
    own free version, then a repository copy. {"u": url, "s": "PMC"|"publisher"|"repository", "pdf": bool}"""
    pmcid = str(rec.get("pmcid") or "")
    if _PMC.match(pmcid) and str(rec.get("inPMC") or rec.get("inEPMC") or "").upper() == "Y":
        return {"u": pmc_link(pmcid), "s": "PMC", "pdf": False}
    urls = ((rec.get("fullTextUrlList") or {}).get("fullTextUrl") or [])
    free = [u for u in urls if str(u.get("availabilityCode") or "").upper() in ("OA", "F")
            and str(u.get("url") or "").startswith("https://") and len(str(u.get("url"))) <= 600]

    def rank(u: dict) -> tuple:
        site = str(u.get("site") or "")
        where = 0 if site in ("Europe_PMC", "PubMedCentral") else 1 if site == "DOI" else 2 if site == "Unpaywall" else 3
        return (where, 0 if str(u.get("documentStyle")) == "html" else 1)
    for u in sorted(free, key=rank):
        site = str(u.get("site") or "")
        if site in ("Europe_PMC", "PubMedCentral"):
            if _PMC.match(pmcid):
                return {"u": pmc_link(pmcid), "s": "PMC", "pdf": False}
            continue
        return {"u": str(u["url"]), "s": "publisher" if site == "DOI" else "repository",
                "pdf": str(u.get("documentStyle")) == "pdf"}
    return None


def lookup(http: Http, pmids: list[str]) -> dict:
    """pmid → best free link (or None), for up to BATCH PubMed IDs in one request."""
    q = "(" + " OR ".join(f"EXT_ID:{p}" for p in pmids) + ") AND SRC:MED"
    data = http.get_json(EPMC, {"query": q, "resultType": "core", "format": "json", "pageSize": 100})
    if not isinstance(data, dict):
        raise RuntimeError("Europe PMC sent something unexpected")
    out = {p: None for p in pmids}
    for rec in ((data.get("resultList") or {}).get("result") or []):
        p = str(rec.get("pmid") or rec.get("id") or "")
        if p in out:
            out[p] = best_link(rec)
    return out


def attach(http: Http, cards: Iterable[dict], cache_dir: Path = CACHE, job: str = "feed", budget: int = 800) -> dict:
    """Give each card with a free full text its link (card["ft"]). At most `budget` papers are asked
    about per run; the rest wait for the next one."""
    cards = [c for c in cards if re.fullmatch(r"\d{1,9}", str(c.get("pmid") or ""))]
    t = today()
    path = cache_dir / f"fulltext-{job}.json"
    cache = read_json(path, {}) or {}
    seen = cache.setdefault("pmids", {})

    def stale(rec: Optional[dict]) -> bool:
        if not rec:
            return True
        wait = RECHECK_FOUND if rec.get("ft") else RECHECK_NONE
        return rec.get("t", "") < (t - timedelta(days=wait)).isoformat()
    want = list(dict.fromkeys(str(c["pmid"]) for c in cards if stale(seen.get(str(c["pmid"])))))[:budget]
    stats = {"asked": 0, "free": 0, "errors": 0}
    for i in range(0, len(want), BATCH):
        part = want[i:i + BATCH]
        try:
            got = lookup(http, part)
        except Exception as exc:              # full text is a bonus: the cards still go out
            stats["errors"] += 1
            log(f"  Full text: Europe PMC failed ({type(exc).__name__}: {str(exc)[:160]}); the rest wait for the next run")
            break
        stats["asked"] += len(part)
        for p, ft in got.items():
            seen[p] = {"t": t.isoformat(), **({"ft": ft} if ft else {})}
    for c in cards:
        c.pop("ft", None)
        rec = seen.get(str(c["pmid"]))
        if rec and rec.get("ft"):
            c["ft"] = rec["ft"]
            stats["free"] += 1
    keep = {str(c["pmid"]) for c in cards}
    old = (t - timedelta(days=400)).isoformat()
    cache["pmids"] = {p: r for p, r in seen.items() if p in keep or r.get("t", "") >= old}
    write_json(path, cache)
    log(f"  Full text: {stats['free']} of {len(cards)} papers free to read; asked Europe PMC about {stats['asked']}")
    return stats
