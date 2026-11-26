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
  const changed = Object.keys(ALERT_GROUPS).filter((k) => T.alerts[k] !== false).join() !== (pushState.groups || []).join();
  const st = notifyStatus || null;
  const status = !st ? "Waiting for the first run with your setup."
    : st.error ? st.error
      : `Working${st.last_sent ? `: last sent ${ago(st.last_sent)}` : ""}${st.sent_total ? `, ${plural(st.sent_total, "notification")} so far` : ""}.`;
  return el("div", {}, head,
    el("ol", { class: "push-steps" },
      el("li", {}, "Copy the setup (it holds this phone’s push address and signing key: keep it private).", " ",
        el("button", { class: "inline-link", onclick: () => copyText(pushState.setup, "Setup copied") }, "Copy setup")),
      el("li", {}, "On GitHub, add a repository secret named ", el("b", {}, "PUSH_SETUP"), " and paste it as the value.", " ",
        el("a", { class: "inline-link", href: SECRET_URL, target: "_blank", rel: "noopener" }, "Open GitHub")),
      el("li", {}, "Send a test.", " ", ghToken()
        ? el("button", { class: "inline-link", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await runJob("notify"); toast("Test sent to GitHub: the notification arrives in about a minute"); } catch (err) { toast(String(err.message || err)); }
          b.disabled = false;
        } }, "Send a test")
        : el("a", { class: "inline-link", href: `https://github.com/${REPO}/actions/workflows/notify.yml`, target: "_blank", rel: "noopener" }, "Run “Send notifications”"))),
    changed ? el("p", { class: "fine warn-text" }, "Your alert choices changed since the setup was made: turn notifications off and on, and paste the new setup, so the notifications match.") : null,
    el("p", { class: `fine${st?.error ? " warn-text" : ""}` }, status),
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: pushOff }, "Turn off on this phone")));
}
// a tapped notification opens Readout at #alerts: show this week's alerts
function openAlertsFromHash() {
  if (location.hash !== "#alerts") return;
  history.replaceState(null, "", location.pathname + location.search);
  setTimeout(() => { if (typeof openAlerts === "function") openAlerts(); }, 600);
}
window.addEventListener("hashchange", openAlertsFromHash);
