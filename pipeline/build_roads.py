"""Roads job: Sierra chain controls from Caltrans → docs/data/roads.json (pipeline/roads.py).

Runs every half hour from October to May. The file changes only when a chain control does (and
every few hours anyway, to show the job is alive), so quiet days add few commits.

    python -m pipeline.build_roads
"""
from __future__ import annotations

from datetime import datetime, timezone

from . import roads
from .common import DATA, read_json, write_json
from .http import default_http, log


def main(http=None, now=None) -> int:
    http = http or default_http()
    now = now or datetime.now(timezone.utc)
    path = DATA / "roads.json"
    old = read_json(path, None)
    try:
        controls = roads.parse_controls(http.get_json(roads.CC_D3, {}))
    except Exception as exc:                      # keep the last file; the app shows how old it is
        log(f"Caltrans chain controls: FAILED ({type(exc).__name__}: {exc})"[:300])
        return 0
    log(f"Caltrans chain controls: {len(controls)} signs with controls on {', '.join(roads.ROUTES)}")
    snap = roads.snapshot(controls, old if isinstance(old, dict) else None, now)
    if snap is None:
        log("  unchanged, and checked recently: nothing to write")
        return 0
    write_json(path, snap)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
