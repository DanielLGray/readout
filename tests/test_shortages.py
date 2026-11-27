from datetime import date

from pipeline import watch as W
from pipeline import watch_features as WF
from pipeline.common import load_yaml

CFG = load_yaml("watch.yaml")["shortages"]
TODAY = date(2026, 11, 27)


def rec(name, status, posted="", updated="11/20/2026", form="Injection", company="GE Healthcare", avail="Unavailable", **kw):
    return {"generic_name": name, "status": status, "initial_posting_date": posted, "update_date": updated, "dosage_form": form,
            "company_name": company, "availability": avail, "shortage_reason": kw.get("reason", "Demand increase for the drug"),
            "proprietary_name": kw.get("brand", ""), "related_info": kw.get("related", ""), "related_info_link": kw.get("link", "")}


ROWS = [
    rec("Iohexol Injection", "Current", "11/10/2026", brand="Omnipaque"),
    rec("Iohexol Injection", "Current", "10/01/2026", company="Bracco", avail="Available", brand="Omnipaque"),
    rec("Sincalide for Injection", "Current", "03/15/2024", company="Bracco", avail="Limited Availability",
        related="Next delivery expected early 2027.", link="https://www.accessdata.fda.gov/scripts/drugshortages/dsp_ActiveIngredientDetails.cfm?AI=Sincalide"),
    rec("Technetium Tc99m Sestamibi Injection", "Resolved", "01/05/2026", updated="11/01/2026", company="Lantheus"),
    rec("Furosemide Tablets", "Current", "11/01/2026", form="Tablet"),                    # only furosemide injection counts
    rec("Furosemide Injection", "To Be Discontinued", "", updated="11/15/2026", company="Hospira"),
    rec("Amoxicillin Capsules", "Current", "11/12/2026"),                                 # not an imaging drug
    rec("Gadobutrol Injection", "Resolved", "01/01/2025", updated="01/10/2025"),            # resolved long ago: no change
    {"generic_name": "", "status": "Current"}, "junk",
]


def test_shortages_grouped_by_drug_with_changes():
    now, evs = W.shortage_report(ROWS, CFG, TODAY)
    names = [d["name"] for d in now]
    assert names == ["Sincalide for Injection", "Iohexol Injection", "Furosemide Injection"]     # current by oldest first, then discontinuations
    ioh = next(d for d in now if d["name"] == "Iohexol Injection")
    assert ioh["posted"] == "2026-10-01" and ioh["companies"] == ["GE Healthcare", "Bracco"] and ioh["avail"] == "1 of 2 unavailable"
    sin = now[0]
    assert sin["related"].startswith("Next delivery") and sin["link"].startswith("https://www.accessdata.fda.gov/") and sin["avail"] == "1 limited"
    by = {e["id"]: e for e in evs}
    assert set(by) == {"shortage:iohexol-injection:new:2026-10-01", "shortage:technetium-tc99m-sestamibi-injection:resolved:2026-11-01",
                       "shortage:furosemide-injection:disc:2026-11-15"}
    assert by["shortage:iohexol-injection:new:2026-10-01"]["level"] == "alert"          # iodinated contrast
    assert by["shortage:furosemide-injection:disc:2026-11-15"]["level"] == "update"
    assert all(e["kind"] == "shortage" for e in evs)


def test_dates_and_rating_features():
    assert W.fda_day("11/05/2026") == date(2026, 11, 5) and W.fda_day("2026-11-05") == date(2026, 11, 5) and W.fda_day("13/40/2026") is None
    _, evs = W.shortage_report(ROWS, CFG, TODAY)
    e = next(x for x in evs if ":new:" in x["id"])
    assert WF.change_of(e) == "short-new" and WF.org_of(e) == "GE Healthcare"
    assert "wt:shortages" not in WF.features(e) and "wk:shortage" in WF.features(e)
