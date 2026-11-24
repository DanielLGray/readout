"""Temporary probe: foundations searches, PMC open-access figures on AWS, PMID→PMCID lookup."""
import io, json, re, sys, time
from datetime import date
import requests, yaml
sys.path.insert(0, ".")
from pipeline.common import fill, load_yaml
from pipeline.http import default_http
from pipeline.pubmed import PubMed
from pipeline import icite

http = default_http(); pm = PubMed(http)
fd = yaml.safe_load(open("config/foundations.yaml"))
print("== FOUNDATIONS")
for g in fd["groups"]:
    for it in g["items"]:
        n, ids = pm.esearch(f'({it["find"]}) NOT (Letter[pt] OR Comment[pt] OR "Published Erratum"[pt])', retmax=40)
        m = icite.metrics(http, ids) if ids else {}
        top = sorted(ids, key=lambda p: -(m.get(p, {}).get("cites", 0)))[:3]
        summ = {r["pmid"]: r for r in pm.summaries(top)} if top else {}
        print(f"\n[{g['id']}] {it['label']}  ({n} hits)")
        for p in top:
            r = summ.get(p, {})
            print(f"   {p} {m.get(p,{}).get('year')} cites={m.get(p,{}).get('cites')} | {r.get('journal')} | {r.get('title','')[:150]}")

import os
if os.environ.get("ONLY_FD"): sys.exit(0)
print("\n== FIGURES")
S3 = "https://pmc-oa-opendata.s3.amazonaws.com"
for pmc in ["PMC13788141", "PMC13785406", "PMC13782375"]:
    r = requests.get(S3 + "/", params={"list-type": "2", "prefix": f"metadata/{pmc}."}, timeout=30)
    print(pmc, "list", r.status_code, re.findall(r"<Key>([^<]+)</Key>", r.text)[:5])
    keys = re.findall(r"<Key>([^<]+)</Key>", r.text)
    if not keys: continue
    meta = requests.get(f"{S3}/{keys[-1]}", timeout=30).json()
    print("  license", meta.get("license_code"), "manuscript", meta.get("is_manuscript"), "media", len(meta.get("media_urls") or []))
    print("  media sample", (meta.get("media_urls") or [])[:4])
    xu = meta["xml_url"].split("?")[0].replace("s3://pmc-oa-opendata", S3)
    x = requests.get(xu, timeout=60).text
    print("  xml bytes", len(x), "license tag:", re.findall(r"<license[^>]*>", x)[:2], re.findall(r"license_ref[^>]*>[^<]+", x)[:1])
    for f in re.findall(r"<fig\b.*?</fig>", x, re.S)[:4]:
        lab = re.search(r"<label>(.*?)</label>", f, re.S)
        gr = re.search(r'<graphic[^>]*xlink:href="([^"]+)"', f)
        cap = re.sub(r"<[^>]+>", " ", (re.search(r"<caption>(.*?)</caption>", f, re.S) or [None, ""])[1] if re.search(r"<caption>(.*?)</caption>", f, re.S) else "")
        print("   fig", lab.group(1) if lab else None, gr.group(1) if gr else None, "|", " ".join(cap.split())[:140])
    jp = [u for u in meta.get("media_urls") or [] if re.search(r"\.(jpe?g|png)\?", u)]
    if jp:
        u = jp[0].split("?")[0].replace("s3://pmc-oa-opendata", S3)
        b = requests.get(u, timeout=60)
        print("  image", u, b.status_code, len(b.content), b.headers.get("content-type"))
        try:
            from PIL import Image
            im = Image.open(io.BytesIO(b.content)); print("  size", im.size, im.mode)
        except Exception as e:
            print("  PIL:", e)

print("\n== IDCONV")
for url in ["https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/", "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/"]:
    try:
        r = requests.get(url, params={"ids": "43073449,43071018,43064878,43066785", "format": "json", "tool": "readout"}, timeout=30)
        print(url, r.status_code, r.text[:600])
    except Exception as e:
        print(url, "ERR", e)
r = requests.post("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi", data={"dbfrom": "pubmed", "db": "pmc", "linkname": "pubmed_pmc", "id": ["43073449", "43071018", "43064878"], "retmode": "json", "tool": "readout"}, timeout=30)
print("elink", r.status_code, r.text[:800])

print("\n== CLASSICS SIZE")
cfg = load_yaml("feeds.yaml")
for st in cfg["streams"]:
    n = pm.count(fill(st["query"], cfg), date(2000, 1, 1), date(2021, 12, 31))
    print(st["id"], n)
