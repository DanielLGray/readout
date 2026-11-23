"""Turning a parsed PubMed record into a card: the authors' own conclusion,
study design, sample size and organ-system tags. No AI, no paraphrase."""
from __future__ import annotations

import re
from typing import Optional

# ── boilerplate that journals append to abstracts ───────────────────────────
_COPYRIGHT = re.compile(r"\s*(?:©|\(c\)\s*(?:19|20)\d\d|Copyright\s*(?:©|\(c\))?\s*(?:19|20)\d\d).*$",
                        re.IGNORECASE | re.DOTALL)
_BOILER = re.compile(
    r"(published under a cc|creative commons|this is an open access article|"
    r"supplemental material is available|online supplemental material|supplementary material is available|"
    r"see also the (?:editorial|commentary|article)|see the (?:editorial|invited commentary|commentary)|"
    r"test your knowledge|quiz questions for this article|"
    r"^clinical trial registration|^trial registration|^registration:|^NCT\d{8}\.?$|"
    r"^keywords?:|^abbreviations?:|^funding:)",
    re.IGNORECASE)

_ABBREV = ["vs.", "e.g.", "i.e.", "et al.", "approx.", "Fig.", "Figs.", "No.", "no.", "Dr.", "cf.", "ca.", "Ref."]


def clean(text: str) -> str:
    text = _COPYRIGHT.sub("", text).strip()
    kept = [s for s in sentences(text) if not _BOILER.search(s.strip())]
    return " ".join(kept).strip()


def sentences(text: str) -> list[str]:
    protected = text
    for i, ab in enumerate(_ABBREV):
        protected = protected.replace(ab, ab.replace(".", f"\u0000{i}\u0000"))
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\[\"“])", protected)
    out = []
    for p in parts:
        for i, ab in enumerate(_ABBREV):
            p = p.replace(ab.replace(".", f"\u0000{i}\u0000"), ab)
        if p.strip():
            out.append(p.strip())
    return out


# ── conclusion ──────────────────────────────────────────────────────────────
_CONCL_LABEL = re.compile(
    r"conclu|interpretation|implication|clinical impact|clinical relevance|critical relevance|"
    r"key points?|take[- ]home|summary statement|tweetable|significance|advances in knowledge",
    re.IGNORECASE)


def _nice_label(label: str) -> str:
    label = label.strip().rstrip(":")
    return label[:1].upper() + label[1:].lower() if label.isupper() else label


def conclusion(rec: dict) -> "tuple[dict, list[dict]]":
    """Returns (primary, extras). primary.kind is one of
    structured — the abstract's labeled conclusion, verbatim
    closing    — unstructured abstract: its last two sentences, verbatim
    opening    — review/educational article: its first two sentences, verbatim
    none       — PubMed has no abstract yet"""
    secs = [dict(s, text=clean(s["text"])) for s in rec.get("sections", [])]
    secs = [s for s in secs if s["text"]]
    if not secs:
        return {"kind": "none", "label": "No abstract in PubMed yet", "text": ""}, []

    labeled = [s for s in secs if s["label"] or s["cat"]]
    concl = [s for s in labeled
             if s["cat"] == "CONCLUSIONS" or (s["cat"] in ("", "UNASSIGNED") and _CONCL_LABEL.search(s["label"]))]
    if concl:
        def rank(s):
            lab = s["label"].lower()
            if "conclu" in lab:
                return 0
            if "interpretation" in lab:
                return 1
            return 2
        primary = sorted(concl, key=rank)[0]
        extras = [{"label": _nice_label(s["label"]) or "Conclusions", "text": s["text"]}
                  for s in concl if s is not primary]
        return {"kind": "structured", "label": _nice_label(primary["label"]) or "Conclusion",
                "text": primary["text"]}, extras

    full = " ".join(s["text"] for s in secs)
    sents = sentences(full)
    pts = set(rec.get("pub_types", []))
    is_review = bool(pts & {"Review", "Systematic Review"}) or rec.get("journal", "").lower() == "radiographics"
    if is_review:
        return {"kind": "opening", "label": "Abstract opening — no stated conclusion",
                "text": " ".join(sents[:2])}, []
    return {"kind": "closing", "label": "Closing lines — abstract has no labeled conclusion",
            "text": " ".join(sents[-2:])}, []


# ── study design ────────────────────────────────────────────────────────────
def _methods_text(rec: dict) -> str:
    secs = rec.get("sections", [])
    m = [s["text"] for s in secs if s["cat"] in ("METHODS", "RESULTS")
         or re.search(r"method|design|setting|participant|patient|result", s["label"], re.I)]
    return " ".join(m) if m else " ".join(s["text"] for s in secs)


def design(rec: dict) -> dict:
    """Badges for how strong the evidence is. Each badge says where it came
    from: 'pubmed' = NLM indexing, 'text' = wording in the abstract."""
    pts = set(rec.get("pub_types", []))
    title = rec.get("title", "")
    methods = _methods_text(rec)
    alltext = title + " " + " ".join(s["text"] for s in rec.get("sections", []))
    badges: list[dict] = []

    def add(label, source, strength):
        badges.append({"label": label, "source": source, "strength": strength})

    if pts & {"Guideline", "Practice Guideline", "Consensus Development Conference",
              "Consensus Development Conference, NIH"}:
        add("Guideline / consensus", "pubmed", 4)
    elif re.search(r"\b(consensus|guidelines?|white paper|position (statement|paper)|recommendations)\b", title, re.I):
        add("Guideline / consensus", "text", 4)

    if "Meta-Analysis" in pts:
        add("Meta-analysis", "pubmed", 4)
    elif re.search(r"meta-analy", title + " " + methods, re.I):
        add("Meta-analysis", "text", 4)
    elif "Systematic Review" in pts:
        add("Systematic review", "pubmed", 4)
    elif re.search(r"systematic(ally)? review", title + " " + methods, re.I):
        add("Systematic review", "text", 4)

    if "Randomized Controlled Trial" in pts:
        add("Randomized trial", "pubmed", 4)
    elif re.search(r"randomi[sz]ed (controlled |clinical )?trial|were randomi[sz]ed|randomly assigned", alltext, re.I):
        add("Randomized trial", "text", 4)

    has_meta = any(b["strength"] == 4 and "Guideline" not in b["label"] for b in badges)
    if not has_meta:
        pro = re.search(r"\bprospective", methods, re.I)
        retro = re.search(r"\bretrospective", methods, re.I)
        if pro and retro:
            add("Prospective + retrospective data", "text", 2)
        elif pro:
            add("Prospective", "text", 3)
        elif retro:
            add("Retrospective", "text", 2)
        if re.search(r"secondary analysis|post[- ]hoc analysis", alltext, re.I):
            add("Secondary analysis", "text", 2)

    if "Multicenter Study" in pts:
        add("Multicenter", "pubmed", 0)
    elif re.search(r"multi-?cent(er|re)|multi-?institution|multi-?site|\d+ (centers|centres|institutions|hospitals)", methods, re.I):
        add("Multicenter", "text", 0)

    if "Case Reports" in pts:
        add("Case report", "pubmed", 1)
    elif "Review" in pts and not has_meta:
        add("Review", "pubmed", 1)

    strength = max([b["strength"] for b in badges], default=0)
    return {"badges": badges, "strength": strength}


# ── sample size ─────────────────────────────────────────────────────────────
_NUM = r"(\d{1,3}(?:[,  ]\d{3})+|\d+)"
_NOUNS = (r"patients|participants|women|men|individuals|subjects|adults|children|volunteers|"
          r"examinations|exams|scans|lesions|nodules|tumors|tumours|studies|cases")
_SAMPLE = re.compile(_NUM + r"\s+(?:(?:consecutive|eligible|adult|pediatric|paediatric|unique|"
                     r"included|enrolled|asymptomatic|symptomatic|treatment-na[iï]ve)\s+)*(" + _NOUNS + r")\b", re.I)
_N_EQ = re.compile(r"\b[nN]\s*=\s*" + _NUM)


def sample_size(rec: dict) -> Optional[str]:
    text = _methods_text(rec)
    is_review = bool({"Meta-Analysis", "Systematic Review"} & set(rec.get("pub_types", []))) or \
        re.search(r"meta-analy|systematic review", rec.get("title", ""), re.I)
    best = None
    for m in _SAMPLE.finditer(text):
        n = int(re.sub(r"\D", "", m.group(1)))
        noun = m.group(2).lower()
        if n < 3 or n > 5_000_000:
            continue
        if noun == "studies" and not is_review:
            continue
        priority = 0 if noun in ("studies",) and is_review else (1 if noun in (
            "patients", "participants", "women", "men", "individuals", "subjects", "adults", "children",
            "volunteers") else 2)
        if best is None or priority < best[0]:
            best = (priority, f"{n:,} {noun}")
    if best:
        return best[1]
    m = _N_EQ.search(text)
    if m:
        n = int(re.sub(r"\D", "", m.group(1)))
        if n >= 3:
            return f"n = {n:,}"
    return None


# ── organ-system tags ───────────────────────────────────────────────────────
def compile_systems(systems_cfg: dict) -> dict:
    out = {}
    for key, cfg in systems_cfg.items():
        pats = []
        for w in cfg["words"]:
            esc = re.escape(w).replace(r"\ ", r"[\s-]")
            if w.isupper() and len(w) <= 5:
                pats.append(re.compile(r"(?<![A-Za-z0-9])" + esc + r"(?![A-Za-z])"))
            else:
                pats.append(re.compile(r"(?<![A-Za-z])" + esc, re.I))
        out[key] = pats
    return out


def tag_systems(rec: dict, compiled: dict) -> list[str]:
    text = rec.get("title", "") + " " + " ".join(s["text"] for s in rec.get("sections", []))
    title = rec.get("title", "")
    hits = []
    for key, pats in compiled.items():
        n = sum(len(p.findall(text)) for p in pats)
        in_title = any(p.search(title) for p in pats)
        if in_title or n >= 2:   # one passing mention in the abstract isn't enough
            hits.append((0 if in_title else 1, -n, key))
    return [k for _, _, k in sorted(hits)]


def short_authors(authors: list[str]) -> str:
    if not authors:
        return ""
    if len(authors) <= 3:
        return ", ".join(authors)
    return ", ".join(authors[:3]) + ", et al."


def to_card(rec: dict, systems_compiled: dict) -> dict:
    primary, extras = conclusion(rec)
    return {
        "pmid": rec["pmid"],
        "title": rec["title"],
        "journal": rec["journal"] or rec["journal_full"],
        "journal_full": rec["journal_full"],
        "authors": short_authors(rec["authors"]),
        "added": rec.get("added"),
        "epub": rec.get("epub"),
        "ppub": rec.get("ppub"),
        "doi": rec.get("doi", ""),
        "pmcid": rec.get("pmcid", ""),
        "pub_types": [p for p in rec.get("pub_types", []) if p not in ("Journal Article", "English Abstract")],
        "design": design(rec),
        "sample": sample_size(rec),
        "conclusion": primary,
        "extras": extras,
        "sections": [{"label": _nice_label(s["label"]), "cat": s["cat"], "text": clean(s["text"])}
                     for s in rec.get("sections", []) if clean(s["text"])],
        "systems": tag_systems(rec, systems_compiled),
        "retracted": rec.get("retracted", False),
        "concern": rec.get("concern", False),
    }
