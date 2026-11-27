"""Radar job: emerging topics → docs/data/radar.json (and cache/radar_state.json, cache/radar_archive.json)

    python -m pipeline.build_radar

Reads the Radar's own research-news feeds, the news job's stories and headline archive, new preprints
(arXiv, one search a topic, three seconds apart) and research counts (OpenAlex: with the
OPENALEX_API_KEY secret, every topic weekly; without it, a few a day). Spots new topics, adds the
ones that keep rising, retires those that don't.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from . import http as http_mod
from . import news
from . import radar as R
from .build_news import fetch_source
from .common import CACHE, DATA, load_yaml, now_iso, read_json, write_json
from .http import Http, log

ARXIV = "https://export.arxiv.org/api/query"
OPENALEX = "https://api.openalex.org/works"


def research(http: Http, query: str, today) -> dict:
    """Works a year for the topic's search, and the most cited from the last 18 months."""
    q = {"search.title_and_abstract": query}
    g = http.get_json(OPENALEX, {**q, "group_by": "publication_year"})
    years = {str(x.get("key")): int(x.get("count") or 0) for x in (g or {}).get("group_by") or []}
    since = (today - timedelta(days=548)).isoformat()
    w = http.get_json(OPENALEX, {**q, "filter": f"from_publication_date:{since}", "sort": "cited_by_count:desc", "per_page": 5,
                                 "select": "id,doi,display_name,publication_date,cited_by_count,primary_location"})
    papers = []
    for r in (w or {}).get("results") or []:
        src = ((r.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
        doi = str(r.get("doi") or "")
        link = doi if doi.startswith("https://doi.org/10.") else str(r.get("id") or "")
        if not link.startswith("https://") or not r.get("display_name"):
            continue
        papers.append({"title": news.clean_text(r["display_name"])[:300], "venue": src[:120], "date": str(r.get("publication_date") or "")[:10],
                       "cites": int(r.get("cited_by_count") or 0), "link": link})
    return {"years": years, "papers": papers, "at": today.isoformat()}


def research_years(http: Http, query: str) -> dict:
    g = http.get_json(OPENALEX, {"search.title_and_abstract": query, "group_by": "publication_year"})
    return {str(x.get("key")): int(x.get("count") or 0) for x in (g or {}).get("group_by") or []}


def preprints(http: Http, query: str) -> list[dict]:
    text = http.get_text(ARXIV, {"search_query": query, "sortBy": "submittedDate", "sortOrder": "descending", "max_results": 8})
    return R.arxiv_entries(text)


def build(http: Http, cfg: dict, news_data: dict, news_archive: dict, state: dict, archive: dict,
          now: datetime, have_key: bool) -> "tuple[dict, dict, dict]":
    st = cfg.get("settings") or {}
    today = now.date()
    days = int(st.get("days", 120))
    credible = set(cfg.get("credible") or [])
    ncfg = load_yaml("news.yaml")
    group_of = {s["name"]: s.get("group", s["name"]) for s in (ncfg.get("sources") or []) + (cfg.get("sources") or [])}
    releases = frozenset(ncfg.get("releases") or [])
    statuses = []

    # 1 — the Radar's own feeds; every headline goes in the archive (for spotting and momentum)
    feed_items = []
    for src in cfg.get("sources") or []:
        got, status = fetch_source(http, src, now)
        statuses.append(status)
        log(f"  {src['name']}: {len(got)} headlines")
        feed_items += got
    for i in feed_items:
        archive[i["id"]] = [i["date"], i["title"], i["source"], i.get("link", ""), news.teaser(i.get("summary", ""), 280), "radar"]

    # 2 — every topic: yours, then the ones spotted earlier
    topics = [R.compile_topic(t, "you") for t in cfg.get("topics") or []]
    auto = (state.get("auto") or {})
    topics += [R.compile_topic({"id": k, **v}, "spotted") for k, v in auto.items()]

    news_items = news_data.get("items") or []
    kind_of = {s["name"]: s.get("kind", "industry") for s in ncfg.get("sources") or []}
    for i in news_items:               # stories that match a topic are kept with their links past the news tab's 30 days
        if any(R.matches(t, f"{i['title']} {i.get('summary', '')}") for t in topics):
            archive[i["id"]] = [i["date"], i["title"], i["source"], i.get("link", ""), news.teaser(i.get("summary", ""), 280), kind_of.get(i["source"], "news")]
    cut = news._utc(now - timedelta(days=int(st.get("archive_days", 760))))
    archive = {k: v for k, v in archive.items() if v[0] >= cut}
    pool = [{"id": k, "date": v[0], "title": v[1], "source": v[2], "link": v[3], "summary": v[4], "kind": v[5]}
            for k, v in archive.items()]
    pool_ids = set(archive)
    titles_only = [{"id": k, "date": v[0], "title": v[1], "source": v[2], "kind": v[3] if len(v) > 3 else "news"}
                   for k, v in (news_archive or {}).items() if k not in pool_ids]

    # 3 — research counts (OpenAlex), within the day's budget: oldest first
    cache = state.get("openalex") or {}
    budget = int(st.get("openalex_searches_with_key", 120) if have_key else st.get("openalex_searches_without_key", 4))
    stale = (today - timedelta(days=6)).isoformat()
    order = sorted(topics, key=lambda t: (cache.get(t["id"], {}).get("at") or "", t["origin"] != "you"))
    oa_ok, oa_err = True, ""
    for t in order:
        if budget < 2:
            break
        if (cache.get(t["id"]) or {}).get("at", "") > stale:
            continue
        try:
            cache[t["id"]] = research(http, t["openalex"], today)
            budget -= 2
        except Exception as exc:          # out of budget, or the service is down: keep what we had
            oa_ok, oa_err = False, f"{type(exc).__name__}: {str(exc)[:160]}"
            break
    statuses.append({"name": "OpenAlex", "ok": oa_ok, "error": oa_err, "key": have_key})

    # 4 — preprints (arXiv: one search a topic)
    pre: dict[str, list] = {}
    ax_ok, ax_err = True, ""
    for t in topics:
        try:
            pre[t["id"]] = preprints(http, t["arxiv"])
        except Exception as exc:
            ax_ok, ax_err = False, f"{type(exc).__name__}: {str(exc)[:160]}"
            pre[t["id"]] = (state.get("preprints") or {}).get(t["id"], [])
    statuses.append({"name": "arXiv", "ok": ax_ok, "error": ax_err})

    # 5 — each topic: developments, momentum, research
    out_topics, by_status = [], {}
    tracked_since = min([v[0] for v in (news_archive or {}).values()] or [now_iso()])
    for t in topics:
        mine = [i for i in pool if R.matches(t, f"{i['title']} {i.get('summary', '')}")]
        for p in pre.get(t["id"], []):
            if p["date"] >= news._utc(now - timedelta(days=days)):
                mine.append(p)
        heads = [h["date"] for h in mine if h["source"] != "arXiv"] + [h["date"] for h in titles_only if R.matches(t, h["title"])]
        mom = R.momentum(heads, now, float(st.get("heating", 2.0)), since=tracked_since)
        rs = cache.get(t["id"])
        trend = R.research_trend(rs["years"], today) if rs else None
        last_hit = max(heads)[:10] if heads else None
        by_status[t["id"]] = {"status": mom["status"], "research": trend, "last_hit": last_hit}
        meta = auto.get(t["id"]) or {}
        out_topics.append({
            "id": t["id"], "name": t["name"], "origin": t["origin"], "words": t["words"][:12],
            "added": meta.get("added"), "why": meta.get("why"),
            "retire_on": (datetime.fromisoformat(meta["added"]) + timedelta(days=round(30.44 * float(st.get("retire_months", 18))))).date().isoformat()
            if meta and not meta.get("heated") else None,
            "momentum": mom, "research": trend, "research_at": (rs or {}).get("at"),
            "papers": (rs or {}).get("papers") or [],
            "preprints": [{k: (news.detex(p[k]) if k == "title" else p[k]) for k in ("title", "date", "link", "authors") if p.get(k)}
                          for p in pre.get(t["id"], [])[:6]],      # titles kept before LaTeX was turned to text, too
            "developments": R.developments(mine, now, days, credible, group_of, releases=releases),
        })

    # 6 — spotting, and adding or retiring topics
    sp = cfg.get("spot") or {}
    heads = [{**h, "kind": h["kind"]} for h in titles_only if h["kind"] in set(sp.get("kinds") or [])] + \
            [h for h in pool if h["kind"] in set(sp.get("kinds") or []) | {"radar"}]
    links = {i["id"]: i.get("link", "") for i in news_items}
    for h in heads:                 # recent ones have a link in the news file
        if not h.get("link"):
            h["link"] = links.get(h["id"], "")
    spotted = R.spot(heads, now, sp, topics, group_of)
    # is a science or health phrase a new field, or an old one in the news? (one search each, as the budget allows)
    cres = dict(state.get("cand_research") or {})
    month_ago = (today - timedelta(days=30)).isoformat()
    for c in spotted:
        if c["kind"] == "business" or budget < 1 or (cres.get(c["key"]) or {}).get("at", "") > month_ago:
            continue
        try:
            cres[c["key"]] = {"years": research_years(http, f'"{c["term"]}"'), "at": today.isoformat()}
            budget -= 1
        except Exception:
            break
    cres = {k: v for k, v in cres.items() if v.get("at", "") > (today - timedelta(days=180)).isoformat()}
    cand_trends = {k: R.research_trend(v["years"], today) for k, v in cres.items()}
    new_state = R.lifecycle({**state, "openalex": cache, "preprints": pre, "cand_research": cres}, spotted, by_status, cfg, today,
                            cand_trends)
    need = int(sp.get("weeks_to_watch", 3))
    cands = new_state.get("candidates") or {}
    spotted_out = [{**{k: c[k] for k in ("key", "term", "kind", "count", "prior", "publishers", "examples")},
                    "weeks": len((cands.get(c["key"]) or {}).get("weeks") or []), "need": need,
                    "research": cand_trends.get(c["key"])}
                   for c in spotted if c["key"] in cands and not R.established(cand_trends.get(c["key"]))]
    order = {"heating": 0, "steady": 1, "quiet": 2}
    out_topics.sort(key=lambda x: (x["origin"] != "you", order.get(x["momentum"]["status"], 3), x["name"].lower()))
    data = {
        "generated": now_iso(),
        "settings": {"days": days, "credible": sorted(credible), "heating": float(st.get("heating", 2.0)),
                     "retire_months": int(st.get("retire_months", 18)), "weeks_to_watch": need,
                     "openalex_key": have_key},
        "sources": statuses,
        "topics": out_topics,
        "spotted": spotted_out,
        "retired": sorted(({"id": k, **v} for k, v in (new_state.get("retired") or {}).items()), key=lambda r: r["retired"], reverse=True),
    }
    return data, new_state, archive


def main() -> int:
    cfg = load_yaml("radar.yaml")
    key = os.environ.get("OPENALEX_API_KEY", "").strip()
    if key:                     # in a header, never in the address (logs and redirects can't show it)
        http_mod.HOST_HEADERS["api.openalex.org"] = {"Authorization": f"Bearer {key}"}
    http = Http(intervals={"export.arxiv.org": 3.2, "api.openalex.org": 0.2, "phys.org": 1.0, "techxplore.com": 1.0}, retries=2)
    state = read_json(CACHE / "radar_state.json", {}) or {}
    archive = read_json(CACHE / "radar_archive.json", {}) or {}
    news_data = read_json(DATA / "news.json", {}) or {}
    news_archive = read_json(CACHE / "news_archive.json", {}) or {}
    data, state, archive = build(http, cfg, news_data, news_archive, state, archive, datetime.now(timezone.utc), bool(key))
    write_json(DATA / "radar.json", data)
    write_json(CACHE / "radar_state.json", state, compact=False)
    write_json(CACHE / "radar_archive.json", archive, compact=False)
    hot = [t["name"] for t in data["topics"] if t["momentum"]["status"] == "heating"]
    log(f"Radar: {len(data['topics'])} topics ({', '.join(hot) or 'none'} heating), {len(data['spotted'])} spotted, "
        f"{sum(len(t['developments']) for t in data['topics'])} developments")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
