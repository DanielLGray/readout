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
    r"see related (?:editorial|commentary|article)|"
    r"^citation format|\bdoi:?\s*10\.\d{4,}/|"
    r"test your knowledge|quiz questions for this article|"
    r"^clinical trial registration|^trial registration|^registration:|^NCT\d{8}\.?$|"
    r"^keywords?:|^abbreviations?:|^funding:)",
    re.IGNORECASE)

_ABBREV = ["vs.", "e.g.", "i.e.", "et al.", "approx.", "Fig.", "Figs.", "No.", "no.", "Dr.", "cf.", "ca.", "Ref."]


# trial and review registrations: a registry number, or a sentence saying where it was registered
_REGISTRY_ID = (r"(?:NCT\d{8}|ChiCTR[-\w]*?\d{6,}|ISRCTN\s*N?\d{6,}|UMIN\d{6,}|CRD\d{8,}|DRKS\d{6,}|ACTRN\d{10,}|"
                r"jRCT[a-z]?\d{6,}|KCT\d{6,}|IRCT\d+\w*|CTRI/\d{4}/\d+/\d+|TCTR\d{8,}|PACTR\d{10,}|"
                r"EudraCT\s*(?:No\.?|number)?\s*:?\s*\d{4}-\d{6}-\d{2})")
_REG_ID = re.compile(_REGISTRY_ID, re.I)
_REG_SENT = re.compile(r"clinicaltrials\.gov|\bPROSPERO\b|trial regist|regist(?:ered|ration|ry)\b[^.]*" + _REGISTRY_ID +
                       r"|^(?:the |this )?(?:study|trial|protocol|review)\s+(?:was|is|has been)\s+(?:\w+ly\s+)?registered", re.I)
_REG_PAREN = re.compile(r"\s*\([^()]*" + _REGISTRY_ID + r"[^()]*\)", re.I)


def _registration(sent: str) -> bool:
    if _REG_SENT.search(sent):
        return True
    if _REG_ID.search(sent):            # "NCT00047385, NCT02777996, and ISRCTN N30604390": numbers and little else
        return len(re.findall(r"[A-Za-z]{3,}", _REG_ID.sub(" ", sent))) <= 3
    return False


def clean(text: str) -> str:
    text = _COPYRIGHT.sub("", text).strip()
    # bullet points ("…54 Gy.•MRI-based…"): make each one a sentence
    text = re.sub(r"(?<=[^.!?:;\s])\s*•\s*", ". ", text)
    text = re.sub(r"\s*•\s*", " ", text).strip()
    text = re.sub(r"(?<!\.)\.\.(?!\.)", ".", text)            # "alone.." (a typo in the record)
    kept = []
    dropped = False
    for s0 in sentences(text):
        s = _REG_PAREN.sub("", s0).strip()       # "(NCT04689828)" inside a real sentence: drop just that
        words = bool(re.search(r"[A-Za-z]{2}", s))
        if (s != s0 or dropped) and not words:
            continue                              # only the registration, or the "3417." left from "p. 3417"
        dropped = False
        if _BOILER.search(s):
            dropped = True
            continue
        if _registration(s):
            if len(s) <= 250:
                dropped = True
                continue
            # a run-on (missing spaces after full stops) holding real text too: cut just the number and link
            s = re.sub(r"\s*https?://\S+", "", _REG_ID.sub("", s)).strip()
        kept.append(s)
    return " ".join(kept).strip()


# sections some journals run into the conclusion without a label of their own (European Radiology,
# Insights into Imaging): the card shows the conclusion up to them
_RUN_ON = re.compile(r"(?<=[.!?])\s+(?:Critical relevance statement|CRITICAL RELEVANCE STATEMENT|Clinical relevance statement|"
                     r"CLINICAL RELEVANCE STATEMENT|Key [Pp]oints?|KEY POINTS?|Key [Ff]indings|KEY FINDINGS)\s*:?\s+(?=[A-Z•·–-])")


def _cut_run_on(text: str) -> str:
    m = _RUN_ON.search(text)
    return text[:m.start()].strip() if m and m.start() >= 30 else text


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


_INLINE_CONCL = re.compile(r"(?:^|[.!?)\]]\s+)(Conclusions?|Interpretation)\s*:?\s+(?=[A-Z0-9(\[“\"'])((?:(?!\b(?:Conclusions?|Interpretation)\s*:?\s+[A-Z]).)+)$")


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
        extras = [{"label": _nice_label(s["label"]) or "Conclusions", "text": _cut_run_on(s["text"])}
                  for s in concl if s is not primary]
        return {"kind": "structured", "label": _nice_label(primary["label"]) or "Conclusion",
                "text": _cut_run_on(primary["text"])}, extras

    full = " ".join(s["text"] for s in secs)
    # an unlabeled abstract that ends in "Critical relevance statement …" / "KEY POINTS: • …": the
    # statement is the authors' own summary; the bullets are not a conclusion
    relevance = None
    run_on = _RUN_ON.search(full)
    if run_on and run_on.start() >= 30:
        heading = full[run_on.start():run_on.end()].strip().rstrip(":")
        rest = full[run_on.end():]
        nxt = _RUN_ON.search(rest)
        if re.match(r"(?:critical|clinical) relevance statement", heading, re.I):
            relevance = {"kind": "structured", "label": _nice_label(heading).capitalize(),
                         "text": (rest[:nxt.start()] if nxt else rest).strip()}
        full = full[:run_on.start()].strip()
    # Some records keep the headings inline: "... Results ... Conclusion AI demonstrated ..."
    inline = _INLINE_CONCL.search(full)
    if inline and len(inline.group(2)) >= 30:
        return {"kind": "structured", "label": "Conclusion", "text": _cut_run_on(inline.group(2).strip())}, []
    if relevance and len(relevance["text"]) >= 30:
        return relevance, []
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


# replies in a letters exchange and invited commentaries, often typed as ordinary articles
_REPLY = re.compile(r"^\s*(?:reply|in reply|authors?['’]? reply|invited commentary|commentary on)\b"
                    r"|^\s*response to\s*[\"“‘']"           # Response to "Title of the letter"
                    r"|^\s*response to (?:the )?(?:letter|comments?|clarification|correspondence|criticism|query|concerns?)\b"
                    r"|\breply to (?:the )?(?:letter|comment)", re.I)


def is_notice(rec: dict) -> bool:
    """Erratum, correction and retraction notices, replies and invited commentaries: not papers to read."""
    pts = set(rec.get("pub_types", []))
    title = rec.get("title", "")
    return bool(pts & {"Published Erratum", "Retraction of Publication", "Retraction Notice", "Expression of Concern"}) \
        or bool(_NOTICE.search(title)) or bool(_REPLY.search(title))


def area_require(areas_cfg: dict) -> dict:
    """{area: compiled pattern} for areas whose papers must mention something (cardiac CT: CT)."""
    return {a: re.compile(v["require"]) for a, v in (areas_cfg or {}).items() if v.get("require")}


def passes(rec: dict, pattern) -> bool:
    text = " ".join([rec.get("title", "")] + [s.get("text", "") for s in rec.get("sections", [])])
    return bool(pattern.search(text))


# ── sample size ─────────────────────────────────────────────────────────────
# a whole number ("1,284", "1 284" with a thin space), never part of "3.5" or "12,5"
_NUM = r"(?<![\d.,])(\d{1,3}(?:[,  ]\d{3})+(?!\d)|\d+)(?![.,]\d)"
_PEOPLE = ("patients", "participants", "women", "men", "males", "females", "individuals", "subjects", "adults",
           "children", "volunteers")
_ANIMALS = ("mice", "rats", "rabbits", "pigs", "animals")
_NOUNS = "|".join(_PEOPLE + _ANIMALS + ("examinations", "exams", "scans", "lesions", "nodules", "tumors", "tumours",
                                          "studies", "cases"))
_SAMPLE = re.compile(_NUM + r"\s+(?:(?:consecutive|eligible|adult|pediatric|paediatric|unique|"
                     r"included|enrolled|asymptomatic|symptomatic|treatment-na[iï]ve|"
                     r"[A-Z]{1,3}-?RADS(?:\s*v?\d+(?:\.\d+)?)?\s*(?:category\s*)?[≥>]?\s*\d[a-c]?)\s+)*"
                     r"(" + _NOUNS + r")\b", re.I)
# "PI-RADS 3 lesions", "grade 2 tumors", "≥ 5 nodules": a score or threshold, not a count
_SCORE_BEFORE = re.compile(r"(?:RADS\)?|grade|stage|type|category|class|score|level|phase|tier|Bosniak|Gleason|"
                           r"ISUP|BCLC|Deauville|[≥≤<>])\s*$", re.I)
# inside parentheses, "(median age 65 years; 27 females)" or "(63 males, mean age 59)" breaks the
# sample down; "237 patients (mean age 29; 98 men)" is the sample itself
_SEXES = ("women", "men", "males", "females")
_OPEN_PAREN = re.compile(r"\(([^()]{0,80})$")
_N_EQ = re.compile(r"\b[nN]\s*=\s*" + _NUM)
_PER_GROUP = re.compile(r"\s*(?:\w+\s+)?(?:per|each|in each)\b", re.I)


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
        if _SCORE_BEFORE.search(text[max(0, m.start() - 16):m.start()]):
            continue
        inside = _OPEN_PAREN.search(text[max(0, m.start() - 81):m.start()])
        if inside and noun in _PEOPLE and (noun in _SEXES or re.search(r"\bages?\b", inside.group(1), re.I)):
            continue
        priority = 0 if noun == "studies" and is_review else 1 if noun in _PEOPLE else 3 if noun in _ANIMALS else 2
        if best is None or priority < best[0]:
            best = (priority, f"{n:,} {noun}")
    if best:
        return best[1]
    for m in _N_EQ.finditer(text):
        if _PER_GROUP.match(text, m.end()):            # "n = 6 per group" is not the study's size
            continue
        n = int(re.sub(r"\D", "", m.group(1)))
        if n >= 3:
            return f"n = {n:,}"
    return None


# ── organ-system tags ───────────────────────────────────────────────────────
def compile_systems(systems_cfg: dict) -> dict:
    out = {}
    for key, cfg in systems_cfg.items():
        pats = []
        for entry in cfg["words"]:
            # a word, or {word: colon, not: "y|ies|ial"} to skip endings ("colon" but not "colony")
            w, unless = (entry["word"], entry.get("not")) if isinstance(entry, dict) else (entry, None)
            esc = re.escape(w).replace(r"\ ", r"[\s-]")
            tail = rf"(?!(?:{unless})(?![A-Za-z]))" if unless else ""
            if w.isupper() and len(w) <= 5:
                pats.append(re.compile(r"(?<![A-Za-z0-9])" + esc + r"(?![A-Za-z])"))
            else:
                pats.append(re.compile(r"(?<![A-Za-z])" + esc + tail, re.I))
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


# ── titles ──────────────────────────────────────────────────────────────────
LANGUAGES = {"chi": "Chinese", "ger": "German", "fre": "French", "spa": "Spanish", "jpn": "Japanese", "kor": "Korean",
             "ita": "Italian", "por": "Portuguese", "rus": "Russian", "dut": "Dutch", "pol": "Polish", "tur": "Turkish",
             "cze": "Czech", "hun": "Hungarian", "swe": "Swedish", "dan": "Danish", "nor": "Norwegian", "fin": "Finnish",
             "gre": "Greek", "heb": "Hebrew", "per": "Persian", "ara": "Arabic", "ukr": "Ukrainian", "rum": "Romanian",
             "srp": "Serbian", "hrv": "Croatian", "slv": "Slovenian", "slo": "Slovak", "bul": "Bulgarian", "lit": "Lithuanian"}
# PubMed sometimes loses the superscript and leaves "[ 18 F]" or "177 Lu-PSMA"
_ISOTOPES = ("177 Lu|68 Ga|67 Ga|18 F|99m Tc|64 Cu|61 Cu|67 Cu|89 Zr|225 Ac|90 Y|86 Y|111 In|131 I|123 I|124 I|125 I|"
             "223 Ra|212 Pb|203 Pb|161 Tb|149 Tb|152 Tb|155 Tb|44 Sc|43 Sc|47 Sc|153 Sm|186 Re|188 Re|166 Ho|213 Bi|"
             "211 At|227 Th|11 C|13 N|15 O|82 Rb|201 Tl|133 Xe|89 Sr|52 Mn")
_ISO_SPACED = re.compile(r"\[\s*(\d{1,3}m?)\s+([A-Z][a-z]?)\s*\]")


def tidy_title(title: str) -> str:
    t = _ISO_SPACED.sub(lambda m: f"[{m.group(1)}{m.group(2)}]", title or "")
    t = re.sub(r"(?<![\d.])(\d{1,3}m?)\s+([A-Z][a-z]?)(?=[-\]/])",
               lambda m: m.group(1) + m.group(2) if f"{m.group(1)} {m.group(2)}" in _ISOTOPES.split("|") else m.group(0), t)
    t = re.sub(r"\s+([:;])(?=\s)", r"\1", t)          # "Glioma : A pilot study" (French spacing)
    return re.sub(r"\s{2,}", " ", t).strip()


def translated_title(title: str) -> Optional[str]:
    """PubMed puts the English translation of a non-English title in brackets:
    "[Expert consensus on …]." -> "Expert consensus on …". "[18F]FDG PET …" is not one."""
    s = (title or "").strip()
    body = s[:-1].rstrip() if s.endswith(".") else s
    if not (body.startswith("[") and body.endswith("]")):
        return None
    depth = 0
    for i, ch in enumerate(body):
        depth += (ch == "[") - (ch == "]")
        if depth == 0 and i < len(body) - 1:
            return None                                 # the first bracket closes early
    return body[1:-1].strip() + ("." if s.endswith(".") else "")


def title_fields(rec_or_card: dict) -> dict:
    t = tidy_title(rec_or_card.get("title", ""))
    out = {"title": t}
    tr = translated_title(t)
    lang = LANGUAGES.get((rec_or_card.get("language") or "").lower())
    if tr:
        out.update(title=tr, translated=True)
    if lang:
        out["language"] = lang
    return out


def to_card(rec: dict, systems_compiled: dict) -> dict:
    primary, extras = conclusion(rec)
    return {
        "pmid": rec["pmid"],
        **title_fields(rec),
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
                systems=tag_systems(rec, systems_compiled), **title_fields(card))
    return card
