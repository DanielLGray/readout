"""Rare, high-bar alerts, pinned at the top of Everything and Today for a week.

News (the news job): FDA approvals and safety warnings for radiopharmaceuticals and imaging
agents, and guideline changes from the USPSTF, the American Cancer Society and the imaging and
cardiac societies. A story counts only when at least two outlets carry it (sister outlets count
once) or a primary source does (the FDA itself, a society's own feed).

Papers (the papers job): the guideline itself in PubMed: USPSTF recommendation statements,
American Cancer Society guidelines in CA, Fleischner, SNMMI and EANM, SCCT, ACR and SAR, ACC/AHA,
ESC and AASLD. A published statement is its own primary source.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Optional

from . import news


def _fill(pattern: str, cfg: dict) -> str:
    return re.sub(r"\{(\w+)\}", lambda m: str(cfg.get(m.group(1), m.group(0))), pattern)


def compile_rules(cfg: dict) -> list[dict]:
    """Each rule: every `title` pattern must match the headline, every `text` pattern the
    headline or its summary."""
    out = []
    for r in cfg.get("rules") or []:
        out.append({"id": r["id"], "group": r.get("group", r["id"]), "label": r.get("label", r["id"]),
                    "title": [re.compile(_fill(p, cfg), re.I) for p in r.get("title") or []],
                    "text": [re.compile(_fill(p, cfg), re.I) for p in r.get("text") or []]})
    return out


def rule_for(item: dict, rules: list[dict]) -> Optional[dict]:
    title = item.get("title", "")
    text = f"{title} {item.get('summary', '')}"
    for r in rules:
        if all(p.search(title) for p in r["title"]) and all(p.search(text) for p in r["text"]):
            return r
    return None


def news_alerts(items: list[dict], cfg: dict, now: datetime, group_of: Optional[dict] = None) -> list[dict]:
    """Stories from the last week that match a rule and that enough outlets (or a primary
    source) carry. One alert per story, keyed by its first headline so it keeps its id as more
    outlets pick it up."""
    a = cfg.get("alerts") or {}
    rules = compile_rules(a)
    if not rules:
        return []
    group_of = group_of or {}
    days = int(a.get("days", 7))
    need = int(a.get("outlets", 2))
    primary = set(a.get("primary") or [])
    cutoff = news._utc(now - timedelta(days=days))
    recent = [i for i in items if i.get("date", "") >= cutoff]
    hits = [(i, r) for i in recent for r in [rule_for(i, rules)] if r]
    if not hits:
        return []
    clusters = news.top_stories(recent, now, days=days, limit=10 ** 6, group_of=group_of, min_outlets=1)
    where = {iid: c for c in clusters for iid in c["items"]}
    by_id = {i["id"]: i for i in recent}
    out: dict[str, dict] = {}
    for it, r in sorted(hits, key=lambda h: h[0]["date"]):
        c = where.get(it["id"]) or {"sources": [it["source"]], "items": [it["id"]], "date": it["date"]}
        srcs = sorted(set(c["sources"]))
        groups = {group_of.get(s, s) for s in srcs}
        if len(groups) < need and not (primary & set(srcs)):
            continue
        members = [by_id[x] for x in c["items"] if x in by_id]
        first = min(members, key=lambda i: i["date"]) if members else it
        key = f"n:{first['id']}"
        if key in out:
            continue
        # the headline that names the agency or the guideline, from the primary source if there is one
        lead = next((m for m in members if m["source"] in primary and rule_for(m, rules)), it)
        out[key] = {"id": key, "rule": r["id"], "group": r["group"], "label": r["label"], "title": lead["title"],
                    "date": first["date"], "updated": c.get("date", it["date"]), "sources": srcs,
                    "items": c["items"], "link": lead.get("link", ""), "via": "news"}
    alerts = sorted(out.values(), key=lambda x: x["date"], reverse=True)
    return alerts[: int(a.get("max", 3))]


# ── guidelines in PubMed ─────────────────────────────────────────────────────
def _norm_title(t: str) -> str:
    """Joint guidelines appear several times (JACC and Circulation, plus an executive summary)."""
    t = re.sub(r"(?i)\bexecutive summary\b|\[[^\]]*\]", " ", t)
    t = t.split(":")[0]
    return re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()


def paper_alerts(pm, cfg: dict, today: date, prev: list[dict], to_card, compiled, is_notice) -> list[dict]:
    """New guideline and recommendation papers from the configured PubMed searches; each stays
    `days` days from the day PubMed listed it."""
    a = cfg.get("alerts") or {}
    rules = a.get("rules") or []
    if not rules:
        return []
    days = int(a.get("days", 7))
    look = int(a.get("lookback", 14))
    seen_before = {x.get("pmid"): x for x in prev or [] if x.get("pmid")}
    found: dict[str, dict] = {}
    for r in rules:
        try:
            _, ids = pm.esearch(" ".join(r["query"].split()), datetype="edat", reldate=look, retmax=20)
        except Exception:            # one rejected search shouldn't sink the others
            continue
        for p in ids:
            found.setdefault(p, r)
    if not found:
        return []
    out, titles = [], set()
    for rec in sorted(pm.fetch(found.keys()), key=lambda r: r.get("added") or "", reverse=False):
        if is_notice(rec):
            continue
        r = found[rec["pmid"]]
        card = to_card(rec, compiled)
        nt = _norm_title(card.get("title", ""))
        if nt in titles:
            continue
        titles.add(nt)
        old = seen_before.get(rec["pmid"])
        when = (old or {}).get("date") or card.get("added") or today.isoformat()
        try:
            if (today - date.fromisoformat(when[:10])).days > days:
                continue
        except ValueError:
            continue
        card.setdefault("areas", [])
        out.append({"id": f"p:{rec['pmid']}", "rule": r["id"], "group": r.get("group", "societies"),
                    "label": r.get("label", r["id"]), "title": card.get("title", ""), "date": when[:10],
                    "pmid": rec["pmid"], "journal": card.get("journal", ""), "via": "pubmed", "card": card})
    out.sort(key=lambda x: x["date"], reverse=True)
    return out[: int(a.get("max", 4))]
