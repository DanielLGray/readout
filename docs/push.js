/* Readout — alerts as notifications on this phone (Web Push). The phone makes a signing key and a
   push subscription; you paste one line (the PUSH_SETUP secret) into the repository's settings;
   after each news, papers or watch update the notify job sends any new alert, once.
   Loaded after cites.js. */
"use strict";

const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && !!window.crypto?.subtle;
const standalone = () => !!(window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true);
const SECRET_URL = `https://github.com/${REPO}/settings/secrets/actions/new`;
let pushState = store.get("push", null);
if (!pushState || typeof pushState !== "object" || typeof pushState.setup !== "string") pushState = null;
let notifyStatus = null;

async function pushOn() {
  if (!pushSupported()) { toast("This browser can’t get notifications from web apps."); return; }
  if (!standalone()) { toast("Add Readout to your Home Screen first, then open it from there."); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications are off for Readout: Settings → Notifications → Readout."); rerender(); return; }
    const reg = await Promise.race([navigator.serviceWorker.ready, pause(8000).then(() => null)]);
    if (!reg) throw new Error("the app’s background worker isn’t running; close Readout, open it again and retry");
    const old = await reg.pushManager.getSubscription();
    if (old) await old.unsubscribe().catch(() => {});
    // the key that signs messages to this phone: made here, kept here and in the secret you paste
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("raw", keys.publicKey);
    const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: new Uint8Array(pub) });
    const s = sub.toJSON();
    const groups = Object.keys(ALERT_GROUPS).filter((k) => T.alerts[k] !== false);
    pushState = { setup: JSON.stringify({ v: 1, sub: { endpoint: s.endpoint, keys: s.keys }, key: jwk.d, groups }), at: localDay(), groups };
    store.set("push", pushState);
    toast("Notifications on for this phone. Now copy the setup to GitHub.");
  } catch (e) {
    toast(`Couldn’t turn notifications on: ${String(e?.message || e).slice(0, 100)}`);
  }
  rerender();
}
// ── your choices, so notifications leave out what the app does ────────────
// Alert kinds, words hidden from Watch and alerts, Watch ratings and switches, sealed with a key
// made from this phone's signing key (only the notify job, which has the same key in PUSH_SETUP,
// can open them). They go in the setup, and the token sends newer ones (pipeline/notify.py).
const W_FEAT = /^w(?:k|t|c|p|a|o|ph):/;
function hashStr(str) {                      // a short fingerprint, to tell whether the job has the latest
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
function alertChoices() {
  const taste = {};
  Object.keys(T.taste).filter((f) => W_FEAT.test(f) && T.taste[f]).sort().forEach((f) => { taste[f] = T.taste[f]; });
  const body = { groups: Object.keys(ALERT_GROUPS).filter((k) => T.alerts[k] !== false), taste, words: [...T.watch.mute].sort(),
    off: Object.keys(WATCH_KINDS).filter((k) => T.watch.kinds[k] === false), topics: [...T.watch.hidden].sort(), follow: [...T.watch.follow].sort() };
  return { v: 1, sig: hashStr(JSON.stringify(body)), ...body };
}
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const bytesB64u = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function sealChoices(c = alertChoices()) {
  const d = JSON.parse(pushState.setup).key;
  const enc = (x) => new TextEncoder().encode(x);
  const base = await crypto.subtle.importKey("raw", b64uBytes(d), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: enc("readout-choices"), info: enc("v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc(JSON.stringify({ ...c, at: new Date().toISOString() }))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv); out.set(ct, iv.length);
  return bytesB64u(out);
}
// sealed ahead of time, so Copy can put it on the clipboard straight from the tap
let sealed = { sig: "", text: "" }, sealing = null;
function freshSealed() {
  if (!pushState) return null;
  const c = alertChoices();
  if (sealed.sig === c.sig) return sealed.text;
  if (!sealing) sealing = sealChoices(c).then((text) => { sealed = { sig: c.sig, text }; }).catch(() => {}).finally(() => { sealing = null; if (S.tab === "tune") rerender(); });
  return null;
}
const setupText = () => { const t = freshSealed(); const s = JSON.parse(pushState.setup); return JSON.stringify(t ? { ...s, choices: t } : s); };
// after a change: send the new choices with the token, a few seconds later (several changes go as one)
let choicesTimer = null, lastSig = null;
function choicesChanged() {
  if (!pushState) return;
  const sig = alertChoices().sig;
  if (sig === lastSig) return;
  lastSig = sig;
  clearTimeout(choicesTimer);
  if (ghToken()) choicesTimer = setTimeout(() => sendChoices().catch(() => {}), 5000);
}
async function sendChoices(force = false) {
  if (!pushState || !ghToken()) return false;
  const c = alertChoices();
  if (!force && (notifyStatus?.choices_sig === c.sig || (pushState.sentSig === c.sig && Date.now() - (pushState.sentAt || 0) < 15 * 60e3))) return false;
  const text = await sealChoices(c);
  const r = await ghFetch(`/actions/workflows/${JOBS.notify.wf}/dispatches`, { method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { test: "false", choices: text } }), headers: { "Content-Type": "application/json" } });
  if (r.status !== 204 && r.status !== 200) throw new Error(ghProblem(r.status));
  pushState = { ...pushState, sentSig: c.sig, sentAt: Date.now() };
  store.set("push", pushState);
  if (S.tab === "tune") rerender();
  return true;
}
// one line for the Rate sheets
function choicesNote() {
  if (!pushState) return "Changes apply at once, on this phone.";
  return ghToken() ? "Changes apply at once here, and reach notifications a minute or two later."
    : "Changes apply at once here. For notifications, send them from Tune → Rules → Alerts.";
}
function choicesStatusEl(st) {
  const c = alertChoices();
  if (st?.choices_sig === c.sig) return el("p", { class: "fine" }, "Notifications follow your choices: alert kinds, words hidden from alerts, and what you rated in Watch.");
  if (!st || !st.generated) return el("p", { class: "fine" }, "Your choices (alert kinds, hidden words, Watch ratings) go with the setup.");
  const sent = pushState.sentSig === c.sig && Date.now() - (pushState.sentAt || 0) < 15 * 60e3;
  return el("p", { class: "fine" }, "Your latest choices haven’t reached notifications yet. ",
    sent ? "Sent: they arrive with the job in a minute or two."
      : ghToken() ? el("button", { class: "inline-link", onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try { await sendChoices(true); toast("Choices sent to GitHub"); } catch (err) { toast(String(err.message || err)); }
        b.disabled = false;
      } }, "Send them now")
        : [el("button", { class: "inline-link", onclick: () => { const t = freshSealed(); if (t) copyText(t, "Choices copied"); else toast("One moment, then tap again"); } }, "Copy choices"),
          ", then on GitHub ", el("a", { class: "inline-link", href: `https://github.com/${REPO}/actions/workflows/notify.yml`, target: "_blank", rel: "noopener" }, "run “Send notifications”"),
          " and paste them under Your choices (with Send a test off)."]);
}

async function pushOff() {
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, pause(4000).then(() => null)]);
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await sub.unsubscribe();
  } catch { /* already gone */ }
  pushState = null;
  store.set("push", null);
  toast("Off on this phone. Delete the PUSH_SETUP secret on GitHub too.");
  rerender();
}
async function loadNotifyStatus() {
  try {
    const r = await fetch("data/notify.json", { cache: "no-cache" });
    notifyStatus = r.ok ? await r.json() : null;
  } catch { notifyStatus = null; }
  if (S.tab === "tune" && TU.pane === "algorithms") rerender();
}
function pushSectionEl() {
  if (notifyStatus === null && pushState) { notifyStatus = false; loadNotifyStatus(); }
  const head = [el("div", { class: "ctl-label", style: "margin-top:14px" }, "Notifications"),
    el("p", { class: "fine", style: "margin-top:2px" }, "New alerts as notifications on this phone, once each, a few minutes after the update that finds them. Only the alert’s label and headline are sent, encrypted, through Apple’s push service.")];
  if (!pushSupported()) return el("div", {}, head, el("p", { class: "fine" }, "This browser can’t get notifications from web apps. On an iPhone, open Readout from its Home Screen icon."));
  if (!standalone()) return el("div", {}, head, el("p", { class: "fine" }, "Add Readout to your Home Screen (Share → Add to Home Screen), open it from there, and turn notifications on here."));
  if (Notification.permission === "denied") return el("div", {}, head, el("p", { class: "fine warn-text" }, "Notifications are blocked for Readout. Turn them on in Settings → Notifications → Readout, then come back."));
  if (!pushState) return el("div", {}, head, el("div", { class: "link-row" }, el("button", { class: "act", onclick: pushOn }, "Turn on notifications")));
  const st = notifyStatus || null;
  freshSealed();
  const status = !st ? "Waiting for the first run with your setup."
    : st.error ? st.error
      : `Working${st.last_sent ? `: last sent ${ago(st.last_sent)}` : ""}${st.sent_total ? `, ${plural(st.sent_total, "notification")} so far` : ""}.`;
  return el("div", {}, head,
    el("ol", { class: "push-steps" },
      el("li", {}, "Copy the setup (it holds this phone’s push address and signing key: keep it private).", " ",
        el("button", { class: "inline-link", onclick: () => copyText(setupText(), "Setup copied") }, "Copy setup")),
      el("li", {}, "On GitHub, add a repository secret named ", el("b", {}, "PUSH_SETUP"), " and paste it as the value.", " ",
        el("a", { class: "inline-link", href: SECRET_URL, target: "_blank", rel: "noopener" }, "Open GitHub")),
      el("li", {}, "Send a test.", " ", ghToken()
        ? el("button", { class: "inline-link", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await runJob("notify"); toast("Test sent to GitHub: the notification arrives in about a minute"); } catch (err) { toast(String(err.message || err)); }
          b.disabled = false;
        } }, "Send a test")
        : el("a", { class: "inline-link", href: `https://github.com/${REPO}/actions/workflows/notify.yml`, target: "_blank", rel: "noopener" }, "Run “Send notifications”"))),
    el("p", { class: `fine${st?.error ? " warn-text" : ""}` }, status),
    choicesStatusEl(st),
    st?.choices_error ? el("p", { class: "fine warn-text" }, st.choices_error) : null,
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: pushOff }, "Turn off on this phone")));
}
// a tapped notification opens Readout at #alerts: show this week's alerts
function openAlertsFromHash() {
  if (location.hash !== "#alerts") return;
  history.replaceState(null, "", location.pathname + location.search);
  setTimeout(() => { if (typeof openAlerts === "function") openAlerts(); }, 600);
}
window.addEventListener("hashchange", openAlertsFromHash);
