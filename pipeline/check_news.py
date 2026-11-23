"""Report which feed address each news outlet is using (or why none works).

    python -m pipeline.check_news
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from .build_news import fetch_source, news_http
from .common import load_yaml


def main(http=None) -> str:
    cfg = load_yaml("news.yaml")
    http = http or news_http()
    now = datetime.now(timezone.utc)
    lines = ["| outlet | stories | newest | address used / problems |", "|---|---|---|---|"]
    for src in cfg.get("sources", []):
        items, st = fetch_source(http, src, now)
        detail = st["url"] if st["ok"] else "; ".join(st["tried"])[:300]
        lines.append(f"| {src['name']} | {st['count']} | {(st['newest'] or '')[:10]} | {detail} |")
    report = "\n".join(lines)
    print(report)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("### Readout news feeds\n\n" + report + "\n")
    return report


if __name__ == "__main__":
    main()
