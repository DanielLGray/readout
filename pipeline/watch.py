"""Watch: what changed in trial registrations (ClinicalTrials.gov), FDA approvals and clearances
(openFDA) and federal rules (Federal Register). Pure functions; build_watch.py does the reading."""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

from . import horizon as H
from .news import clean_text

CT_STUDY = "https://clinicaltrials.gov/study/{}"
PMN = "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID={}"
DENOVO = "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id={}"
PMA = "https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm?id={}"
DAF = "https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={}"

STATUS = {"NOT_YET_RECRUITING": "Not yet recruiting", "RECRUITING": "Recruiting", "ENROLLING_BY_INVITATION": "Enrolling by invitation",
          "ACTIVE_NOT_RECRUITING": "Active, not recruiting", "SUSPENDED": "Suspended", "TERMINATED": "Terminated",
          "COMPLETED": "Completed", "WITHDRAWN": "Withdrawn", "UNKNOWN": "Status unknown"}
ACTIVE = {"NOT_YET_RECRUITING", "RECRUITING", "ENROLLING_BY_INVITATION", "ACTIVE_NOT_RECRUITING"}
STOPPED = {"SUSPENDED", "TERMINATED", "WITHDRAWN"}
_NCT = re.compile(r"^NCT\d{8}$")
_PC = re.compile(r"^[A-Z0-9]{3}$")


def ymd(s) -> Optional[date]:
    """'2027-06-30', '2027-06' (taken as the 1st) or openFDA's '20270630' → a date."""
    s = str(s or "").strip()
    m = re.fullmatch(r"(\d{4})-?(\d{2})(?:-?(\d{2}))?", s)
    if not m:
        return None
    try:
        return date(int(m[1]), int(m[2]), int(m[3] or 1))
    except ValueError:
        return None


def when_text(s: str) -> str:
    d = ymd(s)
    if not d:
        return ""
    return f"{d:%b} {d.year}" if len(str(s)) <= 7 else f"{d:%b} {d.day}, {d.year}"


def phase_text(phases: list) -> str:
    nums = sorted({p.replace("EARLY_PHASE1", "PHASE1").replace("PHASE", "") for p in phases or [] if p.startswith(("PHASE", "EARLY"))})
    return f"Phase {'/'.join(nums)}" if nums else ""


# ── trials ─────────────────────────────────────────────────────────────────
def trial_of(study: dict) -> dict:
    """A ClinicalTrials.gov v2 study → the few fields Watch compares from day to day."""
    ps = study.get("protocolSection") or {}
    idm, sm, dm = ps.get("identificationModule") or {}, ps.get("statusModule") or {}, ps.get("designModule") or {}
    lead = (ps.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}
    pcd = sm.get("primaryCompletionDateStruct") or {}
    res = (sm.get("resultsFirstPostDateStruct") or {}).get("date") or ""
    n = (dm.get("enrollmentInfo") or {}).get("count")
    return {"nct": str(idm.get("nctId") or ""), "title": clean_text(str(idm.get("briefTitle") or ""))[:300],
            "acr": clean_text(str(idm.get("acronym") or ""))[:40], "status": str(sm.get("overallStatus") or ""),
            "why": clean_text(str(sm.get("whyStopped") or ""))[:200],
            "pcd": str(pcd.get("date") or ""), "pcdType": str(pcd.get("type") or ""),
            "first": str((sm.get("studyFirstPostDateStruct") or {}).get("date") or ""),
            "updated": str((sm.get("lastUpdatePostDateStruct") or {}).get("date") or ""),
            "results": str(res or ("posted" if study.get("hasResults") else "")),
            "phases": [str(p) for p in dm.get("phases") or []], "type": str(dm.get("studyType") or ""),
            "n": int(n) if isinstance(n, (int, float)) else None, "sponsor": clean_text(str(lead.get("name") or ""))[:100]}


def compact(t: dict, topic: str) -> dict:
    return {"t": t["title"][:200], "a": t["acr"], "s": t["status"], "p": t["pcd"], "pt": t["pcdType"], "r": t["results"],
            "ph": t["phases"], "n": t["n"], "sp": t["sponsor"][:80], "tp": topic, "u": t["updated"], "f": t["first"]}


def expand(nct: str, c: dict) -> dict:
    return {"nct": nct, "title": c.get("t", ""), "acr": c.get("a", ""), "status": c.get("s", ""), "pcd": c.get("p", ""),
            "pcdType": c.get("pt", ""), "results": c.get("r", ""), "phases": c.get("ph") or [], "n": c.get("n"),
            "sponsor": c.get("sp", ""), "updated": c.get("u", ""), "first": c.get("f", ""), "why": ""}


def qualifies(t: dict, topic: dict) -> bool:
    if t.get("type") and t["type"] != "INTERVENTIONAL":
        return False
    want = set(topic.get("phases") or ["PHASE2", "PHASE3"])
    have = {"PHASE1" if p == "EARLY_PHASE1" else p for p in t.get("phases") or []} or {"NA"}
    return bool(want & have) and (t.get("n") or 0) >= int(topic.get("min_n") or 0)


def trial_sub(t: dict) -> str:
    bits = [phase_text(t["phases"]), f"{t['n']:,} patients" if t.get("n") else "", t.get("sponsor") or ""]
    return " · ".join(b for b in bits if b)


def trial_event(t: dict, topic: dict, code: str, what: str, day: date, level: str = "update") -> dict:
    return {"id": f"trial:{t['nct']}:{code}", "kind": "trial", "topic": topic["id"], "date": day.isoformat(),
            "title": t["title"], "acr": t.get("acr", ""), "what": what, "sub": trial_sub(t), "nct": t["nct"],
            "link": CT_STUDY.format(t["nct"]), "level": level, "org": t.get("sponsor") or "", "ph": phase_text(t["phases"])}


def trial_events(old: Optional[dict], t: dict, topic: dict, today: date, since: date, shift_days: int,
                 results_alert: str = "phase3") -> list[dict]:
    """What changed since the last run. A trial seen for the first time counts only for what its own
    dates say is recent: registered, or results posted, since `since`. results_alert: which trials'
    results are alerts (phase3: Phase 3 and large trials with no phase; phase2: Phase 2 too; none)."""
    out = []
    want = {"phase3": {"PHASE3"}, "phase2": {"PHASE2", "PHASE3"}}.get(results_alert, set())
    p3 = bool(want) and (bool(want & set(t["phases"])) or (not t["phases"] or t["phases"] == ["NA"]) and (t.get("n") or 0) >= 500)
    res_day = ymd(t["results"])
    if old is None:
        first = ymd(t["first"])
        if first and first >= since:
            out.append(trial_event(t, topic, "new", "New trial registered", first))
        if res_day and res_day >= since:
            out.append(trial_event(t, topic, f"results-{t['results']}", "Results posted", res_day, "alert" if p3 else "update"))
        return out
    if old["status"] and t["status"] and old["status"] != t["status"]:
        what = f"{STATUS.get(old['status'], old['status'])} → {STATUS.get(t['status'], t['status'])}"
        if t["status"] in STOPPED and t.get("why"):
            what += f": {t['why']}"
        out.append(trial_event(t, topic, f"status-{t['status']}", what, today))
    if t["results"] and not old["results"]:
        out.append(trial_event(t, topic, f"results-{t['results']}", "Results posted", res_day if res_day and res_day >= since else today,
                               "alert" if p3 else "update"))
    if old["pcdType"] == "ESTIMATED" and t["pcdType"] == "ACTUAL":
        out.append(trial_event(t, topic, f"pcd-actual-{t['pcd']}", f"Primary completion reached ({when_text(t['pcd'])})", today))
    elif old["pcdType"] == "ESTIMATED" and t["pcdType"] == "ESTIMATED":
        a, b = ymd(old["pcd"]), ymd(t["pcd"])
        if a and b and abs((b - a).days) >= shift_days:
            out.append(trial_event(t, topic, f"pcd-{t['pcd']}", f"Primary completion moved {'later' if b > a else 'earlier'}: "
                                   f"{when_text(old['pcd'])} → {when_text(t['pcd'])}", today))
    return out


def is_readout(c: dict, topic: Optional[dict]) -> bool:
    """A trial whose estimated primary completion is worth a date in Coming up: Phase 3 with at
    least 100 patients, or a large device trial with no phase where the topic asks for those."""
    ph = c.get("ph") or []
    n = c.get("n") or 0
    big_device = (not ph or ph == ["NA"]) and n >= 300 and bool((topic or {}).get("device_readouts"))
    return c.get("s") in ACTIVE and c.get("pt") == "ESTIMATED" and (("PHASE3" in ph and n >= 100) or big_device)


def readout_date(nct: str, c: dict, topic_name: str) -> Optional[dict]:
    d = ymd(c.get("p"))
    if not d:
        return None
    name = c.get("a") or c.get("t", "")[:70]
    return H.event(f"readout-{nct.lower()}", "medicine", f"{name}: primary completion (estimated)", d,
                   sub=" · ".join(x for x in [phase_text(c.get("ph")), c.get("sp", "")] if x),
                   about=f"{c.get('t', '')}. {topic_name}. Primary completion is when the last participant's main outcome is measured; "
                         f"results usually follow months later. Estimated by the sponsor on ClinicalTrials.gov.",
                   url=CT_STUDY.format(nct), src="ClinicalTrials.gov", approx="about")


# ── FDA ────────────────────────────────────────────────────────────────────
def device_type(r: dict) -> dict:
    """The FDA's name for the product code, in plain order: "System, Imaging, Pulsed Doppler, Ultrasonic"
    → "Ultrasonic pulsed doppler imaging system". {} when the record has none."""
    names = (r.get("openfda") or {}).get("device_name")
    raw = clean_text(str(names[0] if isinstance(names, list) and names else names or ""))
    if not raw or len(raw) > 160:
        return {}
    words = " ".join(p.strip() for p in reversed(raw.split(",")) if p.strip()).split()
    keep = lambda w: w if (w.isupper() and 1 < len(w) <= 5) or re.search(r"[A-Z].*[A-Z]", w[1:]) else w.lower()
    out = " ".join([words[0] if words[0].isupper() and len(words[0]) > 1 else words[0].capitalize()] + [keep(w) for w in words[1:]])
    return {"pcn": out[:120]}


def clearance_event(r: dict, ai_codes: set, ai_re: "re.Pattern") -> Optional[dict]:
    """A 510(k) or De Novo record from openFDA → an event, if it was cleared or granted."""
    k = str(r.get("k_number") or "").strip().upper()
    name = clean_text(str(r.get("device_name") or ""))[:200]
    day = ymd(r.get("decision_date"))
    dec = str(r.get("decision_description") or "").lower()
    code = str(r.get("decision_code") or "").upper()
    if not re.fullmatch(r"(?:K|DEN)\d{6,7}", k) or not name or not day:
        return None
    if "not substantially" in dec or "declined" in dec or "denied" in dec or code.startswith(("SN", "NS", "DEND")):
        return None
    if not (code.startswith("SE") or dec.startswith("substantially equivalent") or "granted" in dec or code == "DENG"):
        return None
    pc = str(r.get("product_code") or "").upper()
    ai = pc in ai_codes or bool(ai_re.search(name))
    denovo = k.startswith("DEN")
    who = clean_text(str(r.get("applicant") or ""))[:100]
    return {"id": f"device:{k}", "kind": "device", "topic": "devices", "date": day.isoformat(), "title": name,
            "what": ("Granted De Novo" if denovo else "Cleared, 510(k)") + (" · AI" if ai else ""),
            "sub": " · ".join(x for x in [who, f"product code {pc}" if pc else ""] if x),
            "link": (DENOVO if denovo else PMN).format(k), "level": "update", "ai": ai,
            "org": who, **({"pc": pc} if _PC.match(pc) else {}), **device_type(r)}


def pma_event(r: dict) -> Optional[dict]:
    """A PMA approval from openFDA → an event, if it's a new device or a new indication."""
    num = str(r.get("pma_number") or "").strip().upper()
    sup = str(r.get("supplement_number") or "").strip().upper()
    day = ymd(r.get("decision_date"))
    code = str(r.get("decision_code") or "").upper()
    if not re.fullmatch(r"[PHN]\d{5,6}", num) or not day or not code.startswith("AP") or code == "APWD":
        return None
    original = not sup or sup in ("S000", "000")
    stype, reason = str(r.get("supplement_type") or ""), str(r.get("supplement_reason") or "")
    if not (original or "panel" in stype.lower() or re.search(r"indication", reason, re.I)):
        return None
    name = clean_text(str(r.get("trade_name") or r.get("generic_name") or ""))[:200]
    if not name:
        return None
    who = clean_text(str(r.get("applicant") or ""))[:100]
    pc = str(r.get("product_code") or "").upper()
    return {"id": f"pma:{num}{'' if original else sup}", "kind": "device", "topic": "pma", "date": day.isoformat(), "title": name,
            "what": "New device approved (PMA)" if original else "New indication approved (PMA supplement)",
            "sub": " · ".join(x for x in [who, stype if not original else ""] if x),
            "link": PMA.format(num + ("" if original else sup)), "level": "alert",
            "org": who, **({"pc": pc} if _PC.match(pc) else {}), **device_type(r)}


def isotope_re(isotopes: list) -> "re.Pattern":
    """F18 → 'F-18', 'F 18', 'F18'; TC99M → 'TC-99M'…"""
    parts = []
    for iso in isotopes or []:
        m = re.fullmatch(r"([A-Z]{1,2})(\d{1,3})(M?)", str(iso).upper())
        if m:
            parts.append(rf"{m[1]}\W?{m[2]}{m[3]}")
    return re.compile(rf"\b(?:{'|'.join(parts) or 'x^'})\b", re.I)


def drug_events(app: dict, iso_re: "re.Pattern", agents_re: "re.Pattern", skip_re: Optional["re.Pattern"],
                since: date, until: date) -> list[dict]:
    """Drugs@FDA application → events for new approvals and new indications of imaging agents."""
    num = str(app.get("application_number") or "").upper()
    if not re.fullmatch(r"(?:NDA|BLA)\d{6}", num):
        return []
    products = app.get("products") or []
    ingredients = [str(a.get("name") or "") for p in products for a in (p.get("active_ingredients") or [])]
    text = " ; ".join(ingredients)
    if not text or (skip_re and skip_re.search(text)) or not (iso_re.search(text) or agents_re.search(text)):
        return []
    brand = clean_text(str((products[0] if products else {}).get("brand_name") or "")).title()
    ingredient = clean_text(ingredients[0]).lower() if ingredients else ""
    title = f"{brand} ({ingredient})" if brand and ingredient and brand.lower() != ingredient else brand or ingredient
    out = []
    for s in app.get("submissions") or []:
        if str(s.get("submission_status") or "").upper() != "AP":
            continue
        day = ymd(s.get("submission_status_date"))
        if not day or not since <= day <= until:
            continue
        typ, cls = str(s.get("submission_type") or "").upper(), str(s.get("submission_class_code") or "").upper()
        major = cls.startswith(("TYPE 1", "TYPE 2")) or typ == "SUPPL"      # a new agent or a new use; a new form of an old one isn't
        if typ == "ORIG":
            what = "New drug approved" + (" (new molecular entity)" if cls.startswith("TYPE 1") else " (new active ingredient)" if cls.startswith("TYPE 2")
                                          else " (new form of an approved drug)" if cls.startswith(("TYPE 3", "TYPE 5")) else "")
        elif typ == "SUPPL" and cls == "EFFICACY":
            what = "New indication or use approved"
        else:
            continue
        out.append({"id": f"drug:{num}:{typ}{s.get('submission_number') or ''}", "kind": "drug", "topic": "drugs",
                    "date": day.isoformat(), "title": title[:200], "what": what,
                    "sub": clean_text(str(app.get("sponsor_name") or "")).title()[:100], "link": DAF.format(num[3:]),
                    "level": "alert" if major else "update", "org": clean_text(str(app.get("sponsor_name") or "")).title()[:100]})
    return out


# ── Federal Register ───────────────────────────────────────────────────────
_CORRECTION = re.compile(r";\s*Correct(?:ion|ing Amendment)s?\s*$|^Correction", re.I)
FR_KIND = {"Rule": "Final rule", "Proposed Rule": "Proposed rule", "Notice": "Notice"}


def rule_events(docs: list[dict], rule: dict, today: date) -> "tuple[list[dict], list[dict]]":
    """Federal Register documents → events, and Coming up dates (comment deadlines, effective dates)."""
    want = re.compile(rule["title"]) if rule.get("title") else None
    alert = re.compile(rule["alert"]) if rule.get("alert") else None
    events, dates = [], []
    for d in docs:
        title = clean_text(str(d.get("title") or ""))
        num = str(d.get("document_number") or "")
        day = ymd(d.get("publication_date"))
        link = str(d.get("html_url") or "")
        if not title or not num or not day or not link.startswith("https://www.federalregister.gov/"):
            continue
        if _CORRECTION.search(title) or (want and not want.search(title)):
            continue
        typ = str(d.get("type") or "")
        kind = "Guidance" if typ == "Notice" and re.search(r"guidance", title, re.I) else FR_KIND.get(typ, typ or "Document")
        close, eff = ymd(d.get("comments_close_on")), ymd(d.get("effective_on"))
        bits = [kind]
        if close and close >= today:
            bits.append(f"comments due {when_text(close.isoformat())}")
        if eff and eff > today:
            bits.append(f"takes effect {when_text(eff.isoformat())}")
        events.append({"id": f"rule:{num}", "kind": "rule", "topic": rule["id"], "date": day.isoformat(), "title": title[:300],
                       "what": "; ".join(bits), "sub": rule["name"], "link": link,
                       "level": "alert" if typ == "Rule" and alert and alert.search(title) else "update"})
        if close and today <= close <= today + timedelta(days=200):
            dates.append(H.event(f"comments-{H.slug(num)}", "medicine", f"Comments due: {rule['name']}", close,
                                 sub=f"{kind}, {when_text(day.isoformat())}", about=title, url=link, src="Federal Register"))
        if eff and today < eff <= today + timedelta(days=200):
            dates.append(H.event(f"effective-{H.slug(num)}", "medicine", f"Takes effect: {rule['name']}", eff,
                                 sub=f"{kind}, {when_text(day.isoformat())}", about=title, url=link, src="Federal Register"))
    return events, dates


def valid_nct(s: str) -> bool:
    return bool(_NCT.match(str(s or "")))
