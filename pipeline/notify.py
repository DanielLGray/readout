"""Alerts as phone notifications (Web Push) → docs/data/notify.json (and cache/notified.json)

    python -m pipeline.notify [--test]

The PUSH_SETUP secret holds what the phone made in Tune → Rules → Alerts: its push subscription
(an address at Apple's push service, and the keys that encrypt messages to it) and the private key
the phone made to sign them. After each news, papers or watch update this sends every alert it
hasn't sent before, once, unless your choices in the app leave it out (an alert kind turned off,
a word hidden from alerts, a topic filter, a Watch item rated Hide or Less). Those choices come sealed with a key
made from the signing key: in the setup, and newer ones when the app starts this job (CHOICES).
Only the sealed copy is kept (cache/alert-rules.json), so the public repository can't read them. Nothing else leaves the job: the alert's label and headline, encrypted,
go only to the push service in the subscription. docs/data/notify.json tells the app how it went
(no addresses or keys in it).
"""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from urllib.parse import urlparse

from .common import CACHE, DATA, now_iso, read_json, write_json
from .http import log
from .watch_features import features as watch_features

PUSH_HOSTS = re.compile(r"(?:^|\.)(?:push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$")
_B64U = re.compile(r"^[A-Za-z0-9_-]+$")
CONTACT = "https://daniellgray.github.io"               # who sends, for the push service: the app's own site (no email needed)
GROUP_OF_KIND = {"trial": "trials", "rule": "rules", "drug": "fda", "device": "fda"}
LABEL_OF_KIND = {"trial": "Trial results", "rule": "Federal rule", "drug": "FDA", "device": "FDA"}
MAX_EACH = 3                                             # more new alerts than this in one go: the rest as one summary


class SetupError(ValueError):
    pass


class ChoicesError(ValueError):
    pass


# ── your choices in the app: sealed there, opened here ─────────────────────
_FEATURE = re.compile(r"^(?:wk|wt|wc|wp|wo|wa|wph):[^\x00-\x1f]{1,100}$")
_NCT = re.compile(r"^NCT\d{8}$")
SALT, INFO = b"readout-choices", b"v1"           # the app's sealChoices uses the same


def _unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def clean_choices(d) -> dict:
    """Only what the app can choose, in the shapes it uses."""
    if not isinstance(d, dict) or d.get("v") != 1:
        raise ChoicesError("they aren't choices from the app")
    taste = {}
    for k, v in list((d.get("taste") or {}).items())[:800] if isinstance(d.get("taste"), dict) else []:
        if isinstance(k, str) and _FEATURE.match(k) and isinstance(v, int) and not isinstance(v, bool) and v in (-2, -1, 0, 1):
            taste[k] = v
    strs = lambda x, n: [y for y in x if isinstance(y, str)][:n] if isinstance(x, list) else []
    return {"at": str(d.get("at") or "")[:40], "sig": re.sub(r"[^0-9a-z]", "", str(d.get("sig") or ""))[:40],
            "groups": [g for g in strs(d.get("groups"), 30) if re.fullmatch(r"[a-z_]{1,20}", g)],
            "taste": taste, "words": [w.strip()[:60] for w in strs(d.get("words"), 200) if w.strip()],
            "off": [k for k in strs(d.get("off"), 10) if k in GROUP_OF_KIND],
            "topics": [t for t in strs(d.get("topics"), 100) if re.fullmatch(r"[a-z0-9-]{1,40}", t)],
            "follow": [n for n in strs(d.get("follow"), 100) if _NCT.match(n)],
            "rules": [r for r in (_clean_rule(x) for x in (d.get("rules") or [])[:12] if isinstance(d.get("rules"), list)) if r]}


def _clean_rule(r) -> Optional[dict]:
    """A topic filter as the app sends it: the words for the subject (h, any case; hc, exact case)
    and the words that keep an alert anyway (k, kc)."""
    if not isinstance(r, dict):
        return None
    terms = lambda x: [w.strip() for w in x if isinstance(w, str) and w.strip() and len(w) <= 60][:150] if isinstance(x, list) else []
    out = {k: terms(r.get(k)) for k in ("h", "hc", "k", "kc")}
    return out if out["h"] or out["hc"] else None


def open_choices(key: str, sealed: str) -> dict:
    """AES-GCM with a key derived (HKDF-SHA256) from the phone's signing key: iv (12 bytes) + ciphertext."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    if not isinstance(sealed, str) or not _B64U.match(sealed) or not 40 <= len(sealed) <= 40000:
        raise ChoicesError("they aren't the text the app copied")
    raw = _unb64u(sealed)
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=SALT, info=INFO).derive(_unb64u(key))
    try:
        d = json.loads(AESGCM(k).decrypt(raw[:12], raw[12:], None).decode("utf-8"))
    except Exception:
        raise ChoicesError("they were made for a different setup, or damaged")
    return clean_choices(d)


def word_re(words: list[str]) -> "Optional[re.Pattern]":
    """The app's wordRe: whole words (and plurals), or any ending with a trailing *."""
    parts = []
    for x in words or []:
        x = str(x).strip()
        star = x.endswith("*")
        core = (x[:-1] if star else x).strip()
        if core:
            parts.append(re.escape(core) if star else re.escape(core) + r"(?:e?s)?(?![^\W_])")
    return re.compile(r"(?:^|[\W_])(?:" + "|".join(parts) + ")", re.I) if parts else None


def caps_re(words: list[str]) -> "Optional[re.Pattern]":
    """Whole words in exact case: abbreviations and brand names (the app's termSet)."""
    parts = [re.escape(w) for w in words or [] if w]
    return re.compile(r"(?:^|[\W_])(?:" + "|".join(parts) + r")(?![^\W_])") if parts else None


def topic_rules(choices: Optional[dict]) -> list:
    """Each topic filter as (subject patterns, keep patterns)."""
    out = []
    for r in (choices or {}).get("rules") or []:
        hide = [p for p in (word_re(r["h"]), caps_re(r["hc"])) if p]
        keep = [p for p in (word_re(r["k"]), caps_re(r["kc"])) if p]
        if hide:
            out.append((hide, keep))
    return out


def topic_hidden(a: dict, rules: list) -> bool:
    """As in the app: about the subject when the headline names it, or the text does twice;
    kept when it mentions any of the filter's exceptions."""
    head = a["title"]
    body = a.get("text") or ""
    body = "" if body == head else body
    for hide, keep in rules:
        about = any(p.search(head) for p in hide) or sum(len(p.findall(body)) for p in hide) >= 2
        if about and not any(p.search(f"{head} {body}") for p in keep):
            return True
    return False


def left_out(a: dict, choices: Optional[dict], words: "Optional[re.Pattern]", rules: Optional[list] = None) -> bool:
    """Whether your choices keep this alert out of the app, so out of notifications too."""
    if not choices:
        return False
    if choices["groups"] and a.get("group") and a["group"] not in choices["groups"]:
        return True
    if words and words.search(a.get("text") or a["title"]):
        return True
    if a.get("nct") and a["nct"] in choices["follow"]:
        return False
    if rules and topic_hidden(a, rules):
        return True
    if a.get("feats") is None:
        return False
    if a.get("kind") in choices["off"] or a.get("topic") in choices["topics"]:
        return True
    w = [choices["taste"].get(f, 0) for f in a["feats"]]
    return -2 in w or sum(w) < 0


def parse_setup(raw: str) -> dict:
    """Check what was pasted into PUSH_SETUP before using any of it."""
    try:
        d = json.loads(raw)
    except ValueError:
        raise SetupError("it isn't the text the app copied (not JSON)")
    if not isinstance(d, dict) or d.get("v") != 1:
        raise SetupError("it isn't the text the app copied")
    sub = d.get("sub") if isinstance(d.get("sub"), dict) else {}
    endpoint = str(sub.get("endpoint") or "")
    u = urlparse(endpoint)
    if u.scheme != "https" or not u.hostname or not PUSH_HOSTS.search(u.hostname) or len(endpoint) > 1000:
        raise SetupError("its push address isn't at a known push service")
    keys = sub.get("keys") if isinstance(sub.get("keys"), dict) else {}
    p256dh, auth = str(keys.get("p256dh") or ""), str(keys.get("auth") or "")
    if not (_B64U.match(p256dh) and 80 <= len(p256dh) <= 100 and _B64U.match(auth) and 16 <= len(auth) <= 32):
        raise SetupError("its subscription keys are missing or damaged")
    key = str(d.get("key") or "")
    if not (_B64U.match(key) and len(key) == 43):
        raise SetupError("its signing key is missing or damaged")
    groups = [g for g in d.get("groups") or [] if isinstance(g, str) and re.fullmatch(r"[a-z_]{1,20}", g)]
    choices = d.get("choices") if isinstance(d.get("choices"), str) else ""
    return {"sub": {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}, "key": key, "groups": groups,
            "host": u.hostname, "choices": choices}


def _day(s: str) -> str:
    return str(s or "")[:10]


def current_alerts(data_dir, now: datetime, days: int = 7) -> list[dict]:
    """This week's alerts, as the app shows them: news, guideline papers and major Watch changes."""
    cut = (now - timedelta(days=days)).date().isoformat()
    out = []
    for name in ("news", "feed"):
        for a in (read_json(data_dir / f"{name}.json", {}) or {}).get("alerts") or []:
            if isinstance(a, dict) and a.get("id") and a.get("title") and _day(a.get("date")) >= cut:
                out.append({"id": str(a["id"]), "title": str(a["title"]), "label": str(a.get("label") or "Alert"),
                            "group": str(a.get("group") or ""), "date": _day(a.get("date")), "text": str(a["title"])})
    for e in (read_json(data_dir / "watch.json", {}) or {}).get("events") or []:
        if isinstance(e, dict) and e.get("level") == "alert" and e.get("id") and e.get("title") and _day(e.get("seen") or e.get("date")) >= cut:
            title = f"{e['acr']}: {e['title']}" if e.get("acr") else str(e["title"])
            out.append({"id": f"w-{e['id']}", "title": f"{title} ({e.get('what', '')})".replace(" ()", ""),
                        "label": LABEL_OF_KIND.get(e.get("kind"), "Watch"), "group": GROUP_OF_KIND.get(e.get("kind"), ""),
                        "date": _day(e.get("seen") or e.get("date")), "text": f"{e.get('acr') or ''} {e['title']}",
                        "feats": watch_features(e), "kind": e.get("kind"), "topic": e.get("topic"), "nct": e.get("nct") or ""})
    return sorted(out, key=lambda a: a["date"], reverse=True)


def plan(alerts: list[dict], state: dict, groups: list[str], now: datetime, choices: Optional[dict] = None) -> "tuple[list[dict], dict]":
    """Which messages to send, and the state to keep. The first run only learns what's there."""
    sent = dict(state.get("sent") or {})
    today = now.date().isoformat()
    first = not state.get("started")
    words = word_re(choices["words"]) if choices else None
    rules = topic_rules(choices)
    if choices and choices["groups"]:
        groups = choices["groups"]                     # newer than the ones in the setup
    new = [a for a in alerts if a["id"] not in sent and (not groups or not a["group"] or a["group"] in groups)
           and not left_out(a, choices, words, rules)]
    for a in alerts:
        sent.setdefault(a["id"], today)
    msgs = []
    if not first:
        for a in new[:MAX_EACH if len(new) <= MAX_EACH else MAX_EACH - 1]:
            msgs.append({"title": f"Readout · {a['label']}", "body": a["title"][:240], "url": "./#alerts", "tag": a["id"][:60]})
        if len(new) > MAX_EACH:
            rest = len(new) - (MAX_EACH - 1)
            msgs.append({"title": "Readout · Alerts", "body": f"{rest} more new alerts this week", "url": "./#alerts", "tag": "alerts"})
    cut = (now - timedelta(days=60)).date().isoformat()
    return msgs, {**state, "started": state.get("started") or today, "sent": {k: v for k, v in sent.items() if v >= cut}}


def web_push(setup: dict, message: dict) -> int:
    """Encrypt and send one message; the push service's answer (201 is sent)."""
    from pywebpush import WebPushException, webpush          # only this job installs it
    try:
        r = webpush(subscription_info=setup["sub"], data=json.dumps(message), vapid_private_key=setup["key"],
                    vapid_claims={"sub": CONTACT, "exp": int(time.time()) + 12 * 3600}, ttl=24 * 3600, timeout=20)
        return int(getattr(r, "status_code", 201))
    except WebPushException as exc:
        return int(getattr(getattr(exc, "response", None), "status_code", 0) or 0)


def pick_choices(setup: dict, sent_now: str, cache_dir) -> "tuple[Optional[dict], str]":
    """The newest of: the choices in the setup, the ones kept from an earlier run, and the ones the app
    just sent (kept, sealed, for later runs). A problem with the ones just sent is reported, not fatal."""
    found, error = [], ""
    kept = (read_json(cache_dir / "alert-rules.json", {}) or {}).get("sealed") or ""
    for where, sealed in (("setup", setup.get("choices") or ""), ("kept", kept), ("sent", sent_now)):
        if not sealed:
            continue
        try:
            found.append((open_choices(setup["key"], sealed), where, sealed))
        except ChoicesError as exc:
            if where == "sent":
                error = f"The choices the app sent couldn't be used: {exc}. Copy the setup again from Tune → Rules → Alerts."
    if not found:
        return None, error
    best = max(found, key=lambda x: (x[0]["at"], x[1] == "sent"))
    if best[1] == "sent":
        write_json(cache_dir / "alert-rules.json", {"sealed": best[2]})
    return best[0], error


def run(raw: str, test: bool, now: Optional[datetime] = None, data_dir=DATA, cache_dir=CACHE,
        sender: Callable[[dict, dict], int] = web_push, sent_choices: str = "") -> dict:
    now = now or datetime.now(timezone.utc)
    if not (cache_dir / "alert-rules.json").exists():
        write_json(cache_dir / "alert-rules.json", {})   # always there, so the workflow can save it with the rest
    status = read_json(data_dir / "notify.json", {}) or {}
    status = {k: status[k] for k in ("sent_total", "last_sent") if k in status}
    try:
        setup = parse_setup(raw)
    except SetupError as exc:
        status.update({"generated": now_iso(), "ok": False, "error": f"PUSH_SETUP couldn't be used: {exc}. Copy it again from Tune → Rules → Alerts."})
        write_json(data_dir / "notify.json", status)
        return status
    choices, choices_error = pick_choices(setup, sent_choices, cache_dir)
    state = read_json(cache_dir / "notified.json", {}) or {}
    msgs, state = plan(current_alerts(data_dir, now), state, setup["groups"], now, choices)
    if test:
        msgs.insert(0, {"title": "Readout", "body": "Notifications are on: new alerts will show here.", "url": "./#alerts", "tag": "test"})
    sent, error, expired = 0, "", False
    for m in msgs:
        code = sender(setup, m)
        if 200 <= code < 300:
            sent += 1
        elif code in (404, 410):
            expired, error = True, "The phone's subscription has ended (the app was removed or notifications turned off). Turn notifications on again in Tune → Rules → Alerts and copy the new setup."
            break
        else:
            error = f"The push service answered {code or 'nothing'}; will try again with the next alert."
    write_json(cache_dir / "notified.json", state)
    status.update({"generated": now_iso(), "ok": not error, "service": setup["host"].split(".")[-2] if "." in setup["host"] else setup["host"],
                   "sent_total": int(status.get("sent_total", 0)) + sent, "expired": expired, "error": error})
    if choices:                                         # so the app can tell whether its latest choices arrived (a hash, nothing readable)
        status.update({"choices_sig": choices["sig"], "choices_at": choices["at"]})
    if choices_error:
        status["choices_error"] = choices_error
    if sent:
        status["last_sent"] = now_iso()
    write_json(data_dir / "notify.json", status)
    log(f"Notify: {sent} sent of {len(msgs)}" + (f"; {error}" if error else ""))
    return status


def main() -> int:
    raw = os.environ.get("PUSH_SETUP", "").strip()
    if not raw:
        log("Notify: not set up (no PUSH_SETUP secret); nothing to do")
        return 0
    test = "--test" in sys.argv or os.environ.get("NOTIFY_TEST", "").lower() == "true"
    run(raw, test, sent_choices=os.environ.get("CHOICES", "").strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
