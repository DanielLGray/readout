"""NIH iCite: citation counts and the Relative Citation Ratio (field- and
time-normalized; 1.0 = median NIH-funded paper). RCR is blank for papers from
the most recent fiscal year, so recent windows lean on citations per year."""
from __future__ import annotations

from typing import Iterable

from .http import Http, HttpError, log

ICITE = "https://icite.od.nih.gov/api/pubs"
BATCH = 200
FIELDS = "pmid,year,citation_count,citations_per_year,relative_citation_ratio,is_research_article"


def metrics(http: Http, pmids: Iterable[str]) -> dict[str, dict]:
    pmids = list(dict.fromkeys(pmids))
    out: dict[str, dict] = {}
    for i in range(0, len(pmids), BATCH):
        batch = pmids[i:i + BATCH]
        try:
            data = http.get_json(ICITE, {"pmids": ",".join(batch), "fl": FIELDS})
        except HttpError as exc:
            log(f"  iCite batch failed ({exc}); continuing without it")
            continue
        for row in data.get("data", []):
            pmid = str(row.get("pmid", ""))
            if not pmid:
                continue
            out[pmid] = {
                "year": row.get("year"),
                "cites": row.get("citation_count") or 0,
                "cpy": round(float(row.get("citations_per_year") or 0), 2),
                "rcr": (round(float(row["relative_citation_ratio"]), 2)
                        if row.get("relative_citation_ratio") not in (None, "") else None),
                "research": bool(row.get("is_research_article")),
            }
    return out
