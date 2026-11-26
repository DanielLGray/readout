"""What Rate can say something about in a Watch change (the app's wFeatures does the same)."""
from pipeline import watch as W
from pipeline.watch_features import change_of, features, org_of


def test_device_trial_drug_rule():
    r = {"k_number": "K253001", "device_name": "Resona I10W", "decision_date": "2026-10-01", "decision_code": "SESE",
         "decision_description": "Substantially Equivalent", "product_code": "IYN", "applicant": "Shenzhen Mindray Bio-Medical Electronics Co., Ltd.",
         "openfda": {"device_name": "System, Imaging, Pulsed Doppler, Ultrasonic"}}
    e = W.clearance_event(r, set(), __import__("re").compile("x^"))
    assert e["pcn"] == "Ultrasonic pulsed doppler imaging system" and e["pc"] == "IYN"
    assert features(e) == ["wk:device", "wc:510k", "wp:IYN", "wo:Shenzhen Mindray Bio-Medical Electronics Co., Ltd."]
    old = {k: v for k, v in e.items() if k not in ("org", "pc", "pcn")}           # seen before these fields: from its subline
    assert features(old) == features(e)
    t = {"id": "trial:NCT07953049:new", "kind": "trial", "topic": "rlt", "what": "New trial registered",
         "sub": "Phase 1/2 · 40 patients · Sinotau Pharmaceutical Group"}
    assert features(t) == ["wk:trial", "wt:rlt", "wc:new", "wo:Sinotau Pharmaceutical Group", "wph:Phase 1/2"]
    assert change_of({**t, "id": "trial:NCT1:pcd-actual-2026-10"}) == "pcd" and change_of({**t, "id": "trial:NCT1:status-TERMINATED"}) == "status"
    assert features({"id": "drug:NDA1:ORIG1", "kind": "drug", "topic": "drugs", "what": "New drug approved", "sub": "Bracco"}) == \
        ["wk:drug", "wc:drug-new", "wo:Bracco"]
    assert features({"id": "rule:1", "kind": "rule", "topic": "cms-pfs", "what": "Final rule; takes effect Jan 1, 2027", "sub": "Medicare"}) == \
        ["wk:rule", "wt:cms-pfs", "wc:final"]
    assert org_of({"kind": "device", "sub": "product code QAS"}) == ""
    assert W.device_type({}) == {} and W.device_type({"openfda": {"device_name": ["Medical Image Analyzer"]}}) == {"pcn": "Medical image analyzer"}


def test_windows_1252_characters_in_fda_names():
    from pipeline.news import clean_text
    assert clean_text("SIGNA\x99 PET/MR") == "SIGNA™ PET/MR" and clean_text("MIM \x96 KineticID") == "MIM – KineticID"
    assert clean_text("a\x81b") == "ab"
