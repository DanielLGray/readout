/* Readout — Watch: what changed in trial registrations, FDA approvals and clearances, and federal
   rules (data/watch.json, daily from ClinicalTrials.gov, openFDA and the Federal Register).
   Loaded after radar.js. */
"use strict";

const WATCH_KINDS = { trial: "Trials", device: "FDA devices", drug: "FDA drugs", rule: "Rules and guidance" };
const WATCH_SHORT = { trial: "Trial", device: "FDA device", drug: "FDA drug", rule: "Rule" };
const WATCH_LINK = { trial: "ClinicalTrials.gov", device: "FDA database", drug: "Drugs@FDA", rule: "Federal Register" };
const WATCH_COUNT = { trial: "trial change", device: "device clearance", drug: "drug approval", rule: "rule" };
const W_FILTERS = [["all", "All"], ["trial", "Trials"], ["fda", "FDA"], ["rule", "Rules"], ["follow", "Following"]];

const wTopic = (e) => S.watch?.topics?.[e.topic] || "";
const wFollowing = (nct) => !!nct && T.watch.follow.includes(nct);

// ── Rate: what you think of a device type, a company, a kind of change… ────
// The same Hide, Less, Same and More as on cards (kept with them, in Tune → Interests → What you
// like), about these features. pipeline/watch_features.py does the same for notifications.
const W_CHANGE = { "510k": "510(k) clearances", denovo: "De Novo grants", "pma-new": "New PMA approvals", "pma-ind": "New indications for PMA devices",
  "drug-new": "New drug approvals", "drug-ind": "New indications for drugs", new: "New trials registered", status: "Trial status changes",
  results: "Trial results posted", pcd: "Primary completion reached or moved", final: "Final rules", proposed: "Proposed rules", notice: "Notices and guidance" };
// FDA's records write companies in capitals ("ABBOTT MEDICAL"): shown in ordinary case, short
// names (GE, USA) and company suffixes kept as they're written
const CAPS_KEEP = { INC: "Inc", "INC.": "Inc.", LTD: "Ltd", "LTD.": "Ltd.", CORP: "Corp", "CORP.": "Corp.", CO: "Co", "CO.": "Co.", GMBH: "GmbH", OF: "of", AND: "and", THE: "the", FOR: "for" };
function niceCaps(s) {
  const t = String(s || "");
  if (!/[A-Z]{4}/.test(t) || t !== t.toUpperCase()) return t;
  return t.split(/(\s+)/).map((w, i) => {
    if (/^\s+$/.test(w)) return w;
    const k = CAPS_KEEP[w.replace(/,$/, "")];
    if (k) return (i ? k : k[0].toUpperCase() + k.slice(1)) + (w.endsWith(",") ? "," : "");
    const core = w.replace(/[^A-Z]/g, "");
    if (core.length <= 3 || /\d/.test(w)) return w;                     // GE, USA, 3M, product codes
    return w[0] + w.slice(1).toLowerCase().replace(/([-/&(])([a-z])/g, (m, p, c) => p + c.toUpperCase());
  }).join("");
}
const wSub = (e) => wParts(e).map(niceCaps).join(" · ");
const wParts = (e) => String(e.sub || "").split(" · ").map((p) => p.trim()).filter(Boolean);
function wOrg(e) {
  if (e.org) return String(e.org).slice(0, 100);
  const p = wParts(e);
  if (e.kind === "device" && p.length && !p[0].startsWith("product code")) return p[0].slice(0, 100);
  if (e.kind === "drug" && p.length) return p[0].slice(0, 100);
  if (e.kind === "trial") { const r = p.filter((x) => !x.startsWith("Phase ") && !/\bpatients$/.test(x)); return r.length ? r[r.length - 1].slice(0, 100) : ""; }
  return "";
}
const wCode = (e) => (e.pc ? String(e.pc) : (/\bproduct code ([A-Z0-9]{3})\b/.exec(String(e.sub || "")) || [])[1] || "");
const wPhase = (e) => (e.kind !== "trial" ? "" : String(e.ph || wParts(e).find((x) => x.startsWith("Phase ")) || ""));
function wChange(e) {
  const id = String(e.id || ""), what = String(e.what || "");
  if (e.kind === "device") return id.startsWith("pma:") ? (what.startsWith("New device") ? "pma-new" : "pma-ind") : id.startsWith("device:DEN") ? "denovo" : "510k";
  if (e.kind === "drug") return what.startsWith("New drug") ? "drug-new" : "drug-ind";
  if (e.kind === "trial") { const c = (id.split(":")[2] || "").split("-")[0]; return ["new", "status", "results", "pcd"].includes(c) ? c : ""; }
  if (e.kind === "rule") { const h = what.split(";")[0].trim().toLowerCase(); return h === "final rule" ? "final" : h === "proposed rule" ? "proposed" : "notice"; }
  return "";
}
function wFeatures(e) {
  const f = [`wk:${e.kind}`];
  if (e.topic && e.topic !== "devices" && e.topic !== "drugs") f.push(`wt:${e.topic}`);
  const c = wChange(e), pc = wCode(e), o = wOrg(e), ph = wPhase(e);
  if (c) f.push(`wc:${c}`);
  if (pc) f.push(`wp:${pc}`);
  if (e.kind === "device" && e.ai) f.push("wa:ai");
  if (o) f.push(`wo:${o}`);
  if (ph) f.push(`wph:${ph}`);
  return f;
}
let wCodeNames = [null, {}];
function wCodeName(pc) {
  if (wCodeNames[0] !== S.watch) {
    const m = {};
    (S.watch?.events || []).forEach((e) => { const c = wCode(e); if (c && e.pcn && !m[c]) m[c] = e.pcn; });
    wCodeNames = [S.watch, m];
  }
  return wCodeNames[1][pc] ? `${wCodeNames[1][pc]} (${pc})` : `Product code ${pc}`;
}
const wItem = (e) => ({ type: "watch", ev: e, key: `w:${e.id}`, id: e.id, title: e.acr ? `${e.acr}: ${e.title}` : e.title, date: e.seen || e.date });
let wTasteMemo = [null, null, new Map()];
function wTaste(e) {                         // −Infinity hidden; below 0 less; above 0 more
  if (!hasTaste()) return 0;
  if (wTasteMemo[0] !== T.taste || wTasteMemo[1] !== T.learned) wTasteMemo = [T.taste, T.learned, new Map()];
  let v = wTasteMemo[2].get(e.id);
  if (v === undefined) { v = tasteOf(wItem(e)); wTasteMemo[2].set(e.id, v); }
  return v;
}
let wMuteMemo = [null, null];
const wMuteRe = () => (wMuteMemo[0] === T.watch.mute ? wMuteMemo[1] : (wMuteMemo = [T.watch.mute, wordRe(T.watch.mute)])[1]);
const wName = (e) => `${e.acr || ""} ${e.title || ""}`;
const wMuted = (e) => { const re = wMuteRe(); return !!re && re.test(wName(e)); };
const wLess = (e) => !wFollowing(e.nct) && wTaste(e) < 0;
const wMore = (e) => wTaste(e) > 0;
// an alert with a word you hid from Watch and alerts in its headline
function alertMuted(a) {
  const re = wMuteRe();
  return !!re && re.test(a.via === "watch" ? wName(a.ev) : String(a.title || ""));
}

const wRoutine = (e) => e.kind === "device" && !e.ai && e.level !== "alert" && !wMore(e);      // a routine scanner or coil clearance
// what Tune and Rate let through; followed trials always count
function watchEvents() {
  const W = S.watch;
  if (!W?.events) return [];
  const hidden = new Set(T.watch.hidden);
  return W.events.filter((e) => e?.id && e.title && (wFollowing(e.nct)
    || (T.watch.kinds[e.kind] !== false && !hidden.has(e.topic) && !(T.watch.aiOnly && wRoutine(e)) && !wMuted(e) && wTaste(e) > -Infinity)));
}
const wRank = (e) => (wFollowing(e.nct) ? 0 : wMore(e) ? 0.5 : e.level === "alert" ? 1 : e.kind === "trial" && /^Results/.test(e.what) ? 2 : wRoutine(e) ? 5 : e.kind === "device" ? 4 : 3);
function wWhen(e) {
  const d = e.date || "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  const days = Math.round((Date.parse(`${localDay()}T12:00:00`) - Date.parse(`${d}T12:00:00`)) / 864e5);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days} d` : fmtDate(d);
}

// ── alerts: the major changes join the others at the top of Today and Everything ──
function watchAlerts() {
  if (!S.watch) return [];
  const news = (S.news?.alerts || []).map((a) => String(a.title || "").toLowerCase());
  return watchEvents().filter((e) => e.level === "alert" && !wLess(e)).map((e) => ({
    id: `w-${e.id}`, title: e.acr ? `${e.acr}: ${e.title}` : e.title, date: e.seen || e.date, via: "watch", ev: e,
    group: e.kind === "trial" ? "trials" : e.kind === "rule" ? "rules" : "fda", rule: `w-${e.kind}`,
    label: e.kind === "trial" ? "Trial results" : e.kind === "rule" ? "Federal rule" : "FDA",
  })).filter((a) => a.ev.kind !== "drug" || !news.some((t) => t.includes(String(a.ev.title).split(" (")[0].toLowerCase())));   // the FDA's own press release already made it an alert
}

// ── Explore: the entry ─────────────────────────────────────────────────────
function watchEntryEl() {
  const W = S.watch;
  if (!W) return null;
  const cut = localDay(daysAgo(7));
  const week = watchEvents().filter((e) => (e.seen || e.date) >= cut);
  const by = {};
  week.forEach((e) => { by[e.kind] = (by[e.kind] || 0) + 1; });
  const next = (W.dates || []).filter((d) => d.src === "ClinicalTrials.gov" && d.start >= localDay())[0];
  return el("button", { class: "fd-entry w-entry", onclick: () => openWatch() },
    el("span", { class: "fd-entry-h" }, el("b", {}, "Watch"), el("span", {}, week.length ? `${plural(week.length, "change")} this week` : "Trials, FDA and rules")),
    el("span", { class: "rd-mini" },
      Object.keys(WATCH_KINDS).filter((k) => by[k]).map((k) => el("span", {}, `${WATCH_KINDS[k]}: ${by[k]}`)),
      next ? el("span", { class: "fine" }, `Next readout: ${next.title.replace(/: primary completion.*$/, "")}, ~${fmtDate(next.start.slice(0, 10))}`) : null));
}

// ── the Watch page ─────────────────────────────────────────────────────────
function openWatch(filter) {
  if ($("#sheet").classList.contains("open")) closeSheet();
  S.overlay = "watch";
  if (typeof filter === "string") S.watchFilter = filter;
  drawWatch();
  const ov = $("#topic");
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-body").scrollTop = 0;
  $("#topic-back").focus({ preventScroll: true });
}
function wEventEl(e) {
  return el("li", { class: "news-item" }, el("button", { class: "w-row", onclick: () => openWatchEvent(e) },
    el("span", { class: "news-src" }, el("b", {}, WATCH_SHORT[e.kind] || e.kind), wTopic(e) ? el("span", {}, wTopic(e)) : null, el("span", {}, wWhen(e)),
      wFollowing(e.nct) ? el("span", { class: "lang follow" }, "Following") : null, e.level === "alert" ? el("span", { class: "w-major" }, "Major") : null),
    el("span", { class: "news-title" }, e.acr ? `${e.acr}: ${e.title}` : e.title),
    el("span", { class: "w-what" }, e.what),
    e.sub ? el("span", { class: "fine" }, wSub(e)) : null));
}
function drawWatch() {
  $("#topic-title").textContent = "Watch";
  const W = S.watch;
  const body = $("#topic-body");
  const keep = body.scrollTop;
  const f = W_FILTERS.some(([k]) => k === S.watchFilter) ? S.watchFilter : "all";
  const all = watchEvents().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : wRank(a) - wRank(b)));
  const list = all.filter((e) => f === "all" || (f === "fda" ? e.kind === "device" || e.kind === "drug" : f === "follow" ? wFollowing(e.nct) : e.kind === f));
  const less = list.filter(wLess);
  const rest = list.filter((e) => !wLess(e));
  const shown = f === "all" || f === "fda" ? rest.filter((e) => !wRoutine(e)) : rest;
  const routine = rest.filter(wRoutine);
  const ahead = (W?.dates || []).filter((d) => d.src === "ClinicalTrials.gov" && d.start >= localDay()).slice(0, 6);
  const weekCut = localDay(daysAgo(7)), monthCut = localDay(daysAgo(30));
  const groups = [["This week", (e) => e.date >= weekCut], ["Earlier this month", (e) => e.date < weekCut && e.date >= monthCut], ["Before that", (e) => e.date < monthCut]];
  body.replaceChildren(el("div", { class: "rd-page w-page" },
    el("p", { class: "lede small" }, "What changed in trials, FDA approvals and clearances, and federal rules for your areas, read every day from the public records."),
    el("div", { class: "chips wrap w-chips", role: "group", "aria-label": "Show" },
      W_FILTERS.filter(([k]) => k !== "follow" || T.watch.follow.length).map(([k, l]) => el("button", { class: "chip", "aria-pressed": String(f === k),
        onclick: () => { S.watchFilter = k; drawWatch(); } }, l))),
    !W ? el("p", { class: "nothing" }, "Watch fills in with its first daily update.") : null,
    ahead.length && (f === "all" || f === "trial") ? el("section", { class: "w-ahead" },
      el("h3", { class: "sys-head" }, "Readouts ahead"),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "Phase 3 trials in your topics whose primary completion, estimated by the sponsor, is near. Results usually follow months later."),
      el("ul", { class: "rows" }, ahead.map((d) => el("li", { class: "news-item" }, el("button", { class: "w-row", onclick: () => openHzEvent(d) },
        el("span", { class: "news-src" }, el("b", {}, `~${fmtDate(d.start.slice(0, 10))}`), d.sub ? el("span", {}, d.sub) : null),
        el("span", { class: "news-title" }, d.title.replace(/: primary completion \(estimated\)$/, ""))))))) : null,
    W && !list.length ? el("p", { class: "nothing" }, f === "follow" ? "No changes yet in the trials you follow." : "Nothing here in the last four months.") : null,
    groups.map(([label, test]) => {
      const g = shown.filter(test);
      return g.length ? el("section", {}, el("h3", { class: "sys-head" }, label), el("ul", { class: "rows" }, g.slice(0, 60).map(wEventEl))) : null;
    }),
    routine.length ? el("details", { class: "outlets" },
      el("summary", {}, "Other radiology clearances", el("span", { class: "fine" }, String(routine.length))),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "Scanners, coils, workstations and the like, cleared through 510(k). AI software is listed above."),
      el("ul", { class: "rows" }, routine.slice(0, 120).map(wEventEl))) : null,
    less.length ? el("details", { class: "outlets" },
      el("summary", {}, "Rated less", el("span", { class: "fine" }, String(less.length))),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "Changes like ones you rated Less: kept here, out of Today’s card and alerts. Open one and tap Rate to change that."),
      el("ul", { class: "rows" }, less.slice(0, 120).map(wEventEl))) : null,
    W ? el("p", { class: "fine" }, "From ClinicalTrials.gov (U.S. National Library of Medicine), openFDA (510(k), PMA and Drugs@FDA; the FDA’s device data arrive monthly) and the Federal Register, all public records; Readout isn’t endorsed by any of them. ",
      (W.sources || []).filter((s) => !s.ok).map((s) => el("span", { class: "warn-text" }, `${s.name} couldn’t be read on the last run. `)),
      `Updated ${ago(W.generated)}. `,
      el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("interests", "tune-watch"); } }, "Choose what shows")) : null));
  body.scrollTop = keep;
}
function openWatchEvent(e) {
  const link = safeUrl(e.link || "");
  const follow = e.kind === "trial" && e.nct;
  const draw = () => refillSheet(
    el("p", { class: "hz-kind" }, WATCH_KINDS[e.kind] || "", wTopic(e) ? ` · ${wTopic(e)}` : ""),
    el("h2", { id: "sheet-title" }, e.acr ? `${e.acr}: ${e.title}` : e.title),
    el("p", { class: "sheet-meta" }, el("span", {}, fmtDate(e.date)), e.nct ? el("span", {}, e.nct) : null, e.level === "alert" ? el("span", {}, "Major change") : null),
    el("p", { class: "w-what big" }, e.what),
    e.sub ? el("p", { class: "hz-sub" }, wSub(e)) : null,
    e.kind === "device" && e.topic === "devices" ? el("p", { class: "fine" }, "A 510(k) clearance means the FDA found the device as safe and effective as one already on the market; it isn’t an approval of new claims.") : null,
    e.kind === "trial" && /primary completion/i.test(e.what) ? el("p", { class: "fine" }, "Primary completion is when the last participant’s main outcome is measured. Results usually follow months later.") : null,
    el("div", { class: "link-row" },
      link !== "#" ? el("a", { class: "act", href: link, target: "_blank", rel: "noopener" }, icon(ICONS.read), WATCH_LINK[e.kind] || "Details") : null,
      follow ? el("button", { class: "act", "aria-pressed": String(wFollowing(e.nct)), onclick: () => {
        const on = wFollowing(e.nct);
        setTune({ watch: { ...T.watch, follow: on ? T.watch.follow.filter((x) => x !== e.nct) : [...T.watch.follow, e.nct].slice(-100) } });
        toast(on ? "Stopped following this trial" : "Following: every change to this trial shows in Today");
        draw(); if (S.overlay === "watch") drawWatch();
      } }, wFollowing(e.nct) ? "Following" : "Follow trial") : null,
      el("button", { class: "act", "aria-label": "Tell Readout what you think of changes like this", onclick: () => openWatchRate(e) }, icon(ICONS.react), "Rate"),
      S.overlay === "watch" ? null : el("button", { class: "act", onclick: () => openWatch() }, "All of Watch")));
  draw();
  if (!$("#sheet").classList.contains("open")) openSheet();
}

// ── the Rate sheet for a Watch change, and for an alert ────────────────────
const ALERT_GROUP_OF = { trial: "trials", rule: "rules", drug: "fda", device: "fda" };
function alertKindRow(group, redraw) {
  const name = ALERT_GROUPS[group]?.[0] || group;
  return el("div", { class: "fb-row" },
    el("div", { class: "fb-name" }, el("b", {}, `${name} alerts`), el("span", {}, "Alerts of this kind")),
    el("div", { class: "seg fb-seg", role: "group", "aria-label": `${name} alerts` },
      [[false, "Off"], [true, "On"]].map(([x, l]) => el("button", { "aria-pressed": String((T.alerts[group] !== false) === x),
        onclick: () => { setTune({ alerts: { ...T.alerts, [group]: x } }); if (!x) toast(`${name} alerts off. Turn them back on here or in Tune → Rules → Alerts.`); redraw(); } }, l))));
}
// words: tap to hide every Watch change and alert with it in the name; your own too
function hideWordsEl(text, redraw) {
  const mine = T.watch.mute.filter((w) => wordRe([w])?.test(text));
  const taken = new Set(mine.map((w) => w.toLowerCase()));
  const offer = phrasesOf(text).filter((w) => !taken.has(w.toLowerCase()) && !/\d/.test(w)).slice(0, 8);     // not model numbers
  const setMute = (list) => setTune({ watch: { ...T.watch, mute: [...new Set(list)].slice(-200) } });
  const input = el("input", { type: "text", class: "text-in", maxlength: "60", placeholder: "A word or phrase", "aria-label": "Hide a word or phrase" });
  const add = () => { const w = input.value.trim(); if (!w) return; setMute([...T.watch.mute, w]); toast(`Hidden from Watch and alerts: ${w}`); redraw(); };
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); add(); } });
  return [el("div", { class: "ctl-label" }, "Words"),
    el("p", { class: "fine", style: "margin-top:2px" }, "Tap one to hide every Watch change and alert with it in the name (whole words; end one with * for any ending)."),
    el("div", { class: "chips wrap" },
      mine.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Show ${w} again`, onclick: () => { setMute(T.watch.mute.filter((x) => x !== w)); redraw(); } }, `Hidden ${w}  ✕`)),
      offer.map((w) => el("button", { class: "chip", onclick: () => { setMute([...T.watch.mute, w]); toast(`Hidden from Watch and alerts: ${w}`); redraw(); } }, w))),
    el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: add }, "Hide"))];
}
function rateSheetClosed() {
  if (S.overlay === "watch") drawWatch();
  if (S.tab === "feed") refreshFeed(currentKey(true), currentIdx());
  else if (S.tab === "tune") rerender();
}
function openWatchRate(e) {
  let changed = false;
  const redraw = () => { changed = true; draw(); };
  const order = ["wp", "wa", "wo", "wc", "wt", "wph", "wk"];
  const draw = () => {
    const feats = wFeatures(e).sort((a, b) => order.indexOf(a.split(":")[0]) - order.indexOf(b.split(":")[0]));
    const group = ALERT_GROUP_OF[e.kind];
    const t = wTaste(e);
    refillSheet(
      el("h2", { id: "sheet-title" }, "What do you think?"),
      el("p", { class: "sheet-meta fb-title" }, el("span", {}, e.acr ? `${e.acr}: ${e.title}` : e.title)),
      el("p", { class: "fine" }, "More moves changes like this up in Watch and Today. Less moves them to the end of Watch, out of Today’s card and out of alerts. Hide takes them out of all of them."),
      wFollowing(e.nct) ? el("p", { class: "fine" }, "You follow this trial, so its changes show whatever you choose here.") : null,
      el("section", { class: "fb-sect" }, feats.map((f) => rateRow(f, redraw)),
        e.level === "alert" && ALERT_GROUPS[group] ? alertKindRow(group, redraw) : null),
      t === -Infinity || t < 0 || t > 0 ? el("p", { class: "fine" }, t === -Infinity ? "Hidden: out of Watch, Today and alerts." : t < 0 ? "Rated less: at the end of Watch, not in Today or alerts." : "Rated more: first in Watch and Today.") : null,
      hideWordsEl(wName(e), redraw),
      el("p", { class: "fine" }, typeof choicesNote === "function" ? choicesNote() : "Changes apply at once, on this phone."),
      el("div", { class: "link-row" },
        el("button", { class: "act", onclick: closeSheet }, "Done"),
        el("button", { class: "act", onclick: () => { closeSheet(); if (S.overlay === "watch") closeTopic(); switchTab("tune"); setPane("interests", "tune-watch"); } }, "See all")));
    S.onSheetClose = () => { if (changed) rateSheetClosed(); };
  };
  draw();
  if (!$("#sheet").classList.contains("open")) openSheet();
}
// an alert from the news or PubMed: its kind, and words; the story or paper itself has its own Rate
function rateAlert(a) {
  if (a.via === "watch") { openWatchRate(a.ev); return; }
  let changed = false;
  const redraw = () => { changed = true; draw(); };
  const story = a.via === "pubmed" ? null : (S.news?.items || []).find((i) => (a.items || []).includes(i.id));
  const paper = a.via === "pubmed" ? ((S.feed?.items || []).find((x) => x.pmid === a.pmid) || a.card) : null;
  const draw = () => {
    refillSheet(
      el("h2", { id: "sheet-title" }, "What do you think?"),
      el("p", { class: "sheet-meta fb-title" }, el("span", {}, a.title)),
      el("p", { class: "fine" }, "Turn this kind of alert off, or hide alerts with a word in the headline. The story or paper stays in your feed."),
      ALERT_GROUPS[a.group] ? el("section", { class: "fb-sect" }, alertKindRow(a.group, redraw)) : null,
      hideWordsEl(String(a.title || ""), redraw),
      el("p", { class: "fine" }, typeof choicesNote === "function" ? choicesNote() : "Changes apply at once, on this phone."),
      el("div", { class: "link-row" },
        el("button", { class: "act", onclick: closeSheet }, "Done"),
        story ? el("button", { class: "act", onclick: () => { if (changed) rateSheetClosed(); changed = false; openFeedback({ ...story, type: "news", kind: kindOf(story) }); } }, "Rate the story") : null,
        paper ? el("button", { class: "act", onclick: () => { if (changed) rateSheetClosed(); changed = false; openFeedback({ ...paper, type: "paper" }); } }, "Rate the paper") : null));
    S.onSheetClose = () => { if (changed) rateSheetClosed(); };
  };
  draw();
  if (!$("#sheet").classList.contains("open")) openSheet();
}

// ── Today: what changed since the card last showed ─────────────────────────
let watchSeen = store.get("watchSeen", null);
if (!watchSeen || typeof watchSeen !== "object" || Array.isArray(watchSeen)) watchSeen = {};
function watchCardItem() {
  if (!T.brief.watch || !S.watch) return null;
  const today = localDay(), cut = localDay(daysAgo(7));
  // shown on an earlier day: done; shown today: the card keeps it until tomorrow. Major changes are alerts already.
  const fresh = watchEvents().filter((e) => (e.seen || e.date) >= cut && e.level !== "alert" && (!watchSeen[e.id] || watchSeen[e.id] === today))
    .sort((a, b) => wRank(a) - wRank(b) || (a.date < b.date ? 1 : -1));
  if (!fresh.length) return null;
  return { type: "brief-watch", key: "brief:watch", sig: fresh.map((e) => e.id).join(","), fresh };
}
function watchCardEl(it) {
  const by = {};
  it.fresh.forEach((e) => { by[e.kind] = (by[e.kind] || 0) + 1; });
  const top = it.fresh.filter((e) => !wRoutine(e) && !wLess(e)).slice(0, T.brief.watchRows || 4);
  const rest = it.fresh.length - top.length;
  const card = el("article", { class: "card brief-card w-card", "data-key": "brief:watch" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Watch"),
      el("span", {}, Object.keys(WATCH_KINDS).filter((k) => by[k]).map((k) => plural(by[k], WATCH_COUNT[k])).join(" · "))),
    el("ul", { class: "rows" }, top.map((e) => el("li", { class: "news-item" }, el("button", { class: "w-row", onclick: () => openWatchEvent(e) },
      el("span", { class: "news-src" }, el("b", {}, wTopic(e) || WATCH_SHORT[e.kind]), el("span", {}, wWhen(e)),
        wFollowing(e.nct) ? el("span", { class: "lang follow" }, "Following") : null),
      el("span", { class: "news-title" }, e.acr ? `${e.acr}: ${e.title}` : e.title),
      el("span", { class: "w-what" }, e.what))))),
    el("div", { class: "link-row", style: "margin:0" }, el("button", { class: "act", onclick: () => openWatch("all") }, rest > 0 ? `Open Watch (${rest} more)` : "Open Watch")));
  const d = localDay();
  it.fresh.forEach((e) => { watchSeen[e.id] ||= d; });          // counted on the card, so all of them are done
  const cut = localDay(daysAgo(150));
  for (const [k, v] of Object.entries(watchSeen)) if (v < cut) delete watchSeen[k];
  store.set("watchSeen", watchSeen);
  return card;
}

// ── Tune → Interests ───────────────────────────────────────────────────────
function watchSection() {
  const W = S.watch;
  const setW = (patch) => { setTune({ watch: { ...T.watch, ...patch } }); rerender(); };
  const titles = {};
  (W?.events || []).forEach((e) => { if (e.nct) titles[e.nct] = e.acr || e.title; });
  (W?.dates || []).forEach((d) => { if (d.nct) titles[d.nct] ||= d.title.replace(/: primary completion.*$/, ""); });
  const topics = Object.entries(W?.topics || {}).filter(([k]) => !["follow", "devices", "pma", "drugs"].includes(k));
  return el("section", { class: "sect", id: "tune-watch" }, el("h2", {}, "Watch"),
    el("p", { class: "sub" }, "Changes in trials, FDA approvals and clearances, and federal rules, in Explore → Watch and once in Today. Major ones (a new imaging agent or heart valve approved, Phase 3 results posted, a final Medicare payment rule) are alerts."),
    Object.entries(WATCH_KINDS).map(([k, label]) => switchRow(label, {
      trial: "New trials, status changes, results posted, primary completion reached or moved (ClinicalTrials.gov).",
      device: "510(k) clearances from the FDA’s radiology panel, and new heart-valve approvals and indications.",
      drug: "New radiopharmaceuticals and contrast agents, and new indications for them.",
      rule: "Medicare payment rules, NRC rules on medical use of radioactive material, FDA radiology and mammography rules and guidance.",
    }[k], T.watch.kinds[k] !== false, (on) => setW({ kinds: { ...T.watch.kinds, [k]: on } }))),
    switchRow("Only AI among device clearances", "Leaves out routine scanner, coil and workstation clearances.", T.watch.aiOnly, (on) => setW({ aiOnly: on })),
    switchRow("Watch card in Today", "What changed since it last showed, once each.", T.brief.watch, (on) => { setTune({ brief: { ...T.brief, watch: on } }); rerender(); }),
    switchRow("Dates in Coming up", "Phase 3 readouts ahead, comment deadlines and effective dates of rules.", T.watch.dates, (on) => setW({ dates: on })),
    topics.length ? el("details", { class: "outlets" },
      el("summary", {}, "Topics and rules", el("span", { class: "fine" }, `${topics.length}${T.watch.hidden.length ? `, ${T.watch.hidden.length} off` : ""}`)),
      topics.map(([k, name]) => switchRow(name, null, !T.watch.hidden.includes(k),
        (on) => setW({ hidden: on ? T.watch.hidden.filter((x) => x !== k) : [...T.watch.hidden, k] })))) : null,
    T.watch.mute.length ? el("div", {}, el("div", { class: "ctl-label" }, "Words hidden from Watch and alerts"),
      el("div", { class: "chips wrap" }, T.watch.mute.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Show ${w} again`,
        onclick: () => setW({ mute: T.watch.mute.filter((x) => x !== w) }) }, `${w}  ✕`)))) : null,
    (() => {
      const n = Object.keys(T.taste).filter((f) => /^w(?:k|t|c|p|a|o|ph):/.test(f)).length;
      return el("p", { class: "fine" }, n ? `${plural(n, "rating")} of device types, companies, kinds of change and the like, in What you like. ` : "",
        "Tap Rate on a Watch change or an alert to hide or move down ones like it (a device type, a company, 510(k) clearances…), or to move them up.");
    })(),
    T.watch.follow.length ? el("div", {}, el("div", { class: "ctl-label" }, "Trials you follow"),
      el("div", { class: "chips wrap" }, T.watch.follow.map((n) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Stop following ${n}`,
        onclick: () => setW({ follow: T.watch.follow.filter((x) => x !== n) }) }, `${titles[n] || n}  ✕`)))) : null,
    advanced("watch", stepRow("Changes on Today’s card", "The rest are a tap away in Watch.", T.brief.watchRows, { min: 1, max: 12 },
      (v) => { setTune({ brief: { ...T.brief, watchRows: v } }); rerender(); })),
    el("p", { class: "fine" }, "Follow a trial from its page in Watch. To add trial topics of your own, or change which results are alerts, use Tune → Updates → Watch → Change settings."));
}
