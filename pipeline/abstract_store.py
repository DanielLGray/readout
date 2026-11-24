"""Abstracts kept beside the data files, split into small buckets by PMID, so the files the
app loads at launch stay light and an abstract is fetched only when you open it.

    docs/data/abstracts/f07.json   (feed papers whose PMID % 50 == 7)
    docs/data/abstracts/i07.json   (most-important papers)
"""
from __future__ import annotations

import json
from pathlib import Path

BUCKETS = 50


def bucket(pmid: str) -> int:
    return int(pmid) % BUCKETS


def load(folder: Path, prefix: str) -> dict[str, list]:
    out: dict[str, list] = {}
    for n in range(BUCKETS):
        p = folder / f"{prefix}{n:02d}.json"
        if p.exists():
            try:
                out.update(json.loads(p.read_text(encoding="utf-8")))
            except ValueError:
                continue
    return out


def save(folder: Path, prefix: str, sections: dict[str, list]) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    parts: list[dict] = [{} for _ in range(BUCKETS)]
    for pmid, secs in sections.items():
        parts[bucket(pmid)][pmid] = secs
    for n, part in enumerate(parts):
        text = json.dumps(dict(sorted(part.items())), ensure_ascii=False, separators=(",", ":"))
        (folder / f"{prefix}{n:02d}.json").write_text(text, encoding="utf-8")


def split_out(cards: list[dict], prefix: str) -> dict[str, list]:
    """Move each card's sections into the returned map; the card keeps a pointer (abs)."""
    out = {}
    for c in cards:
        secs = c.pop("sections", None)
        if secs:
            out[c["pmid"]] = secs
            c["abs"] = prefix
    return out
