"""Temporary: which society news addresses answer, and with what."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
G = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
cands = {
    "ACR site": ["https://www.acr.org/rss", "https://www.acr.org/News-and-Publications/Media-Center/rss.xml", "https://www.acr.org/sitemap.xml"],
    "ACR Bulletin": ["https://www.acrbulletin.org/feed", "https://www.acrbulletin.org/rss", "https://acrbulletin.org/rss.xml"],
    "GN site:acr.org": [G + "site:acr.org"],
    "GN ACR": [G + "%22American+College+of+Radiology%22"],
    "GN site:snmmi.org": [G + "site:snmmi.org"],
    "SNMMI": ["https://www.snmmi.org/rss", "https://snmmi.org/feed", "https://www.snmmi.org/Feeds/News.aspx"],
    "GN site:scct.org": [G + "site:scct.org"],
    "GN site:rsna.org": [G + "site:rsna.org"],
    "RSNA News": ["https://www.rsna.org/news/rss", "https://www.rsna.org/rss"],
    "JACR": ["https://www.jacr.org/current.rss", "https://www.jacr.org/inpress.rss"],
}
http = news_http()
for name, urls in cands.items():
    got, st = fetch_source(http, {"name": name, "urls": urls, "merge": True}, now)
    print(f"== {name}: ok={st['ok']} count={st['count']} newest={(st['newest'] or '')[:10]} via={st['url']}")
    for t in st["tried"][:3]: print("     tried:", t[:140])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:4]:
        print(f"     {i['date'][:10]} {i['title'][:90]} | {i['link'][:60]}")
