from datetime import date, datetime, timedelta, timezone

from pipeline import alerts
from pipeline.common import load_yaml

NOW = datetime(2026, 11, 20, 15, tzinfo=timezone.utc)


def _item(i, title, source, hours_ago, summary=""):
    d = (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"id": f"x{i}", "title": title, "source": source, "date": d, "summary": summary, "link": f"https://example.org/{i}"}


def test_news_alert_needs_two_outlets_or_a_primary_source():
    cfg = load_yaml("news.yaml")
    group_of = {"Radiology Business": "innovate", "Cardiovascular Business": "innovate"}
    items = [
        # two publishers: an alert
        _item(1, "FDA approves Telix's Gozellix PSMA PET imaging agent", "AuntMinnie", 30),
        _item(2, "FDA approves Gozellix, Telix PSMA PET imaging agent for prostate cancer", "The Imaging Wire", 20),
        # one outlet only, and its sister site: not enough
        _item(3, "FDA issues safety warning for gadolinium contrast in kidney patients", "Radiology Business", 10),
        _item(4, "FDA safety warning on gadolinium contrast for kidney patients", "Cardiovascular Business", 9),
        # the society itself: enough on its own
        _item(5, "SCCT releases updated guideline on coronary CT angiography reporting", "SCCT", 5),
        # matches nothing: an AI clearance, a statistics report
        _item(6, "FDA clears AI software for chest CT triage", "AuntMinnie", 4),
        _item(7, "FDA clears AI software for chest CT triage tool", "The Imaging Wire", 3),
        _item(8, "American Cancer Society report: cancer deaths keep falling", "STAT", 2),
        # too old
        _item(9, "USPSTF finalizes recommendation to screen for lung cancer at 50", "STAT", 24 * 9),
        _item(10, "USPSTF finalizes recommendation to screen for lung cancer at 50", "MedPage Today", 24 * 9),
    ]
    out = alerts.news_alerts(items, cfg, NOW, group_of)
    rules = sorted(a["rule"] for a in out)
    assert rules == ["fda", "society"]
    fda = next(a for a in out if a["rule"] == "fda")
    assert fda["id"] == "n:x1" and set(fda["sources"]) == {"AuntMinnie", "The Imaging Wire"} and fda["label"] == "FDA"
    assert fda["date"] < fda["updated"]


def test_news_alert_keeps_its_id_as_outlets_join():
    cfg = load_yaml("news.yaml")
    a = [_item(1, "USPSTF proposes starting colorectal cancer screening at 40", "STAT", 40),
         _item(2, "USPSTF proposes colorectal cancer screening start at 40", "MedPage Today", 30)]
    first = alerts.news_alerts(a, cfg, NOW)
    more = alerts.news_alerts(a + [_item(3, "Colorectal cancer screening at 40, USPSTF proposes", "NPR Health", 2)], cfg, NOW)
    assert [x["id"] for x in first] == [x["id"] for x in more] == ["n:x1"]
    assert len(more[0]["sources"]) == 3


class _PM:
    def __init__(self, hits, recs):
        self.hits, self.recs, self.terms = hits, recs, []

    def esearch(self, term, **kw):
        self.terms.append(term)
        for key, ids in self.hits.items():
            if key in term:
                return len(ids), ids
        return 0, []

    def fetch(self, ids):
        return [self.recs[p] for p in ids]


def test_guideline_papers_become_alerts_once():
    cfg = load_yaml("feeds.yaml")
    t = date(2026, 11, 20)
    recs = {
        "1": {"pmid": "1", "title": "Screening for Prostate Cancer: US Preventive Services Task Force Recommendation Statement",
              "added": "2026-11-18", "journal": "JAMA"},
        "2": {"pmid": "2", "title": "2026 ACC/AHA Guideline for the Management of Valvular Heart Disease", "added": "2026-11-17",
              "journal": "J Am Coll Cardiol"},
        "3": {"pmid": "3", "title": "2026 ACC/AHA Guideline for the Management of Valvular Heart Disease: Executive Summary",
              "added": "2026-11-17", "journal": "Circulation"},
        "4": {"pmid": "4", "title": "Erratum: Fleischner guideline", "added": "2026-11-19", "journal": "Radiology", "notice": True},
        "5": {"pmid": "5", "title": "SNMMI procedure standard for PSMA PET", "added": "2026-11-02", "journal": "J Nucl Med"},
    }
    pm = _PM({"preventive[ti]": ["1"], "ACC[ti]": ["2", "3"], "Fleischner": ["4"], "SNMMI": ["5"]}, recs)
    card = lambda rec, comp: {"pmid": rec["pmid"], "title": rec["title"], "journal": rec["journal"], "added": rec["added"]}
    out = alerts.paper_alerts(pm, cfg, t, [], card, {}, lambda r: r.get("notice", False))
    assert [a["rule"] for a in out] == ["uspstf", "acc_aha"]        # one copy of the joint guideline; the erratum and the old one out
    assert out[0]["id"] == "p:1" and out[0]["card"]["pmid"] == "1" and out[0]["date"] == "2026-11-18"
    assert all(len(term) < 600 for term in pm.terms)
    # a paper already alerted keeps its first day, so it still drops out a week later
    later = alerts.paper_alerts(pm, cfg, date(2026, 11, 26), [{"pmid": "1", "date": "2026-11-18"}], card, {}, lambda r: False)
    assert "p:1" not in [a["id"] for a in later]
