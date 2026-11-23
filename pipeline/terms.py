"""Emerging and fading phrases in body-imaging paper titles.

No AI: count how many titles use each 1–3 word phrase in the recent window
vs the window before, scaled by how many titles each window has. Phrases
that show up far more often now than before are new ideas, techniques or
products; phrases used far less are fading."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, timedelta

STOP = set("""
a an and are as at be been being between by can could do does for from had has have how in into is it its
may might more most of on or our over should than that the their them then there these they this those
through to toward towards under up upon via was we were what when where whether which while who why will
with within without would not no versus vs among after before during both each other per using use used
based new novel role value its one two three four five six first second third single all any also only
""".split())

# Words too generic to stand alone at either end of a phrase.
EDGE_GENERIC = set("""
study studies patient patients analysis imaging image images evaluation assessment diagnostic diagnosis
performance comparison clinical outcome outcomes results cohort findings feature features accuracy review
systematic meta trial case report cases series utility impact effect effects factor factors risk prediction
predicting predictive detection management treatment therapy disease adults children women men
year years experience approach quantitative qualitative initial early application applications current
update practice radiology radiologic radiological radiologist radiologists association associated
prospective retrospective multicenter multicentre center centre institution correlation characteristics
evaluating assessing comparing compared improved improving improve versus validation development external
internal cross sectional population based level levels type types group groups rate rates
commentary invited essentials narrative panel society european directions future room reading reply
erratum correction perspective pictorial primer editorial making decision lessons learned
""".split())

# second halves of hyphen compounds that can be cut off ("MASLD-related" → "MASLD")
SEPARABLE = set("related based associated derived guided assisted driven specific naive free like induced dependent matched adjusted".split())

TOKEN = re.compile(r"[A-Za-z0-9]+")
ACRONYMS = {"ct", "mri", "mr", "pet", "us", "ai", "psma", "fapi", "hcc", "llm", "llms", "dect", "pcct",
            "ceus", "mrcp", "ipmn", "pdac", "rcc", "net", "sstr", "fdg", "spect", "dwi", "adc", "cad"}

MIN_RECENT = {1: 8, 2: 12, 5: 20}


def _fold(word: str) -> str:
    """Key for counting: lowercase, simple plurals merged ("models" → "model").
    Acronyms are left alone ("RADS" stays "rads")."""
    lw = word.lower()
    plain = word.isalpha() and word[1:].islower()          # "models" or "Models", not "RADS"
    if plain and len(word) > 4 and lw.endswith("s") and not lw.endswith(("ss", "us", "is")):
        return lw[:-1]
    return lw


def phrases(title: str) -> dict[str, str]:
    """canonical phrase -> surface form, for one title."""
    toks = list(TOKEN.finditer(title))
    out: dict[str, str] = {}
    for i in range(len(toks)):
        for n in (1, 2, 3):
            j = i + n - 1
            if j >= len(toks):
                break
            # only join across spaces or hyphens
            seps = [title[toks[k].end():toks[k + 1].start()] for k in range(i, j)]
            if not all(re.fullmatch(r"[\s\-]+", x) for x in seps):
                break
            # never cut a hyphenated compound (keeps "LI-RADS", "watch-and-wait" whole)
            before = title[toks[i - 1].end():toks[i].start()] if i > 0 else " "
            after = title[toks[j].end():toks[j + 1].start()] if j + 1 < len(toks) else " "
            nxt = toks[j + 1].group(0).lower() if j + 1 < len(toks) else ""
            if before == "-" or (after == "-" and nxt not in SEPARABLE):
                continue
            raw = [t.group(0) for t in toks[i:j + 1]]
            words = [w.lower() for w in raw]
            if words[0] in STOP or words[-1] in STOP:
                continue
            # "CT for pancreatic": a stopword inside a phrase only counts when hyphenated
            if any(w in STOP for w in words[1:-1]) and not all("-" in x for x in seps):
                continue
            if words[0].isdigit() or words[-1].isdigit():
                continue
            surface = title[toks[i].start():toks[j].end()]
            if n == 1:
                w = toks[i].group(0)
                if not (sum(c.isupper() for c in w) >= 2 or any(c.isdigit() for c in w)):
                    continue
                if w.lower() in ACRONYMS:   # bare "CT", "MRI" say nothing new
                    continue
            else:
                if words[0] in EDGE_GENERIC or words[-1] in EDGE_GENERIC:
                    continue
                if all(w in ACRONYMS for w in words):
                    continue
            out[" ".join(_fold(w) for w in raw)] = surface
    return out


def _contains(a: str, b: str) -> bool:
    """True if phrase a contains phrase b as whole words (or vice versa)."""
    a2, b2 = f" {a} ", f" {b} "
    return b2 in a2 or a2 in b2


def display(canon: str, surfaces: Counter) -> str:
    """Most common spelling, minus Title Case: acronyms and words with digits keep
    their case ("photon-Counting CT" → "photon-counting CT")."""
    if not surfaces:
        return canon
    s = surfaces.most_common(1)[0][0]
    def fix(word: str) -> str:
        if word.isupper() or sum(c.isupper() for c in word) >= 2 or any(c.isdigit() for c in word):
            return word
        return word.lower()
    return re.sub(r"[A-Za-z0-9]+", lambda m: fix(m.group(0)), s)


def analyze(corpus: list[dict], today: date, windows=(1, 2, 5), top_n: int = 15) -> dict:
    """corpus: [{pmid, title, journal, date: 'YYYY-MM-DD'}]"""
    docs = []
    surfaces: dict[str, Counter] = defaultdict(Counter)
    for d in corpus:
        try:
            dd = date.fromisoformat(d["date"][:10])
        except (ValueError, KeyError, TypeError):
            continue
        ph = phrases(d.get("title", ""))
        for c, s in ph.items():
            surfaces[c][s] += 1
        docs.append((dd, set(ph), d))

    years = list(range(today.year - 9, today.year + 1))
    out = {}
    for w in windows:
        span = timedelta(days=round(365.25 * w))
        r_start, p_start = today - span, today - 2 * span
        recent = [x for x in docs if r_start < x[0] <= today]
        prior = [x for x in docs if p_start < x[0] <= r_start]
        R, P = len(recent), len(prior)
        if R < 50 or P < 50:
            out[str(w)] = {"emerging": [], "fading": [], "docs_recent": R, "docs_prior": P}
            continue
        rc = Counter(c for _, cs, _ in recent for c in cs)
        pc = Counter(c for _, cs, _ in prior for c in cs)
        min_r = MIN_RECENT[w]

        def ratio(c):
            return ((rc[c] + 1) / R) / ((pc[c] + 1) / P)

        emerging = sorted((c for c in rc if rc[c] >= min_r and ratio(c) >= 1.8),
                          key=lambda c: (ratio(c), rc[c]), reverse=True)
        fading = sorted((c for c in pc if pc[c] >= min_r and ratio(c) <= 0.55),
                        key=lambda c: (ratio(c), -pc[c]))

        def pick(cands, n, counts, pool):
            cands = cands[:300]
            want = set(cands)
            docs_of: dict[str, set] = defaultdict(set)
            for idx, (_, cs, _) in enumerate(pool):
                for c in cs & want:
                    docs_of[c].add(idx)
            chosen: list[str] = []
            for c in cands:
                # same papers under a different phrase (e.g. two halves of one title)
                if any(len(docs_of[c] & docs_of[k]) >= 0.6 * len(docs_of[c] | docs_of[k]) and not _contains(c, k)
                       for k in chosen):
                    continue
                clash = [k for k in chosen if _contains(c, k)]
                if clash:
                    # prefer the longer phrase when it carries most of the same papers
                    k = clash[0]
                    if len(c) > len(k) and counts[c] >= 0.8 * counts[k]:
                        chosen[chosen.index(k)] = c
                    continue
                if len(chosen) >= n:
                    break
                chosen.append(c)
            return chosen

        def describe(c, pool):
            ex = sorted((x for x in pool if c in x[1]), key=lambda x: x[0], reverse=True)[:3]
            by_year = Counter(x[0].year for x in docs if c in x[1])
            return {
                "term": display(c, surfaces[c]),
                "recent": rc[c], "prior": pc[c],
                "ratio": round(ratio(c), 2),
                "years": [by_year.get(y, 0) for y in years],
                "examples": [{"pmid": x[2]["pmid"], "title": x[2]["title"], "journal": x[2].get("journal", ""),
                              "date": x[2]["date"]} for x in ex],
            }

        out[str(w)] = {
            "emerging": [describe(c, recent) for c in pick(emerging, top_n, rc, recent)],
            "fading": [describe(c, prior) for c in pick(fading, 10, pc, prior)],
            "docs_recent": R, "docs_prior": P,
        }
    out["years"] = years
    return out

