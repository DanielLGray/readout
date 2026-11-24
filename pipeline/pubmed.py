"""PubMed E-utilities client and XML parsing."""
from __future__ import annotations

import os
import re
from datetime import date, timedelta
from typing import Iterable, Optional
from xml.etree import ElementTree as ET

from .http import Http, log

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
MAX_IDS = 9999          # esearch cannot page past 10,000 records
FETCH_BATCH = 200
SUMMARY_BATCH = 400

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def fmt(d: date) -> str:
    return d.strftime("%Y/%m/%d")


class PubMed:
    def __init__(self, http: Http):
        self.http = http
        self.base = {"db": "pubmed", "tool": "readout"}
        email = os.environ.get("NCBI_EMAIL", "").strip()
        if email:                       # NCBI wants a real address to reach you; send none rather than a made-up one
            self.base["email"] = email
        key = os.environ.get("NCBI_API_KEY", "").strip()
        if key:
            self.base["api_key"] = key
        self.warnings: dict[str, list[str]] = {}

    # ── searching ────────────────────────────────────────────────────────────
    def esearch(self, term: str, *, datetype: Optional[str] = None, mindate: Optional[date] = None,
                maxdate: Optional[date] = None, reldate: Optional[int] = None, retmax: int = 0,
                sort: Optional[str] = None) -> "tuple[int, list[str]]":
        params = dict(self.base, term=term, retmode="json", retmax=str(retmax))
        if datetype:
            params["datetype"] = datetype
        if mindate:
            params["mindate"] = fmt(mindate)
            params["maxdate"] = fmt(maxdate or date.today())
        if reldate:
            params["reldate"] = str(reldate)
        if sort:
            params["sort"] = sort
        data = self.http.post_json(f"{EUTILS}/esearch.fcgi", params)
        res = data.get("esearchresult", {})
        if "ERROR" in res:
            raise RuntimeError(f"PubMed rejected query: {res['ERROR']} :: {term[:200]}")
        self._note_warnings(term, res)
        return int(res.get("count", 0)), list(res.get("idlist", []))

    def count(self, term: str, start: date, end: date, datetype: str = "pdat") -> int:
        return self.esearch(term, datetype=datetype, mindate=start, maxdate=end, retmax=0)[0]

    def ids(self, term: str, start: date, end: date, datetype: str = "pdat") -> "tuple[int, list[str]]":
        """All PMIDs in a date range, splitting the range when PubMed's 10k cap bites."""
        total, ids = self.esearch(term, datetype=datetype, mindate=start, maxdate=end, retmax=MAX_IDS)
        if total <= MAX_IDS:
            return total, ids
        if (end - start).days < 2:
            log(f"  warning: >{MAX_IDS} records on {start}; keeping first {MAX_IDS}")
            return total, ids
        mid = start + (end - start) // 2
        _, a = self.ids(term, start, mid, datetype)
        _, b = self.ids(term, mid + timedelta(days=1), end, datetype)
        seen, out = set(), []
        for pmid in a + b:
            if pmid not in seen:
                seen.add(pmid)
                out.append(pmid)
        return total, out

    def _note_warnings(self, term: str, res: dict) -> None:
        notes = []
        for block in ("warninglist", "errorlist"):
            for k, v in (res.get(block) or {}).items():
                if v:
                    notes.append(f"{k}: {', '.join(v) if isinstance(v, list) else v}")
        if notes:
            self.warnings.setdefault(term, notes)

    # ── fetching ─────────────────────────────────────────────────────────────
    def fetch(self, pmids: Iterable[str]) -> list[dict]:
        pmids = list(dict.fromkeys(pmids))
        out: list[dict] = []
        for i in range(0, len(pmids), FETCH_BATCH):
            batch = pmids[i:i + FETCH_BATCH]
            for attempt in (1, 2, 3):
                xml = self.http.post_text(f"{EUTILS}/efetch.fcgi",
                                          dict(self.base, id=",".join(batch), retmode="xml"))
                try:
                    out.extend(parse_articles(xml))
                    break
                except ET.ParseError as exc:     # truncated or HTML error page
                    log(f"  PubMed sent unreadable XML ({exc}); retry {attempt}/3")
                    if attempt == 3:
                        raise
        return out

    def summaries(self, pmids: Iterable[str]) -> list[dict]:
        """Light records (title, journal, date) via esummary — for big corpora."""
        pmids = list(dict.fromkeys(pmids))
        out = []
        for i in range(0, len(pmids), SUMMARY_BATCH):
            batch = pmids[i:i + SUMMARY_BATCH]
            data = self.http.post_json(f"{EUTILS}/esummary.fcgi",
                                       dict(self.base, id=",".join(batch), retmode="json"))
            res = data.get("result", {})
            for uid in res.get("uids", []):
                r = res.get(uid, {})
                out.append({
                    "pmid": uid,
                    "title": r.get("title", ""),
                    "journal": r.get("source", ""),
                    "date": (r.get("sortpubdate") or "")[:10].replace("/", "-"),
                    # when it first appeared (online ahead of print counts): the fair start for citations
                    "first": min([d for d in [(r.get("sortpubdate") or "")[:10].replace("/", "-")] +
                                  [(h.get("date") or "")[:10].replace("/", "-") for h in r.get("history", []) or []
                                   if h.get("pubstatus") in ("entrez", "pubmed")] if len(d) == 10] or [""]),
                    "types": [str(x) for x in r.get("pubtype", []) or []],
                })
        return out


# ── XML parsing ──────────────────────────────────────────────────────────────
def _text(el: Optional[ET.Element]) -> str:
    if el is None:
        return ""
    return " ".join("".join(el.itertext()).split())


def _date_from(el: Optional[ET.Element]) -> Optional[str]:
    """Year/Month/Day children (or MedlineDate) → 'YYYY-MM-DD' / 'YYYY-MM' / 'YYYY'."""
    if el is None:
        return None
    y = _text(el.find("Year"))
    if not y:
        md = _text(el.find("MedlineDate"))
        return md[:4] if md[:4].isdigit() else None
    m = _text(el.find("Month"))
    d = _text(el.find("Day"))
    if m and not m.isdigit():
        m = str(MONTHS.get(m[:3].lower(), 0) or "")
    parts = [y]
    if m:
        parts.append(f"{int(m):02d}")
        if d.isdigit():
            parts.append(f"{int(d):02d}")
    return "-".join(parts)


def parse_articles(xml: str) -> list[dict]:
    if re.search(r"<!ENTITY|<!DOCTYPE[^>\[]*\[", xml[:200_000], re.I):    # entity tricks: never in PubMed's XML
        raise ET.ParseError("document declares XML entities; refused")
    root = ET.fromstring(xml)
    return [a for a in (parse_article(el) for el in root.iter("PubmedArticle")) if a]


def parse_article(el: ET.Element) -> Optional[dict]:
    mc = el.find("MedlineCitation")
    if mc is None:
        return None
    art = mc.find("Article")
    if art is None:
        return None
    pmid = _text(mc.find("PMID"))
    journal = art.find("Journal")

    sections = []
    for at in art.findall("Abstract/AbstractText"):
        txt = _text(at)
        if not txt:
            continue
        sections.append({
            "label": (at.get("Label") or "").strip(),
            "cat": (at.get("NlmCategory") or "").strip().upper(),
            "text": txt,
        })

    authors = []
    for a in art.findall("AuthorList/Author"):
        if a.find("CollectiveName") is not None:
            authors.append(_text(a.find("CollectiveName")))
        else:
            last, ini = _text(a.find("LastName")), _text(a.find("Initials"))
            if last:
                authors.append(f"{last} {ini}".strip())

    pub_types = [_text(p) for p in art.findall("PublicationTypeList/PublicationType")]
    ids = {i.get("IdType"): _text(i) for i in el.findall("PubmedData/ArticleIdList/ArticleId")}
    doi = ids.get("doi") or next((_text(e) for e in art.findall("ELocationID")
                                  if e.get("EIdType") == "doi"), "")
    history = {h.get("PubStatus"): _date_from(h) for h in el.findall("PubmedData/History/PubMedPubDate")}
    epub = next((_date_from(d) for d in art.findall("ArticleDate")
                 if d.get("DateType", "Electronic") == "Electronic"), None)
    ppub = _date_from(journal.find("JournalIssue/PubDate")) if journal is not None else None
    corrections = {c.get("RefType") for c in mc.findall("CommentsCorrectionsList/CommentsCorrections")}

    return {
        "pmid": pmid,
        "title": _text(art.find("ArticleTitle")) or _text(art.find("VernacularTitle")),
        "journal": _text(journal.find("ISOAbbreviation")) if journal is not None else "",
        "journal_full": _text(journal.find("Title")) if journal is not None else "",
        "authors": authors,
        "pub_types": pub_types,
        "sections": sections,
        "doi": doi,
        "pmcid": ids.get("pmc", ""),
        "added": history.get("entrez") or history.get("pubmed") or epub or ppub,
        "epub": epub,
        "ppub": ppub,
        "retracted": "Retracted Publication" in pub_types or "RetractionIn" in corrections,
        "concern": "ExpressionOfConcernIn" in corrections,
        "language": _text(art.find("Language")),
    }
