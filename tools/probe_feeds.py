"""Temporary: which society news feeds answer from GitHub's network, and with what."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
cands = {
    "SCCT": ("https://scct.org", ["https://scct.org/news/news_rss.asp?cat=11632", "https://scct.org/news/news_rss.asp"]),
    "BNMS": ("https://www.bnms.org.uk", ["https://www.bnms.org.uk/news/news_rss.asp?cat=14173", "https://www.bnms.org.uk/news/news_rss.asp"]),
    "ASNC": ("https://www.asnc.org", ["https://www.asnc.org/feed/", "https://www.asnc.org/news-publications/updates/feed/",
                                      "https://www.asnc.org/news-publications/press-releases/feed/"]),
    "EANM": ("https://eanm.org", ["https://eanm.org/feed/", "https://eanm.org/latestnews/feed/", "https://eanm.org/category/news/feed/"]),
    "SNMMI": ("https://www.snmmi.org", ["https://www.snmmi.org/rss", "https://snmmi.org/Web/News/Default.aspx?rss=1", "https://www.snmmi.org/feed/"]),
    "ACR": ("https://www.acr.org", ["https://www.acr.org/rss", "https://www.acr.org/News-and-Publications/rss.xml", "https://www.acr.org/feed"]),
    "RSNA": ("https://www.rsna.org", ["https://www.rsna.org/rss", "https://www.rsna.org/news/rss", "https://press.rsna.org/rss"]),
    "ESR": ("https://www.myesr.org", ["https://www.myesr.org/feed/", "https://www.myesr.org/news/feed/"]),
    "SCMR": ("https://scmr.org", ["https://scmr.org/news/news_rss.asp", "https://scmr.org/feed/"]),
    "SIIM": ("https://siim.org", ["https://siim.org/feed/", "https://siim.org/news/news_rss.asp"]),
    "ARRS": ("https://arrs.org", ["https://arrs.org/feed/", "https://www.arrs.org/feed/"]),
}
http = news_http()
for name, (home, urls) in cands.items():
    got, st = fetch_source(http, {"name": name, "home": home, "urls": urls, "merge": True}, now)
    print(f"== {name}: ok={st['ok']} count={st['count']} newest={(st['newest'] or '')[:10]} offsite={st.get('offsite', 0)} via={st['url']}")
    for t in st["tried"][:4]: print("     tried:", t[:150])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:6]:
        print(f"     {i['date'][:10]} {i['title'][:100]} || {i.get('summary','')[:70]}")
