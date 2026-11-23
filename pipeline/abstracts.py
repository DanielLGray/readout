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


_INLINE_CONCL = re.compile(r"(?:^|[.!?)\]]\s+)(Conclusions?|Interpretation)\s*:?\s+(?=[A-Z0-9(])((?:(?!\b(?:Conclusions?|Interpretation)\s*:?\s+[A-Z]).)+)$")


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
    # Some records keep the headings inline: "... Results ... Conclusion AI demonstrated ..."
    inline = _INLINE_CONCL.search(full)
    if inline and len(inline.group(2)) >= 30:
        return {"kind": "structured", "label": "Conclusion", "text": inline.group(2).strip()}, []
    sents = sentences(full)
    pts = set(rec.get("pub_types", []))
    is_review = bool(pts & {"Review", "Systematic Review"}) or rec.get("journal", "").lower() == "radiographics"
    if is_review:
        return {"kind": "opening", "label": "Abstract opening — no stated conclusion",
                "text": " ".join(sents[:2])}, []
    return {"kind": "closing", "label": "Closing lines — abstract has no labeled conclusion",
            "text": " ".join(sents[-2:])}, []


# ── study design ────────────────────────────────────────────────────────────
# Inline headings in unlabeled abstracts ("Methods: ... Results: ... Conclusion: ...")
_INLINE_METHODS = re.compile(
    r"(?:^|[.!?)\]]\s+)(?:Materials and Methods|Patients and Methods|Methods?|Design)\s*:?\s+(?=[A-Z0-9(])"
    r"(.+?)(?=(?:[.!?)\]]\s+)(?:Conclusions?|Interpretation)\s*:?\s+[A-Z0-9(]|$)", re.S)

# A mention that is about other or future work, not this study ("prospective studies are needed")
_NOT_THIS_STUDY_AFTER = re.compile(r"\b(needed|warranted|required|should|future|further|pending|planned|ongoing|"
                                   r"would|could|lacking|limited|scarce|remain|are few)\b", re.I)
_NOT_THIS_STUDY_BEFORE = re.compile(r"\b(future|further|pending|need for|require[sd]?|no|previous|prior|one small|"
                                    r"existing|larger|additional|independent|confirmatory)\W+(\w+\W+)?$", re.I)


def _methods_text(rec: dict) -> str:
    secs = rec.get("sections", [])
    m = [s["text"] for s in secs if s["cat"] in ("METHODS", "RESULTS")
         or re.search(r"method|design|setting|participant|patient|result|study type|population", s["label"], re.I)]
    if m:
        return " ".join(m)
    full = " ".join(s["text"] for s in secs)
    inline = _INLINE_METHODS.search(full)
    return inline.group(1) if inline else full


def _about_this_study(text: str, pattern: str, flags=re.I) -> bool:
    """True if `pattern` appears in a sentence that describes this study."""
    for m in re.finditer(pattern, text, flags):
        sentence_rest = re.split(r"(?<=[.;])\s", text[m.end():m.end() + 80], maxsplit=1)[0]
        if _NOT_THIS_STUDY_AFTER.search(sentence_rest):
            continue
        if _NOT_THIS_STUDY_BEFORE.search(text[max(0, m.start() - 40):m.start()]):
            continue
        return True
    return False


# Title wording that means the paper IS guidance (not a study or review about guidance)
_GUIDE_TITLE = re.compile(
    r"\b(consensus|expert) (statement|recommendations?|guidelines?|guidance|report|document|algorithm)s?\b"
    r"|\b(delphi|international|expert|multidisciplinary|national|global|joint|society|panel|interdisciplinary) consensus\b"
    r"|\bconsensus (on|for)\b"
    r"|\bguidelines? (for|on)\b|\bguidelines?\W+(update|summary|part)\b|\bguidelines and recommendations\b"
    r"|\b(clinical )?practice (guidelines?|update|parameter|recommendations)\b"
    r"|\bguidance (on|for)\b|\bwhite paper\b|\bposition (statement|paper)\b"
    r"|\bappropriateness criteria\b|\bESR Essentials\b", re.I)
_GUIDE_ORG = re.compile(r"\b([Rr]ecommendations|[Gg]uidelines?) (from|of|by) (the )?[A-Z]")
_GUIDE_NOT = re.compile(
    r"\b(comparison|comparing|compared|analysis|review|evaluat\w*|performance|accuracy|adherence|concordance|"
    r"concordant|implementation|implications|based on|according to|following|bridging|illustrations|comments|"
    r"navigating|large language|GPT|chatbot|case of|rare case|molecular subtype|controvers\w+|contemporary|"
    r"updated guidelines|putting|prediction|validation|real-world|guideline-defined|guideline-based)\b", re.I)


def is_guideline(rec: dict) -> Optional[str]:
    """'pubmed' when NLM indexed it as guidance, 'text' when the title says it is, else None."""
    pts = set(rec.get("pub_types", []))
    if pts & {"Guideline", "Practice Guideline", "Consensus Development Conference",
              "Consensus Development Conference, NIH", "Consensus Statement"}:
        return "pubmed"
    title = rec.get("title", "")
    if (_GUIDE_TITLE.search(title) or _GUIDE_ORG.search(title)) and not _GUIDE_NOT.search(title):
        return "text"
    return None


def design(rec: dict) -> dict:
    """Badges for how strong the evidence is. Each badge says where it came
    from: 'pubmed' = NLM indexing, 'text' = wording in the abstract."""
    pts = set(rec.get("pub_types", []))
    title = rec.get("title", "")
    methods = _methods_text(rec)
    systematic = bool(pts & {"Systematic Review", "Meta-Analysis"}) or re.search(r"systematic(ally)? review|meta-analy", title, re.I)
    review_title = re.search(r"\breview\b|\bprimer\b|\bpictorial\b|what the radiologist needs to know", title, re.I)
    narrative = (bool(pts & {"Review", "Case Reports"}) or bool(review_title)) and not systematic
    badges: list[dict] = []

    def add(label, source, strength):
        badges.append({"label": label, "source": source, "strength": strength})

    g = is_guideline(rec)
    if g:
        add("Guideline / consensus", g, 4)

    # meta-analyses and systematic reviews say so in their titles
    if "Meta-Analysis" in pts:
        add("Meta-analysis", "pubmed", 4)
    elif re.search(r"meta-analy", title, re.I):
        add("Meta-analysis", "text", 4)
    elif "Systematic Review" in pts:
        add("Systematic review", "pubmed", 4)
    elif re.search(r"systematic(ally)? review", title, re.I):
        add("Systematic review", "text", 4)

    if "Randomized Controlled Trial" in pts:
        add("Randomized trial", "pubmed", 4)
    elif not narrative and (
            re.search(r"\brandomi[sz]ed\b", title, re.I) and not re.search(r"non-?randomi[sz]ed", title, re.I)
            or _about_this_study(methods, r"(?<!non-)(?<!non)\brandomi[sz]ed (controlled |clinical |phase \w+ )?trial")
            or any(not re.search(r"(dataset|image|case|exam|scan|reader|order|sequence|lesion|slice|video)s?\W+(\w+\W+){0,3}$",
                                 methods[max(0, m.start() - 50):m.start()], re.I)
                   # "randomly allocated to a training set" is a data split, not a trial
                   and not re.search(r"training|validation|test(ing)? (set|cohort)|derivation|development|internal|cohorts in",
                                     methods[m.end():m.end() + 60], re.I)
                   for m in re.finditer(r"\b(were|was) randomi[sz]ed|randomly (assigned|allocated)", methods, re.I))):
        add("Randomized trial", "text", 4)

    has_meta = any(b["strength"] == 4 and "Guideline" not in b["label"] for b in badges)
    if not has_meta and not narrative:
        pro = _about_this_study(methods, r"\bprospective(ly)?\b") or re.search(r"\bprospective\b", title, re.I)
        retro = _about_this_study(methods, r"\bretrospective(ly)?\b") or re.search(r"\bretrospective\b", title, re.I)
        if pro and retro:
            add("Prospective + retrospective data", "text", 2)
        elif pro:
            add("Prospective", "text", 3)
        elif retro:
            add("Retrospective", "text", 2)
        if re.search(r"secondary analysis|post[- ]hoc analysis", title + " " + methods, re.I):
            add("Secondary analysis", "text", 2)

    if "Multicenter Study" in pts:
        add("Multicenter", "pubmed", 0)
    elif not narrative and re.search(
            r"multi-?cent(er|re)|multi-?institution|multi-?site|\b([2-9]|\d{2,}) (centers|centres|institutions|hospitals|sites)",
            title + " " + methods, re.I):
        add("Multicenter", "text", 0)

    if "Case Reports" in pts:
        add("Case report", "pubmed", 1)
    elif "Review" in pts and not has_meta:
        add("Review", "pubmed", 1)
    elif review_title and not has_meta and not systematic:
        add("Review", "text", 1)

    strength = max([b["strength"] for b in badges], default=0)
    return {"badges": badges, "strength": strength}


_NOTICE = re.compile(r"(^\s*(erratum|corrigendum|correction|retraction|retracted|expression of concern|withdrawn)\b|"
                     r"[:\-–]\s*(erratum|corrigendum|correction|retraction|expression of concern)\.?\s*$)", re.I)


def is_notice(rec: dict) -> bool:
    """Erratum, correction and retraction notices: not papers to read."""
    pts = set(rec.get("pub_types", []))
    return bool(pts & {"Published Erratum", "Retraction of Publication", "Retraction Notice", "Expression of Concern"}) \
        or bool(_NOTICE.search(rec.get("title", "")))


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


def refresh(card: dict, systems_compiled: dict) -> dict:
    """Re-derive the computed fields of a stored card from its stored abstract,
    so parser improvements reach cards fetched on earlier days."""
    rec = {"title": card.get("title", ""), "journal": card.get("journal", ""),
           "pub_types": card.get("pub_types", []),
           "sections": [{"label": s.get("label", ""), "cat": s.get("cat", ""), "text": s.get("text", "")}
                        for s in card.get("sections", [])]}
    if not rec["sections"]:
        return card
    primary, extras = conclusion(rec)
    card.update(conclusion=primary, extras=extras, design=design(rec), sample=sample_size(rec),
                systems=tag_systems(rec, systems_compiled))
    return card
