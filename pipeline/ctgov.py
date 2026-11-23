"""ClinicalTrials.gov (API v2): how many new studies were registered on a
topic in a window — a leading indicator of evidence 2–3 years out."""
from __future__ import annotations

from datetime import date
from typing import Optional

from .http import Http, HttpError, log

API = "https://clinicaltrials.gov/api/v2/studies"


def new_studies(http: Http, term: str, start: date, end: date) -> Optional[int]:
    params = {
        "query.term": term,
        "filter.advanced": f"AREA[StudyFirstPostDate]RANGE[{start.isoformat()},{end.isoformat()}]",
        "countTotal": "true",
        "pageSize": "1",
        "fields": "NCTId",
    }
    try:
        data = http.get_json(API, params)
    except HttpError as exc:
        log(f"  ClinicalTrials.gov unavailable for '{term}' ({exc})")
        return None
    total = data.get("totalCount")
    return int(total) if total is not None else None
