"""Temporary: which society news feeds answer from GitHub's network, and with what."""
import sys
sys.path.insert(0, ".")
from datetime import datetime, timezone
from pipeline.build_news import fetch_source, news_http
now = datetime.now(timezone.utc)
cands = {
    "MX diagnostic radiology": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/diagnostic-radiology-news/"]),
    "MX radiology & imaging": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/radiology-imaging-news/", "https://medicalxpress.com/rss-feed/health-news/radiology-imaging/"]),
    "MX RSNA": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/partners/radiological-society-of-north-america/"]),
    "MX SNMMI": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/partners/society-of-nuclear-medicine-and-molecular-imaging/", "https://medicalxpress.com/rss-feed/partners/society-of-nuclear-medicine/", "https://medicalxpress.com/rss-feed/partners/snmmi/"]),
    "MX ACR": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/partners/american-college-of-radiology/"]),
    "MX ARRS": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/partners/american-roentgen-ray-society/"]),
    "MX ACC": ("https://medicalxpress.com", ["https://medicalxpress.com/rss-feed/partners/american-college-of-cardiology/"]),
}
http = news_http()
for name, (home, urls) in cands.items():
    got, st = fetch_source(http, {"name": name, "home": home, "urls": urls, "merge": True}, now)
    print(f"== {name}: ok={st['ok']} count={st['count']} newest={(st['newest'] or '')[:10]} offsite={st.get('offsite', 0)} via={st['url']}")
    for t in st["tried"][:4]: print("     tried:", t[:150])
    import re
    soc = re.compile(r"\\b(?:ACR|SNMMI|RSNA|SCCT|ASNC|EANM)\\b|American College of Radiology|Society of Nuclear Medicine|Appropriateness Criteria", re.I)
    print("     mentions a society:", sum(1 for i in got if soc.search(i["title"] + " " + i.get("summary", ""))), "| oldest", min((i["date"][:10] for i in got), default=""))
    for i in sorted(got, key=lambda i: i["date"], reverse=True)[:4]:
        print(f"     {i['date'][:10]} {i['title'][:100]} || {i.get('summary','')[:70]}")
