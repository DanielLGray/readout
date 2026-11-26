"""Alerts as notifications: the setup check, what gets sent, and when — offline (no push library)."""
import json
from datetime import datetime, timezone

import pytest

from pipeline import notify
from pipeline.common import read_json, write_json

NOW = datetime(2026, 11, 26, 15, 0, tzinfo=timezone.utc)
GOOD = {"v": 1, "sub": {"endpoint": "https://web.push.apple.com/QAbc-123_x", "keys": {"p256dh": "B" + "a" * 86, "auth": "c" * 22}},
        "key": "k" * 43, "groups": ["fda", "trials"]}


def test_parse_setup():
    s = notify.parse_setup(json.dumps(GOOD))
    assert s["host"] == "web.push.apple.com" and s["groups"] == ["fda", "trials"]
    for bad in ["nope", json.dumps({**GOOD, "v": 2}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "endpoint": "https://evil.test/push"}}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "endpoint": "http://web.push.apple.com/x"}}),
                json.dumps({**GOOD, "key": "short"}),
                json.dumps({**GOOD, "sub": {**GOOD["sub"], "keys": {"p256dh": "x", "auth": "y"}}})]:
        with pytest.raises(notify.SetupError):
            notify.parse_setup(bad)


def _data(tmp_path, news_alerts=(), watch_events=()):
    write_json(tmp_path / "news.json", {"alerts": list(news_alerts)})
    write_json(tmp_path / "feed.json", {"alerts": []})
    write_json(tmp_path / "watch.json", {"events": list(watch_events)})


def test_first_run_learns_then_sends_each_new_alert_once(tmp_path):
    data, cache = tmp_path / "data", tmp_path / "cache"
    data.mkdir(); cache.mkdir()
    a1 = {"id": "n:1", "title": "FDA approves new PSMA tracer", "label": "FDA", "group": "fda", "date": "2026-11-25T10:00:00Z"}
    _data(data, [a1])
    sent = []
    sender = lambda setup, m: sent.append(m) or 201
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    assert sent == [] and st["ok"] and st["sent_total"] == 0                 # the first run only learns what's there
    a2 = {"id": "n:2", "title": "USPSTF drafts new screening advice", "label": "USPSTF", "group": "uspstf", "date": "2026-11-26T09:00:00Z"}
    w = {"id": "trial:NCT1:results-2026-11-26", "kind": "trial", "level": "alert", "title": "Lu-177 in mCRPC", "acr": "SPLASH",
         "what": "Results posted", "date": "2026-11-26", "seen": "2026-11-26"}
    _data(data, [a1, a2], [w])
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    # a2's group (uspstf) is off in the setup; the trial result goes out, once
    assert [m["body"] for m in sent] == ["SPLASH: Lu-177 in mCRPC (Results posted)"] and sent[0]["title"] == "Readout · Trial results"
    assert st["sent_total"] == 1 and st["last_sent"]
    notify.run(json.dumps(GOOD), False, NOW, data, cache, sender)
    assert len(sent) == 1
    assert "endpoint" not in json.dumps(read_json(data / "notify.json")) and "push.apple" not in json.dumps(read_json(data / "notify.json"))


def test_many_new_alerts_summarize_and_expiry_is_reported(tmp_path):
    data, cache = tmp_path / "data", tmp_path / "cache"
    data.mkdir(); cache.mkdir()
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    _data(data, [{"id": f"n:{i}", "title": f"Story {i}", "label": "FDA", "group": "fda", "date": "2026-11-26"} for i in range(6)])
    sent = []
    st = notify.run(json.dumps(GOOD), False, NOW, data, cache, lambda s, m: sent.append(m) or 201)
    assert len(sent) == 3 and sent[-1]["body"] == "4 more new alerts this week"
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    st = notify.run(json.dumps(GOOD), True, NOW, data, cache, lambda s, m: 410)
    assert st["expired"] and not st["ok"] and "Turn notifications on again" in st["error"]


def test_bad_setup_is_reported_not_used(tmp_path):
    st = notify.run("{}", True, NOW, tmp_path, tmp_path, lambda s, m: pytest.fail("sent with a bad setup"))
    assert not st["ok"] and "PUSH_SETUP" in st["error"]


# ── your choices in the app ────────────────────────────────────────────────
def _seal(key: str, obj: dict) -> str:
    import base64, os
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF
    k = HKDF(algorithm=hashes.SHA256(), length=32, salt=notify.SALT, info=notify.INFO).derive(notify._unb64u(key))
    iv = os.urandom(12)
    return base64.urlsafe_b64encode(iv + AESGCM(k).encrypt(iv, json.dumps(obj).encode(), None)).decode().rstrip("=")


CH = {"v": 1, "sig": "abc123", "at": "2026-11-26T10:00:00.000Z", "groups": ["fda", "trials", "rules"], "taste": {}, "words": [],
      "off": [], "topics": [], "follow": []}
PMA = {"id": "pma:P210001S050", "kind": "device", "topic": "pma", "level": "alert", "title": "Navitor TAVI System",
       "what": "New indication approved (PMA supplement)", "sub": "ABBOTT MEDICAL · Normal 180 Day Track", "date": "2026-11-20", "seen": "2026-11-26"}
TRIAL = {"id": "trial:NCT01234567:results-2026-11-26", "kind": "trial", "topic": "rlt", "level": "alert", "title": "Lu-177 in mCRPC",
         "acr": "SPLASH", "what": "Results posted", "sub": "Phase 3 · 412 patients · Lantheus", "nct": "NCT01234567", "date": "2026-11-26", "seen": "2026-11-26"}


def _sent_with(tmp_path, choices=None, sent_choices="", news=(), events=(PMA, TRIAL), setup_choices=None):
    data, cache = tmp_path / "data", tmp_path / "cache"
    data.mkdir(parents=True, exist_ok=True); cache.mkdir(parents=True, exist_ok=True)
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    _data(data, list(news), list(events))
    setup = {**GOOD, "groups": ["fda", "trials", "rules", "uspstf"]}
    if setup_choices is not None:
        setup["choices"] = _seal(GOOD["key"], setup_choices)
    sent = []
    st = notify.run(json.dumps(setup), False, NOW, data, cache, lambda s, m: sent.append(m["body"]) or 201,
                    sent_choices=_seal(GOOD["key"], choices) if choices else sent_choices)
    return sent, st, cache


def test_hidden_or_rated_down_watch_alerts_are_left_out(tmp_path):
    sent, st, cache = _sent_with(tmp_path)
    assert len(sent) == 2 and "choices_sig" not in st                     # no choices anywhere: everything goes
    sent, st, _ = _sent_with(tmp_path / "a", {**CH, "taste": {"wo:ABBOTT MEDICAL": -2}})
    assert sent == ["SPLASH: Lu-177 in mCRPC (Results posted)"] and st["choices_sig"] == "abc123"
    sent, _, _ = _sent_with(tmp_path / "b", {**CH, "taste": {"wc:pma-ind": -1, "wt:rlt": -1, "wph:Phase 3": 1}})
    assert sent == ["SPLASH: Lu-177 in mCRPC (Results posted)"]           # the valve: Less; the trial: a Less and a More cancel
    sent, _, _ = _sent_with(tmp_path / "c", {**CH, "taste": {"wt:rlt": -1}, "follow": ["NCT01234567"]})
    assert len(sent) == 2                                                 # a trial you follow always counts
    sent, _, _ = _sent_with(tmp_path / "d", {**CH, "off": ["device"]})
    assert sent == ["SPLASH: Lu-177 in mCRPC (Results posted)"]
    sent, _, _ = _sent_with(tmp_path / "e", {**CH, "topics": ["rlt"]})
    assert sent == ["Navitor TAVI System (New indication approved (PMA supplement))"]


def test_words_and_alert_kinds_from_the_choices(tmp_path):
    news = [{"id": "n:1", "title": "FDA approves new PSMA tracer", "label": "FDA", "group": "fda", "date": "2026-11-26"},
            {"id": "n:2", "title": "USPSTF drafts new screening advice", "label": "USPSTF", "group": "uspstf", "date": "2026-11-26"}]
    sent, _, _ = _sent_with(tmp_path, {**CH, "words": ["tracer*", "navitor"]}, news=news)
    assert sent == ["SPLASH: Lu-177 in mCRPC (Results posted)"]           # uspstf is off in these choices (on in the setup)
    sent, _, _ = _sent_with(tmp_path / "b", {**CH, "groups": ["uspstf"], "words": ["screening"]}, news=news)
    assert sent == []


def test_which_choices_count(tmp_path):
    old = {**CH, "at": "2026-11-20T00:00:00Z", "sig": "old", "taste": {"wo:ABBOTT MEDICAL": -2}}
    new = {**CH, "at": "2026-11-26T12:00:00Z", "sig": "new"}
    sent, st, cache = _sent_with(tmp_path, new, setup_choices=old)
    assert len(sent) == 2 and st["choices_sig"] == "new" and read_json(cache / "alert-rules.json")["sealed"]
    # the next run, with nothing sent: the kept ones are newer than the setup's
    data = tmp_path / "data"
    write_json(cache / "notified.json", {"started": "2026-11-01", "sent": {}})
    setup = {**GOOD, "choices": _seal(GOOD["key"], old)}
    st = notify.run(json.dumps(setup), False, NOW, data, cache, lambda s, m: 201)
    assert st["choices_sig"] == "new"
    # choices sealed for another setup are reported, and don't stop the alerts
    sent, st, _ = _sent_with(tmp_path / "x", sent_choices=_seal("A" * 43, new))
    assert len(sent) == 2 and "different setup" in st["choices_error"] and st["ok"]
    with pytest.raises(notify.ChoicesError):
        notify.open_choices(GOOD["key"], "not-sealed")


def test_clean_choices_keeps_only_what_the_app_makes():
    c = notify.clean_choices({"v": 1, "taste": {"wo:Acme": -2, "sys:liver": -2, "wk:device": 5, "wp:IYN": True, "wc:510k": -1},
                              "words": ["  dental ", "", 3], "off": ["device", "evil"], "topics": ["rlt", "../x"], "follow": ["NCT01234567", "x"],
                              "groups": ["fda", "Bad Group"], "sig": "ab<c>12", "at": "2026"})
    assert c["taste"] == {"wo:Acme": -2, "wc:510k": -1} and c["words"] == ["dental"] and c["off"] == ["device"]
    assert c["topics"] == ["rlt"] and c["follow"] == ["NCT01234567"] and c["groups"] == ["fda"] and c["sig"] == "abc12"
    assert notify.word_re(["valve"]).search("New Valves approved") and not notify.word_re(["valve"]).search("valvetrain")
    assert notify.word_re(["dent*"]).search("Dentsply") and notify.word_re([" "]) is None
