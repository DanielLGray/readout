"""Job settings changed in the app → config/overrides.json, and what the app can change → docs/data/config.json

    python -m pipeline.settings          (CHANGES: the settings the app sent, as JSON; optional)

Run by .github/workflows/settings.yml when the app sends changes (Tune → Updates), and whenever a
settings file changes on GitHub, so the app always shows what the files say. Changes are checked
against pipeline/overrides.py's SCHEMA before anything is saved; a problem is reported to the app
(docs/data/config.json, "last") and nothing changes.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

from . import overrides as O
from .common import CONFIG, DATA, load_base, now_iso, read_json, write_json


def fingerprint(doc: dict) -> str:
    return hashlib.sha256(json.dumps({k: v for k, v in doc.items() if k != "at"}, sort_keys=True).encode()).hexdigest()[:16]


def _host(url: str) -> str:
    m = re.match(r"https?://(?:www\.)?([^/]+)", str(url or ""))
    return m[1] if m else ""


def _trial_sub(t: dict) -> str:
    q = t.get("intr") or t.get("term") or t.get("cond") or ""
    return re.sub(r"\s+", " ", q)[:140]


def describe(base: dict, current: dict) -> dict:
    """Everything the app can change, with what the settings files say (base)."""
    files = {}
    kinds = (base["news"].get("kinds") or {})
    for name, sch in O.SCHEMA.items():
        cfg = base[name]
        fields = []
        for f in sch["fields"]:
            b = O.get_path(cfg, f["path"])
            if f["type"] == "words":
                b = []
            elif b is None:
                b = f.get("default")
            fields.append({**f, "base": b})
        lists = []
        for L in sch["lists"]:
            items = []
            for it in cfg.get(L["key"]) or []:
                if not isinstance(it, dict) or not it.get(L["id"]):
                    continue
                b = {}
                for f in L["fields"]:
                    if f["path"] == "alert_on":
                        b["alert_on"] = bool(it.get("alert"))
                    elif f["type"] == "words":
                        b[f["path"]] = []
                    else:
                        v = it.get(f["path"])
                        b[f["path"]] = f.get("default") if v is None else v
                row = {"id": str(it[L["id"]]), "label": str(it.get("name") or it[L["id"]]), "base": b}
                if name == "news":
                    row["group"] = kinds.get(it.get("kind") or "industry", it.get("kind") or "industry")
                    row["sub"] = _host(it.get("home") or (it.get("urls") or [""])[0])
                elif name == "watch" and L["key"] == "trials":
                    row["sub"] = _trial_sub(it)
                elif name == "radar":
                    row["sub"] = ", ".join(str(w) for w in (it.get("words") or [])[:6])
                items.append(row)
            lists.append({k: v for k, v in L.items() if k != "group"} | {"items": items})
        files[name] = {"label": sch["label"], "job": O.JOB_OF[name], "file": O.FILES[name], "fields": fields, "lists": lists}
    return files


def changed_jobs(old: dict, new: dict) -> list[str]:
    return sorted({O.JOB_OF[k] for k in O.SCHEMA if json.dumps(old.get(k), sort_keys=True) != json.dumps(new.get(k), sort_keys=True)})


def compile_check(base: dict, doc: dict) -> None:
    """Lay the changes over each file and compile every pattern they touch, so a job never meets one
    that doesn't work."""
    for name in O.SCHEMA:
        cfg = O.apply(name, base[name], doc.get(name))
        pats = [O.get_path(cfg, p) for p in ("alerts.agents", "alerts.societies", "exclude", "devices.ai_words", "drugs.agents", "spot.skip")]
        pats += [t.get(k) for t in cfg.get("topics") or [] if isinstance(t, dict) for k in ("require", "exclude")]
        for p in pats:
            if isinstance(p, str) and p:
                re.compile(p)


def run(changes: str, config_dir=CONFIG, data_dir=DATA, now: datetime | None = None) -> dict:
    base = {k: load_base(v) if config_dir == CONFIG else _load(config_dir / v) for k, v in O.FILES.items()}
    current = O.read(config_dir)
    old_out = read_json(data_dir / "config.json", {}) or {}
    last, jobs = old_out.get("last"), []
    if changes:
        try:
            try:
                doc = json.loads(changes)
            except ValueError:
                raise O.OverrideError("they aren't the text the app sent")
            clean = O.validate(doc, base)
            compile_check(base, clean)
            jobs = changed_jobs(current, clean)
            clean["at"] = now_iso()
            if len(clean) > 2:
                write_json(config_dir / "overrides.json", clean)
            elif (config_dir / "overrides.json").exists():
                (config_dir / "overrides.json").unlink()            # everything back to the files
            current = clean if len(clean) > 2 else {}
            last = {"at": now_iso(), "ok": True, "sig": fingerprint(clean), "jobs": jobs}
            print(f"Settings saved; jobs to run: {', '.join(jobs) or 'none'}")
        except (O.OverrideError, re.error) as exc:
            last = {"at": now_iso(), "ok": False, "error": f"Not saved: {exc}"}
            print(f"Settings not saved: {exc}", file=sys.stderr)
    out = {"generated": now_iso(), "overrides": current or {"v": 1}, "sig": fingerprint(current or {"v": 1}),
           "files": describe(base, current)}
    if last:
        out["last"] = last
    write_json(data_dir / "config.json", out)
    return {"jobs": jobs, "last": last}


def _load(path):
    import yaml
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def main() -> int:
    r = run(os.environ.get("CHANGES", "").strip())
    gho = os.environ.get("GITHUB_OUTPUT")
    if gho:
        ok = [j for j in r["jobs"] if j in O.JOB_OF.values()]
        with open(gho, "a", encoding="utf-8") as f:
            f.write(f"jobs={' '.join(ok)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
