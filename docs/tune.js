/* Readout — Tune tab: what you read, the rules that build the feed, and how the update jobs are doing.
   Feed rules live on this phone (localStorage); the update jobs' settings live in config/*.yaml on GitHub. */
"use strict";

const REPO = location.hostname.endsWith("github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1] || "readout"}`
  : "DanielLGray/readout";
const GH = `https://github.com/${REPO}`;
const TU = { pane: store.get("tunePane", "reading"), span: "7", armed: null, wordDraft: "" };

const KIND_COLOR = { paper: "var(--ink)", industry: "var(--h3)", societies: "var(--k-soc)", health: "var(--h2)", science: "var(--h4)",
  light: "var(--k-light)", general: "var(--k-gen)", business: "var(--k-biz)", sff: "var(--h5)" };
const kindColor = (k) => KIND_COLOR[k] || "var(--muted)";
const kindLabel = (k) => (k === "paper" ? "Papers" : newsKinds()[k] || k);
const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// ── small controls ─────────────────────────────────────────────────────────
function tsec(title, sub, ...kids) {
  return el("section", { class: "sect" }, el("h2", {}, title), sub ? el("p", { class: "sub" }, sub) : null, ...kids);
}
function segPick(label, opts, value, onpick, note) {
  return el("div", { class: "ctl" },
    label ? el("div", { class: "ctl-label" }, label) : null,
    el("div", { class: "seg", role: "group", "aria-label": label || "Choose", style: `grid-template-columns:repeat(${opts.length},1fr)` },
      opts.map(([v, l]) => el("button", { "aria-pressed": String(String(v) === String(value)), onclick: () => onpick(v) }, l))),
    note ? el("p", { class: "fine" }, note) : null);
}
function switchRow(label, sub, on, onchange) {
  return el("div", { class: "switch-row" },
    el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, label), sub ? el("p", { class: "fine", style: "margin:2px 0 0" }, sub) : null),
    el("button", { class: "switch", role: "switch", "aria-checked": String(!!on), "aria-label": label, onclick: () => onchange(!on) }));
}
// a number with − and +: o { min, max, step, unit, empty (what null means, e.g. "No limit": − from it gives max, + past max gives it) }
function numStep(value, o, onChange, label) {
  const step = o.step || 1;
  if ((o.max - o.min) / step > 40) {             // a wide range: type the number (empty: what null means)
    const inp = el("input", { type: "number", class: "num-in", min: o.min, max: o.max, step, inputmode: step < 1 ? "decimal" : "numeric",
      value: value == null ? "" : value, placeholder: o.empty || String(o.min), "aria-label": label });
    const commit = () => {
      const t = inp.value.trim();
      if (!t) { if (o.empty && value != null) onChange(null); else inp.value = value ?? ""; return; }
      let v = Number(t);
      if (!isFinite(v)) { inp.value = value ?? ""; return; }
      v = Math.min(o.max, Math.max(o.min, Math.round(v / step) * step));
      v = Math.round(v * 1000) / 1000;
      if (v !== value) onChange(v); else inp.value = v;
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
    return el("label", { class: "num-wrap" }, inp, o.unit && value != null ? el("span", { class: "fine" }, o.unit) : null);
  }
  const fix = (v) => Math.round(v * 1000) / 1000;
  const dec = step < 1 ? (String(step).split(".")[1] || "").length : 0;
  const show = value == null ? o.empty || "—" : `${String(Number(Number(value).toFixed(dec)))}${o.unit ? ` ${o.unit}` : ""}`;
  return el("div", { class: "stepper wide", role: "group", "aria-label": label },
    el("button", { "aria-label": `Less: ${label}`, disabled: value == null ? !o.empty : value - step < o.min - 1e-9,
      onclick: () => onChange(value == null ? o.max : fix(Math.max(o.min, value - step))) }, "−"),
    el("output", {}, show),
    el("button", { "aria-label": `More: ${label}`, disabled: value == null || (value + step > o.max + 1e-9 && !o.empty),
      onclick: () => onChange(value + step > o.max + 1e-9 ? null : fix(value + step)) }, "+"));
}
function stepRow(label, sub, value, o, onChange) {
  return el("div", { class: "switch-row" },
    el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, label), sub ? el("p", { class: "fine", style: "margin:2px 0 0" }, sub) : null),
    numStep(value, o, onChange, label));
}
// the finer controls, folded away under each section
const ADV_OPEN = new Set();
function advanced(id, ...kids) {
  return el("details", { class: "outlets adv", ...(ADV_OPEN.has(id) ? { open: true } : {}),
    ontoggle: (e) => { if (e.currentTarget.open) ADV_OPEN.add(id); else ADV_OPEN.delete(id); } },
    el("summary", {}, "Advanced"), kids);
}
function swatch(k) { return el("span", { class: "sw" + (k === "sff" ? " round" : ""), style: `background:${kindColor(k)}` }); }
function hbar(frac, color) {
  const w = Math.max(frac > 0 ? 2 : 0, Math.round(Math.min(1, frac) * 100));
  return el("span", { class: "hbar" }, el("i", { style: `width:${w}%;background:${color}` }));
}
function stack(parts) {          // [[count, color, label]]
  const total = parts.reduce((a, p) => a + p[0], 0) || 1;
  return el("div", { class: "stack", role: "img", "aria-label": parts.map((p) => `${p[2]} ${pctOf(p[0], total)}%`).join(", ") },
    parts.filter((p) => p[0]).map((p) => el("i", { style: `flex-grow:${p[0]};background:${p[1]}` })));
}
function legend(parts) {
  const total = parts.reduce((a, p) => a + p[0], 0) || 1;
  return el("ul", { class: "legend" }, parts.map(([n, color, label, k]) => el("li", {},
    k ? swatch(k) : el("span", { class: "sw", style: `background:${color}` }), el("span", {}, label),
    el("b", {}, n.toLocaleString()), el("span", { class: "lg-pct" }, `${pctOf(n, total)}%`))));
}
function dayBars(values, labels, opts = {}) {      // values: [[back, front]]
  const n = values.length, w = 340, h = opts.h || 64, gap = n > 14 ? 2 : 6;
  const bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...values.map((v) => v[0]));
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, preserveAspectRatio: "none", class: "daybars", "aria-hidden": "true" });
  values.forEach(([a, b], i) => {
    const x = i * (bw + gap);
    const ha = Math.max(a ? 2 : 1, (a / max) * h), hb = (b / max) * h;
    const r1 = svgEl("rect", { x, y: h - ha, width: bw, height: ha, rx: 1.5 }); r1.style.fill = "var(--h0)"; svg.append(r1);
    if (b) { const r2 = svgEl("rect", { x, y: h - hb, width: bw, height: Math.max(2, hb), rx: 1.5 }); r2.style.fill = opts.front || "var(--h3)"; svg.append(r2); }
  });
  return el("div", { class: "chart" }, svg,
    labels ? el("div", { class: "chart-years" }, labels.map((l) => el("span", {}, l))) : null);
}
function twoTap(id, label, confirmLabel, action) {
  const armed = TU.armed === id;
  return el("button", { class: "act wide" + (armed ? " danger" : ""), onclick: () => {
    if (!armed) { TU.armed = id; renderTune(true); setTimeout(() => { if (TU.armed === id) { TU.armed = null; renderTune(true); } }, 4000); return; }
    TU.armed = null; action();
  } }, armed ? confirmLabel : label);
}
function linkBtn(href, label) { return el("a", { class: "act", href, target: "_blank", rel: "noopener" }, label); }

// ── tab ────────────────────────────────────────────────────────────────────
function setPane(p, anchor) {
  TU.pane = p;
  store.set("tunePane", p);
  renderTune();
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
}
function renderTune(keepScroll) {
  const view = $("#view-tune");
  const top = view.scrollTop;
  const panes = { reading: readingPane, interests: interestsPane, algorithms: algoPane, pipeline: pipelinePane };
  if (!panes[TU.pane]) TU.pane = "reading";
  let body;
  try { body = panes[TU.pane](); } catch (err) {
    body = el("section", { class: "sect" }, el("h2", {}, "This page didn’t draw"),
      el("p", { class: "sub" }, `${err?.message || err}. Resetting the feed rules usually fixes it; your saved items stay.`),
      el("div", { class: "link-row" }, el("button", { class: "act wide", onclick: () => {
        store.set("tune", {}); T = loadTune(); S.feedDirty = true; S.exploreKey = null; renderTune();
      } }, "Reset feed rules")));
  }
  view.replaceChildren(el("div", { class: "tune" },
    el("div", { class: "seg pane-seg", role: "tablist", "aria-label": "Tune sections" },
      [["reading", "Reading"], ["interests", "Interests"], ["algorithms", "Rules"], ["pipeline", "Updates"]].map(([k, l]) =>
        el("button", { role: "tab", "aria-selected": String(TU.pane === k), "aria-pressed": String(TU.pane === k), onclick: () => setPane(k) }, l))),
    body));
  view.scrollTop = keepScroll ? top : 0;
}
const rerender = () => renderTune(true);

// ── reading comfort, library access, your data ─────────────────────────────
function textSizeSection() {
  return el("section", { class: "sect", id: "tune-text" }, el("h2", {}, "Text size"),
    el("p", { class: "sub" }, "For conclusions, headlines and abstracts. Very long conclusions continue in the abstract."),
    segPick(null, [[0.9, "Small"], [1, "Default"], [1.12, "Large"], [1.25, "Larger"]], T.textSize, (v) => {
      setTune({ textSize: Number(v) }); applyTextSize(); requestAnimationFrame(fitAll); rerender();
    }));
}

// phones only: iPads and computers always show compact cards, in columns
function layoutSection() {
  if (WIDE.matches) return null;
  return el("section", { class: "sect", id: "tune-layout" }, el("h2", {}, "Cards"),
    segPick(null, [["compact", "Compact"], ["paged", "One per screen"]], T.cardLayout, (v) => {
      setTune({ cardLayout: v }); S.feedDirty = true; rerender();
    }, "Compact: each card is as tall as what it holds, so the next one starts right below. One per screen: each card fills the screen and you swipe up card by card. iPads and computers always show compact cards, in columns."));
}

function librarySection() {
  const input = el("input", { type: "url", class: "text-in wide", placeholder: "https://login.ezproxy.yourlibrary.org/login?url=",
    "aria-label": "Library link prefix", value: T.library || "", autocapitalize: "off", autocomplete: "off", inputmode: "url", enterkeyhint: "done" });
  const save = () => {
    const v = input.value.trim();
    if (v && !/^https?:\/\/\S{4,300}$/i.test(v)) { toast("That doesn’t look like a web address. It should start with https://"); return; }
    setTune({ library: v }); toast(v ? "Journal links now go through your library" : "Library link removed"); rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  const sample = (S.feed?.items || []).find((i) => doiUrl(i.doi));
  return el("section", { class: "sect", id: "tune-library" }, el("h2", {}, "Library access"),
    el("p", { class: "sub" }, "Paste the link your hospital or university library gives for reading journals off campus (often called EZproxy or OpenAthens; the library’s website or help desk has it). Journal buttons then open articles through it, with your institution’s subscriptions."),
    input,
    el("p", { class: "fine" }, "Examples: https://login.ezproxy.yourlibrary.org/login?url=   or   https://go.openathens.net/redirector/yourhospital.org?url=   Put {url} where the article address goes if your library’s link needs it in the middle."),
    el("div", { class: "link-row" },
      el("button", { class: "act", onclick: save }, "Save"),
      T.library ? el("button", { class: "act", onclick: () => { input.value = ""; save(); } }, "Remove") : null,
      T.library && sample ? el("a", { class: "act", href: libraryUrl(doiUrl(sample.doi)), target: "_blank", rel: "noopener" }, "Try it") : null));
}

function backupSection() {
  const n = Object.keys(S.saved).length;
  const file = el("input", { type: "file", accept: ".json,application/json", hidden: true,
    onchange: (e) => { restoreFrom(e.target.files?.[0]); e.target.value = ""; } });
  return el("section", { class: "sect", id: "tune-backup" }, el("h2", {}, "Back up and restore"),
    el("p", { class: "sub" }, `Your ${plural(n, "saved item")}, settings, ratings, cleared cards, Foundations progress and reading history live only on this phone. Keep a copy in Files or iCloud Drive; restore it after deleting the app or on a new phone.`),
    el("div", { class: "link-row" },
      el("button", { class: "act", onclick: backupNow }, "Back up"),
      el("button", { class: "act", onclick: () => file.click() }, "Restore from a backup"), file),
    el("p", { class: "fine" }, "Restoring adds the backup’s saved items to what’s here (nothing here is removed) and brings back its settings."));
}

async function backupNow() {
  const data = { app: "readout", version: 1, exported: new Date().toISOString(),
    saved: S.saved, tune: store.get("tune", {}), stats, pos: store.get("pos", {}), fdRead, quiz: QUIZ, cleared, whyTally };
  const name = `readout-backup-${localDay()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  try {
    const f = new File([blob], name, { type: "application/json" });
    if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: "Readout backup" }); return; }
  } catch (e) { if (e?.name === "AbortError") return; }     // closed the share sheet
  const a = el("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("Backup saved to Downloads");
}

async function restoreFrom(file) {
  if (!file) return;
  let d = null;
  try { d = JSON.parse(await file.text()); } catch { /* not JSON */ }
  if (!d || d.app !== "readout" || !d.saved || typeof d.saved !== "object") { toast("That file isn’t a Readout backup."); return; }
  // only well-formed items: a paper with a PMID, or a story with a web link
  const ok = (v) => v && typeof v === "object" && typeof v.title === "string"
    && ((v.pmid && /^\d{1,9}$/.test(String(v.pmid))) || (typeof v.link === "string" && /^https?:\/\//i.test(v.link)));
  let added = 0;
  for (const [k, v] of Object.entries(d.saved)) if (ok(v) && !S.saved[k]) { S.saved[k] = v; added++; }
  if (d.tune && typeof d.tune === "object") { store.set("tune", d.tune); T = loadTune(); applyTextSize(); }
  if (d.stats?.days && typeof d.stats.days === "object") {
    for (const [day, v] of Object.entries(d.stats.days)) if (!stats.days[day] && v && typeof v === "object") stats.days[day] = v;
    saveStats();
  }
  if (d.pos && typeof d.pos === "object") store.set("pos", { ...d.pos, ...(store.get("pos", {}) || {}) });
  if (d.fdRead && typeof d.fdRead === "object") {          // Foundations progress: read in either copy counts
    for (const [k, v] of Object.entries(d.fdRead)) if (/^\d{1,9}$/.test(k) && typeof v === "string" && !fdRead[k]) fdRead[k] = v.slice(0, 10);
    store.set("fdRead", fdRead);
  }
  if (d.quiz?.by && typeof d.quiz.by === "object") {
    for (const [k, v] of Object.entries(d.quiz.by)) if (["r", "p", "w"].includes(v) && !QUIZ.by[k]) QUIZ.by[k] = v;
    for (const [k, v] of Object.entries(d.quiz.days || {})) if (Array.isArray(v) && !QUIZ.days[k]) QUIZ.days[k] = v.slice(0, 3).map((n) => Math.max(0, Number(n) || 0));
    store.set("quiz", QUIZ);
  }
  if (d.cleared && typeof d.cleared === "object") {        // cards you cleared stay cleared (and snoozed ones snoozed)
    for (const [k, v] of Object.entries(d.cleared)) {
      if (typeof k === "string" && k.length < 80 && typeof v === "string" && /^(?:z:)?\d{4}-\d{2}-\d{2}$/.test(v) && !cleared[k]) cleared[k] = v;
    }
    setCleared("", false);                                  // saves, and drops anything past its 90 days
  }
  if (d.whyTally && typeof d.whyTally === "object") {      // the larger count of each, so restoring your own backup doesn't double it
    for (const k of Object.keys(WHY)) { const n = Math.floor(Number(d.whyTally[k]) || 0); if (n > (whyTally[k] || 0)) whyTally[k] = Math.min(n, 1e6); }
    store.set("whyTally", whyTally);
  }
  toast(store.set("saved", S.saved) ? `Restored ${plural(added, "saved item")} and your settings`
    : "Couldn’t restore everything: Readout’s storage on this phone is full.");
  S.feedDirty = true; S.exploreKey = null; renderTune(true);
}

// ── Today, guess the result, pictures ──────────────────────────────────────
function todaySection() {
  const b = T.brief;
  const setB = (k, v) => { setTune({ brief: { ...T.brief, [k]: v } }); rerender(); };
  const q = quizTotals(30), tried = q.r + q.p + q.w;
  return el("section", { class: "sect", id: "tune-today" }, el("h2", {}, "Today"),
    el("p", { class: "sub" }, "A short stack each morning: the best new papers for your areas, the day’s big stories, the classic of the day, one paper from outside your areas, something lighter and your next Foundations paper, then “You’re caught up.”"),
    segPick("Open the app on", [["today", "Today"], ["all", "Everything"], ["papers", "Papers"], ["important", "Most important"]], T.startOn,
      (v) => { setTune({ startOn: v }); rerender(); }),
    segPick("New papers in Today", [[3, "3"], [5, "5"], [8, "8"]], b.papers, (v) => setB("papers", Number(v))),
    segPick("Stories in Today", [[0, "None"], [2, "2"], [3, "3"]], b.stories, (v) => setB("stories", Number(v))),
    switchRow("Classic of the day", "A highly cited paper at least five years old from your areas: in Today, and a few cards into Everything.", b.classic, (on) => setB("classic", on)),
    switchRow("Outside your areas", "One paper a day from NEJM, The Lancet, JAMA, BMJ and other big general journals that your areas wouldn’t find: recent, and already being cited. Chosen weekly with the Most important lists.", b.wide, (on) => setB("wide", on)),
    switchRow("Something lighter", "One Light reading story a day: Wikipedia’s featured article, NASA’s image of the day, Atlas Obscura, Smithsonian and the like.", b.light, (on) => setB("light", on)),
    switchRow("Next Foundations paper", "Your next unread paper from the reading path in Explore.", b.foundations, (on) => setB("foundations", on)),
    switchRow("Coming up", `The next ${b.hzDays} days of events you follow: earnings, the Fed, tax dates and sales, meetings, launches, awards and movie releases. Choose which in Tune → Interests.`, b.horizon, (on) => setB("horizon", on)),
    b.horizon ? segPick("Coming up covers", [[3, "3 days"], [7, "7 days"], [14, "14 days"]], b.hzDays, (v) => setB("hzDays", Number(v))) : null,
    advanced("today",
      stepRow("New papers in Today", null, b.papers, { min: 1, max: 12 }, (v) => setB("papers", v)),
      stepRow("Stories in Today", null, b.stories, { min: 0, max: 8 }, (v) => setB("stories", v)),
      stepRow("Coming up covers", null, b.hzDays, { min: 1, max: 30, unit: b.hzDays === 1 ? "day" : "days" }, (v) => setB("hzDays", v)),
      stepRow("Changes on the Watch card", null, b.watchRows, { min: 1, max: 12 }, (v) => setB("watchRows", v)),
      todayOrderEl()),
    segPick("Your week, as a card", WEEK_DAYS, b.week, (v) => setB("week", Number(v)),
      "A summary of the last seven days on that day: alerts, Watch changes, the Radar, papers passing citation milestones, the biggest stories and your reading. Explore → Your week has it any day."),
    segPick("Guess the result", [["off", "Off"], ["brief", "In Today"], ["all", "Everywhere"]], T.guess,
      (v) => { setTune({ guess: v }); rerender(); },
      "The card shows the question and the methods; the authors’ conclusion appears when you tap. In Today: two papers a day. Everywhere: also about one paper in six in Papers and Everything."),
    tried ? el("p", { class: "fine" }, `Last 30 days: you called ${q.r} of ${plural(tried, "result")}${q.p ? `, and nearly ${q.p} more` : ""}.`) : null,
    el("div", { id: "tune-weather" }, switchRow("Weather for Reno, NV", "Today’s and tomorrow’s highs, lows and forecast under the chips, from the National Weather Service (NOAA). Your phone asks api.weather.gov directly.", T.weather,
      (on) => { setTune({ weather: on }); if (on) wxRefresh(0); else renderWx(); rerender(); })),
    switchRow("Pictures", "A figure from each open-access paper whose license allows it, credited, and the picture each news outlet puts in its feed. Off: no pictures, less data.", T.pictures,
      (on) => { setTune({ pictures: on }); rerender(); }),
    switchRow("Bylines", "Who wrote each news story, under its summary, when the outlet’s feed says. Rate on a story can hide or favor a writer either way.", T.bylines,
      (on) => { setTune({ bylines: on }); rerender(); }),
    switchRow("Why this card", "A line on each paper and story saying what put it there: the list, words you follow, what you’ve rated, its area. Tap it for the whole account, with the paper’s score.", T.why,
      (on) => { setTune({ why: on }); rerender(); }));
}

// the order of Today's parts: up and down, and the parts that have a switch
function todayOrderEl() {
  const order = T.brief.order || Object.keys(BRIEF_PARTS);
  const full = order.concat(Object.keys(BRIEF_PARTS).filter((k) => !order.includes(k)));
  const move = (i, d) => { const o = full.slice(); [o[i], o[i + d]] = [o[i + d], o[i]]; setTune({ brief: { ...T.brief, order: o } }); rerender(); };
  const onOf = { horizon: "horizon", radar: "radar", watch: "watch", classic: "classic", wide: "wide", light: "light", foundations: "foundations" };
  const offNote = (k) => (k === "cites" && !T.citeAlerts ? "off" : k === "stories" && !T.brief.stories ? "none" : onOf[k] && !T.brief[onOf[k]] ? "off" : "");
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Order"),
    el("p", { class: "fine", style: "margin:2px 0 6px" }, T.brief.order ? "Each part comes whole, in this order, after the alerts and the cover."
      : "The usual order spreads the stories, the classic and the outside paper between the papers. Move any part to set your own."),
    el("ul", { class: "rows" }, full.map((k, i) => el("li", { class: "row ord-row" },
      el("span", { class: "row-name" }, BRIEF_PARTS[k], offNote(k) ? el("span", { class: "fine" }, ` · ${offNote(k)}`) : null),
      el("div", { class: "ord-btns" },
        el("button", { class: "act", "aria-label": `Move ${BRIEF_PARTS[k]} up`, disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
        el("button", { class: "act", "aria-label": `Move ${BRIEF_PARTS[k]} down`, disabled: i === full.length - 1, onclick: () => move(i, 1) }, "↓"))))),
    T.brief.order ? el("button", { class: "fb-forget", onclick: () => { setTune({ brief: { ...T.brief, order: null } }); rerender(); } }, "Back to the usual order") : null);
}

// ── your reading ───────────────────────────────────────────────────────────
function readingPane() {
  const days = Number(TU.span);
  const agg = statsFor(days);
  const kinds = ["paper", ...Object.keys(newsKinds())];
  const sum = [0, 0, 0, 0];
  kinds.forEach((k) => (agg.k[k] || [0, 0, 0, 0]).forEach((n, i) => { sum[i] += n; }));
  const [seen, opened, saved, listened] = sum;
  const out = [
    hintsSection(),
    textSizeSection(),
    layoutSection(),
    todaySection(),
    el("section", { class: "sect", id: "tune-stats" }, el("h2", {}, "Your reading"),
      segPick(null, [["7", "Last 7 days"], ["30", "Last 30 days"]], TU.span, (v) => { TU.span = v; rerender(); })),
  ];
  if (!seen && !opened) {
    out.push(el("section", { class: "sect" }, el("h2", {}, "Nothing counted yet"),
      el("p", { class: "sub" }, "Scroll the feed for a while and come back. A card counts as read once it stays on screen for about a second; opening an abstract, article or PubMed page counts as opened.")));
  } else {
    out.push(el("p", { class: "lede" },
      `You read ${plural(seen, "card")} and opened ${opened.toLocaleString()}`, seen ? ` (${pctOf(opened, seen)}%)` : "", ". ",
      saved || listened ? `${saved ? `Saved ${saved}` : ""}${saved && listened ? ", listened to " : listened ? "Listened to " : ""}${listened ? plural(listened, "episode") : ""}.` : ""));
    const labels = days === 7
      ? agg.daily.map((d) => "SMTWTFS"[new Date(d.d + "T12:00").getDay()])
      : [fmtDate(agg.daily[0].d), "today"];
    out.push(dayBars(agg.daily.map((d) => [d.seen, d.open]), labels),
      el("p", { class: "fine", style: "margin-top:2px" }, el("span", { class: "key", style: "background:var(--h0)" }), " read  ",
        el("span", { class: "key", style: "background:var(--h3)" }, ""), " opened"));

    // by kind: what you open, relative to what you're shown
    const rows = kinds.filter((k) => agg.k[k]).map((k) => {
      const [s, o] = agg.k[k];
      return { k, s, o, rate: s ? o / s : 0 };
    });
    const maxRate = Math.max(0.01, ...rows.map((r) => r.rate));
    out.push(tsec("By kind", "How often you open what the feed shows you.",
      el("ul", { class: "rows" }, rows.map((r) => el("li", { class: "row" }, el("div", { class: "row-static" },
        el("span", { class: "row-name" }, swatch(r.k), kindLabel(r.k)),
        el("span", { class: "row-fig" }, r.s ? `${pctOf(r.o, r.s)}%` : "—"),
        el("span", { class: "row-sub" }, hbar(r.rate / maxRate, kindColor(r.k)), el("span", {}, `${r.o} of ${r.s}`))))))));

    const srcs = Object.entries(agg.s).filter(([, v]) => v[1]).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]).slice(0, 6);
    if (srcs.length) {
      out.push(tsec("Opened most", "Journals and outlets.",
        el("ul", { class: "rows" }, srcs.map(([name, v]) => el("li", { class: "row" }, el("div", { class: "row-static" },
          el("span", { class: "row-name" }, name), el("span", { class: "row-fig" }, String(v[1])),
          el("span", { class: "row-sub" }, `${plural(v[0], "card")} read${v[2] ? `, ${v[2]} saved` : ""}`)))))));
    }
    const sys = S.feed?.systems || {};
    const ys = Object.keys(sys).filter((y) => agg.y[y]).sort((a, b) => agg.y[b][0] - agg.y[a][0]);
    if (ys.length) {
      const maxS = Math.max(...ys.map((y) => agg.y[y][0]));
      out.push(tsec("Papers by organ system", "Papers read, and how many you opened.",
        el("div", { class: "ladder" }, ys.map((y) => el("div", { class: "rung" },
          el("span", {}, sys[y]), el("b", {}, `${agg.y[y][1]} of ${agg.y[y][0]}`), hbar(agg.y[y][0] / maxS, "var(--faint)"))))));
    }
  }
  out.push(feedNowSection());
  out.push(el("p", { class: "fine" }, "Counted on this phone only, never sent anywhere. History older than 120 days is dropped."),
    el("div", { class: "link-row" }, twoTap("clear", "Clear reading history", "Tap again to clear", () => {
      stats = { days: {} }; seenToday = { d: "" }; saveStats(); toast("Reading history cleared"); rerender();
    })));
  out.push(librarySection(), backupSection());
  return out;
}

// Suggestions from your reading (the last 30 days): each says what it noticed and offers one change.
// Nothing changes until you tap; Not now hides one for a month.
let hintsOff = store.get("hintsOff", null);
if (!hintsOff || typeof hintsOff !== "object" || Array.isArray(hintsOff)) hintsOff = {};
function readingHints() {
  const agg = statsFor(30);
  const cut = localDay(daysAgo(30));
  const off = (id) => hintsOff[id] && hintsOff[id] >= cut;
  const out = [];
  const kinds = ["paper", ...Object.keys(newsKinds())];
  let seen = 0, opened = 0;
  kinds.forEach((k) => { const v = agg.k[k] || []; seen += v[0] || 0; opened += (v[1] || 0) + (v[2] || 0) + (v[3] || 0); });
  // kinds you open far more, or far less, than the rest of the feed
  if (opened && seen >= 30) {
    const avg = opened / seen;
    for (const k of kinds.filter((x) => x !== "paper")) {
      const v = agg.k[k] || [];
      const s = v[0] || 0, o = (v[1] || 0) + (v[2] || 0) + (v[3] || 0), w = T.mix[k] ?? 1, name = kindLabel(k).toLowerCase();
      if (s >= 12 && o / s >= 1.6 * avg && w < 4) {
        out.push({ id: `more:${k}`, text: `You open ${name} ${(o / s / avg).toFixed(1)}× as often as the rest of the feed.`,
          label: `Give ${name} more turns`, apply: () => { setTune({ mix: { ...T.mix, [k]: w + 1 } }); toast(`${kindLabel(k)}: ${w + 1} turns per round`); } });
      } else if (s >= 25 && o / s <= 0.35 * avg && w > 0) {
        out.push({ id: `less:${k}`, text: `You open ${pctOf(o, s)}% of ${name} cards, well below your average of ${pctOf(opened, seen)}%.`,
          label: w - 1 ? `Fewer ${name}` : `Take ${name} out of Everything`,
          apply: () => { setTune({ mix: { ...T.mix, [k]: w - 1 } }); toast(w - 1 ? `${kindLabel(k)}: ${w - 1} turn per round` : `${kindLabel(k)} left Everything`); } });
      }
    }
  }
  const outlets = new Set((S.news?.sources || []).map((x) => x.name));
  const muted = new Set(T.mutedSources || []);
  for (const [name, v] of Object.entries(agg.s)) {
    const [, o = 0, sv = 0, l = 0, c = 0] = v;
    const f = outlets.has(name) ? `src:${name}` : `jr:${name}`;
    // an outlet you keep clearing and never open
    if (outlets.has(name) && !muted.has(name) && c >= 6 && !o && !sv && !l && T.taste[f] == null) {
      out.push({ id: `drop:${name}`, text: `You cleared ${c} stories from ${name} this month and opened none.`,
        label: `Less from ${name}`, apply: () => { setTaste(f, -1); toast(`Less from ${name}. Undo in Tune → Interests.`); } });
    }
    // a journal or outlet you save from often
    if (sv >= 3 && (T.taste[f] ?? 0) < 1 && tasteW(f) < 1) {
      out.push({ id: `keep:${name}`, text: `You saved ${sv} ${outlets.has(name) ? "stories" : "papers"} from ${name} this month.`,
        label: `More from ${name}`, apply: () => { setTaste(f, 1); toast(`More from ${name}. Undo in Tune → Interests.`); } });
    }
  }
  if ((whyTally.weak || 0) >= 5 && T.order !== "ranked") {
    out.push({ id: "rank", text: `You’ve cleared ${whyTally.weak} papers as weak studies.`,
      label: "Put stronger evidence first", apply: () => { setTune({ order: "ranked" }); toast("Papers ranked: evidence, size and freshness"); } });
  }
  return out.filter((h) => !off(h.id)).slice(0, 3);
}
function hintsSection() {
  const hints = readingHints();
  if (!hints.length) return null;
  return el("section", { class: "sect", id: "tune-hints" }, el("h2", {}, "Suggestions from your reading"),
    el("p", { class: "sub" }, "From the last 30 days on this phone. Nothing changes until you tap."),
    el("div", { class: "hints" }, hints.map((h) => el("div", { class: "hint" },
      el("p", {}, h.text),
      el("div", { class: "link-row", style: "margin:0" },
        el("button", { class: "act", onclick: () => { h.apply(); rerender(); } }, h.label),
        el("button", { class: "act", onclick: () => { hintsOff[h.id] = localDay(); store.set("hintsOff", hintsOff); rerender(); } }, "Not now"))))));
}

function feedNowSection() {
  const R = {};
  const list = filtered({ kind: "all", system: "all", strong: false, topic: null }, R).filter((i) => i.type !== "top");
  const by = {};
  list.forEach((i) => { const k = i.type === "paper" ? "paper" : i.kind; by[k] = (by[k] || 0) + 1; });
  const parts = ["paper", ...Object.keys(newsKinds())].filter((k) => by[k]).map((k) => [by[k], kindColor(k), kindLabel(k), k]);
  const left = [
    R.capped ? `${R.capped.toLocaleString()} held back by the per-outlet limit` : null,
    R.off ? `${R.off.toLocaleString()} from kinds you turned off` : null,
    R.muted ? `${R.muted.toLocaleString()} muted` : null,
    R.pending ? `${R.pending.toLocaleString()} papers waiting for an abstract` : null,
    R.areaOff ? `${R.areaOff.toLocaleString()} papers from areas you turned off` : null,
    R.dupes ? `${R.dupes.toLocaleString()} repeat headlines` : null,
    R.obits ? `${plural(R.obits, "death notice")} few outlets ran` : null,
  ].filter(Boolean);
  return tsec("Your feed right now", `Everything has ${plural(list.length, "card")}, going back ${S.feed?.settings?.keep_days || 180} days for papers.`,
    stack(parts), legend(parts),
    left.length ? el("p", { class: "fine" }, `Left out of Everything: ${left.join("; ")}. Each kind’s chip still shows its full list.`) : null,
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => setPane("algorithms") }, "Change the mix"),
      el("button", { class: "act", onclick: () => setPane("algorithms", "tune-hidden") }, "What your filters hid")));
}

// ── interests ──────────────────────────────────────────────────────────────
const FOLLOW_IDEAS = ["TAVR", "PSMA", "FAPI", "theranostics", "LI-RADS", "CAD-RADS", "photon-counting", "appropriateness criteria", "amyloid", "incidental"];
function interestsPane() {
  const feedN = {}, impN = {};
  (S.feed?.items || []).forEach((p) => areasOf(p).forEach((a) => { feedN[a] = (feedN[a] || 0) + 1; }));
  Object.values(S.important?.papers || {}).forEach((p) => areasOf(p).forEach((a) => { impN[a] = (impN[a] || 0) + 1; }));
  const setArea = (a, v) => {
    const next = { ...T.areas, [a]: Number(v) };
    if (!areaList().some(([k]) => (next[k] ?? 2) > 0)) { toast("Keep at least one area on"); return; }
    setTune({ areas: next }); if (S.area === a && !v) S.area = "all"; rerender();
  };
  const re = followRe();
  const count = (term) => {
    const r = wordRe([term]);
    if (!r) return 0;
    return (S.feed?.items || []).filter((p) => r.test(`${p.title} ${p.conclusion?.text || ""}`)).length
      + (S.news?.items || []).filter((n) => r.test(`${n.title} ${n.summary || ""}`)).length;
  };
  const input = el("input", { type: "text", class: "text-in", placeholder: "A word or phrase, like TAVR", "aria-label": "Word to follow",
    value: TU.followDraft || "", autocapitalize: "off", autocomplete: "off", enterkeyhint: "done" });
  const add = (w0) => {
    const w = (w0 ?? input.value).trim();
    TU.followDraft = "";
    if (!w || T.follow.some((x) => x.toLowerCase() === w.toLowerCase())) { input.value = ""; return; }
    setTune({ follow: [...T.follow, w] }); toast(`Following “${w}”`); rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  input.addEventListener("input", () => { TU.followDraft = input.value; });
  const systems = S.feed?.systems || {};
  return [
    el("p", { class: "lede small" }, "What Readout brings you. Changes here apply on this phone right away."),
    el("section", { class: "sect", id: "tune-areas" }, el("h2", {}, "Areas"),
      el("p", { class: "sub" }, "How much of your feed each area gets. Off hides it everywhere: Everything, Papers and Most important."),
      areaList().map(([a, info]) => el("div", { class: "area" },
        el("div", { class: "area-head" }, el("b", {}, info.label || a),
          el("span", { class: "fine", style: "margin:0" }, `${(feedN[a] || 0).toLocaleString()} in the feed · ${(impN[a] || 0).toLocaleString()} most important`)),
        info.about ? el("p", { class: "fine", style: "margin:2px 0 0" }, info.about) : null,
        segPick(null, [[0, "Off"], [1, "Less"], [2, "Normal"], [3, "More"]], T.areas[a] ?? 2, (v) => setArea(a, v))))),
    el("section", { class: "sect", id: "tune-follow" }, el("h2", {}, "Following"),
      el("p", { class: "sub" }, "Papers and news that mention these get a Following chip of their own and a tag on the card. Whole words; end one with * for any ending, like radiolog*."),
      el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: () => add() }, "Follow")),
      T.follow.length ? el("div", { class: "chips wrap" }, T.follow.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Stop following ${w}`,
        onclick: () => { setTune({ follow: T.follow.filter((x) => x !== w) }); rerender(); } }, `${w} · ${count(w)}  ✕`))) : null,
      el("div", { class: "ctl-label" }, "Ideas"),
      el("div", { class: "chips wrap" }, FOLLOW_IDEAS.filter((w) => !T.follow.some((x) => x.toLowerCase() === w.toLowerCase()))
        .map((w) => el("button", { class: "chip", onclick: () => add(w) }, `+ ${w}`))),
      re ? el("p", { class: "fine" }, `${plural(followingList(null).length, "item")} match right now.`) : null),
    tasteSection(),
    meetingsSection(),
    typeof horizonSection === "function" ? horizonSection() : null,
    typeof radarSection === "function" ? radarSection() : null,
    typeof watchSection === "function" ? watchSection() : null,
    el("section", { class: "sect" }, el("h2", {}, "Filter chips"),
      el("p", { class: "sub" }, "Which organ-system chips appear at the top of the feed."),
      el("div", { class: "chips wrap" }, Object.entries(systems).map(([k, label]) => el("button", { class: "chip", "aria-pressed": String(!T.hiddenSystems.includes(k)),
        onclick: () => { setTune({ hiddenSystems: T.hiddenSystems.includes(k) ? T.hiddenSystems.filter((x) => x !== k) : [...T.hiddenSystems, k] }); rerender(); } }, label)))),
    el("section", { class: "sect" }, el("h2", {}, "News"),
      el("p", { class: "sub" }, `${Object.values(newsKinds()).join(", ")}. Turn kinds up, down or off in Rules → Feed mix; mute single outlets in Rules → Mute.`),
      el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => setPane("algorithms") }, "Open Rules"))),
    el("section", { class: "sect" }, el("h2", {}, "Change what Readout fetches"),
      el("p", { class: "sub" }, "The areas’ journals and searches, the news outlets and the Explore topics live in files on GitHub. Edit one there and the next update uses it."),
      settingsList([
        ...areaList().map(([a, info]) => `${info.label || a}: ${(info.streams || []).length || "—"} PubMed searches; papers stay ${info.keep_days || 180} days.`),
        `${(S.news?.sources || []).length} news outlets; ${(S.explore?.topics || []).length} Explore topics.`,
      ]),
      el("div", { class: "link-row" },
        linkBtn(`${GH}/edit/main/config/feeds.yaml`, "Areas and journals"),
        linkBtn(`${GH}/edit/main/config/news.yaml`, "News outlets"),
        linkBtn(`${GH}/edit/main/config/topics.yaml`, "Explore topics"))),
  ];
}

// what you've told Readout you like (learn.js), every rating in one place
const FEATURE_ORDER = ["sys", "tp", "jr", "ds", "src", "fl", "cat", "by", "wk", "wt", "wc", "wp", "wa", "wo", "wph"];
const byFeature = (a, b) => FEATURE_ORDER.indexOf(a.split(":")[0]) - FEATURE_ORDER.indexOf(b.split(":")[0])
  || featureName(a)[0].localeCompare(featureName(b)[0]);
function tasteRow(f, extra) {
  const [name, kind] = featureName(f);
  const v = T.taste[f];
  const lw = T.learned[f] || 0;
  return el("div", { class: "fb-row" + (v === 0 ? " pinned" : "") },
    el("div", { class: "fb-name" }, el("b", {}, name), el("span", {}, kind),
      v == null && lw ? el("span", { class: "fb-learned" }, lw > 0 ? "leaning more" : "leaning less") : null),
    el("div", { class: "seg fb-seg", role: "group", "aria-label": name },
      [[HIDE, "Hide"], [-1, "Less"], [0, "Same"], [1, "More"]].map(([x, l]) => el("button", { "aria-pressed": String(tastePressed(f, x)),
        onclick: () => { setTaste(f, x); rerender(); } }, l))),
    extra || null);
}
function tasteSection() {
  const rated = Object.keys(T.taste).sort(byFeature);
  const learned = Object.keys(T.learned).filter((f) => T.taste[f] == null).sort((a, b) => Math.abs(T.learned[b]) - Math.abs(T.learned[a])).slice(0, 30);
  const nReacts = Object.keys(T.reacts).length;
  const forget = (f) => el("button", { class: "fb-forget", onclick: () => {
    const l = { ...T.learned }; delete l[f]; setTune({ learned: l }); rerender();
  } }, "Forget what Readout learned");
  const subjects = Object.keys(FLAVORS).map((k) => `fl:${k}`).filter((f) => T.taste[f] == null);
  return el("section", { class: "sect", id: "tune-taste" }, el("h2", {}, "What you like"),
    el("p", { class: "sub" }, "Tap Rate on any card to say what you think of its organ system, topic, journal, kind of study, outlet, subject, writer or authors. More moves those cards up, Less moves them down, Hide takes them out of every list."),
    rated.length ? el("div", { class: "taste-list" }, el("div", { class: "ctl-label" }, `You chose (${rated.length})`), rated.map((f) => tasteRow(f)))
      : el("p", { class: "nothing" }, "Nothing rated yet."),
    learned.length ? el("div", { class: "taste-list" }, el("div", { class: "ctl-label" }, "Learned from what you rated, opened and saved"),
      el("p", { class: "fine", style: "margin:2px 0 8px" }, "More like this, Less like this and Not for me nudge these; opening, saving or listening nudges them a little toward more. Choose one to make it exact."),
      learned.map((f) => tasteRow(f, forget(f)))) : null,
    segPick("Learn from what you open and save", [["off", "Off"], [1, "A little"], [2, "More"]], T.learnImplicit ? T.learnRate : "off",
      (v) => { setTune(v === "off" ? { learnImplicit: false } : { learnImplicit: true, learnRate: Number(v) }); rerender(); },
      "Each card you open, save or listen to nudges its organ system, topic, journal, outlet and subjects toward more: a tenth of a More like this (a quarter for a save), or twice that. Nothing you skip or clear counts against anything; only Less like this and Not for me do. Names in bylines are never learned."),
    segPick("What Readout learned fades", [[30, "In a month"], [120, "In 4 months"], [365, "In a year"], [0, "Never"]], T.fade,
      (v) => { setTune({ fade: Number(v) }); rerender(); },
      "How long until a learned leaning is down by half, so an old phase or a one-off rating doesn’t steer the feed for good. Your own choices above never fade."),
    el("details", { class: "outlets" },
      el("summary", {}, "Subjects you can rate", el("span", { class: "fine" }, `${subjects.length}`)),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "Found by words in the title and conclusion, in papers and news alike."),
      el("div", { class: "taste-list" }, subjects.map((f) => tasteRow(f)))),
    rated.length || nReacts || learned.length ? el("div", { class: "link-row" },
      rated.length ? twoTap("tasteClear", "Clear your choices", "Tap again to clear", () => { setTune({ taste: {} }); toast("Choices cleared"); rerender(); }) : null,
      nReacts || learned.length ? twoTap("learnClear", "Forget everything learned", "Tap again to forget", () => { setTune({ learned: {}, reacts: {} }); taught = {}; store.set("taught", taught); toast("Readout forgot what it learned"); rerender(); }) : null) : null);
}

function meetingsSection() {
  const ms = S.news?.meetings || [];
  const gone = store.get("meetingsClosed", {}) || {};
  return el("section", { class: "sect", id: "tune-meetings" }, el("h2", {}, "Meetings"),
    el("p", { class: "sub" }, "Four months ahead, a banner under the chips counts down to each meeting that’s on; ✕ closes it. From a week before until a week after, a chip gathers the news that mentions it."),
    ms.length ? ms.map((m) => {
      const on = meetingOn(m);
      return el("div", {},
        switchRow(m.name, `${fmtRange(m.start, m.end)}, ${m.start.slice(0, 4)}${m.place ? `, ${m.place}` : ""}. ${whenText(m)[0].toUpperCase()}${whenText(m).slice(1)}.`, on,
          (v) => { setTune({ meetings: { ...T.meetings, [m.id]: v } }); renderBanner(); rerender(); }),
        on && gone[m.id] ? el("button", { class: "fb-forget", onclick: () => {
          delete gone[m.id]; store.set("meetingsClosed", gone); renderBanner(); rerender();
        } }, "Show its banner again") : null);
    }) : el("p", { class: "nothing" }, "The meeting list arrives with the next news update."),
    el("div", { class: "link-row" }, linkBtn(`${GH}/edit/main/config/meetings.yaml`, "Edit the meeting list")));
}

// ── feed rules ─────────────────────────────────────────────────────────────
function presentKinds() {
  const ks = [];
  if (S.feed?.items?.length) ks.push("paper");
  const counts = {};
  (S.news?.items || []).forEach((i) => { counts[kindOf(i)] = (counts[kindOf(i)] || 0) + 1; });
  Object.keys(newsKinds()).forEach((k) => { if (counts[k]) ks.push(k); });
  return ks;
}
function mixPreview(n) {
  const q = Object.fromEntries(presentKinds().map((k) => [k, Array.from({ length: n }, () => k)]));
  return interleave(q, T.mix).slice(0, n);
}

function alertsSection() {
  const n = activeAlerts().length;
  return el("section", { class: "sect", id: "tune-alerts" }, el("h2", {}, "Alerts"),
    el("p", { class: "sub" }, "Rare, and pinned at the top of Everything and Today for a while (a week, unless you change it below). A news story counts only when two independent sources carry it (copies of one press release or wire story count once), or the FDA or a society says it itself; new guidelines also come straight from PubMed."),
    Object.entries(ALERT_GROUPS).map(([k, [name, what]]) => switchRow(name, what, T.alerts[k] !== false,
      (on) => { setTune({ alerts: { ...T.alerts, [k]: on } }); S.feedDirty = true; rerender(); })),
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: openAlerts }, n ? `This week’s alerts (${n})` : "This week’s alerts")),
    advanced("alerts",
      stepRow("Pinned for", "How long an alert stays at the top.", T.alertDays, { min: 1, max: 14, unit: T.alertDays === 1 ? "day" : "days" },
        (v) => { setTune({ alertDays: v }); rerender(); }),
      stepRow("At the top at once", "The rest are under “more”. 0 keeps them off the top; This week’s alerts still lists them.", T.alertMax, { min: 0, max: 6 },
        (v) => { setTune({ alertMax: v }); rerender(); }),
      switchRow("Two of one kind", "Off: one alert per kind at the top (two FDA actions: the newest, and “1 more”).", T.alertTwo,
        (on) => { setTune({ alertTwo: on }); rerender(); }),
      el("p", { class: "fine" }, "How big a story must be to be an alert (independent sources, which agents and societies count, which trial results) is in Tune → Updates → News and Watch → Change settings.")),
    typeof pushSectionEl === "function" ? pushSectionEl() : null,
    typeof citeSettingEl === "function" ? citeSettingEl() : null);
}

// ── what your filters hid ──────────────────────────────────────────────────
// Each paper and story from the last week that a filter kept out of Everything, under the first
// filter that caught it, so a mute or rating that hides too much is easy to see and undo.
function hiddenReport(days = 7) {
  const cut = Date.now() - days * 864e5;
  const groups = new Map();
  const add = (key, label, kind, it, undo) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, kind, undo, items: [] }));
    g.items.push(it);
  };
  const words = (T.mutedWords || []).map((w) => [w, wordRe([w])]).filter(([, re]) => re);
  const mutedSrc = new Set(T.mutedSources || []);
  const taste = hasTaste();
  const papers = (S.feed?.items || []).filter((p) => (Date.parse(p.added || p.epub || "") || 0) >= cut).map((p) => ({ ...p, type: "paper" }));
  const news = (S.news?.items || []).filter((n) => (Date.parse(n.date || "") || 0) >= cut).map((n) => ({ ...n, type: "news", kind: kindOf(n) }));
  let total = 0;
  for (const it of papers.concat(news)) {
    total++;
    const isNews = it.type === "news";
    if (isNews && mutedSrc.has(it.source)) {
      add(`src:${it.source}`, `Muted outlet: ${it.source}`, "outlet", it, () => setTune({ mutedSources: T.mutedSources.filter((n) => n !== it.source) }));
      continue;
    }
    const w = words.find(([, re]) => mutedHit(it, re));
    if (w) { add(`w:${w[0]}`, `Muted “${w[0]}”`, "word", it, () => setTune({ mutedWords: T.mutedWords.filter((x) => x !== w[0]) })); continue; }
    if (taste && tasteOf(it) === -Infinity) {
      const f = featuresOf(it).concat(byFeatures(it)).find((x) => T.taste[x] === HIDE);
      if (f) {
        const [name, kind] = featureName(f);
        add(`t:${f}`, `Hidden ${kind.toLowerCase()}: ${name}`, "rating", it, () => setTaste(f, 0));
        continue;
      }
    }
    if (isNews && tooOld(it)) { add(`age:${it.kind}`, `${kindLabel(it.kind)} older than ${plural(T.maxAge[it.kind], "day")}`, "kind", it, () => { const m = { ...T.maxAge }; delete m[it.kind]; setTune({ maxAge: m }); }); continue; }
    if (isNews && obitHidden(it)) { add("obits", T.obits === "none" ? "Death notices (all)" : "Death notices few outlets ran", "obit", it, () => setTune({ obits: "all" })); continue; }
    if (!isNews && !homeArea(it)) { add("area", "Papers from areas you turned off", "area", it, null); continue; }
    if (!isNews && T.hidePending && (it.conclusion?.kind || "none") === "none") { add("pending", "Papers waiting for an abstract", "pending", it, () => setTune({ hidePending: false })); continue; }
    if (isNews && (T.mix[it.kind] ?? 1) <= 0) add(`kind:${it.kind}`, `${kindLabel(it.kind)}, turned off in Everything`, "kind", it, () => setTune({ mix: { ...T.mix, [it.kind]: 1 } }));
  }
  // Watch: changes hidden by a word or a rating (followed trials always show)
  const wcut = localDay(daysAgo(days));
  for (const e of typeof wFeatures === "function" ? S.watch?.events || [] : []) {
    if (!e?.id || !e.title || (e.seen || e.date || "") < wcut || wFollowing(e.nct)) continue;
    total++;
    const it = wItem(e);
    if (wMuted(e)) {
      const w = T.watch.mute.find((x) => wordRe([x])?.test(wName(e)));
      add(`ww:${w}`, `Hidden from Watch: “${w}”`, "word", it, () => setTune({ watch: { ...T.watch, mute: T.watch.mute.filter((x) => x !== w) } }));
      continue;
    }
    if (taste && wTaste(e) === -Infinity) {
      const f = wFeatures(e).find((x) => T.taste[x] === HIDE);
      if (f) { const [name, kind] = featureName(f); add(`t:${f}`, `Hidden ${kind.toLowerCase()}: ${name}`, "rating", it, () => setTaste(f, 0)); }
    }
  }
  const list = [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  list.forEach((g) => { g.lot = (g.kind === "word" || g.kind === "rating" || g.kind === "outlet") && (g.items.length >= 25 || g.items.length >= total * 0.05); });
  return { list, total, hidden: list.reduce((a, g) => a + g.items.length, 0), days };
}
const UNDO_LABEL = { word: "Unmute", outlet: "Unmute", rating: "Show again", obit: "Show all", pending: "Show them", kind: "Turn back on" };
function openHidden(g) {
  const day = (it) => (it.type === "watch" ? String(it.date || "").slice(0, 10) : dayOf(it));
  const row = (it) => el("li", { class: "news-item" }, el("button", { class: "w-row",
    onclick: () => (it.type === "watch" ? openWatchEvent(it.ev) : it.type === "paper" ? openAbstract(it) : window.open(safeUrl(it.link), "_blank", "noopener")) },
    el("span", { class: "news-src" }, el("b", {}, it.type === "watch" ? WATCH_SHORT[it.ev.kind] || "Watch" : it.type === "paper" ? it.journal : it.source), el("span", {}, fmtDate(day(it)))),
    el("span", { class: "news-title" }, it.title)));
  openSheet(
    el("h2", { id: "sheet-title" }, g.label),
    el("p", { class: "sheet-meta" }, el("span", {}, `${plural(g.items.length, g.items[0]?.type === "watch" ? "Watch change" : "card")} kept out in the last 7 days`)),
    g.lot ? el("p", { class: "fine warn-text" }, "That’s a lot for one filter: check the list for cards you’d have wanted.") : null,
    el("ul", { class: "rows" }, g.items.sort((a, b) => (day(a) < day(b) ? 1 : -1)).slice(0, 100).map(row)),
    g.items.length > 100 ? el("p", { class: "fine" }, `And ${g.items.length - 100} more.`) : null,
    el("div", { class: "link-row" },
      g.undo ? el("button", { class: "act", onclick: () => { g.undo(); closeSheet(); toast("Done: they’re back"); if (S.tab === "tune") rerender(); } }, UNDO_LABEL[g.kind] || "Undo")
        : el("button", { class: "act", onclick: () => { closeSheet(); setPane("interests", "tune-areas"); } }, "Areas")));
}
function hiddenSection() {
  const r = hiddenReport(7);
  return el("section", { class: "sect", id: "tune-hidden" }, el("h2", {}, "What your filters hid"),
    el("p", { class: "sub" }, r.hidden ? `In the last 7 days your filters kept ${plural(r.hidden, "item")} of ${r.total.toLocaleString()} out of Everything and Watch. Each counts under the first filter that caught it. Kind chips and search still show papers and stories.`
      : "Nothing in the last 7 days. Mutes, ratings set to Hide, death notices and areas you turn off show here with what they kept out."),
    r.list.length ? el("ul", { class: "rows" }, r.list.map((g) => el("li", { class: "row hid-row" },
      el("button", { class: "hid-b", onclick: () => openHidden(g) },
        el("span", { class: "row-name" }, g.label, g.lot ? el("span", { class: "w-major" }, "hides a lot") : null),
        el("span", { class: "hid-n" }, String(g.items.length)))))) : null);
}

function algoPane() {
  return [alertsSection(), hiddenSection(), importantSection(), mixSection(), orderSection(), muteSection(), trendSection(),
    el("section", { class: "sect" }, el("h2", {}, "Start over"),
      el("p", { class: "sub" }, "Puts areas, following, the mix, paper order, mutes and trend rules back to how they came. Your reading history, saved items, ratings and reading settings stay."),
      el("div", { class: "link-row" }, twoTap("reset", "Reset feed rules", "Tap again to reset", () => {
        const keep = { mutedSources: [], mutedWords: [] };
        const mine = Object.fromEntries(["textSize", "library", "startOn", "brief", "guess", "pictures", "bylines", "meetings", "taste", "learned", "reacts", "learnedAt", "learnImplicit", "learnRate", "fade"].map((k) => [k, T[k]]));
        T = { ...TUNE_DEFAULTS, ...keep, ...mine }; store.set("tune", T); S.feedDirty = true; S.exploreKey = null;
        toast("Feed rules reset"); rerender();
      })))];
}

function importantSection() {
  const I = S.important;
  return el("section", { class: "sect", id: "tune-important" }, el("h2", {}, "Most important papers"),
    el("p", { class: "sub" }, I
      ? `Ranked weekly from ${I.stats.checked.toLocaleString()} papers in your journals over the last ${I.settings.years} years, by citations against papers of the same age.`
      : "Ranked weekly by citations against papers of the same age. Not built yet."),
    switchRow("Include reviews, meta-analyses and guidelines", "Off: original research only.", T.impReviews,
      (on) => { setTune({ impReviews: on }); rerender(); }));
}

// how old a story of each kind can be, anywhere in the feed
function ageEl(ks) {
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Oldest story shown"),
    el("p", { class: "fine", style: "margin:2px 0 6px" }, "Per kind of news, in every list. Past 60 days, it’s whatever the job keeps."),
    ks.filter((k) => k !== "paper").map((k) => stepRow(kindLabel(k), null, T.maxAge[k] ?? null, { min: 1, max: 60, unit: (T.maxAge[k] ?? 0) === 1 ? "day" : "days", empty: "Any age" },
      (v) => { const m = { ...T.maxAge }; if (v == null) delete m[k]; else m[k] = v; setTune({ maxAge: m }); rerender(); })));
}
// each outlet: stories a day in Everything, and what you think of it (the same as Rate)
let outletOpen = new Set();
function outletsEl() {
  const sources = (S.news?.sources || []).filter((x) => x.name);
  if (!sources.length) return null;
  const byKind = {};
  sources.forEach((x) => { (byKind[x.kind || "industry"] ||= []).push(x); });
  const setCap = (name, v) => { const c = { ...T.capBy }; if (v == null) delete c[name]; else c[name] = v; setTune({ capBy: c }); rerender(); };
  const row = (x) => {
    const own = T.capBy[x.name];
    const usual = x.kind === "industry" && !T.cap ? null : T.cap ? outletLimit(x.name) : null;
    const tw = T.taste[`src:${x.name}`] ?? 0;
    return el("div", { class: "ol-row" + (own != null || tw ? " changed" : "") },
      el("div", { class: "ol-name" }, el("b", {}, x.name),
        el("span", { class: "fine" }, own != null ? `your number${usual != null ? ` (usually ${usual})` : ""}` : usual == null ? "no limit" : `usually ${usual} a day`)),
      numStep(own ?? usual ?? null, { min: 0, max: 20, empty: "No limit", unit: "a day" }, (v) => setCap(x.name, v), `${x.name}, stories a day`),
      el("select", { class: "ol-taste", "aria-label": `What you think of ${x.name}`, onchange: (e) => { setTaste(`src:${x.name}`, Number(e.currentTarget.value)); rerender(); } },
        [[HIDE, "Hide"], [-1, "Less"], [0, "Same"], [1, "More"]].map(([v, l]) => el("option", { value: v, ...(tw === v ? { selected: true } : {}) }, l))),
      own != null ? el("button", { class: "inline-link", onclick: () => setCap(x.name, null) }, "Usual") : null);
  };
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Each outlet"),
    el("p", { class: "fine", style: "margin:2px 0 6px" }, "Stories a day in Everything (0 keeps it to its own chip), and Hide, Less, Same or More, as in Rate. What the job fetches is in Tune → Updates → News → Change settings."),
    Object.keys(newsKinds()).filter((k) => byKind[k]).map((k) => el("details", { class: "outlets", ...(outletOpen.has(k) ? { open: true } : {}),
      ontoggle: (e) => { if (e.currentTarget.open) outletOpen.add(k); else outletOpen.delete(k); } },
      el("summary", {}, swatch(k), kindLabel(k), el("span", { class: "fine" }, String(byKind[k].length))),
      byKind[k].map(row))));
}
function mixSection() {
  const ks = presentKinds();
  const seq = mixPreview(24);
  const W = ks.reduce((a, k) => a + (T.mix[k] ?? 1), 0) || 1;
  const setW = (k, v) => {
    const next = { ...T.mix, [k]: v };
    if (!ks.some((x) => (next[x] ?? 1) > 0)) { toast("Keep at least one kind in Everything"); return; }
    setTune({ mix: next }); rerender();
  };
  return tsec("Feed mix", "Everything takes turns. Each kind gets this many turns per round, spread out evenly.",
    el("div", { class: "strip", role: "img", "aria-label": `Next 24 cards: ${seq.map(kindLabel).join(", ")}` },
      seq.map((k) => el("i", { class: k === "sff" ? "round" : "", style: `background:${kindColor(k)}` }))),
    el("p", { class: "fine", style: "margin-top:6px" }, "The next 24 cards in Everything."),
    el("ul", { class: "rows", style: "margin-top:10px" }, ks.map((k) => {
      const w = T.mix[k] ?? 1;
      return el("li", { class: "row mix-row" },
        el("span", { class: "row-name" }, swatch(k), kindLabel(k)),
        el("span", { class: "mix-share" }, w ? `${pctOf(w, W)}%` : "Off"),
        el("div", { class: "stepper", role: "group", "aria-label": `${kindLabel(k)} turns per round` },
          el("button", { "aria-label": "Fewer", disabled: w <= 0, onclick: () => setW(k, w - 1) }, "−"),
          el("output", {}, w ? `${w}×` : "0"),
          el("button", { "aria-label": "More", disabled: w >= 6, onclick: () => setW(k, w + 1) }, "+")));
    })),
    segPick("Most stories from one outlet per day", [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [0, "No limit"]], T.cap,
      (v) => { setTune({ cap: Number(v) }); rerender(); },
      "Keeps busy outlets from flooding Everything. Industry news is never limited, and held-back stories still show under their kind’s chip."),
    segPick("Death notices", [["wide", "Widely covered"], ["all", "All"], ["none", "None"]], T.obits,
      (v) => { setTune({ obits: v }); S.feedDirty = true; rerender(); },
      `Widely covered: at least ${OBIT_MIN} news organizations reported the death within 3 days, or the person held high office (a president, prime minister, pope or chief justice). Industry and society news always keep theirs.`),
    switchRow("Top stories card", "Opens the feed with stories that several outlets covered this week.", T.topCard,
      (on) => { setTune({ topCard: on }); rerender(); }),
    T.topCard ? segPick("Top stories per kind", [[0, "Auto"], [2, "2"], [3, "3"], [5, "5"]], T.topPer,
      (v) => { setTune({ topPer: Number(v) }); S.topPick = null; rerender(); },
      "Auto: 3, or 2 each when the card has three kinds of news or more.") : null,
    T.topCard ? segPick("A top story you’ve seen leads again after", [[12, "12 hours"], [36, "1½ days"], [72, "3 days"]], T.topAgain,
      (v) => { setTune({ topAgain: Number(v) }); S.topPick = null; rerender(); },
      "Until then, stories you haven’t been shown come first; one that two more outlets have picked up since comes back sooner.") : null,
    advanced("mix", ageEl(ks), outletsEl()),
    switchRow("Cards you’ve seen go to the end", "Each list starts with what you haven’t seen; the rest follow, marked Seen. Takes effect when a list starts fresh: opening the app, a chip, or a refresh.", T.readLast,
      (on) => { setTune({ readLast: on }); rerender(); }),
    switchRow("Swipe cards sideways", "Left saves a card; right clears it, and the next one takes its place.", T.swipe,
      (on) => { setTune({ swipe: on }); rerender(); }),
    clearedCount() ? el("div", { class: "switch-row" },
      el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, `${plural(clearedCount(), "card")} cleared`),
        el("p", { class: "fine", style: "margin:2px 0 0" }, "Cleared cards stay out of every list for 90 days; Not now brings one back after 3.")),
      el("button", { class: "act", onclick: () => { cleared = {}; store.set("cleared", cleared); S.feedDirty = true; toast("Cleared cards are back"); rerender(); } }, "Bring back")) : null,
    whyLine());
}
// the reasons you gave when clearing (Why? in the toast after a clear)
function whyLine() {
  const parts = [["know", "already known"], ["notme", "not for me"], ["weak", "weak study", "weak studies"], ["later", "put off for later"]]
    .filter(([k]) => whyTally[k]).map(([k, one, many]) => `${whyTally[k]} ${whyTally[k] > 1 && many ? many : one}`);
  if (!parts.length) return null;
  return el("div", { class: "switch-row" },
    el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, "Why you cleared cards"),
      el("p", { class: "fine", style: "margin:2px 0 0" }, `${parts.join(", ")}. Only “Not for me” teaches the feed.`)),
    twoTap("whyClear", "Reset", "Tap again", () => { whyTally = {}; store.set("whyTally", whyTally); toast("Tally reset"); rerender(); }));
}

const WEIGHTS = [[0, "Off"], [0.5, "Low"], [1, "Medium"], [2, "High"]];
function orderSection() {
  const papers = S.feed?.items || [];
  const pending = papers.filter((p) => (p.conclusion?.kind || "none") === "none").length;
  const setRank = (k, v) => { setTune({ rank: { ...T.rank, [k]: Number(v) } }); rerender(); };
  const kids = [
    segPick(null, [["newest", "Newest first"], ["ranked", "Ranked"]], T.order, (v) => { setTune({ order: v }); rerender(); }),
  ];
  if (T.order === "ranked") {
    const sys = S.feed?.systems || {};
    kids.push(
      el("p", { class: "fine" }, "Score = freshness × (1 + evidence + study size + labeled conclusion + your systems). Each part runs from 0 to 1 and is multiplied by the weight you pick."),
      segPick("Freshness", [[3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]], T.rank.fresh, (v) => setRank("fresh", v),
        "A paper’s score halves after this long."),
      segPick("Evidence strength", WEIGHTS, T.rank.evidence, (v) => setRank("evidence", v), "Meta-analyses, trials and guidelines count most."),
      segPick("Study size", WEIGHTS, T.rank.size, (v) => setRank("size", v), "Read from the abstract; 10,000 or more counts fully."),
      segPick("Labeled conclusion", WEIGHTS, T.rank.concl, (v) => setRank("concl", v), "Favors abstracts that state a conclusion."),
      segPick("Your organ systems", WEIGHTS, T.rank.systems, (v) => setRank("systems", v)),
      el("div", { class: "chips wrap" }, Object.entries(sys).map(([k, label]) => el("button", { class: "chip", "aria-pressed": String(T.fav.includes(k)),
        onclick: () => { setTune({ fav: T.fav.includes(k) ? T.fav.filter((x) => x !== k) : [...T.fav, k] }); rerender(); } }, label))),
      T.fav.length ? null : el("p", { class: "fine" }, "Pick the systems you want lifted."),
      rankPreview());
  } else {
    kids.push(el("p", { class: "fine" }, "Papers appear in the order PubMed adds them, newest first."));
  }
  kids.push(switchRow("Hide papers without an abstract yet", `${plural(pending, "paper")} right now. PubMed usually adds the abstract within days.`,
    T.hidePending, (on) => { setTune({ hidePending: on }); rerender(); }));
  return tsec("Paper order", null, ...kids);
}
function rankPreview() {
  const now = Date.now();
  const top = filtered({ kind: "papers", system: "all", strong: false, topic: null }).slice(0, 5);
  const names = { evidence: "evidence", size: "size", concl: "conclusion", systems: "your systems" };
  return el("div", { class: "preview" },
    el("div", { class: "ctl-label" }, "Top of your feed with these settings"),
    el("ol", { class: "rows plain" }, top.map((p) => {
      const sc = paperScore(p, now);
      return el("li", { class: "row" }, el("button", { class: "row-static", onclick: () => openAbstract(p) },
        el("span", { class: "row-name clamp2" }, p.title),
        el("span", { class: "row-fig" }, sc.score.toFixed(2)),
        el("span", { class: "row-sub wrap" },
          el("span", {}, `${p.journal}, ${fmtDate(p.added || p.epub)}`),
          el("span", { class: "factor" }, `fresh ${Math.round(sc.fresh * 100)}%`),
          Object.entries(sc.parts).filter(([, v]) => v > 0.005).map(([k, v]) => el("span", { class: "factor" }, `${names[k]} +${v.toFixed(2)}`)))));
    })));
}

function muteSection() {
  const words = T.mutedWords || [];
  const input = el("input", { type: "text", class: "text-in", placeholder: "A word or phrase", "aria-label": "Word to mute",
    value: TU.wordDraft, autocapitalize: "off", autocomplete: "off", enterkeyhint: "done" });
  const add = () => {
    const w = input.value.trim();
    TU.wordDraft = "";
    if (!w || words.some((x) => x.toLowerCase() === w.toLowerCase())) { input.value = ""; return; }
    setTune({ mutedWords: [...words, w] }); toast(`Muted “${w}”`); rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  input.addEventListener("input", () => { TU.wordDraft = input.value; });
  const muted = new Set(T.mutedSources || []);
  const counts = {};
  (S.news?.items || []).forEach((i) => { counts[i.source] = (counts[i.source] || 0) + 1; });
  const sources = S.news?.sources || [];
  const hidN = Object.fromEntries(hiddenReport(7).list.map((g) => [g.key, g.items.length]));
  return el("section", { class: "sect", id: "tune-mute" }, el("h2", {}, "Mute"),
    el("p", { class: "sub" }, "Hide words or whole outlets everywhere in the feed. Whole words, so AI doesn’t hide “air”; end one with * for any ending. To hide a writer or an author, tap Rate on one of their cards."),
    el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: add }, "Mute")),
    words.length ? el("div", { class: "chips wrap" }, words.map((w) => {
      const n = (hidN[`w:${w}`] || 0);
      return el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Unmute ${w} (hid ${n} this week)`,
        onclick: () => { setTune({ mutedWords: words.filter((x) => x !== w) }); rerender(); } }, `${w} · ${n}  ✕`);
    })) : null,
    words.length ? el("p", { class: "fine" }, "The number is how many cards each kept out in the last 7 days. See them in What your filters hid, above.") : null,
    segPick("Muted words match", [["title", "Headlines"], ["text", "Headlines and text"]], T.muteIn,
      (v) => { setTune({ muteIn: v }); rerender(); },
      "Text: what a card shows under its headline, a paper’s conclusion or a story’s summary. Words match from the start, so “Marvel” also hides “Marvel’s”."),
    Object.entries(newsKinds()).map(([k, label]) => {
      const list = sources.filter((x) => (x.kind || "industry") === k);
      if (!list.length) return null;
      const off = list.filter((x) => muted.has(x.name)).length;
      return el("details", { class: "outlets", open: TU.openKind === k },
        el("summary", { onclick: (e) => { TU.openKind = e.currentTarget.parentElement.open ? null : k; } },
          swatch(k), el("span", {}, label), el("span", { class: "fine", style: "margin:0" }, `${list.length} outlets${off ? `, ${off} muted` : ""}`)),
        list.map((x) => switchRow(x.name, `${plural(counts[x.name] || 0, "story", "stories")} now${x.ok ? "" : " · feed not working"}`, !muted.has(x.name), (on) => {
          setTune({ mutedSources: on ? T.mutedSources.filter((n) => n !== x.name) : [...T.mutedSources, x.name] }); rerender();
        })));
    }));
}

function trendSection() {
  const r = trendRules();
  const b = r.base;
  const cur = T.trend || {};
  const setR = (k, v) => {
    const next = { ...cur, [k]: Number(v) };
    const same = (next.breakout ?? b.breakout) === b.breakout && (next.rising ?? b.rising) === b.rising
      && (next.cooling ?? b.cooling) === b.cooling && (next.minScale ?? 1) === 1;
    setTune({ trend: same ? null : next }); rerender();
  };
  const x = S.explore;
  const yrs = { 1: "1-year", 2: "2-year", 5: "5-year" }[S.win];
  let live = null;
  if (x?.topics) {
    const L = trendLists(x, S.win);
    live = el("p", { class: "lede small" }, `With these rules, the ${yrs} window has ${plural(L.breakouts.length, "breakout")}, ${L.rising.length} rising and ${L.cooling.length} cooling.`);
  }
  const pctTxt = (g) => `${g > 0 ? "+" : "−"}${Math.round(Math.abs(g) * 100)}%`;
  const bTxt = (g) => (g === 1 ? "doubled" : g === 2 ? "tripled" : pctTxt(g));
  return el("section", { class: "sect", id: "tune-trends" }, el("h2", {}, "Explore trend rules"),
    el("p", { class: "sub" }, "How much a topic’s share of imaging research must change to land in Breakouts, Rising or Cooling."),
    live,
    segPick("Breakout", [[0.5, "+50%"], [1, "Doubled"], [2, "Tripled"]], r.breakout, (v) => setR("breakout", v)),
    segPick("Rising", [[0.1, "+10%"], [0.15, "+15%"], [0.25, "+25%"], [0.5, "+50%"]], r.rising, (v) => setR("rising", v)),
    segPick("Cooling", [[-0.1, "−10%"], [-0.15, "−15%"], [-0.25, "−25%"]], r.cooling, (v) => setR("cooling", v)),
    segPick("Papers a topic needs first", [[0.5, "Fewer"], [1, "Standard"], [2, "More"]], cur.minScale ?? 1, (v) => setR("minScale", v),
      `${r.min[1]}, ${r.min[2]} and ${r.min[5]} papers for the 1-, 2- and 5-year windows. Small topics swing wildly, so this keeps noise out.`),
    el("p", { class: "fine" }, `The weekly job’s own rules are ${bTxt(b.breakout)}, ${pctTxt(b.rising)} and ${pctTxt(b.cooling)}${r.custom ? "; yours apply on this phone only" : ""}. `,
      el("a", { href: `${GH}/edit/main/config/topics.yaml`, target: "_blank", rel: "noopener" }, "Change them on GitHub"), "."));
}

// ── updates: the jobs that build the data ──────────────────────────────────
const JOBS = {
  feed: { wf: "feed.yml", cfg: "feeds.yaml", every: 30, title: "Papers", sub: "PubMed, every night (with backup times if GitHub skips one)" },
  news: { wf: "news.yml", cfg: "news.yaml", every: 9, title: "News", sub: "Outlet feeds, about every 6 hours" },
  explore: { wf: "explore.yml", cfg: "topics.yaml", every: 8 * 24, title: "Trends", sub: "PubMed, iCite and ClinicalTrials.gov, every Monday" },
  important: { wf: "important.yml", cfg: "feeds.yaml", every: 8 * 24, title: "Most important papers", sub: "PubMed and NIH iCite, every Tuesday" },
  library: { wf: "library.yml", cfg: "foundations.yaml", every: 32 * 24, title: "Foundations and classics", sub: "PubMed and NIH iCite, on the 3rd of each month" },
  horizon: { wf: "horizon.yml", cfg: "horizon.yaml", every: 30, title: "Coming up", sub: "Fed, BLS, BEA, Federal Register (FDA) and launch calendars, every morning" },
  radar: { wf: "radar.yml", cfg: "radar.yaml", every: 30, title: "Radar", sub: "Research news, arXiv preprints and OpenAlex research counts, every day" },
  watch: { wf: "watch.yml", cfg: "watch.yaml", every: 30, title: "Watch", sub: "ClinicalTrials.gov, openFDA and the Federal Register, every morning" },
  notify: { wf: "notify.yml", cfg: "", every: 24 * 30, title: "Notifications", sub: "New alerts to your phone, after each news, papers and watch update" },
  settings: { wf: "settings.yml", cfg: "", every: 24 * 365, title: "Settings", sub: "Job settings sent from this phone, checked and saved" },
};
async function loadRuns() {
  if (S.runs && Date.now() - S.runs.at < 10 * 60 * 1000) return;
  S.runs = { at: Date.now(), wf: {} };
  await Promise.all(Object.values(JOBS).map(async (j) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${j.wf}/runs?per_page=1`, { headers: { Accept: "application/vnd.github+json" } });
      if (r.ok) S.runs.wf[j.wf] = (await r.json()).workflow_runs?.[0] || null;
    } catch { /* offline or rate-limited: show what the data files say */ }
  }));
  if (S.tab === "tune" && TU.pane === "pipeline") rerender();
}

function jobStatus(key, generated) {
  const j = JOBS[key];
  const run = S.runs?.wf?.[j.wf];
  const hours = generated ? (Date.now() - new Date(generated).getTime()) / 36e5 : Infinity;
  const late = hours > j.every;
  const bits = [el("span", { class: late ? "warn-text" : "" }, generated ? `Data from ${ago(generated)}${late ? ", later than expected" : ""}` : "Not built yet")];
  if (run) {
    const when = ago(run.updated_at || run.created_at);
    if (run.status !== "completed") bits.push(el("span", {}, `Running now (started ${ago(run.created_at)})`));
    else if (run.conclusion === "success") bits.push(el("span", {}, `Last run worked, ${when}`));
    else bits.push(el("a", { class: "warn-text", href: /^https:\/\/github\.com\//.test(run.html_url || "") ? run.html_url : GH, target: "_blank", rel: "noopener" }, `Last run ${run.conclusion === "cancelled" ? "was cancelled" : "failed"}, ${when}. See the log`));
  }
  return el("p", { class: "status" }, bits);
}
function settingsList(rows) {
  const r = rows.filter(Boolean);
  return r.length ? el("ul", { class: "settings-list" }, r.map((t) => el("li", {}, t)))
    : el("p", { class: "fine" }, "Settings show here after the next update.");
}
function jobLinks(key, editLabel) {
  const j = JOBS[key];
  const run = ghToken()
    ? el("button", { class: "act", onclick: async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          // a second tap, or a run already under way: don't queue another (it would only redo the same work)
          // (GitHub takes a few seconds to list a new run, so a start in the last minute counts too)
          const started = (jobLinks.started ||= {});
          const last = await latestRun(j.wf).catch(() => null);
          if ((last && last.status !== "completed") || Date.now() - (started[key] || 0) < 60e3) {
            toast(`${j.title}: already running on GitHub. Results in a few minutes.`); return;
          }
          await runJob(key); started[key] = Date.now();
          toast(`${j.title}: started on GitHub. Results in a few minutes.`); S.runs = null; setTimeout(loadRuns, 4000);
        }
        catch (err) { toast(err.message); }
        finally { b.disabled = false; }
      } }, "Run now")
    : linkBtn(`${GH}/actions/workflows/${j.wf}`, "Run now");
  return el("div", { class: "link-row" }, linkBtn(`${GH}/edit/main/config/${j.cfg}`, editLabel), run);
}

// ── set up: the keys and settings Readout can use, and which are in place ──
function setupSection() {
  const f = S.feed?.settings || {};
  const mv = S.horizon?.sources?.movies;
  const earn = store.get("earn", null);
  const secret = `${GH}/settings/secrets/actions/new`;
  const state = (ok, text) => el("span", { class: "setup-state" + (ok === true ? " on" : ok === false ? " off" : "") }, text);
  const row = (title, st, what, how, ...btns) => el("div", { class: "setup-row" },
    el("div", { class: "setup-h" }, el("b", {}, title), st),
    el("p", { class: "fine", style: "margin:2px 0 0" }, what),
    how ? el("p", { class: "fine", style: "margin:4px 0 0" }, how) : null,
    btns.length ? el("div", { class: "link-row", style: "margin-top:8px" }, btns) : null);
  const ext = (href, label) => el("a", { class: "act", href, target: "_blank", rel: "noopener" }, label);
  return el("section", { class: "sect", id: "tune-setup" }, el("h2", {}, "Set up"),
    el("p", { class: "sub" }, "Everything Readout can use. The first four are secrets on GitHub (Settings → Secrets and variables → Actions → New repository secret: type the name exactly as shown, paste the value). The last two stay on this phone."),
    row("Contact email (NCBI_EMAIL)",
      f.ncbi_contact === true ? state(true, "Set") : f.ncbi_contact === false ? state(false, "Not set") : state(null, "Shows after the next papers update"),
      "Your email address. PubMed asks automated tools to include one so NCBI can contact you instead of blocking the job. The Coming up job sends it to the Bureau of Labor Statistics too.",
      "Name: NCBI_EMAIL. Value: your email address.", ext(secret, "Add on GitHub")),
    row("PubMed API key (NCBI_API_KEY), optional",
      f.ncbi_key === true ? state(true, "Set") : f.ncbi_key === false ? state(false, "Not set") : state(null, "Shows after the next papers update"),
      "Lets the papers jobs ask PubMed 10 times a second instead of 3, so they finish faster. Free with an NCBI account.",
      "Sign in at NCBI, open Account settings, and under API Key Management choose Create an API Key. Name: NCBI_API_KEY.",
      ext("https://account.ncbi.nlm.nih.gov/settings/", "Get a key"), ext(secret, "Add on GitHub")),
    row("Movie releases (TMDB_TOKEN)",
      mv?.via === "tmdb" && mv.ok ? state(true, "Working") : mv?.via === "tmdb" || (mv && !mv.ok) ? state(false, "TMDB refused it") : state(false, "Not set"),
      "Sci-fi and fantasy release dates from TMDB, checked every day and linked to IMDb. Free for personal, non-commercial use.",
      "Make a free TMDB account, then Settings → API → Create (choose Developer, personal use). Copy the API Read Access Token (or the API key). Name: TMDB_TOKEN. Then run Coming up below, or wait for tomorrow’s update.",
      ext("https://www.themoviedb.org/settings/api", "Get a token"), ext(secret, "Add on GitHub")),
    row("Research counts (OPENALEX_API_KEY)",
      S.radar?.settings?.openalex_key ? ((S.radar.sources || []).find((x) => x.name === "OpenAlex")?.ok === false ? state(false, "OpenAlex refused it") : state(true, "Set"))
        : S.radar ? state(false, "Not set") : state(null, "Shows after the first Radar update"),
      "Lets the Radar track research momentum for every topic each week, and tell a new field from an old one that’s in the news. Without it, a couple of topics refresh a day. Free; the data is open (CC0).",
      "Make a free account at openalex.org, then copy your key from openalex.org/settings/api. Name: OPENALEX_API_KEY. Then run Radar below, or wait for tomorrow’s update.",
      ext("https://openalex.org/settings/api", "Get a key"), ext(secret, "Add on GitHub")),
    row("Earnings dates (Alpha Vantage key)",
      store.get("avKey", "") ? (earn?.err && (!earn.at || earn.errAt > earn.at) ? state(false, "Not working") : state(true, "On this phone")) : state(false, "Not set"),
      "Exact earnings dates for the companies you watch, fetched by this phone once a day.",
      null, el("button", { class: "act", onclick: () => setPane("interests", "tune-horizon") }, "Add it in Interests")),
    row("GitHub token, optional",
      ghToken() ? state(true, "On this phone") : state(null, "Not set"),
      "Lets pull-to-refresh update the news on GitHub, and Run now start any job from here.",
      null, el("button", { class: "act", onclick: () => document.getElementById("tune-token")?.scrollIntoView({ block: "start" }) }, "Set it up below")));
}

// ── starting the update jobs from this phone (optional) ────────────────────
// A fine-grained GitHub token that can only run this repository's jobs. It's kept on this phone
// (not in Tune's settings, so not in backups) and sent only to api.github.com.
const GH_API = `https://api.github.com/repos/${REPO}`;
const TOKEN_RE = /^(?:github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/;
function ghToken() {
  const t = store.get("ghToken", "");
  return typeof t === "string" && TOKEN_RE.test(t) ? t : "";
}
function ghFetch(path, opts = {}, token = ghToken()) {
  return fetch(`${GH_API}${path}`, { ...opts, cache: "no-store", referrerPolicy: "no-referrer",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
}
const ghProblem = (status) => (status === 401 ? "GitHub refused the token: it may have expired or been mistyped. Add a new one in Tune → Updates."
  : status === 403 || status === 404 ? "The token can’t run this repository’s jobs. It needs Actions: Read and write, for the readout repository."
  : `GitHub answered ${status}. Try again in a minute.`);
async function runJob(key) {
  const r = await ghFetch(`/actions/workflows/${JOBS[key].wf}/dispatches`,
    { method: "POST", body: JSON.stringify({ ref: "main" }), headers: { "Content-Type": "application/json" } });
  if (r.status !== 204 && r.status !== 200) throw new Error(ghProblem(r.status));
}
async function latestRun(wf) {
  const r = await ghFetch(`/actions/workflows/${wf}/runs?per_page=1`);
  if (!r.ok) throw new Error(ghProblem(r.status));
  return (await r.json()).workflow_runs?.[0] || null;
}
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

// Run the news job now and bring back what it wrote. Resolves with the new news.json (read from the
// repository, so there's no wait for the website to rebuild), or null if it's still going.
let newsRun = null;
function updateNewsNow() {
  if (newsRun) return newsRun;                              // one at a time
  newsRun = (async () => {
    const asked = Date.now();
    let before = await latestRun(JOBS.news.wf);
    let run = before && before.status !== "completed" ? before : null;   // one under way already: follow it
    if (!run) await runJob("news");
    const until = Date.now() + 6 * 60e3;
    while (Date.now() < until) {
      await pause(run ? 6000 : 3500);
      const r = await latestRun(JOBS.news.wf).catch(() => null);
      if (r && (r.id === run?.id || (r.id !== before?.id && Date.parse(r.created_at) >= asked - 15e3))) run = r;
      if (run?.status === "completed") break;
    }
    if (run?.status !== "completed") return null;
    if (run.conclusion !== "success") throw new Error(`The news job ${run.conclusion === "cancelled" ? "was cancelled" : "failed"} on GitHub. Its log is in Tune → Updates.`);
    const r = await ghFetch("/contents/docs/data/news.json?ref=main", { headers: { Accept: "application/vnd.github.raw+json" } });
    if (!r.ok) throw new Error(ghProblem(r.status));
    const text = await r.text();
    const data = JSON.parse(text);
    if (!data?.generated || !Array.isArray(data.items)) throw new Error("The new news file didn’t look right; the next update will bring it.");
    try {                                                    // where the app looks first, so a restart sees it too
      await (await caches.open(DATA_CACHE)).put("data/news.json", new Response(text, { headers: { "Content-Type": "application/json" } }));
    } catch { /* storage full or unavailable: it's in memory for now */ }
    return data;
  })().finally(() => { newsRun = null; });
  return newsRun;
}

// pulling the feed down: with a token, also update the news (unless it was updated minutes ago)
function newsOnPull() {
  if (!ghToken() || S.newsUpdating) return false;
  const age = S.news?.generated ? Date.now() - Date.parse(S.news.generated) : Infinity;
  if (age < 15 * 60e3) return false;
  S.newsUpdating = true;
  updateHeadNote();
  toast("Updating the news on GitHub. About 2 minutes; keep reading.");
  updateNewsNow().then((data) => {
    if (!data) { toast("The news update is taking longer than usual. It will appear on its own."); return; }
    const wasIds = new Set((S.news?.items || []).map((i) => i.id));
    if (S.news?.generated && data.generated <= S.news.generated) { toast("News is up to date."); return; }
    S.news = data;
    S.exploreKey = null;
    markNewsNew();
    const fresh = data.items.filter((i) => !wasIds.has(i.id)).length;
    if (S.tab === "feed") updateFeedQuietly(Date.now() - (S.shownAt || 0)); else S.feedDirty = true;
    renderBanner();
    toast(fresh ? `News updated: ${plural(fresh, "new story", "new stories")}` : "News updated. Nothing new since the last update.");
  }).catch((err) => toast(err.message || "The news update didn’t finish."))
    .finally(() => { S.newsUpdating = false; updateHeadNote(); });
  return true;
}

function tokenSection() {
  const has = !!ghToken();
  const input = el("input", { type: "password", class: "text-in wide", placeholder: "github_pat_…", "aria-label": "GitHub token",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done" });
  const save = async () => {
    const t = input.value.trim();
    if (!TOKEN_RE.test(t)) { toast("That doesn’t look like a GitHub token. Fine-grained tokens start with github_pat_."); return; }
    // a classic token (ghp_) reaches every repository you have: only a fine-grained one can be limited to this one's jobs
    if (!t.startsWith("github_pat_")) { toast("That’s a classic token, which can reach all your repositories. Make a fine-grained one (github_pat_…) with the steps above."); return; }
    const r = await ghFetch(`/actions/workflows/${JOBS.news.wf}`, {}, t).catch(() => null);
    if (!r) { toast("Couldn’t reach GitHub. Try again when you’re online."); return; }
    if (!r.ok) { toast(ghProblem(r.status)); return; }
    store.set("ghToken", t);
    input.value = "";
    toast("Saved. Pull the feed down to update the news.");
    rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save(); } });
  return el("section", { class: "sect", id: "tune-token" }, el("h2", {}, "Start updates from this phone"),
    el("p", { class: "sub" }, has
      ? "On. Pulling the feed down also updates the news on GitHub (about 2 minutes, unless it was updated in the last 15), and Run now starts a job directly."
      : "Optional. With a GitHub token, pulling the feed down also updates the news on GitHub (about 2 minutes), and Run now starts a job directly. Without one, pulling down shows what the last scheduled update brought."),
    has && ghToken().startsWith("ghp_") ? el("p", { class: "warn" }, "This is a classic token, which can reach every repository you have, not just this one’s jobs. Make a fine-grained token with the steps below, then remove this one here and on GitHub.") : null,
    has && !ghToken().startsWith("ghp_") ? null : [
      el("ol", { class: "settings-list" },
        el("li", {}, "On github.com, open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token (the button below goes there)."),
        el("li", {}, "Repository access: Only select repositories → readout."),
        el("li", {}, "Repository permissions: Actions → Read and write. Nothing else."),
        el("li", {}, "Expiration: up to a year. Generate it, copy it, and paste it here.")),
      el("div", { class: "word-add", style: "margin-top:12px" }, input, el("button", { class: "act", onclick: save }, "Save"))],
    el("p", { class: "fine" }, "The token is kept only on this phone: it isn’t part of your settings or backups, and it’s sent only to GitHub. A fine-grained token made this way can start, stop and read this repository’s jobs, nothing else; delete it on GitHub any time."),
    el("div", { class: "link-row" },
      has ? twoTap("token", "Remove the token", "Tap again to remove", () => { store.set("ghToken", ""); toast("Token removed from this phone"); rerender(); }) : null,
      linkBtn("https://github.com/settings/personal-access-tokens/new", has ? "Manage tokens on GitHub" : "Make a token on GitHub")));
}

function pipelinePane() {
  loadRuns();
  return [
    el("p", { class: "lede small" }, `${["", "", "", "", "", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven"][Object.keys(JOBS).length] || Object.keys(JOBS).length} jobs on GitHub build what you read. Their settings live in files on GitHub; the News, Watch, Radar and Coming up jobs’ main ones can also be changed here (Change settings, in each), and apply at the next run.`),
    typeof jobPendingTop === "function" ? jobPendingTop() : null,
    setupSection(), tokenSection(), papersJob(), importantJob(), newsJob(), exploreJob(), libraryJob(), horizonJob(), radarJob(), watchJob(),
    el("p", { class: "fine" }, ghToken() ? "Edit opens the settings file on GitHub. Run now starts the job on GitHub from here." : "Edit opens the settings file on GitHub. Sign in, tap the pencil, change a value and commit. Run now opens the job; tap Run workflow to start it instead of waiting."),
  ];
}

function papersJob() {
  const f = S.feed;
  const items = f?.items || [];
  const st = f?.settings || {};
  const daysBack = 14;
  const perDay = Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(Date.now() - (daysBack - 1 - i) * 864e5).toISOString().slice(0, 10);
    return [items.filter((p) => p.added === d).length, 0];
  });
  const week = perDay.slice(-7).reduce((a, v) => a + v[0], 0);
  const ck = { structured: 0, closing: 0, opening: 0, none: 0 };
  items.forEach((p) => { ck[p.conclusion?.kind || "none"] = (ck[p.conclusion?.kind || "none"] || 0) + 1; });
  const ev = [0, 0, 0, 0, 0];
  items.forEach((p) => { ev[Math.min(4, p.design?.strength || 0)]++; });
  const evMax = Math.max(1, ...ev);
  const streams = f?.streams || {};
  const journals = {};
  items.forEach((p) => { journals[p.journal] = (journals[p.journal] || 0) + 1; });
  const topJ = Object.entries(journals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const concl = [[ck.structured, "var(--ink)", "Labeled conclusion"], [ck.closing, "var(--muted)", "Last lines of the abstract"],
    [ck.opening, "var(--faint)", "Opening of a review"], [ck.none, "var(--h0)", "Abstract not out yet"]];
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.feed.title), el("p", { class: "sub" }, JOBS.feed.sub),
    jobStatus("feed", f?.generated),
    !items.length ? el("p", { class: "nothing" }, "No papers yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Cards in the feed"), el("dd", {}, items.length.toLocaleString()),
        el("dt", {}, "Added in the last 7 days"), el("dd", {}, week.toLocaleString())),
      f?.settings && f.settings.ncbi_contact === false ? el("p", { class: "fine warn-text" },
        "PubMed requests go out without a contact email. Add your email as the NCBI_EMAIL secret on GitHub (Settings → Secrets and variables → Actions), so NCBI can reach you instead of blocking the job if something goes wrong.") : null,
      f?.failed_streams?.length ? el("p", { class: "fine warn-text" },
        `Last run couldn’t search ${f.failed_streams.map((s) => f.streams?.[s] || s).join(", ")}; those papers will catch up on the next run. If this repeats, the search wording in config/feeds.yaml needs a look.`) : null,
      dayBars(perDay, [fmtDate(new Date(Date.now() - (daysBack - 1) * 864e5).toISOString().slice(0, 10)), "today"], { h: 48 }),
      el("div", { class: "ctl-label" }, "What the big text on each card is"),
      stack(concl), legend(concl),
      el("div", { class: "ctl-label" }, "Evidence strength"),
      el("div", { class: "ev-bars" }, ev.map((n, i) => el("div", {},
        el("span", { class: "evb" }, el("i", { style: `height:${Math.max(n ? 4 : 0, Math.round((n / evMax) * 100))}%;background:var(--h${i ? i + (i === 4 ? 1 : 0) : 0})` })),
        el("b", {}, String(n)), el("span", {}, ["None", "1", "2", "3", "4"][i])))),
      el("p", { class: "fine" }, "0 means the design isn’t stated; 4 is a meta-analysis, randomized trial or guideline."),
      el("div", { class: "ctl-label" }, "Where they come from"),
      el("dl", { class: "facts" }, Object.entries(streams).map(([k, name]) => [el("dt", {}, name),
        el("dd", {}, items.filter((p) => (p.streams || []).includes(k)).length.toLocaleString())])),
      el("div", { class: "ctl-label" }, "Busiest journals"),
      el("dl", { class: "facts" }, topJ.map(([j, n]) => [el("dt", {}, j), el("dd", {}, String(n))])),
    ],
    el("div", { class: "ctl-label" }, "Settings in config/feeds.yaml"),
    settingsList(st.keep_days ? [
      `Searches ${st.journals} radiology, ${st.nm_journals} nuclear medicine and ${st.general_journals} high-impact journals.`,
      `Each run re-checks the last ${st.recheck_days} days, since abstracts often reach PubMed late.`,
      `Cards stay ${st.keep_days} days, ${st.max_items.toLocaleString()} at most.`,
      `${st.topics} Explore topics tag the cards.`,
    ] : []),
    jobLinks("feed", "Edit journals and settings"));
}

function newsJob() {
  const n = S.news;
  const items = n?.items || [];
  const st = n?.settings || {};
  const sources = n?.sources || [];
  const okN = sources.filter((x) => x.ok && !x.stale).length;
  const stale = sources.filter((x) => x.ok && x.stale);
  const counts = {};
  items.forEach((i) => { counts[i.source] = (counts[i.source] || 0) + 1; });
  const byKind = {};
  items.forEach((i) => { byKind[kindOf(i)] = (byKind[kindOf(i)] || 0) + 1; });
  const parts = Object.keys(newsKinds()).filter((k) => byKind[k]).map((k) => [byKind[k], kindColor(k), kindLabel(k), k]);
  const failing = sources.filter((x) => !x.ok);
  const ts = st.top_stories, tr = st.trending;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.news.title), el("p", { class: "sub" }, JOBS.news.sub),
    jobStatus("news", n?.generated),
    !items.length ? el("p", { class: "nothing" }, "No stories yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Stories"), el("dd", {}, items.length.toLocaleString()),
        el("dt", {}, "Outlets working"), el("dd", { class: failing.length || stale.length ? "warn-text" : "" }, `${okN} of ${sources.length}`),
        el("dt", {}, "Podcast episodes"), el("dd", {}, String(items.filter((i) => i.audio).length))),
      stack(parts), legend(parts),
      failing.length ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Not working"),
        el("ul", { class: "settings-list" }, failing.map((x) => el("li", {}, el("b", {}, x.name), ": ", (x.tried || [])[0] || "no feed answered")))) : null,
      stale.length ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Not updating"),
        el("ul", { class: "settings-list" }, stale.map((x) => el("li", {}, el("b", {}, x.name), `: newest story is from ${fmtDate(x.newest.slice(0, 10))}. The outlet may have moved its feed.`)))) : null,
      sources.some((x) => x.offsite) ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Links to other sites dropped"),
        el("p", { class: "fine" }, "Stories that pointed away from the outlet’s own site, which can mean a hacked feed. If one keeps showing up for an outlet you trust, add the site to its link_domains in config/news.yaml."),
        el("ul", { class: "settings-list" }, sources.filter((x) => x.offsite).map((x) => el("li", {}, el("b", {}, x.name), `: ${plural(x.offsite, "link")} in the last update`)))) : null,
      el("details", { class: "outlets" }, el("summary", {}, el("span", {}, "Every outlet"), el("span", { class: "fine", style: "margin:0" }, "stories now, newest")),
        el("dl", { class: "facts small" }, sources.slice().sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0)).map((x) => [
          el("dt", {}, swatch(x.kind || "industry"), x.name),
          el("dd", { class: x.ok && !x.stale ? "" : "warn-text" }, !x.ok ? "not working" : x.stale ? "not updating" : `${counts[x.name] || 0} · ${x.newest ? agoShort(x.newest) : "—"}`)]))),
    ],
    el("div", { class: "ctl-label" }, "Settings in config/news.yaml"),
    settingsList(st.keep_days ? [
      `${st.outlets} outlets. Industry stories stay ${st.keep_days} days; other news ${st.other_keep_days} days.`,
      ts ? `Top stories: at least ${ts.min_outlets} publishers in ${ts.days} days, with headlines sharing ${Math.round(ts.match * 100)}% of their key words.` : null,
      tr ? `Trending: the last ${tr.week[0]} days against the ${tr.week[1]} before, and the last ${tr.month[0]} against the ${tr.month[1]} before; ${tr.phrases} phrases per kind.` : null,
      st.promo_filter ? "Gift guides, deals and sponsored posts are skipped outside industry news." : null,
      `Headlines are kept ${Math.round(st.archive_days / 365 * 10) / 10} years for trend lines.`,
    ] : []),
    typeof jobSettingsEl === "function" ? jobSettingsEl("news") : null,
    jobLinks("news", "Edit outlets and settings"));
}

function horizonJob() {
  const H = S.horizon;
  const names = { fed: "Federal Reserve", bls: "BLS (jobs, CPI)", bea: "BEA (GDP, PCE)", fda: "FDA panels", launches: "Launches",
    markets: "Market holidays", seasons: "Earnings seasons (estimated)", meetings: "Your meetings", dates: "Dates checked by hand",
    money: "Personal finance", culture: "Culture & awards", movies: "Sci-fi & fantasy movies" };
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.horizon.title), el("p", { class: "sub" }, JOBS.horizon.sub),
    jobStatus("horizon", H?.generated),
    !H ? el("p", { class: "nothing" }, "Not built yet.") : el("dl", { class: "facts small" },
      Object.entries(H.sources || {}).map(([k, v]) => [el("dt", {}, names[k] || k),
        el("dd", { class: v.ok || v.fallback ? "" : "warn-text" }, v.fallback ? "from the published schedule in the config"
          : v.ok ? String(v.n) : "couldn’t read; last run’s dates kept")])),
    H?.sources?.bls?.fallback ? el("p", { class: "fine" }, "BLS turns away GitHub’s servers even with a contact email, so the jobs and CPI dates come from BLS’s published schedule, copied into the config (through December 2027).") : null,
    el("p", { class: "fine" }, "Earnings dates don’t come through this job: your phone gets them from Alpha Vantage with your key (Tune → Interests → Coming up)."),
    typeof jobSettingsEl === "function" ? jobSettingsEl("horizon") : null,
    jobLinks("horizon", "Edit dates and filters"));
}
function radarJob() {
  const R = S.radar;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.radar.title), el("p", { class: "sub" }, JOBS.radar.sub),
    jobStatus("radar", R?.generated),
    !R ? el("p", { class: "nothing" }, "Not built yet.") : el("dl", { class: "facts small" },
      (R.sources || []).map((x) => [el("dt", {}, x.name), el("dd", { class: x.ok ? "" : "warn-text" }, x.ok ? (x.count != null ? String(x.count) : "read") : "couldn’t read")]),
      el("dt", {}, "Topics"), el("dd", {}, String((R.topics || []).length))),
    typeof jobSettingsEl === "function" ? jobSettingsEl("radar") : null,
    jobLinks("radar", "Edit topics and sources"));
}
function watchJob() {
  const W = S.watch;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.watch.title), el("p", { class: "sub" }, JOBS.watch.sub),
    jobStatus("watch", W?.generated),
    !W ? el("p", { class: "nothing" }, "Not built yet.") : el("dl", { class: "facts small" },
      (W.sources || []).map((x) => [el("dt", {}, x.name), el("dd", { class: x.ok ? "" : "warn-text" }, x.ok ? `${x.count} new` : "couldn’t read; kept the last run’s")]),
      el("dt", {}, "Changes kept"), el("dd", {}, String((W.events || []).length)),
      el("dt", {}, "Trials under way"), el("dd", {}, String(W.tracked || 0))),
    typeof jobSettingsEl === "function" ? jobSettingsEl("watch") : null,
    jobLinks("watch", "Edit topics and rules"));
}
function libraryJob() {
  const L = S.library;
  const F = L?.foundations;
  const nFd = (F?.groups || []).reduce((a, g) => a + g.items.length, 0);
  const cl = L?.classics || {};
  const papers = Object.values(L?.papers || {});
  const withFig = [S.feed?.items || [], Object.values(S.important?.papers || {}), papers]
    .map((l) => [l.filter((p) => p.fig).length, l.length]);
  const set = L?.settings || {};
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.library.title), el("p", { class: "sub" }, JOBS.library.sub),
    jobStatus("library", L?.generated),
    !L ? el("p", { class: "nothing" }, "Not built yet.") : el("dl", { class: "facts" },
      el("dt", {}, "Foundations papers"), el("dd", {}, `${nFd} in ${(F?.groups || []).length} groups`),
      el("dt", {}, "Classics to choose from"), el("dd", {}, Object.entries(cl).map(([a, ids]) => `${areaShort(a)} ${ids.length}`).join(", ") || "none")),
    el("div", { class: "ctl-label" }, "Pictures (PMC Open Access, Creative Commons only)"),
    el("dl", { class: "facts small" },
      el("dt", {}, "Feed"), el("dd", {}, `${withFig[0][0]} of ${withFig[0][1]} papers`),
      el("dt", {}, "Most important"), el("dd", {}, `${withFig[1][0]} of ${withFig[1][1]}`),
      el("dt", {}, "Foundations and classics"), el("dd", {}, `${withFig[2][0]} of ${withFig[2][1]}`)),
    el("p", { class: "fine" }, "Most papers aren’t open access, or have only charts and flowcharts; those get no picture. New figures are fetched by the papers job each morning."),
    el("div", { class: "ctl-label" }, "Settings in config/foundations.yaml"),
    settingsList(set.from_year ? [
      `Classics: papers from ${set.from_year} that are at least ${set.min_age_years} years old, the ${set.per_area} most cited per year since publication in each area, at most ${set.per_year} from any one year.`,
      "Foundations: each entry’s pinned PMID, or the most-cited paper its search finds.",
    ] : []),
    jobLinks("library", "Edit the reading path"));
}

function importantJob() {
  const I = S.important;
  const st = I?.stats || {}, set = I?.settings || {};
  const sizes = (w) => {                // per area since areas came in; one list before
    const v = I?.windows?.[w] || {};
    return String(v.research ? v.research.length : new Set(Object.values(v).flatMap((x) => x.research || [])).size);
  };
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.important.title), el("p", { class: "sub" }, JOBS.important.sub),
    jobStatus("important", I?.generated),
    !I ? el("p", { class: "nothing" }, "Not built yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Papers checked"), el("dd", {}, (st.checked || 0).toLocaleString()),
        el("dt", {}, "Original research"), el("dd", {}, (st.research || 0).toLocaleString()),
        el("dt", {}, "Reviews and guidelines"), el("dd", {}, (st.other || 0).toLocaleString()),
        el("dt", {}, "Left out (case reports, editorials…)"), el("dd", {}, (st.skipped || 0).toLocaleString()),
        el("dt", {}, "Cited at least once"), el("dd", {}, `${Math.round(100 * (st.with_citations || 0) / Math.max(1, st.kept || 1))}%`),
        el("dt", {}, "Papers in New, 1 year, 3 years"), el("dd", {}, `${sizes("6m")}, ${sizes("1y")}, ${sizes("3y")}`)),
      (st.journals || []).length ? [el("div", { class: "ctl-label" }, "Journals by citation record"),
        el("p", { class: "fine", style: "margin-top:2px" }, "Average percentile of their papers that are 1 to 3 years old; new papers borrow it."),
        el("dl", { class: "facts small" }, st.journals.slice(0, 10).map(([j, p, n]) => [el("dt", {}, j), el("dd", {}, `${Math.round(p)} · ${n.toLocaleString()} papers`)]))] : null,
    ],
    el("div", { class: "ctl-label" }, "Settings in config/feeds.yaml (important:)"),
    settingsList(set.years ? [
      `Looks back ${set.years} years over the same journals and filters as the feed.`,
      `Keeps ${set.per_window["6m"]} new, ${set.per_window["1y"]} one-year and ${set.per_window["3y"]} three-year papers; ${set.other_per_window} reviews and guidelines per list.`,
      `The 1- and 3-year lists skip papers younger than ${set.min_age_months} months.`,
    ] : []),
    jobLinks("important", "Edit settings"));
}

function exploreJob() {
  const x = S.explore;
  const st = x?.settings || {};
  const papers = Object.values(x?.papers || {});
  const withAbs = papers.filter((p) => (p.sections || []).length).length;
  const notes = Object.keys(x?.query_notes || {});
  const stale = (x?.topics || []).filter((t) => t.stale);
  const mp = st.min_papers || x?.min_recent;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.explore.title), el("p", { class: "sub" }, JOBS.explore.sub),
    jobStatus("explore", x?.generated),
    !x ? el("p", { class: "nothing" }, "Not built yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Topics"), el("dd", {}, String(x.topics.length)),
        el("dt", {}, "Key papers with abstracts"), el("dd", {}, `${withAbs} of ${papers.length}`),
        el("dt", {}, "Topics kept from last week"), el("dd", { class: stale.length ? "warn-text" : "" }, String(stale.length)),
        el("dt", {}, "Searches that found nothing"), el("dd", {}, String(notes.length))),
      notes.length ? el("details", { class: "outlets" }, el("summary", {}, el("span", {}, "Which searches"),
        el("span", { class: "fine", style: "margin:0" }, "often guideline searches for young topics")),
        el("ul", { class: "settings-list small" }, notes.map((q) => el("li", {}, q.length >= 160 ? q + "…" : q)))) : null,
    ],
    el("div", { class: "ctl-label" }, "Settings in config/topics.yaml"),
    settingsList(st.breakout != null ? [
      `Breakout: share up ${st.breakout === 1 ? "2×" : `${Math.round(st.breakout * 100)}%`} or more. Rising: up ${Math.round(st.rising * 100)}%. Cooling: down ${Math.round(-st.cooling * 100)}%.`,
      mp ? `A topic needs ${mp[1]}, ${mp[2]} and ${mp[5]} papers in the 1-, 2- and 5-year windows before it can trend.` : null,
      `${st.influential} topics under Most influential; ${st.title_phrases} phrases under New in titles.`,
      T.trend ? "You’ve changed these rules on this phone (Feed rules)." : null,
    ] : []),
    jobLinks("explore", "Edit topics and rules"));
}
