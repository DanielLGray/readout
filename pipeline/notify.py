"""Alerts as phone notifications (Web Push) → docs/data/notify.json (and cache/notified.json)

    python -m pipeline.notify [--test]

The PUSH_SETUP secret holds what the phone made in Tune → Rules → Alerts: its push subscription
(an address at Apple's push service, and the keys that encrypt messages to it) and the private key
the phone made to sign them. After each news, papers or watch update this sends every alert it
hasn't sent before, once. Nothing else leaves the job: the alert's label and headline, encrypted,
go only to the push service in the subscription. docs/data/notify.json tells the app how it went
(no addresses or keys in it).
"""
from __future__ import annotations

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

PUSH_HOSTS = re.compile(r"(?:^|\.)(?:push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$")
_B64U = re.compile(r"^[A-Za-z0-9_-]+$")
CONTACT = "https://daniellgray.github.io"               # who sends, for the push service: the app's own site (no email needed)
GROUP_OF_KIND = {"trial": "trials", "rule": "rules", "drug": "fda", "device": "fda"}
LABEL_OF_KIND = {"trial": "Trial results", "rule": "Federal rule", "drug": "FDA", "device": "FDA"}
MAX_EACH = 3                                             # more new alerts than this in one go: the rest as one summary


class SetupError(ValueError):
    pass


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
    return {"sub": {"endpoint": endpoint, "keys": {"p256dh": p256dh, "auth": auth}}, "key": key, "groups": groups,
            "host": u.hostname}


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
                            "group": str(a.get("group") or ""), "date": _day(a.get("date"))})
    for e in (read_json(data_dir / "watch.json", {}) or {}).get("events") or []:
        if isinstance(e, dict) and e.get("level") == "alert" and e.get("id") and e.get("title") and _day(e.get("seen") or e.get("date")) >= cut:
            title = f"{e['acr']}: {e['title']}" if e.get("acr") else str(e["title"])
            out.append({"id": f"w-{e['id']}", "title": f"{title} ({e.get('what', '')})".replace(" ()", ""),
                        "label": LABEL_OF_KIND.get(e.get("kind"), "Watch"), "group": GROUP_OF_KIND.get(e.get("kind"), ""),
                        "date": _day(e.get("seen") or e.get("date"))})
    return sorted(out, key=lambda a: a["date"], reverse=True)


def plan(alerts: list[dict], state: dict, groups: list[str], now: datetime) -> "tuple[list[dict], dict]":
    """Which messages to send, and the state to keep. The first run only learns what's there."""
    sent = dict(state.get("sent") or {})
    today = now.date().isoformat()
    first = not state.get("started")
    new = [a for a in alerts if a["id"] not in sent and (not groups or not a["group"] or a["group"] in groups)]
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


def run(raw: str, test: bool, now: Optional[datetime] = None, data_dir=DATA, cache_dir=CACHE,
        sender: Callable[[dict, dict], int] = web_push) -> dict:
    now = now or datetime.now(timezone.utc)
    status = read_json(data_dir / "notify.json", {}) or {}
    status = {k: status[k] for k in ("sent_total", "last_sent") if k in status}
    try:
        setup = parse_setup(raw)
    except SetupError as exc:
        status.update({"generated": now_iso(), "ok": False, "error": f"PUSH_SETUP couldn't be used: {exc}. Copy it again from Tune → Rules → Alerts."})
        write_json(data_dir / "notify.json", status)
        return status
    state = read_json(cache_dir / "notified.json", {}) or {}
    msgs, state = plan(current_alerts(data_dir, now), state, setup["groups"], now)
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
    run(raw, test)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
