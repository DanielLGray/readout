"""Offline stand-ins for PubMed, iCite and ClinicalTrials.gov.

Builds a SYNTHETIC universe of ~6,000 fake papers (2016–today) with known
trend shapes, and answers the exact queries the pipeline sends. Used by the
tests and to preview the app before the first real run. None of these
papers exist."""
from __future__ import annotations

import json
import random
from datetime import date, timedelta
from urllib.parse import urlparse
from xml.sax.saxutils import escape

from pipeline.build_explore import EVIDENCE
from pipeline.common import fill, load_yaml

RADIOLOGY = ["Radiology", "Radiographics", "AJR Am J Roentgenol", "Eur Radiol", "Abdom Radiol (NY)",
             "Invest Radiol", "J Magn Reson Imaging", "Eur J Radiol", "Korean J Radiol", "Insights Imaging"]
NM = ["J Nucl Med", "Eur J Nucl Med Mol Imaging", "Clin Nucl Med"]
GENERAL = ["Lancet Oncol", "JAMA Oncol", "J Hepatol", "Eur Urol", "Gastroenterology"]

# topic → (title phrases, yearly multiplier function)
def _steady(y): return 1.0
def _rise(start, k=0.45):
    return lambda y: 0.0 if y < start else (1 + k) ** (y - start)
def _boom(start):
    return lambda y: 0.0 if y < start else [0.2, 3.0, 7.0, 11.0, 14.0][min(y - start, 4)]
def _peak(top):
    return lambda y: max(0.25, 1.6 - 0.35 * abs(y - top))

PROFILES = {
    "lirads": (["LI-RADS category reassignment on contrast-enhanced MRI",
                "LI-RADS treatment response algorithm after locoregional therapy"], _steady),
    "amri_hcc": (["Abbreviated MRI for hepatocellular carcinoma surveillance"], _rise(2018, 0.2)),
    "liver_quant": (["MRI proton density fat fraction in steatotic liver disease",
                     "MR elastography for fibrosis staging"], _rise(2016, 0.12)),
    "panc_cyst": (["Pancreatic cyst surveillance with MRCP", "Worrisome features in IPMN"], _steady),
    "pdac_imaging": (["Prediagnostic CT signs of pancreatic ductal adenocarcinoma"], _rise(2017, 0.15)),
    "rectal_mri": (["Rectal cancer MRI restaging before watch-and-wait"], _rise(2016, 0.1)),
    "prostate_mri": (["Biparametric MRI for prostate cancer detection", "PI-RADS 3 lesions on biparametric MRI"],
                     _rise(2016, 0.1)),
    "psma_pet": (["PSMA PET for biochemical recurrence", "PSMA PET staging before radical prostatectomy"],
                 _rise(2016, 0.3)),
    "orads": (["O-RADS MRI risk stratification of adnexal masses"], _rise(2020, 0.35)),
    "fapi": (["FAPI PET in gastrointestinal cancers", "FAPI PET versus FDG PET for peritoneal disease"],
             _rise(2019, 0.6)),
    "theranostics": (["Radioligand therapy outcomes", "Lutetium-177 PSMA radioligand therapy dosimetry"],
                     _rise(2018, 0.45)),
    "total_body_pet": (["Total-body PET with long axial field-of-view scanners"], _rise(2020, 0.55)),
    "pcct": (["Photon-counting CT of the abdomen", "Photon-counting CT for pancreatic lesion conspicuity"],
             _rise(2020, 0.7)),
    "dl_recon": (["Deep learning reconstruction for low-dose abdominal CT"], _rise(2019, 0.5)),
    "llm_radiology": (["Large language models for radiology report simplification",
                       "Large language models for structured reporting"], _boom(2023)),
    "radiomics_body": (["Radiomics nomogram for preoperative prediction", "CT texture analysis of renal masses"],
                       _peak(2021)),
    "ceus": (["Contrast-enhanced ultrasound of focal liver lesions"], _steady),
    "renal_mass": (["Bosniak classification of cystic renal masses"], _steady),
    "adrenal": (["Adrenal incidentalomas on unenhanced CT"], _steady),
    "endometriosis": (["Endometriosis MRI mapping before surgery"], _rise(2016, 0.15)),
}

CONCLUSIONS = [
    "{x} improved diagnostic confidence compared with standard care.",
    "{x} showed high specificity but moderate sensitivity in this cohort.",
    "{x} changed management in about one in five patients.",
    "{x} did not outperform the current standard and should not replace it.",
]


class FakeWorld:
    def __init__(self, today: date, n: int = 6000, seed: int = 7):
        self.today = today
        rnd = random.Random(seed)
        self.cfg = load_yaml("feeds.yaml")
        self.tcfg = load_yaml("topics.yaml")
        self.queries = {}
        for s in self.cfg["streams"]:
            self.queries[fill(s["query"], self.cfg)] = ("stream", s["id"])
        for tp in self.tcfg["topics"]:
            q = " ".join(tp["query"].split())
            self.queries[q] = ("topic", tp["id"])
            for k, f in EVIDENCE.items():
                self.queries[f"({q}) AND {f}"] = ("topic_ev", (tp["id"], k))
        self.queries[" ".join(self.tcfg["baseline_query"].split())] = ("baseline", None)

        start = date(2016, 1, 1)
        span = (today - start).days
        papers = []
        topic_ids = list(PROFILES)
        weights_cache = {}
        i = 0
        while len(papers) < n:
            d = start + timedelta(days=rnd.randrange(span))
            year = d.year
            if year not in weights_cache:
                weights_cache[year] = [PROFILES[t][1](year) for t in topic_ids]
            w = weights_cache[year]
            # literature grows ~6%/yr overall
            if rnd.random() > (1.06 ** (year - 2026)):
                continue
            topic = rnd.choices(topic_ids + [None], weights=w + [3.0])[0]
            i += 1
            pmid = str(80000000 + i)
            stream_r = rnd.random()
            if topic in ("psma_pet", "fapi", "theranostics", "total_body_pet") and stream_r < 0.6:
                journal, stream = rnd.choice(NM), "nm_body"
            elif stream_r < 0.08:
                journal, stream = rnd.choice(GENERAL), "general_imaging"
            else:
                journal, stream = rnd.choice(RADIOLOGY), "body_journals"
            phrase = rnd.choice(PROFILES[topic][0]) if topic else rnd.choice(
                ["CT of acute appendicitis in adults", "MRI of the female pelvis", "Splenic lesions on CT",
                 "Small bowel obstruction on CT", "Gallbladder wall thickening on ultrasound"])
            ev = rnd.choices(["guideline", "meta", "rct", "prospective", "retro"], [3, 7, 3, 22, 65])[0]
            suffix = {"guideline": ": consensus recommendations", "meta": ": a systematic review and meta-analysis",
                      "rct": ": a randomized controlled trial", "prospective": ": a prospective multicenter study",
                      "retro": rnd.choice([": a retrospective study", "", " in routine practice"])}[ev]
            age_y = max(0.1, (today - d).days / 365.25)
            base_c = {"guideline": 9, "meta": 6, "rct": 7, "prospective": 3, "retro": 1.5}[ev]
            cites = int(rnd.expovariate(1 / (base_c * age_y)) )
            papers.append({
                "pmid": pmid, "date": d, "added": d + timedelta(days=rnd.randrange(0, 12)),
                "journal": journal, "stream": stream, "topics": {topic} if topic else set(),
                "title": phrase + suffix, "ev": ev, "structured": journal != "Radiographics" and rnd.random() < 0.85,
                "n": rnd.choice([48, 112, 236, 512, 1284, 3410]), "cites": cites,
                "concl": rnd.choice(CONCLUSIONS).format(x=phrase.split(" for ")[0].split(" of ")[0]),
            })
        self.papers = {p["pmid"]: p for p in papers}

    # ── query evaluation ────────────────────────────────────────────────────
    def match(self, term: str):
        kind = self.queries.get(term)
        if kind is None and "[ta]" in term and term.count('"') >= 2:
            name = term.split('"')[1]
            return [p for p in self.papers.values() if p["journal"] == name]
        if kind is None:
            raise KeyError(f"fake PubMed does not know this query: {term[:120]}")
        k, v = kind
        if k == "stream":
            return [p for p in self.papers.values() if p["stream"] == v]
        if k == "topic":
            return [p for p in self.papers.values() if v in p["topics"]]
        if k == "topic_ev":
            tid, ev = v
            return [p for p in self.papers.values() if tid in p["topics"] and (
                p["ev"] == ev or (ev == "prospective" and p["ev"] == "rct"))]
        return list(self.papers.values())

    def esearch(self, params: dict):
        term = params["term"]
        hits = self.match(term)
        if params.get("datetype") == "edat" and params.get("reldate"):
            cut = self.today - timedelta(days=int(params["reldate"]))
            hits = [p for p in hits if p["added"] >= cut]
        elif params.get("mindate"):
            lo = date(*map(int, params["mindate"].split("/")))
            hi = date(*map(int, params["maxdate"].split("/")))
            field = "added" if params.get("datetype") == "edat" else "date"
            hits = [p for p in hits if lo <= p[field] <= hi]
        if params.get("sort") == "pub_date":
            hits.sort(key=lambda p: p["date"], reverse=True)
        count = len(hits) * (5 if self.queries.get(term, ("",))[0] == "baseline" else 1)
        retmax = int(params.get("retmax", 20))
        return {"esearchresult": {"count": str(count), "idlist": [p["pmid"] for p in hits[:retmax]]}}

    def efetch(self, params: dict) -> str:
        out = ['<?xml version="1.0"?>', "<PubmedArticleSet>"]
        for pmid in params["id"].split(","):
            p = self.papers.get(pmid)
            if p:
                out.append(self._xml(p))
        out.append("</PubmedArticleSet>")
        return "\n".join(out)

    def _xml(self, p: dict) -> str:
        e = escape
        pts = {"guideline": "Practice Guideline", "meta": "Meta-Analysis", "rct": "Randomized Controlled Trial"}
        ptypes = ["Journal Article"] + ([pts[p["ev"]]] if p["ev"] in pts else [])
        design = {"prospective": "This prospective multicenter study", "rct": "This randomized trial",
                  "meta": "This meta-analysis of 24 studies", "guideline": "An expert panel",
                  "retro": "This retrospective study"}[p["ev"]]
        if p["structured"]:
            concl = p["concl"] + (" © RSNA, 2026" if p["journal"] == "Radiology" else "")
            abstract = (
                f'<AbstractText Label="PURPOSE" NlmCategory="OBJECTIVE">To evaluate {e(p["title"].split(":")[0].lower())}.</AbstractText>'
                f'<AbstractText Label="METHODS" NlmCategory="METHODS">{design} included {p["n"]:,} patients.</AbstractText>'
                f'<AbstractText Label="RESULTS" NlmCategory="RESULTS">The area under the curve was 0.{80 + int(p["pmid"]) % 15}.</AbstractText>'
                f'<AbstractText Label="CONCLUSION" NlmCategory="CONCLUSIONS">{e(concl)}</AbstractText>')
        else:
            abstract = (f"<AbstractText>{e(p['title'].split(':')[0])} is increasingly used. {design} reviews "
                        f"the imaging appearance and pitfalls. {e(p['concl'])}</AbstractText>")
        d, a = p["date"], p["added"]
        return f"""<PubmedArticle><MedlineCitation><PMID>{p['pmid']}</PMID><Article>
<Journal><JournalIssue><PubDate><Year>{d.year}</Year><Month>{d.month:02d}</Month></PubDate></JournalIssue>
<Title>{e(p['journal'])}</Title><ISOAbbreviation>{e(p['journal'])}</ISOAbbreviation></Journal>
<ArticleTitle>{e(p['title'])} [SYNTHETIC]</ArticleTitle><Abstract>{abstract}</Abstract>
<AuthorList><Author><LastName>Sample</LastName><Initials>S</Initials></Author><Author><LastName>Example</LastName><Initials>E</Initials></Author></AuthorList>
<Language>eng</Language><PublicationTypeList>{''.join(f'<PublicationType>{t}</PublicationType>' for t in ptypes)}</PublicationTypeList>
<ArticleDate DateType="Electronic"><Year>{d.year}</Year><Month>{d.month}</Month><Day>{d.day}</Day></ArticleDate>
</Article></MedlineCitation><PubmedData><History>
<PubMedPubDate PubStatus="entrez"><Year>{a.year}</Year><Month>{a.month}</Month><Day>{a.day}</Day></PubMedPubDate>
</History><ArticleIdList><ArticleId IdType="pubmed">{p['pmid']}</ArticleId></ArticleIdList></PubmedData></PubmedArticle>"""

    def esummary(self, params: dict):
        ids = params["id"].split(",")
        res = {"uids": [i for i in ids if i in self.papers]}
        for i in res["uids"]:
            p = self.papers[i]
            pts = {"guideline": "Practice Guideline", "meta": "Meta-Analysis", "rct": "Randomized Controlled Trial"}
            res[i] = {"title": p["title"], "source": p["journal"], "sortpubdate": p["date"].strftime("%Y/%m/%d 00:00"),
                      "history": [{"pubstatus": "entrez", "date": min(p["added"], p["date"]).strftime("%Y/%m/%d 00:00")}],
                      "pubtype": ["Journal Article"] + ([pts[p["ev"]]] if p["ev"] in pts else []) +
                                 (["Case Reports"] if int(i) % 23 == 0 else [])}
        return {"result": res}

    def icite(self, params: dict):
        rows = []
        for i in params["pmids"].split(","):
            p = self.papers.get(i)
            if not p:
                continue
            age = max(1, self.today.year - p["date"].year + 1)
            old_enough = p["date"].year < self.today.year - 1
            rows.append({"pmid": int(i), "year": p["date"].year, "citation_count": p["cites"],
                         "citations_per_year": p["cites"] / age,
                         "relative_citation_ratio": round(p["cites"] / age / 3, 2) if old_enough else None,
                         "is_research_article": p["ev"] not in ("guideline", "meta"),
                         "cited_by_clin": list(range(p["cites"] // 40))})
        return {"data": rows}

    def ctgov(self, params: dict):
        rng = params["filter.advanced"].split("RANGE[")[1].rstrip("]").split(",")
        start = date.fromisoformat(rng[0])
        h = sum(map(ord, params["query.term"])) % 17
        growth = 1.0 + (0.25 if "PSMA" in params["query.term"] or "FAPI" in params["query.term"] else 0.0)
        return {"totalCount": int((5 + h) * (growth ** (start.year - 2020)) * (1 + (self.today - start).days / 365))}

    # ── transport ───────────────────────────────────────────────────────────
    def transport(self, method: str, url: str, params: dict):
        path = urlparse(url).path
        try:
            if path.endswith("esearch.fcgi"):
                return 200, json.dumps(self.esearch(params))
            if path.endswith("efetch.fcgi"):
                return 200, self.efetch(params)
            if path.endswith("esummary.fcgi"):
                return 200, json.dumps(self.esummary(params))
            if "icite" in url:
                return 200, json.dumps(self.icite(params))
            if "clinicaltrials" in url:
                return 200, json.dumps(self.ctgov(params))
        except KeyError as exc:
            return 400, str(exc)
        return 404, "unknown endpoint"
