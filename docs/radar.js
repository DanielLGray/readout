/* Readout — the Radar: emerging topics before they're mainstream (data/radar.json, daily).
   Loaded after horizon.js. */
"use strict";

// ── what counts ────────────────────────────────────────────────────────────
// Early: one credible source (research news, a preprint, a journal's news desk, a major newsroom),
// or any two publishers. Confirmed: two publishers. Mainstream: three.
const RADAR_LEVELS = [["early", "Early"], ["confirmed", "2+ sources"], ["mainstream", "3+ sources"]];       // independent sources
const devCounts = (d) => (T.radar.level === "mainstream" ? d.n >= 3 : T.radar.level === "confirmed" ? d.n >= 2 : d.credible || d.n >= 2);
const RADAR_STATUS = { heating: "Heating up", steady: "Steady", quiet: "Quiet" };
const RADAR_LABEL = { preprint: "Preprint, not yet peer reviewed", research: "Research news", newsroom: "Newsroom", other: "" };
const KIND_WORD = { science: "science", health: "health", business: "markets", radar: "research" };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function radarTopics() {
  const R = S.radar;
  if (!R?.topics) return [];
  const hidden = new Set(T.radar.hidden);
  return R.topics.filter((t) => !hidden.has(t.id)).map((t) => ({ ...t, devs: (t.developments || []).filter(devCounts) }));
}
// developments new to you (not yet shown in Today), newest first, from heating topics first
let radarSeen = store.get("radarSeen", null);
if (!radarSeen || typeof radarSeen !== "object" || Array.isArray(radarSeen)) radarSeen = {};
function radarNews(days = 7) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const out = [];
  const today = localDay();      // shown before today: done; shown today: the card keeps it until tomorrow
  for (const t of radarTopics()) for (const d of t.devs) if ((d.updated || d.date) >= since && (!radarSeen[d.id] || radarSeen[d.id] === today)) out.push({ t, d });
  const rank = { heating: 0, steady: 1, quiet: 2 };
  return out.sort((a, b) => (rank[rdStatus(a.t)] ?? 3) - (rank[rdStatus(b.t)] ?? 3) || (a.d.updated < b.d.updated ? 1 : -1));
}
function radarJustAdded(days = 7) {
  const since = localDay(daysAgo(days));
  return radarTopics().filter((t) => t.origin === "spotted" && t.added && t.added >= since);
}
// Heating up: at least 3 headlines in 30 days and Tune's multiple of the usual (6 if there's no usual
// yet). Quiet (none in 60 days) comes from the daily job.
function rdStatus(t) {
  const m = t?.momentum;
  if (!m || m.status === "quiet") return m?.status || "steady";
  const k = T.radar.heat || 2;
  return m.month >= 3 && (m.usual == null ? m.month >= 6 : m.month >= k * Math.max(m.usual, 1)) ? "heating" : "steady";
}
function statusChip(t) {
  const s = rdStatus(t);
  return el("span", { class: `rd-status rd-${s}` }, RADAR_STATUS[s] || s);
}
function momentumText(m) {
  if (!m) return "";
  const usual = m.usual == null ? "" : `, usually ${m.usual < 1 ? "under 1" : Math.round(m.usual)}`;
  return `${plural(m.month, "headline")} in 30 days${usual}`;
}
function researchText(r) {
  if (!r) return "";
  const pct = Math.round((r.growth - 1) * 100);
  return `Research ${pct >= 0 ? "+" : ""}${pct}% last year (${r.last.toLocaleString()} papers)`;
}

// ── Explore: the entry ─────────────────────────────────────────────────────
function radarEntryEl() {
  const R = S.radar;
  if (!R) return null;
  const topics = radarTopics();
  const fresh = radarNews(7).length;
  const hot = topics.filter((t) => rdStatus(t) === "heating");
  return el("button", { class: "fd-entry rd-entry", onclick: openRadar },
    el("span", { class: "fd-entry-h" }, el("b", {}, "Radar"),
      el("span", {}, fresh ? `${plural(fresh, "new development")} this week` : `${plural(topics.length, "topic")}`)),
    el("span", { class: "rd-mini" }, topics.slice(0, 4).map((t) => el("span", {}, statusChip(t), t.name)),
      hot.length ? null : (R.spotted || []).length ? el("span", { class: "fine" }, `${plural(R.spotted.length, "new phrase")} spotted`) : null));
}

// ── the Radar page ─────────────────────────────────────────────────────────
function openRadar(topicId) {
  if ($("#sheet").classList.contains("open")) closeSheet();
  S.overlay = "radar";
  S.radarTopic = typeof topicId === "string" ? topicId : null;
  drawRadar();
  const ov = $("#topic");
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-body").scrollTop = 0;
  $("#topic-back").focus({ preventScroll: true });
}
function drawRadar() {
  if (S.radarTopic) return drawRadarTopic(S.radarTopic);
  $("#topic-title").textContent = "Radar";
  const R = S.radar;
  const body = $("#topic-body");
  const keep = body.scrollTop;
  const topics = radarTopics();
  const hiddenSpots = new Set(T.radar.hiddenSpots);
  const allSpotted = (R?.spotted || []).filter((c) => !hiddenSpots.has(c.key));
  const spotted = S.radarAllSpots ? allSpotted : allSpotted.slice(0, 5);
  const level = RADAR_LEVELS.find(([k]) => k === T.radar.level)?.[1] || "Early";
  body.replaceChildren(el("div", { class: "rd-page" },
    el("p", { class: "lede small" }, "Ideas before they’re mainstream: research news, preprints and the outlets you read, with the dross left out. ",
      el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("interests", "tune-radar"); } }, `Showing: ${level}`)),
    !R ? el("p", { class: "nothing" }, "The Radar fills in with its first daily update.") : null,
    topics.map((t) => el("button", { class: "rd-topic", onclick: () => { S.radarTopic = t.id; drawRadar(); $("#topic-body").scrollTop = 0; } },
      el("span", { class: "rd-topic-h" }, el("b", {}, t.name), statusChip(t)),
      el("span", { class: "rd-topic-m" }, [momentumText(t.momentum), researchText(t.research)].filter(Boolean).join(" · ")),
      t.devs[0] ? el("span", { class: "rd-topic-d" }, t.devs[0].title) : el("span", { class: "rd-topic-d none" }, "Nothing that counts in the last four months."),
      t.origin === "spotted" ? el("span", { class: "fine" }, `Added by the Radar ${fmtDate(t.added)}${t.retire_on ? `; retires ${fmtDate(t.retire_on)} unless it picks up` : ""}`) : null)),
    spotted.length ? el("section", { class: "rd-spot" },
      el("h3", { class: "sys-head" }, "Spotted, not on the Radar yet"),
      el("p", { class: "fine", style: "margin:0 0 8px" }, `Phrases new to science, health and markets headlines. One that keeps turning up for ${R.settings?.weeks_to_watch || 3} weeks joins the Radar by itself.`),
      el("ul", { class: "rows" }, spotted.map((c) => el("li", { class: "rd-cand" },
        el("button", { class: "rd-cand-b", onclick: () => openSpotted(c) },
          el("span", { class: "rd-cand-h" }, el("b", {}, cap(c.term)), el("span", { class: "fine" }, KIND_WORD[c.kind] || c.kind)),
          el("span", { class: "fine" }, `${plural(c.count, "headline")} from ${plural(c.publishers, "publisher")} in 30 days${c.prior ? `, ${c.prior} before` : ", none before"}; seen ${c.weeks} of ${c.need} weeks`,
            c.research ? ` · ${researchText(c.research)}` : "")),
        el("button", { class: "act rd-x", "aria-label": `Not interested in ${c.term}`, onclick: () => {
          setTune({ radar: { ...T.radar, hiddenSpots: [...T.radar.hiddenSpots, c.key].slice(-200) } }); drawRadar(); } }, "Hide")))),
      allSpotted.length > spotted.length ? el("button", { class: "inline-link", onclick: () => { S.radarAllSpots = true; drawRadar(); } },
        `Show all ${allSpotted.length}`) : null,
      R.settings?.openalex_key ? null : el("p", { class: "fine" }, "Without an OpenAlex key, phrases aren’t yet checked against research, so old fields that are in the news show here too.")) : null,
    (R?.retired || []).length ? el("details", { class: "outlets" }, el("summary", {}, "Retired", el("span", { class: "fine" }, String(R.retired.length))),
      el("ul", { class: "rows plain" }, R.retired.map((r) => el("li", { class: "fine" }, el("b", {}, r.name), ` · added ${fmtDate(r.added)}, retired ${fmtDate(r.retired)}: ${r.reason}.`)))) : null,
    R ? el("p", { class: "fine" }, "Research news from Phys.org and Tech Xplore; preprints from arXiv; research counts from OpenAlex (CC0)",
      R.settings?.openalex_key ? "" : ", a few topics a day until an OpenAlex key is added (Tune → Updates)",
      `. Updated ${ago(R.generated)}.`) : null));
  body.scrollTop = keep;
}
function openSpotted(c) {
  openSheet(
    el("h2", { id: "sheet-title" }, cap(c.term)),
    el("p", { class: "sheet-meta" }, el("span", {}, `${plural(c.count, "headline")}, ${plural(c.publishers, "publisher")}`), el("span", {}, KIND_WORD[c.kind] || c.kind)),
    el("ul", { class: "rows" }, (c.examples || []).map((h) => el("li", { class: "news-item" },
      el(h.link ? "a" : "div", h.link ? { href: safeUrl(h.link), target: "_blank", rel: "noopener" } : {},
        el("span", { class: "news-src" }, el("b", {}, h.source), el("span", {}, agoShort(h.date))),
        el("span", { class: "news-title" }, h.title))))),
    el("p", { class: "fine" }, `It joins the Radar after ${c.need} weeks of headlines, unless it’s an established field that just happens to be in the news.`));
}

// ── one topic ──────────────────────────────────────────────────────────────
function devEl(d) {
  const lab = RADAR_LABEL[d.label] || "";
  const first = d.items?.[0];
  const open = () => (d.items?.length > 1 ? openStory({ title: d.title, sources: d.sources, n: d.n, copies: d.copies, date: d.updated, items: d.items.map((_, i) => `${d.id}:${i}`) },
    Object.fromEntries(d.items.map((it, i) => [`${d.id}:${i}`, it]))) : first?.link && window.open(safeUrl(first.link), "_blank", "noopener"));
  return el("li", { class: "news-item" }, el("button", { class: "rd-dev", onclick: open },
    el("span", { class: "news-src" }, el("b", {}, d.sources.length > 1 ? coverageText(d) : d.sources[0]), lab ? el("span", {}, lab) : null, el("span", {}, agoShort(d.updated || d.date))),
    el("span", { class: "news-title" }, d.title),
    d.sources.length > 1 ? el("span", { class: "fine" }, d.sources.join(", ")) : null));
}
function drawRadarTopic(id) {
  const t = radarTopics().find((x) => x.id === id) || (S.radar?.topics || []).find((x) => x.id === id);
  if (!t) { S.radarTopic = null; return drawRadar(); }
  $("#topic-title").textContent = t.name;
  const all = t.developments || [];
  const shown = all.filter(devCounts);
  const m = t.momentum || {}, r = t.research;
  $("#topic-body").replaceChildren(el("div", { class: "rd-page" },
    el("button", { class: "inline-link", onclick: () => { S.radarTopic = null; drawRadar(); } }, "‹ All Radar topics"),
    el("div", { class: "rd-topic-h", style: "margin-top:10px" }, statusChip(t),
      el("span", { class: "fine" }, t.origin === "spotted" ? (t.why || "Added by the Radar") : "A topic you chose")),
    t.retire_on ? el("p", { class: "fine" }, `Retires ${fmtDate(t.retire_on)} unless it heats up.`) : null,
    el("h3", { class: "sys-head" }, "In the news"),
    el("p", { class: "fine", style: "margin:0 0 6px" }, momentumText(m), ". Headlines a week, last 26 weeks."),
    dayBars((m.weeks || []).map((n) => [n, 0]), ["26 weeks ago", "this week"], { h: 48 }),
    r ? [el("h3", { class: "sys-head" }, "In research"),
      el("p", { class: "fine", style: "margin:0 0 6px" }, `${researchText(r)}${r.accel ? ", and speeding up" : ""}. Papers a year, from OpenAlex (this year so far, still being indexed).`),
      dayBars(r.years.map(([, n], i) => [n, i === r.years.length - 2 ? n : 0]), [String(r.years[0][0]), String(r.years[r.years.length - 1][0])], { h: 56 })]
      : el("p", { class: "fine" }, "Research counts arrive with a later update."),
    el("h3", { class: "sys-head" }, `Developments${shown.length ? ` (${shown.length})` : ""}`),
    shown.length ? el("ul", { class: "rows" }, shown.slice(0, 20).map(devEl)) : el("p", { class: "nothing" }, "Nothing that counts in the last four months."),
    all.length > shown.length ? el("p", { class: "fine" }, `${plural(all.length - shown.length, "more story", "more stories")} from single, less established outlets left out. `,
      el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("interests", "tune-radar"); } }, "Change what counts")) : null,
    (t.preprints || []).length ? [el("h3", { class: "sys-head" }, "New preprints"),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "From arXiv: posted by the authors, not yet peer reviewed."),
      el("ul", { class: "rows" }, t.preprints.map((p) => el("li", { class: "news-item" }, el("a", { href: safeUrl(p.link), target: "_blank", rel: "noopener" },
        el("span", { class: "news-src" }, el("b", {}, "arXiv"), el("span", {}, fmtDate((p.date || "").slice(0, 10)))),
        el("span", { class: "news-title" }, p.title), p.authors ? el("span", { class: "fine" }, p.authors) : null))))] : null,
    (t.papers || []).length ? [el("h3", { class: "sys-head" }, "Most cited lately"),
      el("p", { class: "fine", style: "margin:0 0 6px" }, "Published in the last 18 months, most cited first (OpenAlex)."),
      el("ul", { class: "rows" }, t.papers.map((p) => el("li", { class: "news-item" }, el("a", { href: safeUrl(p.link), target: "_blank", rel: "noopener" },
        el("span", { class: "news-src" }, el("b", {}, p.venue || "Paper"), el("span", {}, `${fmtDate(p.date)} · cited ${plural(p.cites, "time")}`)),
        el("span", { class: "news-title" }, p.title)))))] : null,
    el("p", { class: "fine" }, "Matches: ", (t.words || []).join(", "), "."),
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => {
      setTune({ radar: { ...T.radar, hidden: [...new Set([...T.radar.hidden, t.id])] } });
      toast(`${t.name} hidden. Bring it back in Tune → Interests → Radar.`); S.radarTopic = null; drawRadar();
    } }, "Hide this topic"))));
}

// ── Today ──────────────────────────────────────────────────────────────────
function radarCardItem() {
  if (!T.brief.radar || !S.radar) return null;
  const fresh = radarNews(7).slice(0, 3);
  const added = radarJustAdded(7).filter((t) => !radarSeen[`added:${t.id}`] || radarSeen[`added:${t.id}`] === localDay());
  if (!fresh.length && !added.length) return null;
  return { type: "brief-radar", key: "brief:radar", sig: fresh.map((x) => x.d.id).concat(added.map((t) => t.id)).join(","), fresh, added };
}
function radarCardEl(it) {
  const card = el("article", { class: "card brief-card rd-card", "data-key": "brief:radar" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "On your radar"), el("span", {}, "new this week")),
    it.added.map((t) => el("p", { class: "rd-added" }, el("b", {}, "New topic: "), t.name, t.why ? el("span", { class: "fine" }, ` · ${t.why}`) : null)),
    el("ul", { class: "rows" }, it.fresh.map(({ t, d }) => el("li", { class: "news-item" }, el("button", { class: "rd-dev", onclick: () => openRadar(t.id) },
      el("span", { class: "news-src" }, el("b", {}, t.name), statusChip(t), el("span", {}, d.sources.length > 1 ? coverageText(d) : d.sources[0])),
      el("span", { class: "news-title" }, d.title))))),
    el("div", { class: "link-row", style: "margin:0" }, el("button", { class: "act", onclick: () => openRadar() }, "Open the Radar")));
  // shown once: marked when it's on screen, so tomorrow brings only what's new
  const d = localDay();
  it.fresh.forEach(({ d: dev }) => { radarSeen[dev.id] ||= d; });
  it.added.forEach((t) => { radarSeen[`added:${t.id}`] ||= d; });
  const cut = localDay(daysAgo(150));
  for (const [k, v] of Object.entries(radarSeen)) if (v < cut) delete radarSeen[k];
  store.set("radarSeen", radarSeen);
  return card;
}

// ── Tune → Interests ───────────────────────────────────────────────────────
function radarSection() {
  const R = S.radar;
  const hidden = (T.radar.hidden || []).map((id) => (R?.topics || []).find((t) => t.id === id) || { id, name: id });
  return el("section", { class: "sect", id: "tune-radar" }, el("h2", {}, "Radar"),
    el("p", { class: "sub" }, "Emerging topics in Explore → Radar, and a Today card when something new counts. Topics you chose stay; ones the Radar spots join after a few weeks of headlines and retire if they don’t pick up within a year and a half."),
    segPick("What counts as a development", RADAR_LEVELS, T.radar.level, (v) => { setTune({ radar: { ...T.radar, level: v } }); rerender(); },
      "Early: one credible source is enough (research news, a preprint, a journal’s news desk or a major newsroom); anything else needs two independent sources. 2+ or 3+ sources: quieter, but by then it’s rarely early. Independent: sister outlets, copies of one press release and wire copies count once."),
    segPick("Heating up at", [[1.5, "1.5× usual"], [2, "2× usual"], [3, "3× usual"]], T.radar.heat, (v) => { setTune({ radar: { ...T.radar, heat: Number(v) } }); rerender(); },
      "Headlines in the last 30 days against the usual month, and at least 3. Heating topics lead the Radar and its Today card."),
    switchRow("Radar card in Today", "New developments and newly added topics, once each.", T.brief.radar, (on) => { setTune({ brief: { ...T.brief, radar: on } }); rerender(); }),
    hidden.length ? el("div", { class: "chips wrap" }, hidden.map((t) => el("button", { class: "chip", "aria-pressed": "true",
      onclick: () => { setTune({ radar: { ...T.radar, hidden: T.radar.hidden.filter((x) => x !== t.id) } }); rerender(); } }, `${t.name}  ✕`))) : null,
    hidden.length ? el("p", { class: "fine" }, "Hidden topics: tap one to bring it back.") : null,
    el("p", { class: "fine" }, "To add or remove a topic for good, edit config/radar.yaml (Tune → Updates → Radar), or ask for it."));
}
