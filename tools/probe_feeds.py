"""Temporary: which major outlets' science feeds answer from GitHub's network, and with what."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone, timedelta
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
cands = {
    "NYT Science": ("https://www.nytimes.com", ["https://rss.nytimes.com/services/xml/rss/nyt/Science.xml"]),
    "NYT Health": ("https://www.nytimes.com", ["https://rss.nytimes.com/services/xml/rss/nyt/Health.xml"]),
    "NYT Space & Cosmos": ("https://www.nytimes.com", ["https://rss.nytimes.com/services/xml/rss/nyt/Space.xml"]),
    "BBC Science": ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"]),
    "Phys.org": ("https://phys.org", ["https://phys.org/rss-feed/", "https://phys.org/rss-feed/breaking/"]),
    "Guardian Science": ("https://www.theguardian.com", ["https://www.theguardian.com/science/rss"]),
    "WaPo Science": ("https://www.washingtonpost.com", ["https://feeds.washingtonpost.com/rss/rss_speaking-of-science"]),
}
http = news_http()
for name, (home, urls) in cands.items():
    got, st = fetch_source(http, {"name": name, "home": home, "urls": urls, "link_domains": ["bbc.co.uk", "nyti.ms"], "verbatim": name == "Phys.org"}, now)
    week = sum(1 for i in got if i["date"] >= (now - timedelta(days=7)).isoformat())
    print(f"== {name}: ok={st['ok']} count={st['count']} last7d={week} newest={(st['newest'] or '')[:10]} offsite={st.get('offsite', 0)}")
    for t in st["tried"][:3]: print("     tried:", t[:150])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:4]:
        print(f"     {i['date'][:10]} {i['title'][:95]} || {i.get('summary','')[:60]}")
