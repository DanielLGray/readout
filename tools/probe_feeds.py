"""Temporary: U.S. news and business & markets candidates, as the news job would read them."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone, timedelta
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
DJ = "https://feeds.content.dowjones.io/public/rss/"
NYT = "https://rss.nytimes.com/services/xml/rss/nyt/"
NPR = "https://feeds.npr.org/{}/rss.xml"
cands = {f"WSJ {k}": ("https://www.wsj.com", [DJ + k]) for k in
         ["RSSMarketsMain", "WSJcomUSBusiness", "RSSUSnews", "socialeconomyfeed", "RSSPersonalFinance", "RSSWorldNews", "socialpoliticsfeed", "socialhealth"]}
cands.update({f"MarketWatch {k}": ("https://www.marketwatch.com", [DJ + k]) for k in ["mw_topstories", "mw_marketpulse", "mw_realtimeheadlines", "mw_bulletins"]})
cands["MarketWatch old"] = ("https://www.marketwatch.com", ["https://feeds.marketwatch.com/marketwatch/topstories"])
cands.update({f"NYT {k}": ("https://www.nytimes.com", [NYT + k + ".xml"]) for k in ["US", "Business", "Economy", "Dealbook", "YourMoney", "Politics"]})
cands.update({f"NPR {n}": ("https://www.npr.org", [NPR.format(n)]) for n in (1003, 1006, 1017, 1014)})
cands["NPR Planet Money"] = ("https://www.npr.org", ["https://feeds.npr.org/510289/podcast.xml"])
cands["NPR The Indicator"] = ("https://www.npr.org", ["https://feeds.npr.org/510325/podcast.xml"])
cands["BBC Business"] = ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/business/rss.xml"])
cands["BBC US & Canada"] = ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml"])
http = news_http()
for name, (home, urls) in cands.items():
    got, st = fetch_source(http, {"name": name, "home": home, "urls": urls, "link_domains": ["bbc.co.uk", "nyti.ms", "wsj.com", "marketwatch.com", "barrons.com"],
                                  "verbatim": name.startswith("NYT")}, now)
    day = sum(1 for i in got if i["date"] >= (now - timedelta(days=1)).isoformat())
    imgs = sum(1 for i in got if i.get("img"))
    print(f"== {name}: ok={st['ok']} count={st['count']} last24h={day} imgs={imgs} newest={(st['newest'] or '')[:16]} offsite={st.get('offsite', 0)}")
    for t in st["tried"][:2]: print("     tried:", t[:140])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:3]:
        print(f"     {i['date'][:16]} {i['title'][:80]} || {i.get('summary','')[:70]} || {i['link'][:60]}")
