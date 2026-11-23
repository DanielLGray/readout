/* Readout — body imaging literature, led by each paper's own conclusion. */
"use strict";

// ── tiny helpers ───────────────────────────────────────────────────────────
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(3)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
function icon(svg) { const s = el("span"); s.innerHTML = svg; return s.firstElementChild; }
const ICONS = {
  abstract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 6h14M5 10h14M5 14h14M5 18h9"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4-6 4z"/></svg>',
  saved: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3.5h12v17l-6-4-6 4z"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M5 12v7.5h14V12"/></svg>',
  pubmed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const store = {
  get(k, d) { try { const v = localStorage.getItem("readout." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("readout." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s) {
  if (!s) return "";
  const [y, m, d] = String(s).split("-");
  if (!m) return y;
  if (!d) return `${MON[+m - 1]} ${y}`;
  return `${MON[+m - 1]} ${+d}, ${y}`;
}
function ago(iso) {
  if (!iso) return "";
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
function pct(g) {
  if (g == null) return "new";
  if (g >= 4) return `${Math.round(g + 1)}×`;
  const v = Math.round(g * 100);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + "%";
}
const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + "s")}`;

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ── state ──────────────────────────────────────────────────────────────────
const S = {
  feed: null, explore: null, tab: "feed",
  system: "all", strong: false, topic: null,
  win: store.get("win", "2"),
  saved: store.get("saved", {}),
  newIds: new Set(), list: [], rendered: 0, loadedAt: 0, exploreKey: null,
  news: null, newsCat: "all", newsTerm: null, newsSpan: store.get("newsSpan", "week"), newsShown: 40,
  newsNew: new Set(), newsKey: null,
};

async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// ── feed ───────────────────────────────────────────────────────────────────
function markNew() {
  const prev = store.get("prevIds", null);
  const ids = (S.feed?.items || []).map((i) => i.pmid);
  S.newIds = prev ? new Set(ids.filter((id) => !prev.includes(id))) : new Set();
}
function rememberSeen() {
  if (S.feed) store.set("prevIds", S.feed.items.map((i) => i.pmid));
  if (S.news) store.set("prevNewsIds", S.news.items.map((i) => i.id));
}
function markNewsNew() {
  const prev = store.get("prevNewsIds", null);
  S.newsNew = prev && S.news ? new Set(S.news.items.map((i) => i.id).filter((id) => !prev.includes(id))) : new Set();
}

function paperOf(ref) {
  // explore.json lists papers by PMID; older files embedded them
  return typeof ref === "string" ? S.explore?.papers?.[ref] : ref;
}

function topicName(id) {
  return S.feed?.topics?.[id]?.name || S.explore?.topics?.find((t) => t.id === id)?.name || id;
}

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!S.feed) return;
  if (S.topic) {
    box.append(el("button", { class: "chip chip-topic", "aria-pressed": "true", onclick: () => { S.topic = null; refreshFeed(); } },
      `${topicName(S.topic)}  ✕`));
  }
  const add = (key, label) => box.append(el("button", {
    class: "chip", "aria-pressed": String(S.system === key),
    onclick: () => { S.system = key; refreshFeed(); },
  }, label));
  add("all", "All");
  for (const [k, label] of Object.entries(S.feed.systems || {})) add(k, label);
  box.append(el("span", { class: "chip-sep", "aria-hidden": "true" }));
  box.append(el("button", {
    class: "chip", "aria-pressed": String(S.strong),
    onclick: () => { S.strong = !S.strong; refreshFeed(); },
  }, "Strong evidence"));
}

function filtered() {
  let items = S.feed?.items || [];
  if (S.system !== "all") items = items.filter((i) => (i.systems || []).includes(S.system));
  if (S.strong) items = items.filter((i) => (i.design?.strength || 0) >= 3);
  if (S.topic) items = items.filter((i) => (i.topics || []).includes(S.topic));
  return items;
}

let feedObserver;
function refreshFeed() {
  renderChips();
  const view = $("#view-feed");
  view.replaceChildren();
  view.scrollTop = 0;
  updateHeadNote();
  if (!S.feed) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "No papers yet" }),
      el("p", { text: "Your feed fills after the first update runs. On GitHub, open Actions, choose “Update feed”, and run it. Then tap refresh here." }),
      el("button", { class: "btn", onclick: () => reload(true) }, "Check again")));
    return;
  }
  S.list = filtered();
  S.rendered = 0;
  if (!S.list.length) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "Nothing matches these filters" }),
      el("p", { text: "Try another organ system, or turn off Strong evidence." }),
      el("button", { class: "btn", onclick: () => { S.system = "all"; S.strong = false; S.topic = null; refreshFeed(); } }, "Show all papers")));
    return;
  }
  const sentinel = el("div", { "aria-hidden": "true", style: "height:1px" });
  view.append(sentinel);
  feedObserver?.disconnect();
  feedObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) appendCards(8);
  }, { root: view, rootMargin: "0px 0px 150% 0px" });
  feedObserver.observe(sentinel);
  appendCards(10);
}

function appendCards(n) {
  const view = $("#view-feed");
  const sentinel = view.lastElementChild;
  const batch = S.list.slice(S.rendered, S.rendered + n);
  const made = batch.map(cardEl);
  made.forEach((c) => view.insertBefore(c, sentinel));
  S.rendered += batch.length;
  requestAnimationFrame(() => made.forEach(fitCard));
  if (S.rendered >= S.list.length && !view.querySelector(".feed-end")) {
    feedObserver?.disconnect();
    const days = S.list.length ? S.list[S.list.length - 1].added : "";
    view.insertBefore(el("section", { class: "feed-end" },
      el("h2", { text: "You’re at the end" }),
      el("p", { text: `${plural(S.list.length, "paper")} here, back to ${fmtDate(days)}. New papers arrive every morning.` }),
      el("button", { class: "btn", onclick: () => { view.scrollTo({ top: 0 }); } }, "Back to newest")), sentinel);
  }
}

function conclLabel(c) {
  switch (c.kind) {
    case "structured": {
      const l = (c.label || "Conclusion").toLowerCase();
      return /^conclusions?$/.test(l) ? "Authors’ conclusion" : `Authors’ ${l}`;
    }
    case "closing": return "Last lines of the abstract — no labeled conclusion";
    case "opening": return "Opening of a review — no stated conclusion";
    default: return "";
  }
}
function lenClass(t) {
  const n = (t || "").length;
  return n <= 170 ? "" : n <= 300 ? "l2" : n <= 480 ? "l3" : "l4";
}

function evidenceEl(design, small, sample) {
  const badges = design?.badges || [];
  const s = design?.strength || 0;
  const main = badges.filter((b) => b.strength > 0).sort((a, b) => b.strength - a.strength)[0];
  const rest = badges.filter((b) => b !== main);
  const meter = el("span", { class: "meter", "data-s": String(s), role: "img",
    "aria-label": `Evidence strength ${s} of 4` }, el("i"), el("i"), el("i"), el("i"));
  return el("div", { class: "evidence" },
    meter,
    el("span", { class: "ev-main" }, main ? main.label : "Design not stated"),
    small ? null : rest.map((b) => el("span", {
      class: "badge" + (b.source === "text" ? " text" : ""),
      title: b.source === "text" ? "Detected from the abstract’s wording" : "From PubMed indexing",
    }, b.label)),
    sample ? el("span", { class: "sample" }, sample) : null);
}

function cardEl(it) {
  const isNew = S.newIds.has(it.pmid);
  const c = it.conclusion || { kind: "none" };
  const extra = c.kind === "structured" && (c.text || "").length < 260 ? (it.extras || [])[0] : null;
  const card = el("article", { class: "card", "data-pmid": it.pmid },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, it.journal),
      el("span", {}, fmtDate(it.epub || it.added)),
      el("span", { class: "spacer" }),
      isNew ? el("span", { class: "tag-new" }, "New") : null),
    it.retracted ? el("div", { class: "warn" }, "Retracted. See the notice on PubMed before using this.") : null,
    it.concern ? el("div", { class: "warn" }, "Expression of concern published for this paper.") : null,
    el("h2", { class: "card-title clamp" }, it.title),
    el("div", { class: "concl" }, el("div", { class: "concl-inner" },
      c.kind === "none"
        ? el("p", { class: "concl-text none" }, "PubMed doesn’t have this abstract yet. It usually appears within a few days.")
        : [el("div", { class: "concl-label" + (c.kind === "structured" ? "" : " soft") }, conclLabel(c)),
          el("p", { class: `concl-text ${lenClass(c.text)}` }, c.text)],
      extra ? el("div", { class: "extra" },
        el("div", { class: "extra-label" }, extra.label),
        el("p", { class: "extra-text" }, extra.text)) : null)),
    evidenceEl(it.design, false, it.sample),
    (it.topics || []).length ? el("div", { class: "topic-tags" },
      it.topics.slice(0, 3).map((t) => el("button", { class: "topic-tag", onclick: () => { S.topic = t; S.system = "all"; refreshFeed(); } }, topicName(t)))) : null,
    actionsEl(it, true));
  return card;
}

function actionsEl(it, withShare) {
  const saved = !!S.saved[it.pmid];
  const saveBtn = el("button", { class: "act", "aria-pressed": String(saved), onclick: () => toggleSave(it, saveBtn) },
    icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save");
  return el("div", { class: "actions", style: withShare ? null : "grid-template-columns:repeat(3,1fr)" },
    el("button", { class: "act", onclick: () => openAbstract(it) }, icon(ICONS.abstract), "Abstract"),
    saveBtn,
    el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener" }, icon(ICONS.pubmed), "PubMed"),
    withShare ? el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share") : null);
}

function fitCard(card) {
  const box = card.querySelector(".concl");
  const inner = box?.querySelector(".concl-inner");
  const p = box?.querySelector(".concl-text:not(.none)");
  if (!box || !p) return;
  // reset, so this can run again after fonts load or the screen rotates
  p.style.webkitLineClamp = "";
  p.style.lineClamp = "";
  card.querySelector(".more-note")?.remove();
  const extra = box.querySelector(".extra");
  if (extra) extra.hidden = false;
  const sizes = ["", "l2", "l3", "l4"];
  const base = p.dataset.size ?? (p.dataset.size = sizes.find((c) => c && p.classList.contains(c)) || "");
  sizes.forEach((c) => c && p.classList.remove(c));
  if (base) p.classList.add(base);
  const over = () => inner.scrollHeight > box.clientHeight + 1;
  if (over() && extra) extra.hidden = true;
  // smaller type before cutting text: the conclusion is the point of the card
  for (let i = sizes.indexOf(base) + 1; over() && i < sizes.length; i++) {
    sizes.forEach((c) => c && p.classList.remove(c));
    p.classList.add(sizes[i]);
  }
  if (!over()) return;
  const note = el("button", { class: "concl-label more-note",
    onclick: () => openAbstract(S.list.find((i) => i.pmid === card.dataset.pmid)) }, "Continues in the abstract");
  inner.append(note);
  const lh = parseFloat(getComputedStyle(p).lineHeight) || 30;
  const label = box.querySelector(".concl-label:not(.more-note)");
  const avail = box.clientHeight - (label ? label.offsetHeight + 8 : 0) - (note.offsetHeight + 8);
  const lines = String(Math.max(2, Math.floor(avail / lh)));
  p.style.webkitLineClamp = lines;
  p.style.lineClamp = lines;
}
function fitAll() { document.querySelectorAll("#view-feed .card").forEach(fitCard); }

function toggleSave(it, btn) {
  if (S.saved[it.pmid]) {
    delete S.saved[it.pmid];
    toast("Removed from Saved");
  } else {
    S.saved[it.pmid] = Object.assign({}, it, { savedAt: Date.now() });
    toast("Saved");
  }
  store.set("saved", S.saved);
  const on = !!S.saved[it.pmid];
  document.querySelectorAll(`[data-pmid="${it.pmid}"] .act[aria-pressed]`).forEach((b) => setSaveBtn(b, on));
  if (btn) setSaveBtn(btn, on);
  if (S.tab === "saved") renderSaved();
}
function setSaveBtn(b, on) {
  b.setAttribute("aria-pressed", String(on));
  b.replaceChildren(icon(on ? ICONS.saved : ICONS.save), on ? "Saved" : "Save");
}

async function share(it) {
  const text = `${it.title} (${it.journal})\n\n${it.conclusion?.text || ""}`;
  try {
    if (navigator.share) await navigator.share({ title: it.title, text, url: pubmedUrl(it.pmid) });
    else { await navigator.clipboard.writeText(`${text}\n${pubmedUrl(it.pmid)}`); toast("Copied to clipboard"); }
  } catch { /* cancelled */ }
}

// ── abstract sheet ─────────────────────────────────────────────────────────
function openSheet(...content) {
  const card = $("#sheet-card");
  card.replaceChildren(
    el("div", { style: "display:flex;align-items:center" },
      el("div", { class: "grab", style: "margin:0 auto" }),
      el("button", { class: "icon-btn", "aria-label": "Close", onclick: closeSheet }, icon(ICONS.close))),
    ...content.flat(3).filter((x) => x != null && x !== false));
  card.scrollTop = 0;
  const sheet = $("#sheet");
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  card.querySelector("button")?.focus({ preventScroll: true });
}
function closeSheet() {
  const sheet = $("#sheet");
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
}

function openAbstract(it) {
  if (!it) return;
  const secs = it.sections || [];
  const links = [
    el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener" }, "PubMed"),
    it.doi ? el("a", { class: "act", href: `https://doi.org/${it.doi}`, target: "_blank", rel: "noopener" }, "Journal") : null,
    it.pmcid ? el("a", { class: "act", href: `https://pmc.ncbi.nlm.nih.gov/articles/${it.pmcid}/`, target: "_blank", rel: "noopener" }, "Free full text") : null,
  ];
  openSheet(
    el("h2", { id: "sheet-title" }, it.title),
    el("p", { class: "sheet-meta" },
      [it.authors, it.journal, fmtDate(it.epub || it.added || it.ppub), `PMID ${it.pmid}`].filter(Boolean).map((t) => el("span", {}, t))),
    it.retracted ? el("div", { class: "warn", style: "margin-bottom:14px" }, "Retracted. Check the retraction notice on PubMed.") : null,
    evidenceEl(it.design),
    it.sample ? el("p", { class: "sample", style: "margin:6px 0 0;font-size:14px" }, `Sample: ${it.sample} (read from the abstract)`) : null,
    el("div", { style: "height:16px" }),
    secs.length
      ? secs.map((s) => el("section", { class: "abs-sec" + (s.cat === "CONCLUSIONS" ? " key" : "") },
        s.label ? el("h3", {}, s.label) : null, el("p", {}, s.text)))
      : el("p", { class: "sample" }, "PubMed has no abstract for this paper. Open it on PubMed or the journal’s site to read it."),
    el("div", { class: "link-row" }, links, actionsEl(it, false).children[1]));
}

function openInfo() {
  const gen = S.feed?.generated ? `Feed updated ${ago(S.feed.generated)}.` : "Feed not built yet.";
  const exg = S.explore?.generated ? ` Trends updated ${ago(S.explore.generated)}.` : "";
  openSheet(el("div", { class: "info" },
    el("h2", { id: "sheet-title" }, "How cards are built"),
    el("p", {}, `Every card is a PubMed record. ${gen}${exg}`),
    el("h3", {}, "The big text is the authors’ own words"),
    el("p", {}, "When the abstract has a labeled conclusion, the card shows it word for word, with copyright and journal boilerplate removed. Nothing is summarized or rewritten by AI."),
    el("ul", {},
      el("li", {}, "“Authors’ conclusion”: the labeled Conclusion section."),
      el("li", {}, "“Last lines of the abstract”: the abstract has no labels, so you see its final two sentences."),
      el("li", {}, "“Opening of a review”: review articles rarely conclude anything, so you see their first two sentences.")),
    el("h3", {}, "Evidence strength"),
    el("div", { class: "scale" }), el("div", { class: "scale-l" }, el("span", {}, "Case report, review"), el("span", {}, "Meta-analysis, RCT, guideline")),
    el("p", {}, "The colored scale borrows the PET hot-iron map. Solid badges come from PubMed’s indexing. Dashed badges were detected from words in the abstract (for example “retrospective”), so treat them as a hint. Sample size is read from the abstract the same way."),
    el("h3", {}, "Explore"),
    el("p", {}, "Topic trends compare paper counts in PubMed for the last 1, 2 or 5 years with the same span before, adjusted for how fast imaging research grew overall. Citation figures come from NIH iCite; new trial counts from ClinicalTrials.gov. Citations take a year or two to build up, so the 1-year view leans on paper counts."),
    el("h3", {}, "Sources"),
    el("p", {}, "PubMed (NLM), NIH iCite, ClinicalTrials.gov. Fonts: Literata, Atkinson Hyperlegible Next (SIL Open Font License).")));
}

// ── explore ────────────────────────────────────────────────────────────────
function heatVar(g) {
  if (g == null) return "var(--h4)";
  if (g <= -0.15) return "var(--faint)";
  if (g < 0.15) return "var(--h1)";
  if (g < 0.5) return "var(--h2)";
  if (g < 1) return "var(--h3)";
  return "var(--h4)";
}
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
function spark(counts, win, g, opts = {}) {
  const w = opts.w || 88, h = opts.h || 22, gap = opts.gap ?? 2;
  const n = counts.length, bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...counts);
  const svg = svgEl("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}`, class: "spark", "aria-hidden": "true" });
  counts.forEach((c, i) => {
    const bh = Math.max(1, (c / max) * h);
    const inWin = i >= n - Number(win);
    const r = svgEl("rect", { x: i * (bw + gap), y: h - bh, width: bw, height: bh, rx: 1 });
    r.style.fill = inWin ? heatVar(g) : "var(--h0)";
    if (i === n - 1) r.style.opacity = "0.6";   // current year, not finished
    svg.append(r);
  });
  return svg;
}

function topicRow(tp, mode) {
  const w = tp.windows?.[S.win] || {};
  const min = S.explore.min_recent?.[S.win] || 0;
  const few = (w.recent || 0) < min && (w.prior || 0) < min;
  let fig, figClass = "", sub;
  if (mode === "influence") {
    fig = (w.influence || 0).toFixed(1);
    sub = "citations a year, average of its 10 most-cited papers";
  } else if (mode === "practice") {
    const n = (w.guidelines || []).length;
    fig = String(n);
    sub = n === 1 ? "guideline or consensus paper" : "guideline or consensus papers";
  } else {
    fig = few ? "few papers" : pct(w.growth);
    figClass = few ? "" : (w.growth == null || w.growth >= 0.15 ? "hot" : w.growth <= -0.15 ? "cold" : "");
    sub = `${plural(w.recent || 0, "paper")}, ${(w.prior || 0).toLocaleString()} before`;
  }
  return el("li", { class: "row" },
    el("button", { onclick: () => openTopic(tp.id) },
      el("span", { class: "row-name" }, tp.name),
      el("span", { class: `row-fig ${figClass}` }, fig),
      el("span", { class: "row-sub" }, spark(tp.years || [], S.win, w.growth), el("span", {}, sub))));
}

function termRow(t, years) {
  const ex = el("div", { class: "term-ex", hidden: true },
    (t.examples || []).map((e) => el("a", { href: pubmedUrl(e.pmid), target: "_blank", rel: "noopener" },
      `${e.title} (${e.journal}, ${(e.date || "").slice(0, 4)})`)),
    el("a", { class: "more", target: "_blank", rel: "noopener",
      href: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(`"${t.term}"[ti]`)}&sort=date` },
    "Search PubMed for this phrase"));
  const ratio = t.prior === 0 ? "new" : `${t.ratio.toFixed(1)}×`;
  const btn = el("button", { "aria-expanded": "false", onclick: () => {
    const open = ex.hidden; ex.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  } },
  el("span", { class: "row-name" }, t.term),
  el("span", { class: "row-fig " + (t.ratio >= 1 ? "hot" : "cold") }, ratio),
  el("span", { class: "row-sub" }, spark(t.years || [], S.win, t.ratio >= 1 ? Math.min(1.5, t.ratio - 1) : -0.5),
    el("span", {}, `${plural(t.recent, "title")} now, ${t.prior.toLocaleString()} before`)));
  return el("li", { class: "row" }, btn, ex);
}

function segEl(onchange) {
  const labels = { 1: "1 year", 2: "2 years", 5: "5 years" };
  return el("div", { class: "seg", role: "group", "aria-label": "Time window" },
    Object.entries(labels).map(([k, l]) => el("button", { "aria-pressed": String(S.win === k),
      onclick: () => { S.win = k; store.set("win", k); onchange(); } }, l)));
}

function section(title, sub, rows, emptyText) {
  return el("section", { class: "sect" },
    el("h2", {}, title), sub ? el("p", { class: "sub" }, sub) : null,
    rows.length ? el("ul", { class: "rows" }, rows) : el("p", { class: "nothing" }, emptyText || "Nothing this time."));
}

function renderExplore(force) {
  const view = $("#view-explore");
  const x = S.explore;
  const key = `${x?.generated}|${S.win}`;
  if (!force && key === S.exploreKey && view.childElementCount) return;   // already showing this
  const keep = S.exploreKey && S.exploreKey.split("|")[0] === String(x?.generated) ? view.scrollTop : 0;
  S.exploreKey = key;
  view.replaceChildren();
  if (!x) {
    view.append(el("section", { class: "empty", style: "height:100%" },
      el("h2", { text: "Trends aren’t built yet" }),
      el("p", { text: "They come from a weekly job. On GitHub, open Actions, choose “Update trends”, and run it once. It takes about 10 minutes." }),
      el("button", { class: "btn", onclick: () => reload(true) }, "Check again")));
    return;
  }
  const byId = Object.fromEntries(x.topics.map((t) => [t.id, t]));
  const L = x.lists?.[S.win] || {};
  const pick = (ids, n = 8) => (ids || []).slice(0, n).map((id) => byId[id]).filter(Boolean);
  const yrs = { 1: "year", 2: "2 years", 5: "5 years" }[S.win];
  const terms = x.terms?.[S.win] || {};

  const wrap = el("div", { class: "explore" },
    segEl(() => renderExplore(true)),
    el("p", { class: "ex-note" }, `Papers in the last ${yrs} compared with the ${yrs} before, adjusted for how fast imaging research grew overall. Updated ${ago(x.generated)}.`),
    section("Breakouts", "At least doubled their share of imaging research.",
      pick(L.breakouts).map((t) => topicRow(t, "growth")), "No topic doubled in this window."),
    section("Rising", "Growing faster than imaging research overall.",
      pick(L.rising).map((t) => topicRow(t, "growth"))),
    section("Most influential", "Ranked by how often their top papers are cited (NIH iCite).",
      pick(L.influential, 6).map((t) => topicRow(t, "influence"))),
    section("Reaching practice", "New guidelines and consensus statements.",
      pick(L.practice, 6).map((t) => topicRow(t, "practice"))),
    section("Cooling", "A shrinking share of imaging research.",
      pick(L.cooling, 6).map((t) => topicRow(t, "growth")), "No topic is clearly shrinking."),
    section("New in titles", `Phrases used far more often in body-imaging titles than in the ${yrs} before. Tap one to see papers.`,
      (terms.emerging || []).map((t) => termRow(t)), "Not enough titles in this window yet."),
    section("Fading from titles", null, (terms.fading || []).slice(0, 6).map((t) => termRow(t)), "Nothing notable."),
  );
  const all = el("section", { class: "sect" }, el("h2", {}, "All topics"),
    el("p", { class: "sub" }, "Edit the list in config/topics.yaml."));
  for (const [sys, label] of Object.entries(x.systems || {})) {
    const tps = x.topics.filter((t) => t.system === sys);
    if (!tps.length) continue;
    all.append(el("div", { class: "sys-head" }, label), el("ul", { class: "rows" }, tps.map((t) => topicRow(t, "growth"))));
  }
  wrap.append(all);
  view.append(wrap);
  view.scrollTop = keep;
}

function paperEl(p, opts = {}) {
  const m = p.metrics;
  const c = p.conclusion || {};
  return el("article", { class: "paper", "data-pmid": p.pmid },
    el("div", { class: "paper-meta" }, el("b", {}, p.journal), el("span", {}, fmtDate(p.epub || p.ppub || p.added))),
    p.retracted ? el("div", { class: "warn" }, "Retracted") : null,
    el("h3", { class: "paper-title" }, p.title),
    c.text ? el("div", { class: "concl-label" + (c.kind === "structured" ? "" : " soft") }, conclLabel(c)) : null,
    c.text ? el("p", { class: "paper-concl" }, c.text) : null,
    m ? el("div", { class: "paper-metrics" },
      el("span", {}, el("b", {}, (m.cites || 0).toLocaleString()), " citations"),
      el("span", {}, el("b", {}, String(m.cpy ?? 0)), " a year"),
      m.rcr != null ? el("span", { title: "Relative Citation Ratio: 1.0 is the median NIH-funded paper in its field" }, "RCR ", el("b", {}, String(m.rcr))) : null) : null,
    evidenceEl(p.design, true),
    opts.noActions ? null : actionsEl(p, false));
}

function openTopic(id) {
  const tp = S.explore.topics.find((t) => t.id === id);
  if (!tp) return;
  $("#topic-title").textContent = tp.name;
  const body = $("#topic-body");
  const draw = () => {
    const w = tp.windows?.[S.win] || {};
    const yrs = { 1: "year", 2: "2 years", 5: "5 years" }[S.win];
    const ev = w.evidence || {};
    const total = Math.max(1, ev.total || 0);
    const rung = (label, n) => {
      const share = n / total;
      const pctW = n ? Math.max(2, Math.round(share * 100)) : 0;
      return el("div", { class: "rung" }, el("span", {}, label), el("b", {}, (n || 0).toLocaleString()),
        el("span", { class: "bar" }, el("i", { style: `width:${pctW}%;background-size:${pctW ? Math.round(10000 / pctW) : 100}% 100%` })));
    };
    const inFeed = (S.feed?.items || []).filter((i) => (i.topics || []).includes(tp.id)).length;
    const startYear = new Date().getFullYear() - Number(S.win) + 1;
    const pubmedLink = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(tp.query)}&filter=years.${startYear}-${new Date().getFullYear()}&sort=date`;
    const years = tp.years || [];
    const big = spark(years, S.win, w.growth, { w: 340, h: 110, gap: 6 });
    big.setAttribute("width", "100%");
    big.setAttribute("preserveAspectRatio", "none");
    const tr = w.trials;
    body.replaceChildren(
      segEl(draw),
      el("div", { class: "chart" }, big,
        el("div", { class: "chart-years" }, el("span", {}, String(S.explore.years?.[0] ?? "")),
          el("span", {}, `${S.explore.years?.slice(-1)[0] ?? ""} so far`))),
      el("p", { class: "fine", style: "margin-top:0" }, "PubMed papers per year. Highlighted bars fall in the chosen window."),
      el("dl", { class: "facts" },
        el("dt", {}, `Papers, last ${yrs}`), el("dd", {}, (w.recent || 0).toLocaleString()),
        el("dt", {}, `Papers, the ${yrs} before`), el("dd", {}, (w.prior || 0).toLocaleString()),
        el("dt", {}, "Change, adjusted for field growth"), el("dd", { style: `color:${w.growth != null && w.growth <= -0.15 ? "var(--cold-text)" : "var(--heat-text)"}` }, pct(w.growth)),
        el("dt", {}, "Change in raw counts"), el("dd", {}, pct(w.raw_growth)),
        el("dt", {}, "Highly cited papers (RCR ≥ 2)"), el("dd", {}, String(w.high_rcr ?? 0)),
        tr && tr.recent != null ? [el("dt", {}, "New trials registered"), el("dd", {}, `${tr.recent} (${tr.prior ?? "?"} before)`)] : null),
      el("section", { class: "sect" },
        el("h2", {}, "Evidence ladder"),
        el("p", { class: "sub" }, `Papers in the last ${yrs}, by study type.`),
        el("div", { class: "ladder" },
          rung("Guidelines and consensus statements", ev.guideline || 0),
          rung("Meta-analyses and systematic reviews", ev.meta || 0),
          rung("Randomized trials", ev.rct || 0),
          rung("Prospective studies", ev.prospective || 0),
          rung("All papers", ev.total || 0)),
        el("p", { class: "fine" }, "From PubMed publication types and title/abstract words. Types overlap; everything else is mostly retrospective or narrative.")),
      el("section", { class: "sect" },
        el("h2", {}, "Most-cited papers"),
        el("p", { class: "sub" }, S.win === "1" ? "Citations so far. One year is early, so read these as a first signal." : "Ranked by citations per year (NIH iCite)."),
        (w.top || []).length ? (w.top || []).map(paperOf).filter(Boolean).map((p) => paperEl(p)) : el("p", { class: "nothing" }, "No citation data yet for this window.")),
      el("section", { class: "sect" },
        el("h2", {}, "Guidelines and consensus"),
        (w.guidelines || []).length ? w.guidelines.map(paperOf).filter(Boolean).map((p) => paperEl(p)) : el("p", { class: "nothing" }, "None published in this window.")),
      el("section", { class: "sect" },
        el("h2", {}, "Go further"),
        el("div", { class: "link-row" },
          inFeed ? el("button", { class: "act", onclick: () => { S.topic = tp.id; S.system = "all"; closeTopic(); switchTab("feed"); refreshFeed(); } },
            `${plural(inFeed, "card")} in your feed`) : null,
          el("a", { class: "act", href: pubmedLink, target: "_blank", rel: "noopener" }, "Open in PubMed"),
          tp.trials_term ? el("a", { class: "act", target: "_blank", rel: "noopener",
            href: `https://clinicaltrials.gov/search?term=${encodeURIComponent(tp.trials_term)}` }, "Trials") : null),
        el("details", { style: "margin-top:16px" },
          el("summary", { class: "fine" }, "PubMed query for this topic"),
          el("p", { class: "fine", style: "word-break:break-word" }, tp.query))));
    body.scrollTop = 0;
  };
  draw();
  const ov = $("#topic");
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  $("#topic-back").focus({ preventScroll: true });
}
function closeTopic() {
  const ov = $("#topic");
  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
  if (S.tab === "explore") renderExplore();   // no-op unless the window was changed on the topic page
}

// ── news ───────────────────────────────────────────────────────────────────
function agoShort(iso) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 1) return "now";
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return d < 14 ? `${d} d` : fmtDate(iso.slice(0, 10));
}

function newsItemEl(it) {
  const cats = (it.categories || []).map((c) => S.news.categories?.[c]).filter(Boolean);
  return el("li", { class: "news-item" },
    el("a", { href: it.link, target: "_blank", rel: "noopener" },
      el("span", { class: "news-src" }, el("b", {}, it.source), el("span", {}, agoShort(it.date)),
        S.newsNew.has(it.id) ? el("span", { class: "tag-new" }, "New") : null),
      el("span", { class: "news-title" }, it.title),
      it.summary ? el("span", { class: "news-teaser" }, it.summary) : null,
      cats.length ? el("span", { class: "news-cats" }, cats.map((c) => el("span", {}, c))) : null));
}

function storyEl(st, byId) {
  const links = el("div", { class: "story-links", hidden: true },
    st.items.map((id) => byId[id]).filter(Boolean).map((it) =>
      el("a", { href: it.link, target: "_blank", rel: "noopener" }, `${it.source}: ${it.title}`)));
  const btn = el("button", { "aria-expanded": "false", onclick: () => {
    const open = links.hidden; links.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  } },
  el("span", { class: "story-title" }, st.title),
  el("span", { class: "story-meta" },
    el("span", { class: "cover" }, `${st.sources.length} outlets`),
    el("span", {}, st.sources.join(", ")),
    el("span", {}, agoShort(st.date))));
  return el("li", { class: "row story" }, btn, links);
}

function renderNews(force) {
  const view = $("#view-news");
  const n = S.news;
  const key = `${n?.generated}|${S.newsCat}|${S.newsTerm?.key}|${S.newsSpan}|${S.newsShown}`;
  if (!force && key === S.newsKey && view.childElementCount) return;
  const keep = S.newsKey && S.newsKey.split("|")[0] === String(n?.generated) ? view.scrollTop : 0;
  S.newsKey = key;
  view.replaceChildren();
  if (!n) {
    view.append(el("section", { class: "empty", style: "height:100%" },
      el("h2", { text: "No news yet" }),
      el("p", { text: "Headlines arrive with the “Update news” job on GitHub, which runs every 6 hours. You can also run it from the Actions tab." }),
      el("button", { class: "btn", onclick: () => reload(true) }, "Check again")));
    return;
  }
  const byId = Object.fromEntries(n.items.map((i) => [i.id, i]));
  const tr = n.trending?.[S.newsSpan] || { terms: [] };
  const spanSeg = el("div", { class: "seg", role: "group", "aria-label": "Trending window", style: "grid-template-columns:repeat(2,1fr)" },
    [["week", "This week"], ["month", "This month"]].map(([k, l]) => el("button", { "aria-pressed": String(S.newsSpan === k),
      onclick: () => { S.newsSpan = k; S.newsTerm = null; store.set("newsSpan", k); renderNews(true); } }, l)));

  let list = n.items;
  if (S.newsTerm) {
    const ids = new Set(S.newsTerm.ids);
    list = list.filter((i) => ids.has(i.id));
  } else if (S.newsCat !== "all") {
    list = list.filter((i) => (i.categories || []).includes(S.newsCat));
  }
  const chips = el("div", { class: "news-chips", role: "group", "aria-label": "Filter headlines" },
    [["all", "All"], ...Object.entries(n.categories || {})].map(([k, l]) => el("button", {
      class: "chip", "aria-pressed": String(!S.newsTerm && S.newsCat === k),
      onclick: () => { S.newsCat = k; S.newsTerm = null; S.newsShown = 40; renderNews(true); } }, l)));
  const working = (n.sources || []).filter((x) => x.ok).map((x) => x.name);
  const failing = (n.sources || []).filter((x) => !x.ok).map((x) => x.name);

  view.append(el("div", { class: "news" },
    el("p", { class: "ex-note" }, `Radiology industry and business headlines, updated ${ago(n.generated)}. Tap a headline to read it on the outlet’s site.`),
    section("Top stories", "Covered by more than one outlet in the last 7 days.",
      (n.top_stories || []).map((st) => storyEl(st, byId)), "No story has been picked up by several outlets this week."),
    el("section", { class: "sect" },
      el("h2", {}, "Trending in headlines"),
      el("p", { class: "sub" }, tr.basis === "growth"
        ? `Phrases used more than in the ${S.newsSpan === "week" ? "4 weeks" : "3 months"} before. Tap one to see the stories.`
        : "Phrases most outlets are using. Trend lines start once a few weeks of headlines build up. Tap one to see the stories."),
      spanSeg,
      el("div", { class: "term-chips", style: "margin-top:12px" },
        (tr.terms || []).length ? tr.terms.map((t) => el("button", {
          class: "term-chip", "aria-pressed": String(S.newsTerm?.key === t.key),
          onclick: () => { S.newsTerm = S.newsTerm?.key === t.key ? null : t; S.newsShown = 40; renderNews(true); } },
          t.term, el("b", {}, String(t.count)))) : el("p", { class: "nothing" }, "Not enough headlines yet."))),
    el("section", { class: "sect" },
      el("h2", {}, S.newsTerm ? `Stories on “${S.newsTerm.term}”` : "Latest"),
      chips,
      list.length ? el("ul", { class: "rows" }, list.slice(0, S.newsShown).map(newsItemEl))
        : el("p", { class: "nothing" }, "No headlines in this category yet."),
      list.length > S.newsShown ? el("button", { class: "act more-btn", style: "padding:0 18px",
        onclick: () => { S.newsShown += 40; renderNews(true); } }, `Show more (${list.length - S.newsShown} left)`) : null),
    el("p", { class: "fine", style: "margin-top:24px" },
      `From ${working.join(", ") || "no outlets yet"}.` + (failing.length ? ` Not reachable right now: ${failing.join(", ")}.` : ""))));
  view.scrollTop = keep;
}

// ── saved ──────────────────────────────────────────────────────────────────
function renderSaved() {
  const view = $("#view-saved");
  const items = Object.values(S.saved).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  const keep = view.scrollTop;
  view.replaceChildren();
  if (!items.length) {
    view.append(el("section", { class: "empty", style: "height:100%" },
      el("h2", { text: "Nothing saved yet" }),
      el("p", { text: "Tap Save on any card to keep it here. Saved papers stay on this phone even after they leave the feed." })));
    return;
  }
  const copy = async () => {
    const text = items.map((i) => `${i.title} ${i.journal}. ${(i.epub || i.added || "").slice(0, 4)}. ${pubmedUrl(i.pmid)}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`Copied ${plural(items.length, "paper")}`); } catch { toast("Couldn’t reach the clipboard"); }
  };
  view.append(
    el("div", { class: "saved-tools" }, el("button", { class: "act", style: "padding:0 14px", onclick: copy }, "Copy list")),
    el("div", { class: "saved-list" }, items.map((i) => paperEl(i))));
  view.scrollTop = keep;
}

// ── tabs, header, boot ─────────────────────────────────────────────────────
function updateHeadNote() {
  const note = $("#head-note");
  if (S.tab === "news" && S.newsNew.size) note.textContent = `${S.newsNew.size} new`;
  else if (S.tab === "news" && S.news) note.textContent = `Updated ${ago(S.news.generated)}`;
  else if (S.tab === "feed" && S.newIds.size) note.textContent = `${S.newIds.size} new`;
  else if (S.tab === "feed" && S.feed) note.textContent = `Updated ${ago(S.feed.generated)}`;
  else note.textContent = "";
}

function switchTab(tab) {
  S.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#view-feed").hidden = tab !== "feed";
  $("#view-explore").hidden = tab !== "explore";
  $("#view-news").hidden = tab !== "news";
  $("#view-saved").hidden = tab !== "saved";
  $("#chips").hidden = tab !== "feed";
  $("#title").textContent = { feed: "Readout", news: "News", explore: "Explore", saved: "Saved" }[tab];
  updateHeadNote();
  if (tab === "explore") renderExplore();
  if (tab === "news") renderNews();
  if (tab === "saved") renderSaved();
}

async function reload(announce) {
  const before = new Set((S.feed?.items || []).map((i) => i.pmid));
  const was = { feed: S.feed?.generated, explore: S.explore?.generated, news: S.news?.generated };
  const [feed, explore, newsData] = await Promise.all([
    loadJSON("data/feed.json").catch(() => null),
    loadJSON("data/explore.json").catch(() => null),
    loadJSON("data/news.json").catch(() => null),
  ]);
  if (newsData) S.news = newsData;
  const newsChanged = !S.news || S.news.generated !== was.news;
  markNewsNew();
  if (newsChanged) S.newsKey = null;
  if (S.tab === "news" && (announce || newsChanged)) renderNews();
  if (feed) S.feed = feed;
  if (explore) S.explore = explore;
  if (feed || explore || newsData) S.loadedAt = Date.now();
  const feedChanged = !S.feed || S.feed.generated !== was.feed;
  const exploreChanged = !S.explore || S.explore.generated !== was.explore;
  markNew();
  // rebuilding resets scroll position, so only do it when something changed (or the user asked)
  if (announce || feedChanged) refreshFeed();
  else updateHeadNote();
  if (exploreChanged) S.exploreKey = null;
  if (S.tab === "explore" && (announce || exploreChanged)) renderExplore();
  if (announce) {
    if (!feed) toast("Couldn’t reach the feed. Showing what’s on this phone.");
    else {
      const added = feed.items.filter((i) => !before.has(i.pmid)).length;
      toast(added && before.size ? `${plural(added, "new paper")}` : `Up to date. Feed built ${ago(feed.generated)}.`);
    }
  }
}

function boot() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#btn-refresh").addEventListener("click", () => reload(true));
  $("#btn-info").addEventListener("click", openInfo);
  $("#topic-back").addEventListener("click", closeTopic);
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("#sheet").classList.contains("open")) closeSheet();
    else if ($("#topic").classList.contains("open")) closeTopic();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") rememberSeen();
    else if (Date.now() - S.loadedAt > 60 * 60 * 1000) reload(false);   // home-screen apps stay open for days
  });
  window.addEventListener("pagehide", rememberSeen);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fitAll, 200); });
  document.fonts?.ready.then(fitAll);
  document.fonts?.addEventListener?.("loadingdone", fitAll);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  reload(false);
}
boot();
