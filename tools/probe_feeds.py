"""Temporary: which society news addresses answer, and with what."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
G = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
cands = {
    "ACR": [G + "%22American+College+of+Radiology%22+OR+%22ACR+appropriateness%22"],
    "SNMMI": [G + "%22SNMMI%22+OR+%22Society+of+Nuclear+Medicine+and+Molecular+Imaging%22"],
    "SCCT": [G + "%22Society+of+Cardiovascular+Computed+Tomography%22+OR+%22SCCT%22+cardiac"],
    "RSNA": [G + "%22RSNA%22+radiology"],
    "TAVR CT": [G + "TAVR+CT+imaging"],
}
http = news_http()
for name, urls in cands.items():
    got, st = fetch_source(http, {"name": name, "urls": urls, "merge": True}, now)
    print(f"== {name}: ok={st['ok']} count={st['count']} newest={(st['newest'] or '')[:10]} via={st['url']}")
    for t in st["tried"][:3]: print("     tried:", t[:140])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:8]:
        print(f"     {i['date'][:10]} {i['title'][:110]} || {i.get('summary','')[:60]}")
