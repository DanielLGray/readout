"""Config loading, query templating, file helpers."""
from __future__ import annotations

import gzip
import json
import re
import os
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
DATA = Path(os.environ.get("READOUT_DATA_DIR", ROOT / "docs" / "data"))
CACHE = Path(os.environ.get("READOUT_CACHE_DIR", ROOT / "cache"))


def load_base(name: str) -> dict:
    """A settings file as written, without the changes made in the app."""
    with open(CONFIG / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_yaml(name: str) -> dict:
    """A settings file, with the changes made in the app (config/overrides.json, pipeline/overrides.py)
    laid over it. If they can't be applied the job runs on the file alone, and says so."""
    cfg = load_base(name)
    if os.environ.get("READOUT_OVERRIDES", "on") == "off":
        return cfg
    from . import overrides as O
    key = next((k for k, v in O.FILES.items() if v == name), None)
    part = O.read(CONFIG).get(key) if key else None
    if not part:
        return cfg
    try:
        return O.apply(key, cfg, part)
    except Exception as exc:                      # never let a setting stop a job
        print(f"Settings from the app couldn't be applied to {name} ({type(exc).__name__}: {exc}); using the file alone", file=sys.stderr)
        return cfg


def _or(items: list[str]) -> str:
    return " OR ".join(items)


def fill(query: str, cfg: dict) -> str:
    """Replace {name} placeholders with the config block of that name: a list of journals is
    OR-ed together, text is used as is. An unknown placeholder is an error, never sent to PubMed."""
    def block(m: "re.Match") -> str:
        name = m.group(1)
        if name not in cfg:
            raise KeyError(f"query uses {{{name}}} but config has no block called {name!r}")
        v = cfg[name]
        return _or(v) if isinstance(v, list) else " ".join(str(v).split())
    out = query
    for _ in range(4):                      # blocks may use other blocks: {cardiac_terms} uses {tavr_terms}
        nxt = re.sub(r"\{([a-z_]+)\}", block, out)
        if nxt == out:
            break
        out = nxt
    return " ".join(out.split())


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def today() -> date:
    override = os.environ.get("READOUT_TODAY")
    return date.fromisoformat(override) if override else date.today()


def read_json(path: Path, default=None):
    try:
        if path.suffix == ".gz":
            with gzip.open(path, "rt", encoding="utf-8") as f:
                return json.load(f)
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path: Path, data, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    kw = {"separators": (",", ":")} if compact else {"indent": 2}
    if path.suffix == ".gz":
        with gzip.open(tmp, "wt", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, **kw)
    else:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, **kw)
    tmp.replace(path)
