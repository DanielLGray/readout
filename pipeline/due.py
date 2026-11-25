"""Should this scheduled run do its work?

GitHub sometimes delays scheduled runs or drops them when it's busy, so each update job has backup
times. A scheduled run whose data is already fresh skips the work; a run started by hand always
does it.

    python3 -m pipeline.due docs/data/news.json 5       # due when 5+ hours old; writes run=true|false to $GITHUB_OUTPUT
    python3 -m pipeline.due docs/data/feed.json daily   # due once per UTC day, whenever the last run was
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone


def age_hours(path: str, now: datetime | None = None) -> float:
    """Hours since the data file was generated; infinite when it's missing or unreadable."""
    try:
        with open(path, encoding="utf-8") as f:
            g = json.load(f).get("generated", "")
        when = datetime.fromisoformat(str(g).replace("Z", "+00:00"))
    except (OSError, ValueError, AttributeError):
        return float("inf")
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - when).total_seconds() / 3600


def generated_day(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as f:
            return str(json.load(f).get("generated", ""))[:10]
    except (OSError, ValueError, AttributeError):
        return ""


def is_due(path: str, max_hours, event: str, now: datetime | None = None) -> bool:
    if event != "schedule":
        return True
    if max_hours == "daily":                     # not yet today (UTC): a run late last night doesn't skip today's
        return generated_day(path) != (now or datetime.now(timezone.utc)).date().isoformat()
    return age_hours(path, now) >= float(max_hours)


def main(argv: list[str]) -> int:
    path, max_hours = argv[1], argv[2]
    event = os.environ.get("GITHUB_EVENT_NAME", "")
    due = is_due(path, max_hours, event)
    age = age_hours(path)
    print(f"{path}: {'missing' if age == float('inf') else f'{age:.1f} hours old'}; "
          + ("updating" if due else "already updated, so this backup run skips"))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(f"run={'true' if due else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
