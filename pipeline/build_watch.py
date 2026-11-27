"""Watch job: changes in trials, FDA approvals and federal rules → docs/data/watch.json
(and cache/watch_state.json, what was seen last time, to compare against)

    python -m pipeline.build_watch

Reads ClinicalTrials.gov (API v2), openFDA (510(k), PMA, Drugs@FDA) and the Federal Register,
all public U.S. government data with no key. Topics and rules are in config/watch.yaml.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

from . import watch as W
from .common import CACHE, DATA, load_yaml, now_iso, read_json, write_json
from .http import Http, HttpError, log

CTGOV = "https://clinicaltrials.gov/api/v2/studies"
FDA_510K = "https://api.fda.gov/device/510k.json"
FDA_PMA = "https://api.fda.gov/device/pma.json"
FDA_DRUGS = "https://api.fda.gov/drug/drugsfda.json"
FED_REG = "https://www.federalregister.gov/api/v1/documents.json"
CT_FIELDS = ("NCTId|BriefTitle|Acronym|OverallStatus|WhyStopped|PrimaryCompletionDate|PrimaryCompletionDateType|"
             "StudyFirstPostDate|LastUpdatePostDate|ResultsFirstPostDate|Phase|StudyType|EnrollmentCount|LeadSponsorName|HasResults")
ACTIVE_FILTER = "NOT_YET_RECRUITING,RECRUITING,ENROLLING_BY_INVITATION,ACTIVE_NOT_RECRUITING"
KINDS = {"trial": "Trials", "device": "FDA devices", "drug": "FDA drugs", "rule": "Rules and guidance"}


def ct_query(http: Http, params: dict, max_pages: int) -> list[dict]:
    """Studies for one search, page by page. Asks for only the fields Watch uses; if the API ever
    refuses that list, asks again for whole records."""
    def pages(p0: dict) -> list[dict]:
        out, token = [], None
        for _ in range(max_pages):
            p = dict(p0, **({"pageToken": token} if token else {}))
            data = http.get_json(CTGOV, p)
            if not isinstance(data, dict):
                raise RuntimeError("ClinicalTrials.gov sent something unexpected")
            out.extend(s for s in data.get("studies") or [] if isinstance(s, dict))
            token = data.get("nextPageToken")
            if not token:
                break
        return out
    try:
        return pages({**params, "fields": CT_FIELDS})
    except HttpError as exc:
        if not str(exc).startswith("400"):
            raise
        log(f"  ClinicalTrials.gov refused the field list ({str(exc)[:120]}); asking for whole records")
        return pages(params)


def ct_search(topic: dict) -> dict:
    """A topic's search: in the interventions, the conditions, anywhere, or more than one (all must match)."""
    out = {f"query.{k}": topic[k] for k in ("intr", "cond", "term") if topic.get(k)}
    if not out:
        raise ValueError(f"trial topic {topic.get('id')} has no intr, cond or term")
    return out


def fda_query(http: Http, url: str, search: str, sort: str = "", max_pages: int = 3) -> list[dict]:
    """openFDA results for a search; none found is an empty list, not an error."""
    out: list[dict] = []
    for page in range(max_pages):
        params = {"search": search, "limit": 1000, "skip": page * 1000}
        if sort:
            params["sort"] = sort
        try:
            data = http.get_json(url, params)
        except HttpError as exc:
            if str(exc).startswith("404") and ("NOT_FOUND" in str(exc) or "No matches" in str(exc)):
                break
            raise
        if not isinstance(data, dict):
            raise RuntimeError("openFDA sent something unexpected")
        got = [r for r in data.get("results") or [] if isinstance(r, dict)]
        out.extend(got)
        total = ((data.get("meta") or {}).get("results") or {}).get("total") or 0
        if len(got) < 1000 or len(out) >= total:
            break
    return out


def build(http: Http, cfg: dict, state: dict, now: datetime) -> "tuple[dict, dict]":
    st = cfg.get("settings") or {}
    today = now.date()
    keep_days = int(st.get("days", 120))
    last = W.ymd(state.get("last_run"))
    first_run = not state.get("trials") or not last
    span = int(st.get("first_days", 30)) if first_run else max(3, min(int(st.get("first_days", 30)), (today - last).days + 2))
    since = today - timedelta(days=span)
    events: dict = {e["id"]: e for e in state.get("events") or [] if isinstance(e, dict) and e.get("id")}
    trials: dict = dict(state.get("trials") or {})
    fr_dates: dict = {e["id"]: e for e in state.get("dates") or [] if isinstance(e, dict) and e.get("id")}
    sources: list[dict] = []
    topics = {t["id"]: t for t in cfg.get("trials") or []}
    follow = [n for n in cfg.get("follow") or [] if W.valid_nct(n)]
    follow_topic = {"id": "follow", "name": "Trials you follow", "phases": ["EARLY_PHASE1", "PHASE1", "PHASE2", "PHASE3", "PHASE4", "NA"]}
    shift = int(st.get("pcd_shift_days", 60))

    def source(name: str, fn) -> None:
        try:
            n = fn()
            sources.append({"name": name, "ok": True, "count": n})
            log(f"  {name}: {n}")
        except Exception as exc:
            msg = f"{type(exc).__name__}: {exc}"[:240]
            sources.append({"name": name, "ok": False, "error": msg})
            log(f"  {name}: FAILED ({msg})")

    def add(evs: list[dict]) -> int:
        n = 0
        for e in evs:
            if e["id"] not in events:
                events[e["id"]] = {**e, "seen": today.isoformat()}     # the day Watch first saw it (FDA data arrive weeks late)
                n += 1
            else:
                for k, v in e.items():                                 # fields added since it was first seen (company, device type…)
                    events[e["id"]].setdefault(k, v)
                events[e["id"]]["title"] = e["title"]                 # and the name as the record has it now
        return n

    def handle(study: dict, topic: dict) -> int:
        t = W.trial_of(study)
        if not W.valid_nct(t["nct"]):
            return 0
        old = trials.get(t["nct"])
        tp = follow_topic if t["nct"] in follow else topic
        if t["nct"] not in follow and not W.qualifies(t, topic):
            return 0                                   # only trials that count are kept to compare
        n = add(W.trial_events(W.expand(t["nct"], old) if old else None, t, tp, today, since, shift,
                               str(st.get("results_alert") or "phase3")))
        if old and old.get("tp") in topics and old["tp"] != topic["id"] and t["nct"] not in follow:
            tp = topics[old["tp"]]                      # keep the topic it was first found under
        trials[t["nct"]] = W.compact(t, tp["id"])
        return n

    def per_topic(params_of, max_pages: int) -> int:
        """Each topic on its own, so one bad search doesn't cost the others; all failing is a failure."""
        n, bad = 0, []
        for tp in topics.values():
            try:
                n += sum(handle(s, tp) for s in ct_query(http, params_of(tp), max_pages))
            except Exception as exc:
                bad.append(f"{tp['id']}: {type(exc).__name__}: {exc}"[:160])
                log(f"  ClinicalTrials.gov, {tp['id']}: FAILED ({bad[-1]})")
        if bad and len(bad) == len(topics):
            raise RuntimeError("; ".join(bad)[:240])
        return n

    def ct_recent() -> int:
        n = per_topic(lambda tp: {**ct_search(tp), "pageSize": 200, "sort": "LastUpdatePostDate:desc",
                                  "filter.advanced": f"AREA[StudyType]INTERVENTIONAL AND AREA[LastUpdatePostDate]RANGE[{since.isoformat()},MAX]"}, 3)
        if follow:
            got = ct_query(http, {"filter.ids": ",".join(follow), "pageSize": 100}, max_pages=1)
            n += sum(handle(s, follow_topic) for s in got)
        return n

    def ct_active() -> int:                    # every trial under way, weekly: the readouts ahead, and a baseline to compare
        n = per_topic(lambda tp: {**ct_search(tp), "filter.overallStatus": ACTIVE_FILTER, "pageSize": 1000,
                                  "filter.advanced": "AREA[StudyType]INTERVENTIONAL"}, 2)
        state["readouts_at"] = today.isoformat()
        return n

    source("ClinicalTrials.gov", ct_recent)
    due = W.ymd(state.get("readouts_at"))
    if first_run or not due or (today - due).days >= int(st.get("readouts_every_days", 7)):
        source("ClinicalTrials.gov, trials under way", ct_active)

    dcfg = cfg.get("devices") or {}
    ai_codes = {str(c).upper() for c in dcfg.get("ai_codes") or []}
    ai_re = re.compile(dcfg.get("ai_words") or r"x^", re.I)

    def devices() -> int:
        start = today - timedelta(days=int(dcfg.get("window_days", 75)))
        rng = f"[{start:%Y%m%d} TO {today:%Y%m%d}]"
        n = 0
        for panel in dcfg.get("panels") or []:
            rows = fda_query(http, FDA_510K, f"advisory_committee:{panel} AND decision_date:{rng}", sort="decision_date:desc")
            n += add([e for e in (W.clearance_event(r, ai_codes, ai_re) for r in rows) if e])
        for code in dcfg.get("pma_codes") or []:
            rows = fda_query(http, FDA_PMA, f"product_code:{code} AND decision_date:{rng}", sort="decision_date:desc")
            n += add([e for e in (W.pma_event(r) for r in rows) if e])
        return n

    dr = cfg.get("drugs") or {}

    def drugs() -> int:
        start = today - timedelta(days=int(dr.get("window_days", 60)))
        rows = fda_query(http, FDA_DRUGS, f"submissions.submission_status_date:[{start:%Y%m%d} TO {today:%Y%m%d}]")
        iso, agents = W.isotope_re(dr.get("isotopes") or []), re.compile(dr.get("agents") or r"x^", re.I)
        skip = re.compile(dr["skip"], re.I) if dr.get("skip") else None
        return add([e for app in rows for e in W.drug_events(app, iso, agents, skip, start, today)])

    def rules() -> int:
        n = 0
        start = today - timedelta(days=int(st.get("rules_days", 60)))
        for rule in cfg.get("rules") or []:
            params = {"conditions[agencies][]": rule["agency"], "conditions[type][]": list(rule.get("types") or ["RULE", "PRORULE"]),
                      "conditions[publication_date][gte]": start.isoformat(), "order": "newest", "per_page": 50,
                      "fields[]": ["title", "type", "document_number", "publication_date", "html_url", "comments_close_on", "effective_on"]}
            if rule.get("cfr"):
                params["conditions[cfr][title]"], params["conditions[cfr][part]"] = str(rule["cfr"][0]), str(rule["cfr"][1])
            if rule.get("term"):
                params["conditions[term]"] = rule["term"]
            data = http.get_json(FED_REG, params)
            if not isinstance(data, dict) or "results" not in data and data.get("count") not in (0, None):
                raise RuntimeError(f"the Federal Register sent something unexpected for {rule['id']}")
            evs, dates = W.rule_events(data.get("results") or [], rule, today)
            n += add(evs)
            fr_dates.update({d["id"]: d for d in dates})
        return n

    source("openFDA devices", devices)
    source("openFDA drugs", drugs)
    source("Federal Register", rules)

    # keep what's recent; trials stay while under way, or for 400 days after their last update
    cut = (today - timedelta(days=keep_days)).isoformat()
    kept = sorted((e for e in events.values() if e.get("date", "") >= cut), key=lambda e: (e["date"], e["id"]), reverse=True)[:600]
    old_cut = today - timedelta(days=400)
    trials = {k: v for k, v in trials.items() if v.get("s") in W.ACTIVE or (W.ymd(v.get("u")) or today) >= old_cut or k in follow}
    fr_dates = {k: v for k, v in fr_dates.items() if (W.ymd(v.get("start", "")[:10]) or today) >= today}

    stop = today + timedelta(days=int(st.get("readout_days", 120)))
    readouts = []
    for nct, c in trials.items():
        d = W.ymd(c.get("p"))
        if d and today - timedelta(days=7) <= d <= stop and W.is_readout(c, topics.get(c.get("tp"))):
            ev = W.readout_date(nct, c, (topics.get(c.get("tp")) or follow_topic)["name"])
            if ev:
                ev["nct"] = nct
                readouts.append(ev)
    readouts.sort(key=lambda e: e["start"])

    data = {
        "generated": now_iso(),
        "settings": {"days": keep_days, "readout_days": int(st.get("readout_days", 120))},
        "kinds": KINDS,
        "topics": {**{t["id"]: t["name"] for t in topics.values()}, "follow": follow_topic["name"],
                   **{r["id"]: r["name"] for r in cfg.get("rules") or []}, "devices": "Radiology devices", "pma": "Heart valve approvals",
                   "drugs": "Imaging agents and radiopharmaceuticals"},
        "sources": sources,
        "events": kept,
        "dates": sorted(list(fr_dates.values()) + readouts, key=lambda e: e["start"]),
        "tracked": sum(1 for v in trials.values() if v.get("s") in W.ACTIVE),
    }
    new_state = {"last_run": today.isoformat(), "readouts_at": state.get("readouts_at", ""), "trials": trials,
                 "events": kept, "dates": list(fr_dates.values())}
    return data, new_state


def main() -> int:
    cfg = load_yaml("watch.yaml")
    state = read_json(CACHE / "watch_state.json", {}) or {}
    http = Http(intervals={"clinicaltrials.gov": 1.5, "api.fda.gov": 0.5, "www.federalregister.gov": 1.0}, retries=3)
    data, state = build(http, cfg, state, datetime.now(timezone.utc))
    if not any(s["ok"] for s in data["sources"]) and (DATA / "watch.json").exists():
        log("Watch: every source failed; keeping the last file")
        return 1
    write_json(DATA / "watch.json", data)
    write_json(CACHE / "watch_state.json", state)
    bad = [s["name"] for s in data["sources"] if not s["ok"]]
    log(f"Watch: {len(data['events'])} changes, {len(data['dates'])} dates, {data['tracked']} trials under way"
        + (f"; couldn't read {', '.join(bad)}" if bad else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
