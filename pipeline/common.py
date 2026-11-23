"""Config loading, query templating, file helpers."""
from __future__ import annotations

import gzip
import json
import os
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config"
DATA = Path(os.environ.get("READOUT_DATA_DIR", ROOT / "docs" / "data"))
CACHE = Path(os.environ.get("READOUT_CACHE_DIR", ROOT / "cache"))


def load_yaml(name: str) -> dict:
    with open(CONFIG / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _or(items: list[str]) -> str:
    return " OR ".join(items)


def fill(query: str, cfg: dict) -> str:
    """Replace {journals}, {body_filter}, … placeholders with config blocks."""
    repl = {
        "journals": _or(cfg.get("journals", [])),
        "nm_journals": _or(cfg.get("nm_journals", [])),
        "general_journals": _or(cfg.get("general_journals", [])),
        "body_filter": " ".join(cfg.get("body_filter", "").split()),
        "imaging_terms": " ".join(cfg.get("imaging_terms", "").split()),
        "exclude": " ".join(cfg.get("exclude", "").split()),
    }
    out = query
    for k, v in repl.items():
        out = out.replace("{" + k + "}", v)
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
