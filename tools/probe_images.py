"""Temporary: do the story pictures in news.json load, and how big are they?"""
import json, collections, requests
n = json.load(open("docs/data/news.json"))
by = collections.defaultdict(list)
for i in n["items"]:
    if i.get("img"): by[i["source"]].append(i["img"])
total = collections.Counter(i["source"] for i in n["items"])
for src in sorted(total):
    imgs = by.get(src, [])
    line = f"{src[:34]:34} {len(imgs):4}/{total[src]:<4}"
    for u in imgs[:2]:
        try:
            r = requests.get(u, timeout=20, headers={"User-Agent": "Mozilla/5.0 readout-check"}, stream=True)
            size = r.headers.get("content-length") or len(r.content)
            line += f" | {r.status_code} {r.headers.get('content-type','')[:10]} {int(size)//1024}KB"
        except Exception as e:
            line += f" | ERR {type(e).__name__}"
    print(line, "|", (imgs[0][:90] if imgs else ""))
