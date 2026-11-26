"""Watch: trial changes, FDA approvals and clearances, federal rules — offline."""
import re
from datetime import date, datetime, timezone

from pipeline import build_watch, watch as W
from pipeline.http import HttpError

TODAY = date(2026, 11, 26)
NOW = datetime(2026, 11, 26, 13, 0, tzinfo=timezone.utc)
TOPIC = {"id": "rlt", "name": "Radioligand therapy", "intr": "lutetium", "phases": ["PHASE2", "PHASE3"]}


def study(nct="NCT01234567", status="RECRUITING", pcd="2027-03-31", pcd_type="ESTIMATED", results="", phases=("PHASE3",),
          n=600, first="2024-01-10", updated="2026-11-20", why="", acronym="SPLASH-2"):
    sm = {"overallStatus": status, "primaryCompletionDateStruct": {"date": pcd, "type": pcd_type},
          "studyFirstPostDateStruct": {"date": first}, "lastUpdatePostDateStruct": {"date": updated}}
    if results:
        sm["resultsFirstPostDateStruct"] = {"date": results}
    if why:
        sm["whyStopped"] = why
    return {"protocolSection": {"identificationModule": {"nctId": nct, "briefTitle": "Lu-177 PSMA in mCRPC", "acronym": acronym},
                                "statusModule": sm,
                                "designModule": {"studyType": "INTERVENTIONAL", "phases": list(phases), "enrollmentInfo": {"count": n}},
                                "sponsorCollaboratorsModule": {"leadSponsor": {"name": "Acme Pharma"}}},
            "hasResults": bool(results)}


def test_trial_changes():
    old = W.trial_of(study())
    assert W.qualifies(old, TOPIC) and not W.qualifies(W.trial_of(study(phases=("PHASE1",))), TOPIC)
    assert not W.qualifies(W.trial_of(study(n=50)), {**TOPIC, "min_n": 100})
    since = date(2026, 11, 20)
    c = W.expand("NCT01234567", W.compact(old, "rlt"))
    # nothing changed
    assert W.trial_events(c, W.trial_of(study()), TOPIC, TODAY, since, 60) == []
    # stopped, with a reason
    ev = W.trial_events(c, W.trial_of(study(status="TERMINATED", why="Sponsor decision")), TOPIC, TODAY, since, 60)
    assert [e["what"] for e in ev] == ["Recruiting → Terminated: Sponsor decision"] and ev[0]["level"] == "update"
    # results posted on a Phase 3: an alert, dated the day they were posted
    ev = W.trial_events(c, W.trial_of(study(results="2026-11-24")), TOPIC, TODAY, since, 60)
    assert ev[0]["what"] == "Results posted" and ev[0]["level"] == "alert" and ev[0]["date"] == "2026-11-24"
    assert ev[0]["link"] == "https://clinicaltrials.gov/study/NCT01234567" and ev[0]["sub"] == "Phase 3 · 600 patients · Acme Pharma"
    # primary completion reached, or moved by months
    ev = W.trial_events(c, W.trial_of(study(pcd="2026-11-15", pcd_type="ACTUAL")), TOPIC, TODAY, since, 60)
    assert ev[0]["what"] == "Primary completion reached (Nov 15, 2026)"
    ev = W.trial_events(c, W.trial_of(study(pcd="2027-09-30")), TOPIC, TODAY, since, 60)
    assert ev[0]["what"] == "Primary completion moved later: Mar 31, 2027 → Sep 30, 2027"
    assert W.trial_events(c, W.trial_of(study(pcd="2027-04-15")), TOPIC, TODAY, since, 60) == []
    # first seen: only what its own dates say is recent
    assert [e["what"] for e in W.trial_events(None, W.trial_of(study(first="2026-11-22")), TOPIC, TODAY, since, 60)] == ["New trial registered"]
    assert W.trial_events(None, W.trial_of(study()), TOPIC, TODAY, since, 60) == []


def test_readout_dates():
    c = W.compact(W.trial_of(study(pcd="2027-01-31")), "rlt")
    assert W.is_readout(c, TOPIC)
    ev = W.readout_date("NCT01234567", c, "Radioligand therapy")
    assert ev["start"] == "2027-01-31" and ev["approx"] == "about" and ev["kind"] == "medicine"
    assert ev["title"] == "SPLASH-2: primary completion (estimated)" and ev["src"] == "ClinicalTrials.gov"
    assert not W.is_readout(W.compact(W.trial_of(study(phases=("PHASE2",))), "rlt"), TOPIC)
    assert not W.is_readout(W.compact(W.trial_of(study(status="COMPLETED")), "rlt"), TOPIC)
    dev = W.compact(W.trial_of(study(phases=("NA",), n=900)), "tavr")
    assert W.is_readout(dev, {"phases": ["NA", "PHASE3"], "device_readouts": True}) and not W.is_readout(dev, {"phases": ["NA"]})
    assert not W.is_readout(W.compact(W.trial_of(study(n=40)), "rlt"), TOPIC)


def test_fda_events():
    ai_re = re.compile(r"\b(?:AI|deep learning|triage)\b", re.I)
    k = {"k_number": "K253456", "device_name": "BriefCase-Triage for PE", "decision_date": "2026-10-15", "decision_code": "SESE",
         "decision_description": "Substantially Equivalent", "applicant": "Aidoc Medical", "product_code": "QAS"}
    ev = W.clearance_event(k, {"QAS"}, ai_re)
    assert ev["ai"] and ev["what"] == "Cleared, 510(k) · AI" and ev["link"].endswith("ID=K253456") and ev["date"] == "2026-10-15"
    assert W.clearance_event({**k, "decision_code": "SENU", "decision_description": "Not Substantially Equivalent"}, set(), ai_re) is None
    plain = W.clearance_event({**k, "device_name": "CT scanner", "product_code": "JAK", "decision_date": "20261001"}, {"QAS"}, ai_re)
    assert not plain["ai"] and plain["date"] == "2026-10-01"
    pma = {"pma_number": "P140031", "supplement_number": "S112", "supplement_type": "Panel Track Supplement",
           "supplement_reason": "Change Design/Components", "trade_name": "SAPIEN 3", "applicant": "Edwards", "decision_date": "2026-11-01",
           "decision_code": "APPR"}
    assert W.pma_event(pma)["what"] == "New indication approved (PMA supplement)" and W.pma_event(pma)["level"] == "alert"
    assert W.pma_event({**pma, "supplement_type": "30-Day Notice"}) is None
    assert W.pma_event({**pma, "supplement_number": "", "supplement_type": ""})["what"] == "New device approved (PMA)"
    iso = W.isotope_re(["F18", "LU177", "TC99M", "GA68"])
    agents = re.compile(r"\bGADO\w+\b")
    skip = re.compile(r"\bFLUDEOXYGLUCOSE\b")
    app = {"application_number": "NDA219999", "sponsor_name": "LANTHEUS", "products": [{"brand_name": "NEWSCAN",
           "active_ingredients": [{"name": "FLURPIRIDAZ F-18"}]}],
           "submissions": [{"submission_type": "ORIG", "submission_number": "1", "submission_status": "AP",
                            "submission_status_date": "20261020", "submission_class_code": "TYPE 1"},
                           {"submission_type": "SUPPL", "submission_number": "3", "submission_status": "AP",
                            "submission_status_date": "20261101", "submission_class_code": "LABELING"}]}
    ev = W.drug_events(app, iso, agents, skip, date(2026, 10, 1), TODAY)
    assert [e["what"] for e in ev] == ["New drug approved (new molecular entity)"] and ev[0]["title"] == "Newscan (flurpiridaz f-18)"
    assert ev[0]["level"] == "alert"
    new_form = {**app, "submissions": [{**app["submissions"][0], "submission_class_code": "TYPE 5"}]}
    assert [(e["what"], e["level"]) for e in W.drug_events(new_form, iso, agents, skip, date(2026, 10, 1), TODAY)] == \
        [("New drug approved (new form of an approved drug)", "update")]
    assert ev[0]["link"].endswith("ApplNo=219999")
    fdg = {**app, "products": [{"brand_name": "FDG", "active_ingredients": [{"name": "FLUDEOXYGLUCOSE F-18"}]}]}
    assert W.drug_events(fdg, iso, agents, skip, date(2026, 10, 1), TODAY) == []
    statin = {**app, "products": [{"brand_name": "X", "active_ingredients": [{"name": "ATORVASTATIN CALCIUM"}]}]}
    assert W.drug_events(statin, iso, agents, skip, date(2026, 10, 1), TODAY) == []
    assert W.drug_events({**app, "application_number": "ANDA219999"}, iso, agents, skip, date(2026, 10, 1), TODAY) == []
    assert iso.search("LUTETIUM LU 177 VIPIVOTIDE") and iso.search("TECHNETIUM TC-99M SESTAMIBI") and not iso.search("F-180")


def test_rule_events():
    rule = {"id": "cms-pfs", "name": "Medicare physician fee schedule", "title": "(?i)physician fee schedule", "alert": "(?i)physician fee schedule"}
    docs = [{"title": "Medicare Program; CY 2027 Payment Policies Under the Physician Fee Schedule", "type": "Rule", "document_number": "2026-21001",
             "publication_date": "2026-11-05", "html_url": "https://www.federalregister.gov/documents/2026/11/05/2026-21001/x",
             "effective_on": "2027-01-01", "comments_close_on": "2026-12-31"},
            {"title": "Medicare Program; CY 2027 Payment Policies Under the Physician Fee Schedule; Correction", "type": "Rule",
             "document_number": "2026-21500", "publication_date": "2026-11-20", "html_url": "https://www.federalregister.gov/documents/x"},
            {"title": "Durable medical equipment bidding", "type": "Proposed Rule", "document_number": "2026-1", "publication_date": "2026-11-01",
             "html_url": "https://www.federalregister.gov/documents/y"}]
    evs, dates = W.rule_events(docs, rule, TODAY)
    assert [e["id"] for e in evs] == ["rule:2026-21001"] and evs[0]["level"] == "alert"
    assert evs[0]["what"] == "Final rule; comments due Dec 31, 2026; takes effect Jan 1, 2027"
    assert sorted(d["title"] for d in dates) == ["Comments due: Medicare physician fee schedule", "Takes effect: Medicare physician fee schedule"]


class FakeHttp:
    def __init__(self, studies, fail=()):
        self.studies, self.fail, self.calls = studies, set(fail), []

    def get_json(self, url, params):
        self.calls.append((url, dict(params)))
        if "clinicaltrials" in url:
            if "clinicaltrials" in self.fail:
                raise HttpError("503 from clinicaltrials.gov: down")
            return {"studies": self.studies}
        if "510k" in url:
            return {"meta": {"results": {"total": 1}}, "results": [{"k_number": "K250001", "device_name": "Lung AI triage",
                    "decision_date": "2026-11-02", "decision_code": "SESE", "applicant": "X", "product_code": "QAS"}]}
        if "pma" in url or "drugsfda" in url:
            raise HttpError('404 from api.fda.gov: {"error":{"code":"NOT_FOUND","message":"No matches found!"}}')
        return {"count": 0, "description": "none"}


def test_build_end_to_end():
    cfg = {"settings": {"days": 120, "first_days": 30, "readout_days": 180}, "trials": [TOPIC],
           "devices": {"panels": ["RA"], "ai_codes": ["QAS"], "pma_codes": ["NPT"]}, "drugs": {"isotopes": ["F18"]},
           "rules": [{"id": "nrc-35", "name": "NRC", "agency": "nuclear-regulatory-commission", "cfr": [10, 35]}]}
    http = FakeHttp([study(), study(nct="NCT07654321", first="2026-11-10", acronym="")])
    data, state = build_watch.build(http, cfg, {}, NOW)
    assert all(s["ok"] for s in data["sources"]), data["sources"]
    ids = [e["id"] for e in data["events"]]
    assert "trial:NCT07654321:new" in ids and "device:K250001" in ids and len(ids) == 2
    assert [d["title"] for d in data["dates"]][:1] == ["SPLASH-2: primary completion (estimated)"]
    ct = [p for u, p in http.calls if "clinicaltrials" in u]
    assert any("filter.overallStatus" in p for p in ct) and all("fields" in p and p.get("query.intr") == "lutetium" for p in ct)
    # next day: the first trial terminates; the list of trials under way isn't read again yet
    http2 = FakeHttp([study(status="TERMINATED", why="Futility"), study(nct="NCT07654321", first="2026-11-10", acronym="")])
    data2, state2 = build_watch.build(http2, cfg, state, datetime(2026, 11, 27, 13, 0, tzinfo=timezone.utc))
    assert data2["events"][0]["id"] == "trial:NCT01234567:status-TERMINATED" and data2["events"][0]["date"] == "2026-11-27"
    assert not any("filter.overallStatus" in p for u, p in http2.calls if "clinicaltrials" in u)
    assert "SPLASH-2" not in " ".join(d["title"] for d in data2["dates"])          # no longer under way
    # a source that fails is reported, the rest still count
    data3, _ = build_watch.build(FakeHttp([], fail={"clinicaltrials"}), cfg, state2, datetime(2026, 11, 28, 13, 0, tzinfo=timezone.utc))
    assert [s["ok"] for s in data3["sources"]] == [False, True, True, True]
    assert {e["id"] for e in data3["events"]} >= {"trial:NCT01234567:status-TERMINATED", "device:K250001"}


def test_citation_milestones():
    from pipeline.build_important import milestones
    rows = {"1": {"cites": 104}, "2": {"cites": 49}, "3": {"cites": 260}, "4": {"cites": 30}, "5": {"cites": 8}}
    prev = {"1": 97, "2": 40, "3": 240, "5": 2}
    before = [{"pmid": "9", "mark": 50, "cites": 51, "date": "2026-11-10"}, {"pmid": "8", "mark": 25, "cites": 26, "date": "2026-10-01"}]
    got, snap = milestones(prev, rows, TODAY, before)
    assert [(m["pmid"], m["mark"]) for m in got] == [("3", 250), ("1", 100), ("9", 50)]
    assert snap == {"1": 104, "2": 49, "3": 260, "4": 30}
