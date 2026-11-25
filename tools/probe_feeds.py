"""Temporary: lighter reading and general news candidates, as the news job would read them."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone, timedelta
import requests
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
W = "https://en.wikipedia.org/w/api.php?action=featuredfeed&feedformat=atom&feed="
NPR = "https://feeds.npr.org/{}/rss.xml"
cands = {
    "Wikipedia featured article": ("https://en.wikipedia.org", [W + "featured"]),
    "Wikipedia on this day": ("https://en.wikipedia.org", [W + "onthisday"]),
    "Wikipedia picture of the day": ("https://en.wikipedia.org", [W + "potd"]),
    "NASA Image of the Day": ("https://www.nasa.gov", ["https://www.nasa.gov/feeds/iotd-feed/", "https://www.nasa.gov/rss/dyn/lg_image_of_the_day.rss"]),
    "Smithsonian Smart News": ("https://www.smithsonianmag.com", ["https://www.smithsonianmag.com/rss/smart-news/"]),
    "Smithsonian History": ("https://www.smithsonianmag.com", ["https://www.smithsonianmag.com/rss/history/"]),
    "NYT Well": ("https://www.nytimes.com", ["https://rss.nytimes.com/services/xml/rss/nyt/Well.xml"]),
    "NYT Home": ("https://www.nytimes.com", ["https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml"]),
    "Knowable": ("https://knowablemagazine.org", ["https://knowablemagazine.org/rss", "https://knowablemagazine.org/rss.xml",
                 "https://knowablemagazine.org/feed", "https://knowablemagazine.org/action/showFeed?type=etoc&feed=rss&jc=knowable"]),
    "BBC News": ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/rss.xml"]),
    "BBC World": ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/world/rss.xml"]),
    "BBC Science & Environment": ("https://www.bbc.com", ["https://feeds.bbci.co.uk/news/science_and_environment/rss.xml"]),
}
for n in (1001, 1002, 1004, 1003, 1008, 1032, 1053, 1048, 1126, 1146, 1025, 1026, 1047, 1132, 1145):
    cands[f"NPR {n}"] = ("https://www.npr.org", [NPR.format(n)])
http = news_http()
for name, (home, urls) in cands.items():
    got, st = fetch_source(http, {"name": name, "home": home, "urls": urls, "link_domains": ["bbc.co.uk", "nyti.ms", "wikimedia.org"], "verbatim": name.startswith("NYT")}, now)
    week = sum(1 for i in got if i["date"] >= (now - timedelta(days=7)).isoformat())
    title = ""
    try:
        r = requests.get(urls[0], timeout=20, headers={"User-Agent": "readout-probe"})
        import re
        m = re.search(r"<title[^>]*>(.*?)</title>", r.text, re.S)
        title = (m.group(1) if m else "")[:60]
    except Exception as e:
        title = f"ERR {e}"[:60]
    print(f"== {name} [{title}]: ok={st['ok']} count={st['count']} last7d={week} newest={(st['newest'] or '')[:10]} offsite={st.get('offsite', 0)}")
    for t in st["tried"][:4]: print("     tried:", t[:150])
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:3]:
        print(f"     {i['date'][:10]} {i['title'][:80]} || {i.get('summary','')[:110]} || {i['link'][:70]}")
if "--raw" in sys.argv or True:
    r = requests.get(W + "featured", timeout=20, headers={"User-Agent": "readout-probe"})
    print("\n== RAW featured feed (first entry):"); i = r.text.find("<entry>"); print(r.text[i:i + 1800])
