/* Readout — Your week: what changed in the last seven days, in one place. A card in Today on the
   day you choose (Saturday unless Tune says otherwise) and Explore → Your week any day.
   Loaded after watch.js. */
"use strict";

const WEEK_DAYS = [[6, "Sat"], [0, "Sun"], [1, "Mon"], [5, "Fri"], [-1, "Off"]];

function weekSummary() {
  const since = localDay(daysAgo(7));
  const alerts = typeof activeAlerts === "function" ? activeAlerts() : [];
  const watch = typeof watchEvents === "function" ? watchEvents().filter((e) => (e.seen || e.date) >= since) : [];
  const watchTop = watch.filter((e) => !wRoutine(e)).sort((a, b) => wRank(a) - wRank(b) || (a.date < b.date ? 1 : -1));
  const topics = typeof radarTopics === "function" ? radarTopics() : [];
  const heating = topics.filter((t) => rdStatus(t) === "heating");
  const devs = topics.flatMap((t) => t.devs.filter((d) => String(d.updated || d.date || "").slice(0, 10) >= since).map((d) => ({ t, d })))
    .sort((a, b) => (rdStatus(a.t) === "heating" ? 0 : 1) - (rdStatus(b.t) === "heating" ? 0 : 1) || (b.d.n || 0) - (a.d.n || 0));
  const added = typeof radarJustAdded === "function" ? radarJustAdded(7) : [];
  const retired = (S.radar?.retired || []).filter((r) => (r.retired || "") >= since);
  const I = S.important;
  const miles = (I?.milestones || []).filter((m) => (m.date || "") >= localDay(daysAgo(8)) && I.papers?.[m.pmid]
    && !hiddenByTaste({ ...I.papers[m.pmid], type: "paper" }) && homeArea(I.papers[m.pmid]));
  const seen = new Set();
  const stories = topStoryLists(null).flatMap(([, l]) => l).filter((st) => !seen.has(storyKey(st)) && seen.add(storyKey(st)))
    .sort((a, b) => indepOf(b) - indepOf(a) || b.sources.length - a.sources.length).slice(0, 5);
  const st = statsFor(7);
  const reading = [0, 1, 2, 4].map((i) => Object.values(st.k).reduce((a, v) => a + (v[i] || 0), 0));
  const ahead = typeof hzEvents === "function" ? hzEvents(7) : [];
  const filters = typeof hiddenReport === "function" ? hiddenReport(7) : null;
  return { since, alerts, watch, watchTop, heating, devs, added, retired, miles, stories, reading, ahead, filters };
}
const weekSpan = () => {
  const a = daysAgo(6), b = new Date();
  const f = (d, y) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(y ? { year: "numeric" } : {}) });
  return `${f(a)} – ${f(b)}`;
};
function watchCounts(list) {
  const by = {};
  list.forEach((e) => { by[e.kind] = (by[e.kind] || 0) + 1; });
  const ai = list.filter((e) => e.kind === "device" && e.ai).length;
  return [by.trial ? plural(by.trial, "trial change") : "", by.drug ? plural(by.drug, "drug approval") : "",
    by.device ? `${plural(by.device, "device clearance")}${ai ? ` (${ai} AI)` : ""}` : "", by.rule ? plural(by.rule, "rule") : ""].filter(Boolean).join(", ");
}
function weekLines(w) {
  const out = [];
  if (w.alerts.length) out.push(["Alerts", `${plural(w.alerts.length, "alert")}: ${w.alerts[0].title}`]);
  if (w.watch.length) out.push(["Watch", watchCounts(w.watch)]);
  if (w.heating.length || w.devs.length || w.added.length) {
    out.push(["Radar", [w.heating.length ? `${w.heating.map((t) => t.name).join(", ")} heating up` : "",
      w.devs.length ? plural(w.devs.length, "development") : "", w.added.length ? `new topic: ${w.added.map((t) => t.name).join(", ")}` : ""].filter(Boolean).join("; ")]);
  }
  if (w.miles.length) {
    const m = w.miles[0];
    out.push(["Citations", `${plural(w.miles.length, "paper")} from your areas passed a citation milestone, the biggest ${m.mark} (${S.important.papers[m.pmid].journal})`]);
  }
  if (w.stories.length) out.push(["Biggest story", `${w.stories[0].title} (${coverageText(w.stories[0])})`]);
  if (w.reading[0]) out.push(["You", `saw ${plural(w.reading[0], "card")}, opened ${w.reading[1]} and saved ${w.reading[2]}`]);
  if (w.filters?.hidden) out.push(["Filters", `kept out ${plural(w.filters.hidden, "card")}${w.filters.list[0] ? `, most by ${w.filters.list[0].label.replace(/^Muted /, "")}` : ""}`]);
  return out;
}

// ── Today: on the day you chose ────────────────────────────────────────────
function weekCardItem() {
  if (T.brief.week < 0 || new Date().getDay() !== T.brief.week) return null;
  const key = `week:${localDay()}`;
  if (typeof isCleared === "function" && isCleared(key)) return null;
  const w = weekSummary();
  const lines = weekLines(w);
  if (lines.length < 2) return null;
  return { type: "brief-week", key, sig: lines.map((l) => l[1]).join("|"), lines };
}
function weekCardEl(it) {
  return el("article", { class: "card brief-card wk-card", "data-key": it.key },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Your week"), el("span", {}, weekSpan())),
    el("dl", { class: "wk-lines" }, it.lines.map(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])),
    el("div", { class: "link-row", style: "margin:0" }, el("button", { class: "act", onclick: openWeek }, "Open your week"),
      el("button", { class: "act", onclick: (e) => clearCard(e.currentTarget.closest(".card"), it) }, "Dismiss")));
}

// ── Explore: the entry ─────────────────────────────────────────────────────
function weekEntryEl() {
  if (!S.feed && !S.news) return null;
  const lines = weekLines(weekSummary()).filter(([k]) => k !== "You");
  return el("button", { class: "fd-entry wk-entry", onclick: openWeek },
    el("span", { class: "fd-entry-h" }, el("b", {}, "Your week"), el("span", {}, weekSpan())),
    el("span", { class: "rd-mini" }, lines.slice(0, 3).map(([k, v]) => el("span", {}, el("b", {}, `${k}: `), v))));
}

// ── the page ───────────────────────────────────────────────────────────────
function openWeek() {
  if ($("#sheet").classList.contains("open")) closeSheet();
  S.overlay = "week";
  drawWeek();
  const ov = $("#topic");
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-body").scrollTop = 0;
  $("#topic-back").focus({ preventScroll: true });
}
function drawWeek() {
  $("#topic-title").textContent = "Your week";
  const w = weekSummary();
  const I = S.important;
  const sec = (title, note, rows, more) => (rows.length ? el("section", { class: "wk-sec" }, el("h3", { class: "sys-head" }, title),
    note ? el("p", { class: "fine", style: "margin:0 0 6px" }, note) : null, el("ul", { class: "rows" }, rows), more || null) : null);
  const item = (onclick, src, title, sub) => el("li", { class: "news-item" }, el("button", { class: "w-row", onclick },
    el("span", { class: "news-src" }, src), el("span", { class: "news-title" }, title), sub ? el("span", { class: "fine" }, sub) : null));
  $("#topic-body").replaceChildren(el("div", { class: "rd-page wk-page" },
    el("p", { class: "lede small" }, `${weekSpan()}: what changed in the things you follow, in one place.`),
    sec("Alerts", null, w.alerts.map((a) => item(() => alertOpen(a), [el("b", {}, a.label), el("span", {}, alertWhen(a))], a.title, alertSrc(a)))),
    sec("Watch", w.watch.length ? watchCounts(w.watch) + "." : null,
      w.watchTop.slice(0, 8).map((e) => item(() => openWatchEvent(e), [el("b", {}, WATCH_SHORT[e.kind]), wTopic(e) ? el("span", {}, wTopic(e)) : null, el("span", {}, wWhen(e))],
        e.acr ? `${e.acr}: ${e.title}` : e.title, e.what)),
      w.watch.length ? el("button", { class: "inline-link", onclick: () => openWatch("all") }, "All of Watch") : null),
    sec("Radar", [w.heating.length ? `Heating up: ${w.heating.map((t) => t.name).join(", ")}.` : "", w.added.length ? `New topic: ${w.added.map((t) => t.name).join(", ")}.` : "",
      w.retired.length ? `Retired: ${w.retired.map((r) => r.name).join(", ")}.` : ""].filter(Boolean).join(" ") || null,
      w.devs.slice(0, 6).map(({ t, d }) => item(() => openRadar(t.id), [el("b", {}, t.name), statusChip(t), el("span", {}, d.sources.length > 1 ? coverageText(d) : d.sources[0])], d.title))),
    sec("Citation milestones", "Papers from your areas whose citations passed a round number this week (NIH iCite, counted every Tuesday).",
      w.miles.slice(0, 6).map((m) => {
        const p = I.papers[m.pmid];
        return item(() => openAbstract({ ...p, type: "paper" }), [el("b", {}, p.journal), el("span", {}, `passed ${m.mark} citations`)], p.title,
          `${m.cites.toLocaleString()} now, ${m.was.toLocaleString()} a week before`);
      })),
    sec("The week’s biggest stories", "By how many independent sources covered them.", w.stories.map((st) => {
      const byId = Object.fromEntries((S.news?.items || []).map((i) => [i.id, i]));
      return item(() => openStory(st, byId), [el("b", {}, coverageText(st)), el("span", {}, agoShort(st.date))], st.title);
    })),
    sec("Next 7 days", null, w.ahead.slice(0, 6).map((e) => item(() => openHzEvent(e), [el("b", {}, hzSpan(e) || dayWord(hzStart(e)))], e.title, hzSub(e))),
      w.ahead.length > 6 ? el("button", { class: "inline-link", onclick: openHorizon }, `All ${w.ahead.length} in Coming up`) : null),
    el("section", { class: "wk-sec" }, el("h3", { class: "sys-head" }, "Your reading"),
      w.reading[0] ? el("p", {}, `You saw ${plural(w.reading[0], "card")}, opened ${w.reading[1]}, saved ${w.reading[2]} and cleared ${w.reading[3]}. `,
        el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("reading", "tune-stats"); } }, "More in Tune"))
        : el("p", { class: "fine" }, "Nothing counted on this phone this week."),
      w.filters?.hidden ? el("p", {}, `Your filters kept ${plural(w.filters.hidden, "card")} out. `,
        el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("algorithms", "tune-hidden"); } }, "See what")) : null),
    el("p", { class: "fine" }, T.brief.week < 0 ? "The weekly card in Today is off (Tune → Today)."
      : `Today shows this as a card each ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][T.brief.week]} (Tune → Today).`)));
}
