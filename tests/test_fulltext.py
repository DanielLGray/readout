"""Free full text from Europe PMC — offline."""
from pipeline import fulltext


def rec(pmid, pmcid="", in_pmc="N", urls=()):
    return {"pmid": pmid, "pmcid": pmcid, "inPMC": in_pmc, "inEPMC": in_pmc,
            "fullTextUrlList": {"fullTextUrl": [dict(zip(("availabilityCode", "documentStyle", "site", "url"), u)) for u in urls]}}


def test_best_link():
    assert fulltext.best_link(rec("1", "PMC123", "Y"))["u"] == "https://pmc.ncbi.nlm.nih.gov/articles/PMC123/"
    pub = fulltext.best_link(rec("2", urls=[("S", "html", "DOI", "https://pay.test/a"), ("OA", "pdf", "Unpaywall", "https://repo.test/a.pdf"),
                                           ("F", "html", "DOI", "https://free.test/a")]))
    assert pub == {"u": "https://free.test/a", "s": "publisher", "pdf": False}
    repo = fulltext.best_link(rec("3", urls=[("OA", "pdf", "Unpaywall", "https://repo.test/b.pdf")]))
    assert repo == {"u": "https://repo.test/b.pdf", "s": "repository", "pdf": True}
    assert fulltext.best_link(rec("4", urls=[("S", "html", "DOI", "https://pay.test/c")])) is None
    assert fulltext.best_link(rec("5", "PMC9", "N", urls=[("OA", "html", "Europe_PMC", "https://europepmc.org/x")]))["u"].endswith("/PMC9/")
    assert fulltext.best_link(rec("6", urls=[("OA", "html", "DOI", "http://insecure.test/x")])) is None


class FakeHttp:
    def __init__(self):
        self.calls = []

    def get_json(self, url, params):
        self.calls.append(params["query"])
        return {"resultList": {"result": [rec("11", "PMC11", "Y"), rec("12", urls=[("S", "html", "DOI", "https://pay.test")])]}}


def test_attach_and_recheck(tmp_path):
    cards = [{"pmid": "11"}, {"pmid": "12"}, {"pmid": "13"}]
    http = FakeHttp()
    stats = fulltext.attach(http, cards, cache_dir=tmp_path, job="t")
    assert stats["free"] == 1 and cards[0]["ft"]["s"] == "PMC" and "ft" not in cards[1] and "ft" not in cards[2]
    assert http.calls == ["(EXT_ID:11 OR EXT_ID:12 OR EXT_ID:13) AND SRC:MED"]
    again = [{"pmid": "11"}, {"pmid": "12"}]
    fulltext.attach(http, again, cache_dir=tmp_path, job="t")          # nothing stale: no new questions
    assert len(http.calls) == 1 and again[0]["ft"]["s"] == "PMC"
