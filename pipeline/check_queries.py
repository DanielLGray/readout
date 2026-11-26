"""Sanity-check every query in config/ against live PubMed.

    python -m pipeline.check_queries

Prints how many papers each stream/topic matches and any PubMed warnings
(e.g. a quoted phrase PubMed doesn't recognise). Run it after editing the
YAML files. In GitHub Actions the table also lands in the run summary."""
from __future__ import annotations

import os
from datetime import timedelta

from .common import fill, load_yaml, today
from .http import default_http
from .pubmed import PubMed


def main(http=None) -> str:
    cfg, tcfg = load_yaml("feeds.yaml"), load_yaml("topics.yaml")
    pm = PubMed(http or default_http())
    t = today()
    rows = []
    for s in cfg["streams"]:
        q = fill(s["query"], cfg)
        n = pm.esearch(q, datetype="edat", reldate=30)[0]
        rows.append(("stream", s["id"], f"{n} in last 30 days", "; ".join(pm.warnings.get(q, []))))
    # journal coverage: how much of each journal the body filter keeps (last 45 days)
    body = " ".join(cfg.get("body_filter", "").split())
    for key in ("journals", "nm_journals", "general_journals"):
        for j in cfg.get(key, []):
            total = pm.esearch(j, datetype="edat", reldate=45)[0]
            kept = pm.esearch(f"({j}) AND ({body})", datetype="edat", reldate=45)[0]
            rows.append(("journal", j.split('"')[1] if '"' in j else j,
                         f"{kept} of {total} kept (45 days)", ""))
    # alerts should be rare: how many each guideline search found in the last two years
    for r in (cfg.get("alerts") or {}).get("rules", []):
        q = " ".join(r["query"].split())
        try:
            n = pm.count(q, t - timedelta(days=730), t, datetype="edat")
        except Exception as exc:       # a search PubMed rejects shows here instead of stopping the check
            rows.append(("alert", r["id"], "rejected", str(exc)[:120]))
            continue
        flag = " ⚠ too many for an alert" if n > 60 else " ⚠ none" if n == 0 else ""
        rows.append(("alert", r["id"], f"{n} in 2 years{flag}", "; ".join(pm.warnings.get(q, []))))
    w = cfg.get("wide") or {}
    if w.get("query"):
        q = fill(w["query"], cfg)
        n = pm.count(q, t - timedelta(days=round(30.44 * float(w.get("months", 6)))), t)
        rows.append(("wide", "outside your areas", f"{n} in {w.get('months', 6)} months", "; ".join(pm.warnings.get(q, []))))
    for tp in tcfg["topics"]:
        q = " ".join(tp["query"].split())
        n = pm.count(q, t - timedelta(days=1825), t)
        flag = " ⚠ very few" if n < 40 else ""
        rows.append(("topic", tp["id"], f"{n} in 5 years{flag}", "; ".join(pm.warnings.get(q, []))))
    lines = ["| kind | id | papers | PubMed notes |", "|---|---|---|---|"]
    lines += [f"| {a} | {b} | {c} | {d} |" for a, b, c, d in rows]
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Readout query check\n\n" + report + "\n")
    return report


if __name__ == "__main__":
    main()
