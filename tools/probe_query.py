"""Temporary: how PubMed reads the general-journal query, part by part."""
import json, sys
sys.path.insert(0, ".")
from datetime import date, timedelta
from pipeline.common import fill, load_yaml
from pipeline.http import default_http
cfg = load_yaml("feeds.yaml")
http = default_http()
E = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
def count(term):
    r = http.get_json(E, {"db": "pubmed", "term": term, "retmode": "json", "retmax": "0", "datetype": "pdat",
                          "mindate": (date.today() - timedelta(days=1096)).strftime("%Y/%m/%d"), "maxdate": date.today().strftime("%Y/%m/%d")})
    er = r.get("esearchresult", {})
    return er.get("count"), er.get("querytranslation", "")[:300], er.get("warninglist"), er.get("errorlist")
J = cfg["general_journals"] if isinstance(cfg["general_journals"], str) else " OR ".join(cfg["general_journals"])
print("journals:", count(f"({fill('{general_journals}', cfg)})")[0])
print("journals+tiab:", count(f"({fill('{general_journals}', cfg)}) AND ({fill('{imaging_terms}', cfg)})")[0])
print("journals+title:", count(f"({fill('{general_journals}', cfg)}) AND ({fill('{imaging_title}', cfg)})"))
for part in fill("{imaging_title}", cfg).split(" OR "):
    print(f"  {part.strip():45} {count(f'({fill(chr(123)+chr(103)+chr(101)+chr(110)+chr(101)+chr(114)+chr(97)+chr(108)+chr(95)+chr(106)+chr(111)+chr(117)+chr(114)+chr(110)+chr(97)+chr(108)+chr(115)+chr(125), cfg)}) AND {part.strip()}')[0]}")
st = next(s for s in cfg["streams"] if s["id"] == "general_imaging")
print("stream:", count(fill(st["query"], cfg)))
