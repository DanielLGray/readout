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
  listen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  read: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h11v14H6a2 2 0 0 1-2-2z"/><path d="M15 9h4v8a2 2 0 0 1-2 2h-2"/><path d="M7.5 9h4.5M7.5 12.5h4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};
const store = {
  get(k, d) { try { const v = localStorage.getItem("readout." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("readout." + k, JSON.stringify(v)); return true; } catch { return false; } },   // full, or private mode
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
// links from outlets' feeds: web addresses only
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? u : "#");
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
  news: null, kind: "all", newsSpan: store.get("newsSpan", "week"), newsNew: new Set(),
  feedDirty: false, runs: null,
  important: null, impWin: store.get("impWin", "1y"),
};

// ── tuning: the settings that drive the feed, kept on this phone (Tune tab) ──
const TUNE_DEFAULTS = {
  mix: { paper: 2, industry: 1, societies: 1, science: 1, health: 1, sff: 1 },   // turns per round in Everything
  areas: { body: 3, nm: 2, cardiac: 2, general: 1 },   // interest areas: 0 off, 1 less, 2 normal, 3 more
  follow: [],           // words and phrases you follow (the Following chip)
  hiddenSystems: [],    // organ-system chips you don't want in the chip row
  cap: 2,               // most stories per outlet per day in Everything (industry news exempt); 0 = no limit
  topCard: true,        // open the feed with stories several outlets covered
  order: "newest",      // papers: "newest" or "ranked"
  rank: { fresh: 7, evidence: 1, size: 0.5, concl: 0.5, systems: 1 },   // half-life in days; weights
  fav: [],              // your organ systems (a ranking boost)
  hidePending: true,    // hide papers whose abstract isn't in PubMed yet (the conclusion is the card)
  mutedSources: [], mutedWords: [],
  trend: null,          // null: the weekly job's rules; else { breakout, rising, cooling, minScale }
  impReviews: false,    // Most important: also reviews, meta-analyses and guidelines
  startOn: "all",       // the view the app opens on: all, papers or important
};
// stored settings are checked field by field, so an old or damaged copy can't break the app
function loadTune() {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const t = obj(store.get("tune", {}));
  const mix = {};
  for (const [k, v] of Object.entries({ ...TUNE_DEFAULTS.mix, ...obj(t.mix) })) mix[k] = Math.max(0, Math.min(4, Math.round(num(v, 1))));
  const areas = {};
  for (const [k, v] of Object.entries({ ...TUNE_DEFAULTS.areas, ...obj(t.areas) })) areas[k] = Math.max(0, Math.min(3, Math.round(num(v, 2))));
  const rank = {};
  for (const [k, v] of Object.entries(TUNE_DEFAULTS.rank)) rank[k] = Math.max(0, num(obj(t.rank)[k], v));
  if (!rank.fresh) rank.fresh = TUNE_DEFAULTS.rank.fresh;      // a half-life must be > 0
  const trend = Object.fromEntries(Object.entries(obj(t.trend))
    .filter(([k, v]) => ["breakout", "rising", "cooling", "minScale"].includes(k) && typeof v === "number" && isFinite(v)));
  return {
    mix, rank, areas, follow: strs(t.follow), hiddenSystems: strs(t.hiddenSystems),
    cap: Math.max(0, Math.round(num(t.cap, TUNE_DEFAULTS.cap))),
    topCard: typeof t.topCard === "boolean" ? t.topCard : TUNE_DEFAULTS.topCard,
    order: t.order === "ranked" ? "ranked" : "newest",
    fav: strs(t.fav), hidePending: typeof t.hidePending === "boolean" ? t.hidePending : TUNE_DEFAULTS.hidePending,
    mutedSources: strs(t.mutedSources), mutedWords: strs(t.mutedWords),
    trend: Object.keys(trend).length ? trend : null,
    impReviews: t.impReviews === true,
    startOn: ["all", "papers", "important"].includes(t.startOn) ? t.startOn : "all",
  };
}
let T = loadTune();
function setTune(patch) {
  T = { ...T, ...patch };
  store.set("tune", T);
  S.feedDirty = true;
  S.lastKey = null;          // new rules: start the feed from the top
  S.exploreKey = null;
}

// ── reading metrics, counted on this phone ─────────────────────────────────
const STAT_IDX = { seen: 0, open: 1, save: 2, listen: 3 };
let stats = store.get("stats", null);
if (!stats || typeof stats.days !== "object" || !stats.days || Array.isArray(stats.days)) stats = { days: {} };
let seenToday = store.get("seenToday", null);
if (!seenToday || typeof seenToday !== "object") seenToday = { d: "" };      // what was counted today, so nothing counts twice
const localDay = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
const daysAgo = (i) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - i); };
const itemKind = (it) => (it.pmid ? "paper" : (it.kind || "industry"));
let statsTimer;
function bump(type, it) {
  if (!it || it.type === "top") return;
  const d = localDay();
  if (seenToday.d !== d || !Array.isArray(seenToday.seen)) seenToday = { d, seen: [], open: [], save: [], listen: [] };
  const key = saveKey(it);
  if (seenToday[type].includes(key)) return;
  if (type !== "seen") bump("seen", it);        // opening, saving or listening means you saw it
  seenToday[type].push(key);
  const day = stats.days[d] || (stats.days[d] = { k: {}, s: {}, y: {} });
  const i = STAT_IDX[type];
  const inc = (obj, key) => { (obj[key] || (obj[key] = [0, 0, 0, 0]))[i]++; };
  inc(day.k, itemKind(it));
  const src = it.pmid ? it.journal : it.source;
  if (src) inc(day.s, src);
  if (it.pmid) (it.systems || []).forEach((y) => inc(day.y, y));
  clearTimeout(statsTimer);
  statsTimer = setTimeout(saveStats, 800);
}
function saveStats() {
  const cut = localDay(daysAgo(120));
  for (const d of Object.keys(stats.days)) if (d < cut) delete stats.days[d];
  store.set("stats", stats);
  store.set("seenToday", seenToday);
}
function statsFor(days) {
  const out = { k: {}, s: {}, y: {}, daily: [] };
  for (let i = days - 1; i >= 0; i--) {
    const d = localDay(daysAgo(i));
    const day = stats.days[d] || {};
    for (const grp of ["k", "s", "y"]) {
      for (const [key, v] of Object.entries(day[grp] || {})) {
        const t = out[grp][key] || (out[grp][key] = [0, 0, 0, 0]);
        v.forEach((n, j) => { t[j] += n; });
      }
    }
    let seen = 0, open = 0;
    for (const v of Object.values(day.k || {})) { seen += v[0]; open += v[1]; }
    out.daily.push({ d, seen, open });
  }
  return out;
}

// the last copy of each data file stays on the phone (same cache as the service worker's), so the
// app opens at once from it and updates when the network answers
const DATA_CACHE = "readout-data";
async function keptJSON(path) {
  try {
    if (!("caches" in window)) return null;
    const r = await (await caches.open(DATA_CACHE)).match(path, { ignoreSearch: true });
    return r ? await r.json() : null;
  } catch { return null; }
}
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  if (r.headers.get("x-readout-offline")) S.offline = true;      // the service worker's saved copy
  else if (!navigator.serviceWorker?.controller && "caches" in window) {   // no service worker yet: keep it ourselves
    const copy = r.clone();
    caches.open(DATA_CACHE).then((c) => c.put(path, copy)).catch(() => {});
  }
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

const MIX_ORDER = ["paper", "industry", "societies", "science", "health", "sff"];   // ties go in this order

// Everything takes turns: a kind with weight w gets w turns per round, spread evenly.
// Card j of a kind sits at (j + phase) / w; staggered phases keep kinds from bunching up,
// so the default weights give paper, industry, science, paper, health, sci-fi, …
function interleave(queues, weights) {
  const keys = MIX_ORDER.concat(Object.keys(queues).filter((k) => !MIX_ORDER.includes(k)))
    .filter((k) => queues[k]?.length && (weights[k] ?? 1) > 0);
  const slots = [];
  keys.forEach((k, i) => {
    const w = weights[k] ?? 1, phase = (i + 0.5) / keys.length;
    queues[k].forEach((it, j) => slots.push([(j + phase) / w, i, it]));
  });
  slots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return slots.map((x) => x[2]);
}

// ── interest areas (Tune → Interests) ──────────────────────────────────────
const AREA_DEFAULTS = { body: { label: "Body imaging", short: "Body" }, nm: { label: "Nuclear medicine", short: "NM" },
  cardiac: { label: "Cardiac & vascular CT", short: "Cardiac CT" }, general: { label: "General radiology", short: "General" } };
function areaList() {
  const a = S.feed?.areas && Object.keys(S.feed.areas).length ? S.feed.areas : AREA_DEFAULTS;
  return Object.entries(a);
}
const areaShort = (a) => (S.feed?.areas?.[a] || AREA_DEFAULTS[a] || {}).short || a;
const areasOf = (p) => (p.areas && p.areas.length ? p.areas : ["body"]);     // cards from before areas existed
// the area chip only applies on Papers and Most important
const areaPick = () => (["papers", "important"].includes(S.kind) && S.area && S.area !== "all" ? S.area : null);
// the area a paper counts under: the one you weight most (and, with an area chip, that one)
function homeArea(p, only = null) {
  const on = areasOf(p).filter((a) => (T.areas[a] ?? 2) > 0 && (!only || only === a));
  return on.sort((x, y) => (T.areas[y] ?? 2) - (T.areas[x] ?? 2))[0] || null;
}
function followRe() {
  const w = (T.follow || []).map((x) => x.trim()).filter(Boolean);
  if (!w.length) return null;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "iu");
}
const followHit = (it, re = followRe()) => !!re && re.test(`${it.title} ${it.conclusion?.text || it.summary || ""}`);
function followingList(mute) {
  const re = followRe();
  if (!re) return [];
  const seen = new Set();
  const papers = (S.feed?.items || []).concat(Object.values(S.important?.papers || {}))
    .filter((p) => !seen.has(p.pmid) && seen.add(p.pmid) && followHit(p, re) && homeArea(p))
    .map((p) => ({ ...p, type: "paper", _when: (p.epub || p.added || "") }));
  const news = (S.news?.items || []).filter((n) => followHit(n, re) && !(T.mutedSources || []).includes(n.source))
    .map((n) => ({ ...n, type: "news", kind: kindOf(n), _when: (n.date || "").slice(0, 10) }));
  return papers.concat(news).filter((i) => !(mute && mute.test(i.title))).sort((a, b) => (a._when < b._when ? 1 : -1));
}

// ── most important papers: ranked weekly by citations against same-quarter papers ──
const IMP_WINDOWS = [["6m", "New"], ["1y", "1 year"], ["3y", "3 years"]];
function importantList(system = "all", strong = false, mute = null) {
  const I = S.important;
  if (!I) return [];
  const win = I.windows?.[S.impWin] ? S.impWin : "1y";
  const w = I.windows?.[win] || {};
  // per area since areas came in ({area: {research, other}}); one list before that
  const per = w.research ? { body: w } : w;
  const ids = [];
  for (const [a, lists] of Object.entries(per)) {
    if ((T.areas[a] ?? 2) <= 0 || (areaPick() && areaPick() !== a)) continue;
    ids.push(...(lists.research || []), ...(T.impReviews ? lists.other || [] : []));
  }
  let list = [...new Set(ids)].map((p) => I.papers?.[p]).filter(Boolean).map((p) => ({ ...p, type: "paper" }));
  const best = (p) => {                 // its percentile in the best of your areas
    const pc = p.impact?.pcts || {};
    const mine = areasOf(p).filter((a) => (T.areas[a] ?? 2) > 0 && (!areaPick() || areaPick() === a));
    return Math.max(...mine.map((a) => pc[a] ?? p.impact?.pct ?? 0), 0);
  };
  const rank = new Map(list.map((p) => [p, win === "6m" ? p.impact?.score || 0 : best(p)]));
  list.sort((a, b) => rank.get(b) - rank.get(a) || (b.impact?.cites || 0) - (a.impact?.cites || 0));
  list.forEach((p) => {                 // show the percentile and area that earned its place
    if (!p.impact) return;
    const pc = p.impact.pcts || {};
    const area = areaPick() && pc[areaPick()] != null ? areaPick()
      : Object.keys(pc).filter((a) => (T.areas[a] ?? 2) > 0).sort((x, y) => pc[y] - pc[x])[0];
    if (area) p.impact = { ...p.impact, pct: pc[area], area };
  });
  if (system !== "all") list = list.filter((i) => (i.systems || []).includes(system));
  if (strong) list = list.filter((i) => (i.design?.strength || 0) >= 3);
  if (mute) list = list.filter((i) => !mute.test(i.title));
  return list;
}
const topPct = (p) => (p >= 99.5 ? "top 1%" : `top ${Math.max(1, Math.round(100 - p))}%`);
function impactEl(it) {
  const m = it.impact;
  if (!m) return null;
  const lead = m.age >= 4
    ? el("b", {}, `${topPct(m.pct)[0].toUpperCase()}${topPct(m.pct).slice(1)} for citations${m.area ? ` (${areaShort(m.area)})` : ""}`)
    : [el("b", {}, "New"), ` · ${it.journal} papers usually rank in the ${topPct(m.jpct)}`];
  return el("div", { class: "impact" }, lead,
    m.age >= 4 ? ` · ${plural(m.cites, "citation")}` : null,
    m.rcr != null && m.age >= 4 ? ` · RCR ${m.rcr}` : null,
    m.clin ? ` · cited in ${plural(m.clin, "clinical paper")}` : null,
    m.kind === "other" ? el("span", { class: "imp-kind" }, "Review or guideline") : null);
}

function mutedRe() {
  const w = (T.mutedWords || []).map((x) => x.trim()).filter(Boolean);
  if (!w.length) return null;
  return new RegExp(`\\b(?:${w.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "i");
}

const sampleN = (s) => { const m = String(s || "").replace(/(\d),(?=\d{3})/g, "$1").match(/\d+/); return m ? +m[0] : 0; };
// score = freshness × (1 + evidence + size + conclusion + your systems); each factor 0–1 times its weight
function paperScore(p, now = Date.now()) {
  const r = T.rank;
  const when = Date.parse(p.added || p.epub || p.seen || "");
  const age = isNaN(when) ? 30 : Math.max(0, (now - when) / 864e5);
  const fresh = Math.pow(0.5, age / (r.fresh || 7));
  const n = sampleN(p.sample);
  const parts = {
    evidence: r.evidence * (p.design?.strength || 0) / 4,
    size: r.size * (n ? Math.min(1, Math.log10(n) / 4) : 0),
    concl: r.concl * ({ structured: 1, closing: 0.4, opening: 0.2 }[p.conclusion?.kind] || 0),
    systems: r.systems * (T.fav.length && (p.systems || []).some((y) => T.fav.includes(y)) ? 1 : 0),
  };
  const quality = 1 + parts.evidence + parts.size + parts.concl + parts.systems;
  return { score: fresh * quality, fresh, quality, parts };
}
function rankPapers(list) {
  const now = Date.now();
  return list.map((p) => [paperScore(p, now).score, p]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

function newsKinds() {
  const k = S.news?.kinds;
  if (k) return k;
  return S.news ? { industry: "Industry news", science: "Science & health" } : {};
}
const kindOf = (n) => n.kind || "industry";

function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!S.feed && !S.news) return;
  if (S.topic) {
    box.append(el("button", { class: "chip chip-topic", "aria-pressed": "true", onclick: () => { S.topic = null; refreshFeed(); } },
      `${topicName(S.topic)}  ✕`));
  }
  const kindChip = ([k, label]) => el("button", { class: "chip" + (k === "important" ? " chip-imp" : ""), "aria-pressed": String(S.kind === k && !S.topic),
    onclick: () => { S.kind = k; S.topic = null; if (!["papers", "all", "important"].includes(k)) S.strong = false; refreshFeed(); } }, label);
  const sep = () => el("span", { class: "chip-sep", "aria-hidden": "true" });
  // papers first, with their sub-filters right beside them; then news
  box.append(...[["all", "Everything"], ["papers", "Papers"], ...(S.important ? [["important", "Most important"]] : []),
    ...(followRe() ? [["following", "Following"]] : [])].map(kindChip));
  const onAreas = areaList().filter(([a]) => (T.areas[a] ?? 2) > 0);
  if ((S.kind === "papers" || S.kind === "important") && !S.topic && onAreas.length > 1) {   // one area at a time
    box.append(sep());
    for (const [a, info] of [["all", { short: "All areas" }], ...onAreas]) {
      box.append(el("button", { class: "chip chip-sub", "aria-pressed": String((S.area || "all") === a),
        onclick: () => { S.area = a; refreshFeed(); } }, info.short || info.label || a));
    }
  }
  if (S.kind === "important" && !S.topic) {          // which list: new, or proven over 1 or 3 years
    box.append(sep());
    for (const [w, label] of IMP_WINDOWS) {
      box.append(el("button", { class: "chip chip-sub", "aria-pressed": String(S.impWin === w),
        onclick: () => { S.impWin = w; store.set("impWin", w); refreshFeed(); } }, label));
    }
  }
  box.append(sep(), ...Object.entries(newsKinds()).map(kindChip));
  box.append(el("span", { class: "chip-sep", "aria-hidden": "true" }));
  box.append(el("button", { class: "chip", "aria-pressed": String(S.strong),
    onclick: () => { S.strong = !S.strong; if (S.strong && !["papers", "important"].includes(S.kind)) S.kind = "papers"; refreshFeed(); } }, "Strong evidence"));
  box.append(el("span", { class: "chip-sep", "aria-hidden": "true" }));
  const systems = S.feed?.systems || {};
  for (const [k, label] of Object.entries(systems)) {
    if (T.hiddenSystems.includes(k) && S.system !== k) continue;
    box.append(el("button", { class: "chip", "aria-pressed": String(S.system === k),
      onclick: () => { S.system = S.system === k ? "all" : k; refreshFeed(); } }, label));
  }
}

const dayOf = (it) => (it.type === "news" ? it.date : it.added || it.epub || "").slice(0, 10);

// The feed for the current chips. `f` overrides the chips; `report` (optional) counts what was left out.
function filtered(f = {}, report = null) {
  const kind = f.kind ?? S.kind, system = f.system ?? S.system, strong = f.strong ?? S.strong, topic = f.topic ?? S.topic;
  const R = report || {};
  const drop = (why, n = 1) => { R[why] = (R[why] || 0) + n; };
  const mute = mutedRe();
  const mutedSrc = new Set(T.mutedSources || []);
  if (kind === "important") return importantList(system, strong, mute);
  if (kind === "following") return followingList(mute);
  // papers
  let papers = (S.feed?.items || []).map((i) => ({ ...i, type: "paper" }));
  if (T.hidePending) papers = papers.filter((i) => (i.conclusion?.kind || "none") !== "none" || (drop("pending"), false));
  if (mute) papers = papers.filter((i) => !mute.test(i.title) || (drop("muted"), false));
  if (system !== "all") papers = papers.filter((i) => (i.systems || []).includes(system));
  if (strong) papers = papers.filter((i) => (i.design?.strength || 0) >= 3);
  if (topic) papers = papers.filter((i) => (i.topics || []).includes(topic));
  const onlyArea = kind === "papers" ? areaPick() : null;
  papers = papers.filter((i) => homeArea(i, onlyArea) || (!onlyArea && drop("areaOff"), false));
  if (T.order === "ranked") papers = rankPapers(papers);
  // take turns between areas by the weights you set (Tune → Interests)
  const byArea = {};
  for (const p of papers) { const a = homeArea(p, onlyArea); (byArea[a] = byArea[a] || []).push(p); }
  papers = Object.keys(byArea).length > 1 ? interleave(byArea, T.areas) : papers;
  if (topic || strong || kind === "papers") return papers;
  // news
  let news = (S.news?.items || []).map((i) => ({ ...i, type: "news", kind: kindOf(i) }));
  news = news.filter((i) => (!mutedSrc.has(i.source) && !(mute && mute.test(i.title))) || (drop("muted"), false));
  if (system !== "all") news = news.filter((i) => (i.systems || []).includes(system));
  const only = kind === "all" ? null : kind;
  const tops = T.topCard && system === "all" && topStoryLists(only).length ? [{ type: "top", key: "top", only }] : [];
  if (kind !== "all") return tops.concat(news.filter((i) => i.kind === kind));
  // Everything: take turns by weight, each stream newest first (or ranked, for papers), so the
  // newest papers sit at the top even though news arrives hours sooner than PubMed records
  const perSource = new Map();
  const byTime = (a, b) => (a.date < b.date ? 1 : -1);
  const queues = { paper: papers };
  for (const n of news.sort(byTime)) {
    if (T.cap && n.kind !== "industry") {            // busy outlets: a few a day in Everything
      const k = `${dayOf(n)}|${n.source}`;
      const c = perSource.get(k) || 0;
      perSource.set(k, c + 1);
      if (c >= T.cap) { drop("capped"); continue; }
    }
    (queues[n.kind] = queues[n.kind] || []).push(n);
  }
  for (const [k, q] of Object.entries(queues)) if (q.length && (T.mix[k] ?? 1) <= 0) drop("off", q.length);
  // the same headline from two outlets (a society story an industry site also ran): show it once
  const said = new Set();
  return tops.concat(interleave(queues, T.mix).filter((i) => {
    if (i.type !== "news") return true;
    const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (said.has(key)) { drop("dupes"); return false; }
    said.add(key);
    return true;
  }));
}

let feedObserver, seenObserver;
const listKey = (it) => (it.type === "top" ? `top:${it.only || ""}` : saveKey(it));
function currentKey(evenAtTop = false) {
  const v = $("#view-feed");
  if (!v.clientHeight) return null;
  const it = S.list[Math.round(v.scrollTop / v.clientHeight)];
  return it && (v.scrollTop > 0 || evenAtTop) ? listKey(it) : null;
}
// what a rendered card shows: the top-stories card changes with its stories
const shownSig = (it) => (it.type === "top" ? `top:${JSON.stringify(topStoryLists(it.only).map(([, l]) => l.map((s) => s.title)))}` : listKey(it));
// after a background update: leave the screen alone when the cards already drawn are unchanged
function updateFeedQuietly(sinceShown) {
  const next = filtered();
  const n = S.rendered;
  const same = n > 0 && next.length >= n && next.slice(0, n).every((it, i) => shownSig(it) === shownSig(S.list[i]));
  if (same) { S.list = next; updateHeadNote(); return; }
  // an update in the first moments replaces the old copy; later, keep the card you're reading
  refreshFeed(sinceShown < 4000 && !$("#view-feed").scrollTop ? null : currentKey(true));
}
// keepKey: the card you were reading; the rebuilt feed opens there if it's still in the list
function refreshFeed(keepKey) {
  S.feedDirty = false;
  if ((S.kind === "following" && !followRe()) || (S.kind !== "all" && S.kind !== "papers" && S.kind !== "important"
      && S.kind !== "following" && S.news && !newsKinds()[S.kind])) S.kind = "all";
  if (S.area && S.area !== "all" && (T.areas[S.area] ?? 2) <= 0) S.area = "all";
  renderChips();
  const view = $("#view-feed");
  view.replaceChildren();
  view.scrollTop = 0;
  if (!S.feed && !S.news) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "No papers yet" }),
      el("p", { text: "Your feed fills after the first update runs. On GitHub, open Actions, choose “Update feed”, and run it. Then tap refresh here." }),
      el("button", { class: "btn", onclick: () => reload(true) }, "Check again")));
    return;
  }
  S.list = filtered();
  S.rendered = 0;
  if (!S.shownAt) S.shownAt = Date.now();
  updateHeadNote();
  if (!S.list.length && S.kind === "important" && !S.important) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "Not ranked yet" }),
      el("p", { text: "Most important papers come from a weekly job. On GitHub, open Actions, choose “Update most important papers”, and run it. Then tap refresh here." }),
      el("button", { class: "btn", onclick: () => { S.kind = "all"; refreshFeed(); } }, "Show everything")));
    return;
  }
  if (!S.list.length) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "Nothing matches these filters" }),
      el("p", { text: "Try another organ system, or turn off Strong evidence." }),
      el("button", { class: "btn", onclick: () => { S.system = "all"; S.strong = false; S.topic = null; S.kind = "all"; refreshFeed(); } }, "Show everything")));
    return;
  }
  const sentinel = el("div", { "aria-hidden": "true", style: "height:1px" });
  view.append(sentinel);
  feedObserver?.disconnect();
  feedObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) appendCards(8);
  }, { root: view, rootMargin: "0px 0px 150% 0px" });
  feedObserver.observe(sentinel);
  // a card counts as read once it has stayed on screen for about a second
  seenObserver?.disconnect();
  seenObserver = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const c = e.target;
      clearTimeout(c._seenT);
      if (e.isIntersecting) c._seenT = setTimeout(() => bump("seen", c._it), 900);
    }
  }, { root: view, threshold: 0.6 });
  appendCards(10);
  const at = keepKey ? S.list.findIndex((it) => listKey(it) === keepKey) : -1;
  if (at > 0 && at < 200) {
    while (S.rendered <= at + 1 && S.rendered < S.list.length) appendCards(10);
    view.scrollTop = at * view.clientHeight;
  }
}

function appendCards(n) {
  const view = $("#view-feed");
  const sentinel = view.lastElementChild;
  const batch = S.list.slice(S.rendered, S.rendered + n);
  const made = batch.map((it) => { const c = cardEl(it); c._it = it; return c; });
  made.forEach((c) => { view.insertBefore(c, sentinel); seenObserver?.observe(c); });
  S.rendered += batch.length;
  requestAnimationFrame(() => made.forEach(fitCard));
  if (S.rendered >= S.list.length && !view.querySelector(".feed-end")) {
    feedObserver?.disconnect();
    const last = S.list.length ? dayOf(S.list[S.list.length - 1]) : "";
    view.insertBefore(el("section", { class: "feed-end" },
      el("h2", { text: "You’re at the end" }),
      el("p", { text: `${plural(S.list.length, "card")} here, back to ${fmtDate(last)}. Papers arrive every morning and news every few hours.` }),
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
  if (it.type === "news") return newsCardEl(it);
  if (it.type === "top") return topCardEl(it.only);
  return paperCardEl(it);
}

const saveKey = (it) => it.pmid || `n:${it.id}`;

function newsCardEl(it) {
  const isNew = S.newsNew.has(it.id);
  const cats = (it.categories || []).map((c) => S.news?.categories?.[c]).filter(Boolean);
  const saved = !!S.saved[saveKey(it)];
  const saveBtn = el("button", { class: "act", "aria-pressed": String(saved), onclick: () => toggleSave(it, saveBtn) },
    icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save");
  return el("article", { class: "card news-card", "data-key": saveKey(it) },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, it.source),
      el("span", {}, agoShort(it.date)),
      followHit(it) ? el("span", { class: "lang follow" }, "Following") : null,
      el("span", { class: "spacer" }),
      isNew ? el("span", { class: "tag-new" }, "New") : null),
    el("div", { class: "kind-label", "data-kind": it.kind },
      newsKinds()[it.kind] || "News", it.audio ? el("span", { class: "pod" }, `Podcast${it.duration ? `, ${it.duration} min` : ""}`) : null),
    el("div", { class: "concl" }, el("div", { class: "concl-inner" },
      el("h2", { class: "news-headline" }, it.title),
      it.summary ? el("p", { class: "concl-text news-teaser l3" }, it.summary) : null)),
    cats.length ? el("div", { class: "news-cats" }, cats.map((c) => el("span", {}, c))) : null,
    el("div", { class: "actions", style: `grid-template-columns:repeat(${it.audio ? 4 : 3},1fr)` },
      it.audio ? el("button", { class: "act", onclick: () => play(it) }, icon(ICONS.listen), "Listen") : null,
      el("a", { class: "act", href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, icon(ICONS.read), "Read"),
      saveBtn,
      el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share")));
}

// ── podcast player: keeps playing while you scroll ─────────────────────────
// where you stopped in each episode, so a closed app or a new episode doesn't lose your place
function savePos() {
  const a = $("#pl-audio"), id = a.dataset.id;
  if (!id || !isFinite(a.duration)) return;
  const pos = store.get("pos", {}) || {};
  if (a.ended || a.currentTime > a.duration - 20) delete pos[id];
  else if (a.currentTime > 5) pos[id] = [Math.round(a.currentTime), Date.now()];
  store.set("pos", Object.fromEntries(Object.entries(pos).sort((x, y) => y[1][1] - x[1][1]).slice(0, 40)));
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function showProgress() {
  const a = $("#pl-audio");
  const d = a.duration, t = a.currentTime || 0;
  $("#pl-prog").style.width = isFinite(d) && d ? `${(t / d) * 100}%` : "0";
  const left = isFinite(d) ? Math.max(0, Math.round((d - t) / 60)) : null;
  $("#pl-src").textContent = left == null ? a.dataset.src || "" : `${a.dataset.src} · ${left ? `${left} min left` : "ending"}`;
}
function play(it) {
  const a = $("#pl-audio");
  if (safeUrl(it.audio) === "#") return;
  if (a.dataset.id !== it.id) {
    savePos();                       // the episode you're leaving
    a.src = it.audio;
    a.dataset.id = it.id;
    a.dataset.src = it.source;
    const saved = (store.get("pos", {}) || {})[it.id];
    if (saved) {
      a.addEventListener("loadedmetadata", () => {
        if (saved[0] < a.duration - 20) { a.currentTime = saved[0]; toast(`Picking up at ${clock(saved[0])}`); }
      }, { once: true });
    }
    $("#pl-title").textContent = it.title;
    $("#pl-src").textContent = it.source;
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: it.title, artist: it.source, album: "Readout" });
    }
  }
  $("#player").hidden = false;
  document.body.classList.add("playing");
  bump("listen", it);
  a.play().catch(() => toast("Couldn’t start the audio. Try Read to open the episode page."));
}
function syncPlayer() {
  const a = $("#pl-audio");
  $("#pl-toggle").replaceChildren(icon(a.paused ? ICONS.play : ICONS.pause));
  $("#pl-toggle").setAttribute("aria-label", a.paused ? "Play" : "Pause");
}

function topStoryLists(only) {
  const t = S.news?.top_stories || {};
  const mute = mutedRe();
  const mutedSrc = new Set(T.mutedSources || []);
  const keep = (l) => l.filter((st) => !(mute && mute.test(st.title)) && st.sources.some((x) => !mutedSrc.has(x)));
  if (Array.isArray(t)) return keep(t).length ? [["Industry news", keep(t)]] : [];
  return Object.entries(newsKinds()).filter(([k]) => !only || k === only)
    .map(([k, label]) => [label, keep(t[k] || []), k]).filter(([, l]) => l.length);
}

function topCardEl(only) {
  const byId = Object.fromEntries((S.news?.items || []).map((i) => [i.id, i]));
  const lists = topStoryLists(only);
  const ts = S.news?.settings?.top_stories || {};
  const span = !ts.days || ts.days === 7 ? "this week" : `in the last ${ts.days} days`;
  return el("article", { class: "card top-card", "data-key": "top" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Top stories"),
      el("span", {}, `covered by ${(ts.min_outlets || 2) > 2 ? `${ts.min_outlets} or more outlets` : "more than one outlet"} ${span}`)),
    el("div", { class: "top-lists" },
      lists.map(([label, list]) => el("section", {},
        el("h3", { class: "top-h" }, label),
        el("ol", { class: "top-list" }, list.slice(0, lists.length > 2 ? 2 : 3).map((st) =>
          el("li", {}, el("button", { onclick: () => openStory(st, byId) },
            el("span", { class: "top-title" }, st.title),
            el("span", { class: "top-meta" }, `${st.sources.length} outlets: ${st.sources.join(", ")}`)))))))),
    el("p", { class: "fine", style: "margin:0" }, "Swipe up for the latest papers and news."));
}

function openStory(st, byId) {
  openSheet(
    el("h2", { id: "sheet-title" }, st.title),
    el("p", { class: "sheet-meta" }, el("span", {}, `${st.sources.length} outlets`), el("span", {}, agoShort(st.date))),
    el("ul", { class: "rows" }, st.items.map((id) => byId[id]).filter(Boolean).map((it) =>
      el("li", { class: "news-item" }, el("a", { href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) },
        el("span", { class: "news-src" }, el("b", {}, it.source), el("span", {}, agoShort(it.date))),
        el("span", { class: "news-title" }, it.title),
        it.summary ? el("span", { class: "news-teaser" }, it.summary) : null)))));
}

function paperCardEl(it) {
  const isNew = S.newIds.has(it.pmid);
  const c = it.conclusion || { kind: "none" };
  const extra = c.kind === "structured" && (c.text || "").length < 260 ? (it.extras || [])[0] : null;
  const card = el("article", { class: "card", "data-pmid": it.pmid, "data-key": it.pmid },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, it.journal),
      el("span", {}, fmtDate(it.epub || it.added)),
      it.translated ? el("span", { class: "lang", title: "PubMed’s English translation of the title" }, it.language ? `In ${it.language}` : "Translated title") : null,
      followHit(it) ? el("span", { class: "lang follow" }, "Following") : null,
      el("span", { class: "spacer" }),
      isNew ? el("span", { class: "tag-new" }, "New") : null),
    impactEl(it),
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
  const saved = !!S.saved[saveKey(it)];
  const saveBtn = el("button", { class: "act", "aria-pressed": String(saved), onclick: () => toggleSave(it, saveBtn) },
    icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save");
  return el("div", { class: "actions", style: withShare ? null : "grid-template-columns:repeat(3,1fr)" },
    el("button", { class: "act", onclick: () => openAbstract(it) }, icon(ICONS.abstract), "Abstract"),
    saveBtn,
    el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, icon(ICONS.pubmed), "PubMed"),
    withShare ? el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share") : null);
}

function fitCard(card) {
  const box = card.querySelector(".concl");
  const inner = box?.querySelector(".concl-inner");
  const p = box?.querySelector(".concl-text:not(.none)");
  if (!box || !p) return;
  if (!box.clientHeight) return;      // feed not on screen (another tab): fit when it comes back
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
  if (card.classList.contains("news-card")) {      // a teaser: clamp it, the article is one tap away
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 24;
    const head = box.querySelector(".news-headline");
    const lines = String(Math.max(1, Math.floor((box.clientHeight - (head ? head.offsetHeight + 8 : 0)) / lh)));
    p.style.webkitLineClamp = lines;
    p.style.lineClamp = lines;
    return;
  }
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
  const key = saveKey(it);
  if (S.saved[key]) {
    delete S.saved[key];
    toast("Removed from Saved");
  } else {
    S.saved[key] = Object.assign({}, it, { savedAt: Date.now() });
    if (!it.sections && it.abs) {        // keep the abstract with the saved copy, for when it leaves the feed
      sectionsOf(it).then((secs) => {
        if (!S.saved[key] || !secs.length) return;
        S.saved[key].sections = secs;
        if (!store.set("saved", S.saved)) delete S.saved[key].sections;   // no room for the abstract: keep the card
      }).catch(() => {});
    }
    bump("save", it);
    toast("Saved");
  }
  if (!store.set("saved", S.saved)) {
    if (S.saved[key] && S.saved[key].savedAt) {      // didn't fit: undo, and say so rather than lose it later
      const copy = S.saved[key];
      delete copy.sections; delete copy.extras; delete copy.streams;
      if (!store.set("saved", S.saved)) {
        delete S.saved[key];
        toast("Couldn’t save: Readout’s storage on this phone is full. Remove some saved items first.");
      }
    } else toast("Couldn’t update Saved: this phone’s storage is full.");
  }
  const on = !!S.saved[key];
  document.querySelectorAll(`[data-key="${CSS.escape(key)}"] .act[aria-pressed]`).forEach((b) => setSaveBtn(b, on));
  if (btn) setSaveBtn(btn, on);
  if (S.tab === "saved") renderSaved();
}
function setSaveBtn(b, on) {
  b.setAttribute("aria-pressed", String(on));
  b.replaceChildren(icon(on ? ICONS.saved : ICONS.save), on ? "Saved" : "Save");
}

async function share(it) {
  const isNews = it.type === "news" || (!it.pmid && it.link);
  const url = isNews ? it.link : pubmedUrl(it.pmid);
  const text = isNews ? `${it.title} (${it.source})` : `${it.title} (${it.journal})\n\n${it.conclusion?.text || ""}`;
  try {
    if (navigator.share) await navigator.share({ title: it.title, text, url });
    else { await navigator.clipboard.writeText(`${text}\n${url}`); toast("Copied to clipboard"); }
  } catch { /* cancelled */ }
}

// ── abstract sheet ─────────────────────────────────────────────────────────
// while a sheet or the topic page is open, what's behind it can't be reached (VoiceOver, keyboard);
// on close, focus returns to the button that opened it
let sheetOpener = null, topicOpener = null;
function setInert() {
  const sheet = $("#sheet").classList.contains("open"), topic = $("#topic").classList.contains("open");
  $(".app").inert = sheet || topic;
  $("#topic").inert = !topic || sheet;
  $("#sheet").inert = !sheet;
}
function refocus(elm) { if (elm?.isConnected && !elm.closest("[inert]")) elm.focus({ preventScroll: true }); }
function openSheet(...content) {
  if (!$("#sheet").classList.contains("open")) sheetOpener = document.activeElement;
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
  setInert();
  card.querySelector("button")?.focus({ preventScroll: true });
}
function closeSheet() {
  const sheet = $("#sheet");
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  setInert();
  refocus(sheetOpener);
}

// abstracts sit beside the data files in small buckets (pipeline/abstract_store.py)
const absCache = new Map();
async function sectionsOf(it) {
  if (it.sections) return it.sections;
  if (!it.abs || !it.pmid) return [];
  const name = `${it.abs}${String(Number(it.pmid) % 50).padStart(2, "0")}`;
  const path = `data/abstracts/${name}.json`;
  if (!absCache.has(name)) {
    // abstracts don't change: a kept copy that has this paper answers at once, even on a weak signal
    absCache.set(name, keptJSON(path).then((k) => (k?.[it.pmid] ? k : loadJSON(path)))
      .catch(() => { absCache.delete(name); return null; }));
  }
  let b = await absCache.get(name);
  if (b && !b[it.pmid]) {             // kept copy from before this paper joined: ask the network
    absCache.delete(name);
    b = await loadJSON(path).then((x) => { absCache.set(name, Promise.resolve(x)); return x; }).catch(() => null);
  }
  if (b === null) throw new Error("offline");
  return b?.[it.pmid] || [];
}
async function openAbstract(it) {
  if (!it) return;
  bump("open", it);
  let secs = [], missing = false;
  try { secs = await sectionsOf(it); } catch { missing = true; }
  const links = [
    el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener" }, "PubMed"),
    it.doi ? el("a", { class: "act", href: `https://doi.org/${it.doi}`, target: "_blank", rel: "noopener" }, "Journal") : null,
    it.pmcid ? el("a", { class: "act", href: `https://pmc.ncbi.nlm.nih.gov/articles/${it.pmcid}/`, target: "_blank", rel: "noopener" }, "Free full text") : null,
  ];
  openSheet(
    el("h2", { id: "sheet-title" }, it.title),
    el("p", { class: "sheet-meta" },
      [it.authors, it.journal, fmtDate(it.epub || it.added || it.ppub), `PMID ${it.pmid}`,
        it.translated ? `${it.language ? `Article in ${it.language}; ` : ""}title translated by PubMed` : null].filter(Boolean).map((t) => el("span", {}, t))),
    it.retracted ? el("div", { class: "warn", style: "margin-bottom:14px" }, "Retracted. Check the retraction notice on PubMed.") : null,
    evidenceEl(it.design),
    it.sample ? el("p", { class: "sample", style: "margin:6px 0 0;font-size:14px" }, `Sample: ${it.sample} (read from the abstract)`) : null,
    it.impact ? el("p", { class: "imp-detail" }, it.impact.age >= 4
      ? `${plural(it.impact.cites, "citation")}${it.impact.age >= 12 ? ` (${it.impact.cpy} a year)` : ""}${it.impact.rcr != null ? `, Relative Citation Ratio ${it.impact.rcr}` : ""}. Cited more than ${Math.floor(it.impact.pct)}% of ${it.impact.area ? (S.feed?.areas?.[it.impact.area]?.label || areaShort(it.impact.area)).toLowerCase().replace(/\bct\b/g, "CT") : "radiology"} papers that came out in ${it.impact.q}.${it.impact.clin ? ` Cited in ${plural(it.impact.clin, "clinical paper")} (trials, guidelines).` : ""} Source: NIH iCite.`
      : `Too new to judge by citations (${Math.round(it.impact.age)} months old). Papers in ${it.journal} from the last few years average the ${Math.round(it.impact.jpct)}th percentile for citations.`) : null,
    el("div", { style: "height:16px" }),
    secs.length
      ? secs.map((s) => el("section", { class: "abs-sec" + (s.cat === "CONCLUSIONS" ? " key" : "") },
        s.label ? el("h3", {}, s.label) : null, el("p", {}, s.text)))
      : el("p", { class: "sample" }, missing ? "Couldn’t load the abstract (you may be offline). Open it on PubMed instead."
        : it.abs ? "This abstract is no longer stored in Readout (the paper has left the feed). Open it on PubMed."
        : "PubMed has no abstract for this paper. Open it on PubMed or the journal’s site to read it."),
    el("div", { class: "link-row" }, links, actionsEl(it, false).children[1]));
}

function openInfo() {
  const gen = S.feed?.generated ? `Feed updated ${ago(S.feed.generated)}.` : "Feed not built yet.";
  const exg = S.explore?.generated ? ` Trends updated ${ago(S.explore.generated)}.` : "";
  openSheet(el("div", { class: "info" },
    el("h2", { id: "sheet-title" }, "How cards are built"),
    el("p", {}, `Paper cards come straight from PubMed; news cards from each outlet’s own feed. ${gen}${exg}`),
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
    el("h3", {}, "News in the feed"),
    el("p", {}, "The feed mixes papers with four kinds of news: radiology industry (AuntMinnie, Radiology Business, ITN, The Imaging Wire…), health & medicine (STAT, KFF Health News, NPR Health, MedPage Today…), science for everyone (NPR Short Wave and Science, Science Friday, Radiolab, Quanta, Smithsonian, Live Science, NASA…) and sci-fi & fantasy (Reactor, Locus, File 770, Strange Horizons, Inverse, Den of Geek…). The full list is in config/news.yaml. In Everything they take turns with papers (papers get two turns per round, each news kind one), and each busy outlet adds at most two stories a day; tap a chip to see one kind in full. You can change the mix, the outlet limit and the paper order in the Tune tab. Cards show the headline and the outlet’s own short summary; Read opens the article, and podcast episodes have Listen, which keeps playing while you scroll. The first card lists stories more than one publisher covered this week."),
    el("h3", {}, "Your interests"),
    el("p", {}, "Papers come from four areas: nuclear medicine (every paper in the NM journals), body imaging, cardiac & vascular CT (TAVR planning, CCTA, CT-FFR, calcium), and general radiology (Radiology, AJR, RadioGraphics, JACR). In Tune → Interests you turn areas on or off, set how much of the feed each gets, follow words like “TAVR” (they get their own chip), and pick which organ-system chips show. ACR, SNMMI and SCCT news arrive as “ACR & societies”."),
    el("h3", {}, "Most important"),
    el("p", {}, "Every paper from the same journals over the last three years, ranked by how often it’s cited compared with body-imaging papers published in the same quarter (citations from NIH iCite). “1 year” and “3 years” list original research at least four months old, by that percentile. “New” covers the last six months: early citations count for more as a paper ages, and until then its journal’s record stands in. Case reports, editorials and letters are left out; reviews and guidelines can be added in Tune. Readership counts aren’t publicly available, so citations are the measure."),
    el("h3", {}, "Tune"),
    el("p", {}, "The Tune tab shows what you read (counted only on this phone), lets you change how the feed and Explore are put together, and reports how each update job is doing, with links to edit its settings on GitHub."),
    el("h3", {}, "Sources"),
    el("p", {}, "PubMed (NLM), NIH iCite, ClinicalTrials.gov. Fonts: Literata, Atkinson Hyperlegible Next (SIL Open Font License).")));
}

// ── explore ────────────────────────────────────────────────────────────────
// Trend rules: the weekly job's (config/topics.yaml), unless changed in Tune.
// Same logic as lists_for() in pipeline/build_explore.py.
function trendRules() {
  const srv = S.explore?.settings || {};
  const base = { breakout: srv.breakout ?? 1, rising: srv.rising ?? 0.15, cooling: srv.cooling ?? -0.15,
    min: srv.min_papers || S.explore?.min_recent || { 1: 15, 2: 25, 5: 40 }, influential: srv.influential ?? 8 };
  const t = T.trend;
  if (!t) return { ...base, base, custom: false };
  return { breakout: t.breakout ?? base.breakout, rising: t.rising ?? base.rising, cooling: t.cooling ?? base.cooling,
    min: Object.fromEntries(Object.entries(base.min).map(([k, v]) => [k, Math.max(1, Math.round(v * (t.minScale || 1)))])),
    influential: base.influential, base, custom: true };
}
function trendLists(x, win) {
  const r = trendRules();
  const k = String(win);
  if (!r.custom && x.lists?.[k]) return x.lists[k];
  const mp = r.min[k] ?? 0;
  const W = (tp) => tp.windows?.[k] || {};
  const g = (tp) => W(tp).growth;
  const byG = (a, b) => g(b) - g(a);
  const ok = x.topics.filter((tp) => (W(tp).recent || 0) >= mp);
  const ids = (l) => l.map((tp) => tp.id);
  return {
    breakouts: ids(ok.filter((tp) => g(tp) == null).concat(ok.filter((tp) => g(tp) != null && g(tp) >= r.breakout).sort(byG))),
    rising: ids(ok.filter((tp) => g(tp) != null && g(tp) >= r.rising && g(tp) < r.breakout).sort(byG)),
    cooling: ids(x.topics.filter((tp) => (W(tp).prior || 0) >= mp && g(tp) != null && g(tp) <= r.cooling).sort((a, b) => g(a) - g(b))),
    influential: ids(ok.slice().sort((a, b) => (W(b).influence || 0) - (W(a).influence || 0)).slice(0, r.influential)),
    practice: x.lists?.[k]?.practice || [],
  };
}
const upText = (g) => (Math.abs(g - Math.round(g)) < 1e-9 && g >= 1 && g <= 3
  ? `At least ${["", "doubled", "tripled", "quadrupled"][Math.round(g)]} their share of imaging research.`
  : `Share of imaging research up at least ${Math.round(g * 100)}%.`);
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
  const min = trendRules().min?.[S.win] || 0;
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
  if (!x && S.exploreLoading) {
    S.exploreKey = null;                     // draw again when it arrives
    view.append(el("section", { class: "empty", style: "height:100%" }, el("h2", { text: "Loading trends…" })));
    return;
  }
  if (!x) {
    view.append(el("section", { class: "empty", style: "height:100%" },
      el("h2", { text: "Trends aren’t built yet" }),
      el("p", { text: "They come from a weekly job. On GitHub, open Actions, choose “Update trends”, and run it once. It takes about 10 minutes." }),
      el("button", { class: "btn", onclick: () => reload(true) }, "Check again")));
    return;
  }
  const byId = Object.fromEntries(x.topics.map((t) => [t.id, t]));
  const L = trendLists(x, S.win);
  const TR = trendRules();
  const pick = (ids, n = 8) => (ids || []).slice(0, n).map((id) => byId[id]).filter(Boolean);
  const yrs = { 1: "year", 2: "2 years", 5: "5 years" }[S.win];
  const terms = x.terms?.[S.win] || {};

  const wrap = el("div", { class: "explore" },
    segEl(() => renderExplore(true)),
    el("p", { class: "ex-note" }, `Papers in the last ${yrs} compared with the ${yrs} before, adjusted for how fast imaging research grew overall. Updated ${ago(x.generated)}.`,
      TR.custom ? [" ", el("button", { class: "inline-link", onclick: () => { switchTab("tune"); setPane("algorithms", "tune-trends"); } }, "Using your trend rules.")] : null),
    section("Breakouts", upText(TR.breakout),
      pick(L.breakouts).map((t) => topicRow(t, "growth")), "No topic cleared the breakout bar in this window."),
    section("Rising", `Share of imaging research up at least ${Math.round(TR.rising * 100)}%.`,
      pick(L.rising).map((t) => topicRow(t, "growth"))),
    section("Most influential", "Ranked by how often their top papers are cited (NIH iCite).",
      pick(L.influential, 6).map((t) => topicRow(t, "influence"))),
    section("Reaching practice", "New guidelines and consensus statements.",
      pick(L.practice, 6).map((t) => topicRow(t, "practice"))),
    section("Cooling", `Share of imaging research down at least ${Math.round(-TR.cooling * 100)}%.`,
      pick(L.cooling, 6).map((t) => topicRow(t, "growth")), "No topic is clearly shrinking."),
    section("New in titles", `Phrases used far more often in body-imaging titles than in the ${yrs} before. Tap one to see papers.`,
      (terms.emerging || []).map((t) => termRow(t)), "Not enough titles in this window yet."),
    section("Fading from titles", null, (terms.fading || []).slice(0, 6).map((t) => termRow(t)), "Nothing notable."),
  );
  const nt = newsTrendsEl();
  if (nt) wrap.append(nt);
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

function newsTrendsEl() {
  const n = S.news;
  if (!n?.trending) return null;
  const byKind = n.trending.week ? { industry: n.trending } : n.trending;      // older files had one set
  const byId = Object.fromEntries(n.items.map((i) => [i.id, i]));
  const groups = Object.entries(newsKinds()).filter(([k]) => byKind[k]);
  const span = S.newsSpan;
  return el("section", { class: "sect" },
    el("h2", {}, "In the news"),
    el("p", { class: "sub" }, "Phrases trending in headlines. Tap one to see the stories."),
    el("div", { class: "seg", role: "group", "aria-label": "News window", style: "grid-template-columns:repeat(2,1fr);margin:0 0 4px" },
      [["week", "This week"], ["month", "This month"]].map(([k, l]) => el("button", { "aria-pressed": String(span === k),
        onclick: () => { S.newsSpan = k; store.set("newsSpan", k); renderExplore(true); } }, l))),
    groups.map(([k, label]) => {
      const tr = byKind[k][span] || { terms: [] };
      return el("div", { style: "margin-top:14px" },
        el("div", { class: "sys-head", style: "margin-top:0" }, label),
        el("p", { class: "fine", style: "margin:0 0 8px" }, tr.basis === "growth"
          ? `Used more than in the ${span === "week" ? "4 weeks" : "3 months"} before.`
          : "Most widely covered (trend lines start once a few weeks of headlines build up)."),
        (tr.terms || []).length
          ? el("div", { class: "term-chips" }, tr.terms.map((t) => el("button", { class: "term-chip",
              onclick: () => openSheet(
                el("h2", { id: "sheet-title" }, `“${t.term}” in the news`),
                el("p", { class: "sheet-meta" }, el("span", {}, plural(t.count, "headline")), el("span", {}, t.sources.join(", "))),
                el("ul", { class: "rows" }, t.ids.map((id) => byId[id]).filter(Boolean).map((it) =>
                  el("li", { class: "news-item" }, el("a", { href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) },
                    el("span", { class: "news-src" }, el("b", {}, it.source), el("span", {}, agoShort(it.date))),
                    el("span", { class: "news-title" }, it.title)))))) },
              t.term, el("b", {}, String(t.count)))))
          : el("p", { class: "nothing" }, "Not enough headlines yet."));
    }));
}

function paperEl(p, opts = {}) {
  if (!p.pmid && p.link) return savedNewsEl(p);
  const m = p.metrics;
  const c = p.conclusion || {};
  return el("article", { class: "paper", "data-pmid": p.pmid },
    el("div", { class: "paper-meta" }, el("b", {}, p.journal), el("span", {}, fmtDate(p.epub || p.ppub || p.added))),
    p.retracted ? el("div", { class: "warn" }, "Retracted") : null,
    el("h3", { class: "paper-title" }, p.title),
    c.text ? el("div", { class: "concl-label" + (c.kind === "structured" ? "" : " soft") }, conclLabel(c)) : null,
    c.text ? el("p", { class: "paper-concl" }, c.text) : null,
    p.impact ? impactEl(p) : null,
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
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-back").focus({ preventScroll: true });
}
function closeTopic() {
  const ov = $("#topic");
  ov.classList.remove("open");
  ov.setAttribute("aria-hidden", "true");
  setInert();
  refocus(topicOpener);
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

function savedNewsEl(it) {
  return el("article", { class: "paper", "data-key": saveKey(it) },
    el("div", { class: "paper-meta" }, el("b", {}, it.source), el("span", {}, fmtDate((it.date || "").slice(0, 10)))),
    el("h3", { class: "paper-title" }, it.title),
    it.summary ? el("p", { class: "news-teaser", style: "margin:0" }, it.summary) : null,
    el("div", { class: "actions", style: `grid-template-columns:repeat(${it.audio ? 4 : 3},1fr)` },
      it.audio ? el("button", { class: "act", onclick: () => play(it) }, icon(ICONS.listen), "Listen") : null,
      el("a", { class: "act", href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, icon(ICONS.read), "Read"),
      actionsEl(it, false).children[1],
      el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share")));
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
    const text = items.map((i) => i.pmid
      ? `${i.title} ${i.journal}. ${(i.epub || i.added || "").slice(0, 4)}. ${pubmedUrl(i.pmid)}`
      : `${i.title} (${i.source}, ${(i.date || "").slice(0, 10)}). ${i.link}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast(`Copied ${plural(items.length, "item")}`); } catch { toast("Couldn’t reach the clipboard"); }
  };
  view.append(
    el("div", { class: "saved-tools" }, el("button", { class: "act", style: "padding:0 14px", onclick: copy }, "Copy list")),
    el("div", { class: "saved-list" }, items.map((i) => paperEl(i))));
  view.scrollTop = keep;
}

// ── tabs, header, boot ─────────────────────────────────────────────────────
function updateHeadNote() {
  const note = $("#head-note");
  const fresh = S.list.filter((i) => (i.type === "paper" ? S.newIds.has(i.pmid) : i.type === "news" && S.newsNew.has(i.id))).length;
  if (S.tab === "feed" && S.offline) note.textContent = S.feed ? `Offline · ${ago(S.feed.generated)}` : "Offline";
  else if (S.tab === "feed" && S.kind === "important" && S.important) note.textContent = `Ranked ${ago(S.important.generated)}`;
  else if (S.tab === "feed" && fresh) note.textContent = `${fresh} new`;
  else if (S.tab === "feed" && S.feed) note.textContent = `Updated ${ago(S.feed.generated)}`;
  else note.textContent = "";
}

function switchTab(tab) {
  if (S.tab === "feed" && tab !== "feed") S.lastKey = currentKey();
  S.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#view-feed").hidden = tab !== "feed";
  $("#view-explore").hidden = tab !== "explore";
  $("#view-saved").hidden = tab !== "saved";
  const tv = $("#view-tune");
  if (tv) tv.hidden = tab !== "tune";
  $("#chips").hidden = tab !== "feed";
  $("#title").textContent = { feed: "Readout", explore: "Explore", saved: "Saved", tune: "Tune" }[tab];
  updateHeadNote();
  if (tab === "feed") {
    if (S.feedDirty) refreshFeed(S.lastKey);
    else requestAnimationFrame(fitAll);       // the screen may have turned while you were away
  }
  if (tab === "explore") renderExplore();
  if (tab === "saved") renderSaved();
  if (tab === "tune" && typeof renderTune === "function") renderTune();
}

async function reload(announce) {
  const before = new Set((S.feed?.items || []).map((i) => i.pmid));
  const was = { feed: S.feed?.generated, explore: S.explore?.generated, news: S.news?.generated };
  S.offline = false;
  const wasImp = S.important?.generated;
  const [feed, newsData, important] = await Promise.all([
    loadJSON("data/feed.json").catch(() => null),
    loadJSON("data/news.json").catch(() => null),
    loadJSON("data/important.json").catch(() => null),
  ]);
  // Explore isn't needed for the feed: fetch it after, so the feed gets the bandwidth
  const exploreDone = loadJSON("data/explore.json").catch(() => null).then((explore) => {
    S.exploreLoading = false;
    if (explore) S.explore = explore;
    const changed = !S.explore || S.explore.generated !== was.explore;
    if (changed) S.exploreKey = null;
    if (S.tab === "explore" && (announce || changed)) renderExplore();
    if (S.tab === "tune" && typeof renderTune === "function" && changed) renderTune(true);
  });
  if (important) S.important = important;
  const impChanged = !!S.important && S.important.generated !== wasImp;
  if (newsData) S.news = newsData;
  const newsChanged = !!S.news && S.news.generated !== was.news;
  markNewsNew();
  if (feed) S.feed = feed;
  if (feed || newsData) S.loadedAt = Date.now();
  const feedChanged = !S.feed || S.feed.generated !== was.feed;
  markNew();
  // rebuilding resets the feed; when it's on screen keep your place (unless you tapped refresh),
  // when it isn't, rebuild on the way back
  if (announce || feedChanged || newsChanged || (impChanged && (S.kind === "important" || !wasImp))) {
    if (S.tab === "feed") { if (announce) refreshFeed(null); else updateFeedQuietly(Date.now() - (S.shownAt || 0)); }
    else { S.feedDirty = true; if (announce) S.lastKey = null; }
  } else updateHeadNote();
  if (newsChanged) S.exploreKey = null;
  if (S.tab === "tune" && typeof renderTune === "function" && (announce || feedChanged || newsChanged)) renderTune(true);
  if (!feed && !newsData && navigator.onLine === false) S.offline = true;
  updateHeadNote();
  if (announce) {
    if (S.offline) toast(`You’re offline. Showing what’s on this phone${S.feed ? ` (papers from ${ago(S.feed.generated)})` : ""}.`);
    else if (!feed && !newsData) toast("Couldn’t reach Readout. Showing what’s on this phone.");
    else {
      const added = (feed?.items || []).filter((i) => !before.has(i.pmid)).length;
      const fresh = S.newsNew.size;
      toast(added && before.size ? `${plural(added, "new paper")}` + (fresh ? ` and ${plural(fresh, "new story", "new stories")}` : "")
        : `Up to date. Papers updated ${ago(feed?.generated)}${S.news ? `, news ${ago(S.news.generated)}` : ""}.`);
    }
  }
  return exploreDone;
}

// open at once from what's on the phone; reload() then brings it up to date
async function showKept() {
  const [feed, newsData, important] = await Promise.all(["feed", "news", "important"].map((f) => keptJSON(`data/${f}.json`)));
  if (!feed && !newsData) return;
  if (S.feed || S.news) return;             // the network won the race
  S.feed = feed; S.news = newsData; S.important = important;
  S.loadedAt = Date.now();
  markNewsNew(); markNew();
  if (S.tab === "feed") refreshFeed(); else S.feedDirty = true;
  S.shownAt = Date.now();
  keptJSON("data/explore.json").then((x) => { if (x && !S.explore) { S.explore = x; S.exploreKey = null; if (S.tab === "explore") renderExplore(); } });
}

function boot() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#btn-refresh").addEventListener("click", () => reload(true));
  $("#btn-info").addEventListener("click", openInfo);
  $("#topic-back").addEventListener("click", closeTopic);
  const pa = $("#pl-audio");
  $("#pl-toggle").addEventListener("click", () => (pa.paused ? pa.play().catch(() => {}) : pa.pause()));
  $("#pl-close").addEventListener("click", () => { pa.pause(); $("#player").hidden = true; document.body.classList.remove("playing"); });
  ["play", "pause", "ended"].forEach((ev) => pa.addEventListener(ev, syncPlayer));
  ["pause", "ended"].forEach((ev) => pa.addEventListener(ev, savePos));
  let lastSave = 0;
  pa.addEventListener("timeupdate", () => {
    showProgress();
    if (Date.now() - lastSave > 10000) { lastSave = Date.now(); savePos(); }
  });
  pa.addEventListener("loadedmetadata", showProgress);
  const skip = (s) => { if (isFinite(pa.duration)) pa.currentTime = Math.max(0, Math.min(pa.duration - 1, pa.currentTime + s)); showProgress(); };
  $("#pl-back").addEventListener("click", () => skip(-15));
  if ("mediaSession" in navigator) {        // lock-screen buttons
    const on = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* not supported */ } };
    on("play", () => pa.play().catch(() => {}));
    on("pause", () => pa.pause());
    on("seekbackward", (d) => skip(-(d?.seekOffset || 15)));
    on("seekforward", (d) => skip(d?.seekOffset || 30));
    on("seekto", (d) => { if (d?.seekTime != null) { pa.currentTime = d.seekTime; showProgress(); } });
  }
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") closeSheet(); });
  setInert();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("#sheet").classList.contains("open")) closeSheet();
    else if ($("#topic").classList.contains("open")) closeTopic();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { rememberSeen(); saveStats(); savePos(); }
    else if (Date.now() - S.loadedAt > 60 * 60 * 1000) reload(false);   // home-screen apps stay open for days
  });
  window.addEventListener("pagehide", () => { rememberSeen(); saveStats(); savePos(); });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fitAll, 200); });
  document.fonts?.ready.then(fitAll);
  document.fonts?.addEventListener?.("loadingdone", fitAll);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  S.kind = T.startOn;
  S.exploreLoading = true;
  showKept().finally(() => reload(false));
}
boot();
