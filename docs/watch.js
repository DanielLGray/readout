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
const wRoutine = (e) => e.kind === "device" && !e.ai && e.level !== "alert";      // a routine scanner or coil clearance
// what Tune lets through; followed trials always count
function watchEvents() {
  const W = S.watch;
  if (!W?.events) return [];
  const hidden = new Set(T.watch.hidden);
  return W.events.filter((e) => e?.id && e.title && (wFollowing(e.nct)
    || (T.watch.kinds[e.kind] !== false && !hidden.has(e.topic) && !(T.watch.aiOnly && wRoutine(e)))));
}
const wRank = (e) => (wFollowing(e.nct) ? 0 : e.level === "alert" ? 1 : e.kind === "trial" && /^Results/.test(e.what) ? 2 : wRoutine(e) ? 5 : e.kind === "device" ? 4 : 3);
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
  return watchEvents().filter((e) => e.level === "alert").map((e) => ({
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
    e.sub ? el("span", { class: "fine" }, e.sub) : null));
}
function drawWatch() {
  $("#topic-title").textContent = "Watch";
  const W = S.watch;
  const body = $("#topic-body");
  const keep = body.scrollTop;
  const f = W_FILTERS.some(([k]) => k === S.watchFilter) ? S.watchFilter : "all";
  const all = watchEvents().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : wRank(a) - wRank(b)));
  const list = all.filter((e) => f === "all" || (f === "fda" ? e.kind === "device" || e.kind === "drug" : f === "follow" ? wFollowing(e.nct) : e.kind === f));
  const shown = f === "all" || f === "fda" ? list.filter((e) => !wRoutine(e)) : list;
  const routine = list.filter(wRoutine);
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
    e.sub ? el("p", { class: "hz-sub" }, e.sub) : null,
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
      S.overlay === "watch" ? null : el("button", { class: "act", onclick: () => openWatch() }, "All of Watch")));
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
  const top = it.fresh.filter((e) => !wRoutine(e)).slice(0, 4);
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
    T.watch.follow.length ? el("div", {}, el("div", { class: "ctl-label" }, "Trials you follow"),
      el("div", { class: "chips wrap" }, T.watch.follow.map((n) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Stop following ${n}`,
        onclick: () => setW({ follow: T.watch.follow.filter((x) => x !== n) }) }, `${titles[n] || n}  ✕`)))) : null,
    el("p", { class: "fine" }, "Follow a trial from its page in Watch. To watch other trial topics or rules, edit config/watch.yaml (Tune → Updates → Watch), or ask for it."));
}
