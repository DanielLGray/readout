"""Job settings changed from the phone (Tune → Updates → a job → Settings).

The commented settings files (config/*.yaml) stay as they are; what you change in the app is kept
in config/overrides.json and laid over them when a job loads its settings (common.load_yaml). Only
what SCHEMA lists can be changed, within its limits: numbers in a range, switches, choices, lists of
plain words (turned into patterns here, so no pattern from outside ever reaches a job), outlets,
topics and rules that already exist, and your own topics built from words. pipeline/settings.py
checks changes against this before saving them, and describes it all for the app
(docs/data/config.json).
"""
from __future__ import annotations

import copy
import json
import re
from typing import Any, Optional

FILES = {"news": "news.yaml", "watch": "watch.yaml", "radar": "radar.yaml", "horizon": "horizon.yaml"}
JOB_OF = {"news": "news", "watch": "watch", "radar": "radar", "horizon": "horizon"}     # the workflow (<job>.yml) that reads each
MAX_WORDS, MAX_WORD = 60, 60
_WORD = re.compile(r"^[^\x00-\x1f<>{}\\]{1,60}$")
_CODE = re.compile(r"^[A-Z0-9]{3}$")
PHASES = [("PHASE1", "Phase 1"), ("PHASE2", "Phase 2"), ("PHASE3", "Phase 3"), ("PHASE4", "Phase 4"), ("NA", "No phase (devices)")]


class OverrideError(ValueError):
    pass


def F(path: str, label: str, type: str, **kw) -> dict:
    return {"path": path, "label": label, "type": type, **kw}


# what the phone may change, file by file. Paths are into the YAML (a.b.c); a words field with
# "into" adds its words to that pattern, or with "list" to that list.
SCHEMA: dict[str, dict] = {
    "news": {
        "label": "News",
        "fields": [
            F("settings.top_stories.days", "Top stories: look back", "int", min=1, max=14, unit="days",
              help="The first card in the feed: stories from this many days."),
            F("settings.top_stories.min_outlets", "Top stories: publishers needed", "int", min=2, max=6,
              help="A story makes the card when this many different publishers ran it."),
            F("settings.top_stories.match", "Top stories: how alike headlines must be", "float", min=0.3, max=0.9, step=0.05,
              help="Two headlines count as one story above this likeness (0 to 1). Lower joins more."),
            F("settings.top_stories.per_kind", "Top stories kept per kind", "int", min=2, max=15),
            F("settings.keep_days", "Radiology industry stories kept", "int", min=14, max=365, unit="days"),
            F("settings.other_keep_days", "Health, science and sci-fi stories kept", "int", min=7, max=120, unit="days"),
            F("settings.kind_keep_days.societies", "ACR & societies stories kept", "int", min=14, max=365, unit="days"),
            F("settings.kind_keep_days.general", "U.S. & world news kept", "int", min=1, max=30, unit="days"),
            F("settings.kind_keep_days.business", "Business & markets kept", "int", min=1, max=30, unit="days"),
            F("settings.kind_keep_days.local", "Reno & Nevada kept", "int", min=3, max=120, unit="days"),
            F("local.places_more_reno", "Reno & Nevada: more Reno-area places", "words", list="local.places.reno",
              help="Names that put a story in the Reno area (as written, capitalized): a neighborhood, a town, a school."),
            F("local.places_more_nevada", "Reno & Nevada: more Nevada places", "words", list="local.places.nevada"),
            F("alerts.days", "Alerts: stories this recent", "int", min=2, max=14, unit="days"),
            F("alerts.outlets", "Alerts: independent sources needed", "int", min=1, max=4,
              help="A news alert needs this many independent sources, unless the FDA or a society says it itself."),
            F("alerts.max", "Alerts: at most at once", "int", min=1, max=6),
            F("alerts.agents_more", "FDA alerts: more agents and devices to watch for", "words", into="alerts.agents",
              help="Words that make an FDA story about imaging count, besides the built-in list of tracers and contrast agents."),
            F("alerts.societies_more", "Guideline alerts: more societies", "words", into="alerts.societies",
              help="Groups whose new guidelines count, besides ACR, SNMMI, SCCT, Fleischner and the rest."),
            F("exclude_more", "Never keep stories with these words", "words", into="exclude",
              help="On the job, for every outlet but industry and business news. Mute in Tune → Rules does this on the phone."),
        ],
        "lists": [
            {"key": "sources", "id": "name", "label": "Outlets", "group": "kind", "off": True,
             "fields": [F("max_per_day", "Kept a day", "int", min=1, max=60, empty="No limit", help="At most this many stories a day from it."),
                        F("everything_per_day", "In Everything a day", "int", min=0, max=20, default=2,
                          help="How many a day Everything shows at Tune's limit of 2; your limit moves it the same amount.")]},
        ],
    },
    "watch": {
        "label": "Watch",
        "fields": [
            F("settings.days", "Changes kept", "int", min=30, max=365, unit="days"),
            F("settings.readout_days", "Readouts ahead: look this far", "int", min=30, max=365, unit="days"),
            F("settings.pcd_shift_days", "A primary completion moved this much counts", "int", min=14, max=180, unit="days"),
            F("settings.results_alert", "Trial results that are alerts", "choice",
              options=[["phase3", "Phase 3 (and large device trials)"], ["phase2", "Phase 2 and 3"], ["none", "None"]], default="phase3"),
            F("devices.window_days", "FDA devices: look back", "int", min=30, max=180, unit="days"),
            F("devices.panels", "FDA 510(k) panels", "multi", options=[["RA", "Radiology"], ["CV", "Cardiovascular (many a month)"]]),
            F("devices.pma_codes", "PMA product codes to follow", "codes",
              help="FDA product codes whose new approvals and indications are alerts. NPT is transcatheter aortic valves."),
            F("devices.ai_words_more", "More words that mark a device as AI", "words", into="devices.ai_words"),
            F("drugs.window_days", "FDA drugs: look back", "int", min=30, max=180, unit="days"),
            F("drugs.agents_more", "More imaging agents to watch for", "words", into="drugs.agents",
              help="Drug names or ingredients, besides the radionuclides and contrast agents built in."),
        ],
        "lists": [
            {"key": "trials", "id": "id", "label": "Trial topics", "off": True,
             "fields": [F("phases", "Phases", "multi", options=[list(p) for p in PHASES]),
                        F("min_n", "Fewest patients", "int", min=0, max=5000, step=50),
                        F("device_readouts", "Large trials with no phase get a Coming up date", "bool"),
                        F("intr_more", "More treatments or tests to search for", "words", into_query="intr")],
             "add": {"label": "Add a trial topic", "builder": "trial",
                     "fields": [F("name", "Name", "text"), F("words", "Treatments or tests (any of these)", "words"),
                                F("phases", "Phases", "multi", options=[list(p) for p in PHASES], default=["PHASE2", "PHASE3"]),
                                F("min_n", "Fewest patients", "int", min=0, max=5000, step=50, default=0)]}},
            {"key": "rules", "id": "id", "label": "Rules and guidance", "off": True,
             "fields": [F("alert_on", "Final rules are alerts", "bool")]},
        ],
    },
    "radar": {
        "label": "Radar",
        "fields": [
            F("settings.days", "Developments listed per topic", "int", min=30, max=365, unit="days"),
            F("settings.max_auto", "Topics the job may add by itself", "int", min=0, max=20),
            F("settings.retire_months", "Retire an added topic that never heats up after", "int", min=3, max=36, unit="months"),
            F("settings.quiet_retire_months", "…or one with no headlines for", "int", min=2, max=24, unit="months"),
            F("spot.min_headlines", "Spotting: headlines needed", "int", min=2, max=12),
            F("spot.min_publishers", "Spotting: publishers needed", "int", min=1, max=6),
            F("spot.weeks_to_watch", "Spotting: weeks it must keep showing up", "int", min=1, max=10),
            F("spot.watch_within_weeks", "…within", "int", min=2, max=20, unit="weeks"),
            F("spot.max_candidates", "Spotting: candidates listed", "int", min=3, max=30),
            F("spot.skip_more", "Never topics", "words", into_anchored="spot.skip",
              help="Phrases the Radar should never turn into a topic."),
            F("credible", "Outlets that count alone at Early", "subset"),
        ],
        "lists": [
            {"key": "topics", "id": "id", "label": "Topics", "off": True, "fields": [F("words_more", "More words", "words", list="words")],
             "add": {"label": "Add a topic", "builder": "radar",
                     "fields": [F("name", "Name", "text"), F("words", "Words and names (any of these)", "words"),
                                F("require", "Must also mention one of (optional)", "words"),
                                F("exclude", "Never with (optional)", "words")]}},
        ],
    },
    "horizon": {
        "label": "Coming up",
        "fields": [
            F("days_ahead", "Look ahead", "int", min=90, max=400, step=10, unit="days"),
            F("launches.max", "Launches listed", "int", min=0, max=30),
            F("tmdb.max", "Movies listed", "int", min=0, max=50),
            F("tmdb.min_popularity", "Movies: least popularity", "int", min=0, max=200, step=5,
              help="TMDB's popularity score; raise it to leave out small releases."),
        ],
        "lists": [],
    },
}


# ── reading and writing paths ──────────────────────────────────────────────
def get_path(d: Any, path: str, default=None):
    for k in path.split("."):
        if not isinstance(d, dict) or k not in d:
            return default
        d = d[k]
    return d


def set_path(d: dict, path: str, value) -> None:
    keys = path.split(".")
    for k in keys[:-1]:
        if not isinstance(d.get(k), dict):
            d[k] = {}
        d = d[k]
    d[keys[-1]] = value


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-")[:40]


def _alt(words: list[str]) -> str:
    return "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True))


def word_pattern(words: list[str]) -> str:
    """Plain words → a pattern for whole words (and their plurals), any case, as the app's word lists match."""
    return r"(?i:(?<![\w-])(?:" + _alt(words) + r")(?:e?s)?(?![\w-]))"


def ct_terms(words: list[str]) -> str:
    """Words → a ClinicalTrials.gov search: each quoted, any of them."""
    return " OR ".join('"' + w.replace('"', "") + '"' for w in words)


# ── checking ───────────────────────────────────────────────────────────────
def _fields(name: str) -> dict:
    return {f["path"]: f for f in SCHEMA[name]["fields"]}


def _check_value(f: dict, v, base=None):
    t = f["type"]
    if t == "int":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or float(v) != int(v):
            raise OverrideError(f"{f['label']}: not a whole number")
        v = int(v)
        if not f["min"] <= v <= f["max"]:
            raise OverrideError(f"{f['label']}: {v} is outside {f['min']}–{f['max']}")
        return v
    if t == "float":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not f["min"] <= float(v) <= f["max"]:
            raise OverrideError(f"{f['label']}: outside {f['min']}–{f['max']}")
        return round(float(v), 3)
    if t == "bool":
        if not isinstance(v, bool):
            raise OverrideError(f"{f['label']}: not on or off")
        return v
    if t == "choice":
        if v not in [o[0] for o in f["options"]]:
            raise OverrideError(f"{f['label']}: not one of the choices")
        return v
    if t == "multi":
        ok = [o[0] for o in f["options"]]
        if not isinstance(v, list) or any(x not in ok for x in v):
            raise OverrideError(f"{f['label']}: not from the choices")
        return [x for x in ok if x in v]
    if t == "subset":
        ok = [str(x) for x in base or []]
        if not isinstance(v, list) or any(x not in ok for x in v):
            raise OverrideError(f"{f['label']}: only from the built-in list")
        return [x for x in ok if x in v]
    if t == "words":
        if not isinstance(v, list) or len(v) > MAX_WORDS:
            raise OverrideError(f"{f['label']}: at most {MAX_WORDS} words")
        out = []
        for w in v:
            w = " ".join(str(w).split()) if isinstance(w, str) else ""
            if not _WORD.match(w):
                raise OverrideError(f"{f['label']}: “{str(w)[:30]}” isn't a plain word or phrase")
            if w.lower() not in (x.lower() for x in out):
                out.append(w)
        return out
    if t == "codes":
        if not isinstance(v, list) or len(v) > 30 or any(not isinstance(c, str) or not _CODE.match(c.upper()) for c in v):
            raise OverrideError(f"{f['label']}: three-letter FDA product codes only")
        return sorted({c.upper() for c in v})
    if t == "text":
        v = " ".join(str(v).split()) if isinstance(v, str) else ""
        if not 1 <= len(v) <= 60 or not _WORD.match(v):
            raise OverrideError(f"{f['label']}: 1 to 60 plain characters")
        return v
    raise OverrideError(f"unknown kind of setting {t}")


def validate(doc, base_cfgs: dict) -> dict:
    """The overrides document the app sent → a clean one, or OverrideError saying what's wrong.
    base_cfgs: file name → its YAML as loaded (without overrides), to check names and ids exist."""
    if not isinstance(doc, dict) or doc.get("v") != 1:
        raise OverrideError("these aren't settings from the app")
    if len(json.dumps(doc)) > 60000:
        raise OverrideError("too many changes at once")
    out = {"v": 1}
    for name, part in doc.items():
        if name == "v":
            continue
        if name not in SCHEMA:
            raise OverrideError(f"unknown settings: {str(name)[:30]}")
        if not isinstance(part, dict):
            raise OverrideError(f"{name}: not settings")
        base = base_cfgs[name]
        fields, clean = _fields(name), {}
        sets = part.get("set") or {}
        if not isinstance(sets, dict):
            raise OverrideError(f"{name}: not settings")
        for path, v in sets.items():
            if path not in fields:
                raise OverrideError(f"{SCHEMA[name]['label']}: {str(path)[:40]} can't be changed here")
            if fields[path]["type"] == "int" and get_path(base, path) is None and not fields[path].get("default"):
                pass                                              # a setting the file doesn't have yet: fine, it's added
            clean.setdefault("set", {})[path] = _check_value(fields[path], v, get_path(base, path))
        lists = {L["key"]: L for L in SCHEMA[name]["lists"]}
        for key, items in (part.get("items") or {}).items():
            L = lists.get(key)
            if not L or not isinstance(items, dict):
                raise OverrideError(f"{SCHEMA[name]['label']}: {str(key)[:30]} can't be changed here")
            ids = {str(i.get(L["id"])): i for i in base.get(key) or [] if isinstance(i, dict)}
            lf = {f["path"]: f for f in L["fields"]}
            for iid, vals in items.items():
                if iid not in ids or not isinstance(vals, dict):
                    raise OverrideError(f"{L['label']}: no “{str(iid)[:40]}” to change")
                c = {}
                for k, v in vals.items():
                    if k == "off" and L.get("off"):
                        c["off"] = _check_value({"label": "Off", "type": "bool"}, v)
                    elif k in lf:
                        c[k] = _check_value(lf[k], v)
                    else:
                        raise OverrideError(f"{L['label']}: {str(k)[:30]} can't be changed here")
                if c:
                    clean.setdefault("items", {}).setdefault(key, {})[iid] = c
        for key, added in (part.get("add") or {}).items():
            L = lists.get(key)
            if not L or not L.get("add") or not isinstance(added, list) or len(added) > 12:
                raise OverrideError(f"{SCHEMA[name]['label']}: can't add to {str(key)[:30]} (at most 12)")
            af = {f["path"]: f for f in L["add"]["fields"]}
            seen = {str(i.get(L["id"])) for i in base.get(key) or [] if isinstance(i, dict)}
            for item in added:
                if not isinstance(item, dict) or set(item) - set(af):
                    raise OverrideError(f"{L['add']['label']}: unexpected fields")
                c = {k: _check_value(f, item[k]) if k in item else f.get("default") for k, f in af.items()}
                if not c.get("words"):
                    raise OverrideError(f"{L['add']['label']}: give at least one word")
                c = {k: v for k, v in c.items() if v is not None}
                iid = f"my-{slug(c['name'])}"
                if len(iid) < 4 or iid in seen:
                    raise OverrideError(f"{L['add']['label']}: “{c['name']}” is already a topic")
                seen.add(iid)
                clean.setdefault("add", {}).setdefault(key, []).append(c)
        if clean:
            out[name] = clean
    return out


# ── laying them over a job's settings ──────────────────────────────────────
def _build(builder: str, c: dict) -> dict:
    iid = f"my-{slug(c['name'])}"
    if builder == "trial":
        return {"id": iid, "name": c["name"], "intr": ct_terms(c["words"]), "phases": c.get("phases") or ["PHASE2", "PHASE3"],
                "min_n": int(c.get("min_n") or 0), "mine": True}
    if builder == "radar":
        t = {"id": iid, "name": c["name"], "words": list(c["words"]), "mine": True}
        if c.get("require"):
            t["require"] = word_pattern(c["require"])
        if c.get("exclude"):
            t["exclude"] = word_pattern(c["exclude"])
        return t
    raise OverrideError(builder)


def apply(name: str, cfg: dict, part: Optional[dict]) -> dict:
    """A job's settings with your changes laid over them (a copy; the original is left alone)."""
    if not part or name not in SCHEMA:
        return cfg
    cfg = copy.deepcopy(cfg)
    fields = _fields(name)
    for path, v in (part.get("set") or {}).items():
        f = fields.get(path)
        if not f:
            continue
        if f["type"] == "words":
            if not v:
                continue
            if f.get("into"):
                old = get_path(cfg, f["into"]) or ""
                set_path(cfg, f["into"], f"{old}|{word_pattern(v)}" if old else word_pattern(v))
            elif f.get("into_anchored"):
                old = get_path(cfg, f["into_anchored"]) or ""
                new = "^(?:" + _alt([w.lower() for w in v]) + ")$"
                set_path(cfg, f["into_anchored"], f"{new}|{old}" if old else new)
            elif f.get("list"):
                set_path(cfg, f["list"], list(get_path(cfg, f["list"]) or []) + v)
        else:
            set_path(cfg, path, v)
    for L in SCHEMA[name]["lists"]:
        key = L["key"]
        items = list(cfg.get(key) or [])
        changes = (part.get("items") or {}).get(key) or {}
        lf = {f["path"]: f for f in L["fields"]}
        kept = []
        for it in items:
            ch = changes.get(str(it.get(L["id"]))) if isinstance(it, dict) else None
            if not ch:
                kept.append(it)
                continue
            if ch.get("off"):
                continue
            it = dict(it)
            for k, v in ch.items():
                f = lf.get(k)
                if not f:
                    continue
                if k == "alert_on":                       # a rule's final rules: alerts or not
                    if not v:
                        it.pop("alert", None)
                    elif not it.get("alert"):
                        it["alert"] = "."
                elif f["type"] == "words" and f.get("into_query"):
                    if v:
                        q = it.get(f["into_query"]) or it.get("term") or ""
                        it[f["into_query"] if it.get(f["into_query"]) or not it.get("term") else "term"] = f"({q}) OR {ct_terms(v)}" if q else ct_terms(v)
                elif f["type"] == "words" and f.get("list"):
                    if v:
                        it[f["list"]] = list(it.get(f["list"]) or []) + v
                else:
                    it[k] = v
            kept.append(it)
        for c in (part.get("add") or {}).get(key) or []:
            kept.append(_build(L["add"]["builder"], c))
        if key in cfg or kept:
            cfg[key] = kept
    return cfg


def read(config_dir) -> dict:
    """config/overrides.json, or {} (missing or damaged: the jobs run on their files alone)."""
    try:
        with open(config_dir / "overrides.json", encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) and d.get("v") == 1 else {}
    except (OSError, ValueError):
        return {}
