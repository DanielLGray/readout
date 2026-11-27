/* Readout — body imaging literature, led by each paper's own conclusion. */
"use strict";

// Readout never runs inside another site's frame: a page that framed it could trick taps on
// Run now or the key boxes. (GitHub Pages can't send the header that forbids framing.)
const FRAMED = (() => { try { return window.top !== window.self; } catch { return true; } })();
if (FRAMED) {
  document.documentElement.replaceChildren();
  throw new Error("Readout won't run inside another page");
}

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
  react: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7"/></svg>',
  reacted: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(180deg)"><path d="M7 11v9H4v-9z"/><path d="M7 11l4-7c1.7 0 2.6 1.2 2.2 2.8L12.6 10H18a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 17 20H7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
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
const TEXT_SIZES = [0.9, 1, 1.12, 1.25];
function applyTextSize() { document.documentElement.style.setProperty("--ts", String(T?.textSize || 1)); }
// a journal link through your library's proxy, so paywalled articles open with your institution's access
function libraryUrl(url) {
  const p = T?.library;
  if (!p || !url || !/^https?:\/\//i.test(p)) return url;      // only ever a web address
  if (p.includes("{url}")) return p.replace("{url}", encodeURIComponent(url));
  return /openathens|redirector|qurl=$/i.test(p) ? p + encodeURIComponent(url) : p + url;    // EZproxy's login?url= takes it as is
}
const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${/^\d{1,9}$/.test(String(pmid)) ? pmid : ""}`;
// links built from paper data: only well-formed identifiers make a link
const doiUrl = (doi) => (/^10\.\d{4,9}\/[^\s"<>]+$/.test(String(doi || "")) ? `https://doi.org/${encodeURI(doi)}` : null);
const pmcUrl = (id) => (/^PMC\d{1,9}$/.test(String(id || "")) ? `https://pmc.ncbi.nlm.nih.gov/articles/${id}/` : null);
// links from outlets' feeds: web addresses only
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? u : "#");
// The best way to read a paper in full: a free copy the papers jobs found in Europe PMC (PubMed
// Central, the publisher's free version, or a repository copy Unpaywall knows), else through your
// library's link, else nothing (the card keeps PubMed). A saved copy picks up a link found since.
let ftIndex = { feed: null, map: new Map() };
function latestCard(it) {
  if (!it?.pmid) return null;
  if (ftIndex.feed !== S.feed) ftIndex = { feed: S.feed, map: new Map((S.feed?.items || []).map((p) => [p.pmid, p])) };
  return ftIndex.map.get(it.pmid) || S.important?.papers?.[it.pmid] || S.library?.papers?.[it.pmid] || null;
}
function fullTextOf(it) {
  const ft = it?.ft || latestCard(it)?.ft;
  if (ft && /^https:\/\//.test(String(ft.u || ""))) return { url: ft.u, free: true, where: ft.s, pdf: !!ft.pdf };
  if (pmcUrl(it?.pmcid)) return { url: pmcUrl(it.pmcid), free: true, where: "PMC" };
  if (T?.library && doiUrl(it?.doi)) return { url: libraryUrl(doiUrl(it.doi)), free: false, where: "library" };
  return null;
}
const FT_WHERE = { PMC: "PubMed Central", publisher: "the journal’s free version", repository: "a free copy (Unpaywall)", library: "your library" };
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : (many || one + "s")}`;

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.classList.remove("act");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// a toast with one button (Undo), up a little longer
function toastAction(msg, label, fn) { toastActions(msg, [[label, fn]]); }
function toastActions(msg, acts) {
  const t = $("#toast");
  t.replaceChildren(el("span", {}, msg), ...acts.map(([label, fn]) => el("button", { class: "toast-act", onclick: () => {
    clearTimeout(toastTimer); t.classList.remove("show", "act"); fn();
  } }, label)));
  t.classList.add("show", "act");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show", "act"), acts.length > 1 ? 6500 : 5000);
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
  library: null,          // Foundations and the classics (monthly job)
};

// earnings dates to watch (Tune → Interests → Coming up): market movers, then imaging, radiopharma and structural heart
const WATCH_DEFAULT = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "JPM", "BAC", "WFC", "C", "GS",
  "GEHC", "SMMNY", "PHG", "EW", "MDT", "LNTH", "RDNT"];
const WATCH_NAMES = { AAPL: "Apple", MSFT: "Microsoft", NVDA: "Nvidia", AMZN: "Amazon", GOOGL: "Alphabet", META: "Meta", TSLA: "Tesla",
  JPM: "JPMorgan Chase", BAC: "Bank of America", WFC: "Wells Fargo", C: "Citigroup", GS: "Goldman Sachs", GEHC: "GE HealthCare",
  SMMNY: "Siemens Healthineers", PHG: "Philips", EW: "Edwards Lifesciences", MDT: "Medtronic", LNTH: "Lantheus", RDNT: "RadNet" };
const HZ_KINDS = { markets: "Markets & economy", money: "Personal finance", medicine: "Medicine & imaging", science: "Science & space",
  sky: "Night sky", movies: "Sci-fi & fantasy movies", culture: "Culture & awards", news: "Big scheduled news" };
// Today's parts, in their usual order (Tune → Reading → Today → Advanced can put them in yours)
const BRIEF_PARTS = { near: "Near Reno", horizon: "Coming up", radar: "Radar", watch: "Watch", local: "Reno & Nevada", cites: "New citations", papers: "New papers", stories: "Stories",
  classic: "Classic of the day", wide: "Outside your areas", foundations: "Next Foundations paper" };
// alerts: which switch in Tune → Rules turns each kind off
const ALERT_GROUPS = {
  fda: ["FDA", "Approvals and safety warnings for radiopharmaceuticals and imaging agents (contrast, PET and SPECT tracers, radioligand therapy), and new heart-valve approvals and indications."],
  trials: ["Trial results", "Results posted for a Phase 3 trial in your Watch topics (ClinicalTrials.gov)."],
  rules: ["Federal rules", "Final Medicare payment rules (physician fee schedule, hospital outpatient) and NRC rules on medical use of radioactive material."],
  uspstf: ["USPSTF", "New and draft recommendations from the U.S. Preventive Services Task Force."],
  acs: ["American Cancer Society", "Changes to its screening and other guidelines."],
  societies: ["Societies", "Guidelines and consensus statements: ACR, SAR, SNMMI, EANM, SCCT, Fleischner, ACC/AHA, ESC, AASLD."],
};

// ── tuning: the settings that drive the feed, kept on this phone (Tune tab) ──
const TUNE_DEFAULTS = {
  mix: { paper: 2, industry: 1, societies: 1, science: 1, health: 1, general: 1, local: 1, business: 1, sff: 1 },   // turns per round in Everything
  areas: { body: 3, nm: 2, cardiac: 2, general: 1 },   // interest areas: 0 off, 1 less, 2 normal, 3 more
  follow: [],           // words and phrases you follow (the Following chip)
  hiddenSystems: [],    // organ-system chips you don't want in the chip row
  textSize: 1,          // reading text: 0.9 small, 1 default, 1.12 large, 1.25 larger
  library: "",          // your library's off-campus link prefix (EZproxy, OpenAthens), for Journal links
  cap: 2,               // most stories per outlet per day in Everything (industry news exempt); 0 = no limit
  topCard: true,        // open the feed with stories several outlets covered
  topPer: 0,            // top stories per kind in that card: 0 = 3, or 2 when there are three kinds or more
  topAgain: 36,         // hours before a top story you were shown leads the card again (12, 36 or 72)
  allBylines: false,    // every story's writers; off: only outlets whose terms ask that writers be credited
  why: true,            // a line on each card saying what put it there
  citeAlerts: true,     // new papers citing ones you saved (this phone asks NIH iCite once a day)
  muteIn: "text",       // muted words: "title" (headlines only) or "text" (headlines and the text on the card)
  order: "newest",      // papers: "newest" or "ranked"
  rank: { fresh: 7, evidence: 1, size: 0.5, concl: 0.5, systems: 1 },   // half-life in days; weights
  fav: [],              // your organ systems (a ranking boost)
  hidePending: true,    // hide papers whose abstract isn't in PubMed yet (the conclusion is the card)
  readLast: true,       // cards you've already seen go to the end of each list
  weather: true,        // today's and tomorrow's forecast for Reno under the chips
  near: { quakes: true, fires: true, mi: 100, mag: 3, days: 2, acres: 10, rx: false, contained: false, alerts: true, roads: true, air: true, aqi: 101 },   // Today's Near Reno card (near.js)
  swipe: true,          // swipe a card left to save it, right to clear it
  horizon: { kinds: Object.fromEntries(Object.keys(HZ_KINDS).map((k) => [k, true])), watch: WATCH_DEFAULT, range: 90 },   // Coming up (range: days Explore shows)
  alerts: { fda: true, uspstf: true, acs: true, societies: true },   // rare alerts at the top of Everything and Today
  radar: { level: "early", hidden: [], hiddenSpots: [], heat: 2 },
  watch: { kinds: { trial: true, device: true, drug: true, rule: true }, aiOnly: false, follow: [], hidden: [], dates: true, mute: [] },   // Watch: which kinds, AI-only devices, trials you follow, topics off, dates in Coming up, words hidden from Watch and alerts   // the Radar: what counts as a development; topics and phrases you hid; Heating up at this many times the usual
  alertDays: 7,         // alerts stay pinned this many days
  alertMax: 2,          // at most this many alert cards at the top (the rest: "N more")
  alertTwo: false,      // two alerts of one kind can both show
  maxAge: {},           // kind → oldest story shown, in days (none: any age the job keeps)
  capBy: {},            // outlet → stories a day in Everything (none: your limit, moved by the outlet's own setting and your rating)
  obits: "wide",        // death notices: "wide" (only those many outlets ran, or high office), "all" or "none"
  cardLayout: "compact", // phones: "compact" (cards as tall as what they hold) or "paged" (one per screen); wider screens are always compact
  mutedSources: [], mutedWords: [],
  rules: RULE_DEFAULTS,  // topic filters (filters.js): hide a subject everywhere unless it mentions what you choose
  trend: null,          // null: the weekly job's rules; else { breakout, rising, cooling, minScale }
  impReviews: false,    // Most important: also reviews, meta-analyses and guidelines
  startOn: "today",     // the view the app opens on: today, all, papers or important
  brief: { papers: 5, stories: 2, classic: true, foundations: true, horizon: true, wide: true, radar: true, watch: true, week: 6, hzDays: 7, watchRows: 4, local: 3, order: null },
  local: { scope: "nevada" },   // Reno & Nevada: "reno" (Reno and northern Nevada), "nevada" (the state) or "all"   // what Today holds (week: the day of the week brief, 0 Sunday…6 Saturday, -1 off)
  guess: "brief",       // guess the result: "off", "brief" (two a day in Today) or "all" (also every few papers elsewhere)
  pictures: true,       // open-access figures on cards
  meetings: {},         // meeting id → false to hide its banner and chip (true to show one that's off by default)
  taste: {},            // what you said about a feature (sys:liver, jr:Radiology, fl:ai…): -2 hide, -1 less, 1 more
  learned: {},          // what 👍, 👎, Not for me, and what you open and save taught, a little at a time (−1.5 … 1.5)
  learnedAt: "",        // the day learned leanings last faded (they halve over about four months)
  learnImplicit: true,  // learn a little from what you open, save and listen to (never from what you skip)
  learnRate: 1,         // how much: 1 a little, 2 twice that
  fade: 120,            // learned leanings halve over this many days (30, 120 or 365); 0: they don't fade
  reacts: {},           // card → 1 (more like this) or -1 (less like this)
  v: 2,
};
// stored settings are checked field by field, so an old or damaged copy can't break the app
function loadTune() {
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
  const t = obj(store.get("tune", {}));
  const mix = {};
  for (const [k, v] of Object.entries({ ...TUNE_DEFAULTS.mix, ...obj(t.mix) })) if (k in TUNE_DEFAULTS.mix) mix[k] = Math.max(0, Math.min(6, Math.round(num(v, 1))));
  const ints = (v, lo, hi) => Object.fromEntries(Object.entries(obj(v)).filter(([k, x]) => typeof k === "string" && k.length <= 120 && Number.isInteger(x) && x >= lo && x <= hi).slice(0, 300));
  const within = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const areas = {};
  for (const [k, v] of Object.entries({ ...TUNE_DEFAULTS.areas, ...obj(t.areas) })) areas[k] = Math.max(0, Math.min(3, Math.round(num(v, 2))));
  const rank = {};
  for (const [k, v] of Object.entries(TUNE_DEFAULTS.rank)) rank[k] = Math.max(0, num(obj(t.rank)[k], v));
  if (!rank.fresh) rank.fresh = TUNE_DEFAULTS.rank.fresh;      // a half-life must be > 0
  const trend = Object.fromEntries(Object.entries(obj(t.trend))
    .filter(([k, v]) => ["breakout", "rising", "cooling", "minScale"].includes(k) && typeof v === "number" && isFinite(v)));
  const weights = (v, ok) => Object.fromEntries(Object.entries(obj(v))
    .filter(([k, x]) => typeof k === "string" && k.length <= 160 && typeof x === "number" && ok(x)).slice(-800));
  const b = obj(t.brief);
  const hz = obj(t.horizon), hzk = obj(hz.kinds);
  const startOn = ["today", "all", "papers", "important"].includes(t.startOn) ? t.startOn : "today";
  return {
    mix, rank, areas, follow: strs(t.follow), hiddenSystems: strs(t.hiddenSystems),
    cap: Math.max(0, Math.round(num(t.cap, TUNE_DEFAULTS.cap))),
    topCard: typeof t.topCard === "boolean" ? t.topCard : TUNE_DEFAULTS.topCard,
    topPer: [0, 2, 3, 5].includes(t.topPer) ? t.topPer : 0,
    topAgain: [12, 36, 72].includes(t.topAgain) ? t.topAgain : 36,
    allBylines: t.allBylines === true,
    why: t.why !== false,
    citeAlerts: t.citeAlerts !== false,
    muteIn: t.muteIn === "title" ? "title" : "text",
    order: t.order === "ranked" ? "ranked" : "newest",
    fav: strs(t.fav), hidePending: typeof t.hidePending === "boolean" ? t.hidePending : TUNE_DEFAULTS.hidePending,
    readLast: t.readLast !== false,
    weather: t.weather !== false,
    swipe: t.swipe !== false,
    cardLayout: t.cardLayout === "paged" ? "paged" : "compact",
    obits: ["wide", "all", "none"].includes(t.obits) ? t.obits : "wide",
    radar: { level: ["early", "confirmed", "mainstream"].includes(t.radar?.level) ? t.radar.level : "early",
      hidden: strs(t.radar?.hidden).slice(0, 200), hiddenSpots: strs(t.radar?.hiddenSpots).slice(-200),
      heat: typeof t.radar?.heat === "number" && t.radar.heat >= 1.25 && t.radar.heat <= 5 ? Math.round(t.radar.heat * 4) / 4 : 2 },
    watch: { kinds: Object.fromEntries(["trial", "device", "drug", "rule"].map((k) => [k, obj(obj(t.watch).kinds)[k] !== false])),
      aiOnly: obj(t.watch).aiOnly === true, dates: obj(t.watch).dates !== false,
      follow: [...new Set(strs(obj(t.watch).follow).filter((s) => /^NCT\d{8}$/.test(s)))].slice(-100), hidden: strs(obj(t.watch).hidden).slice(0, 100),
      mute: [...new Set(strs(obj(t.watch).mute).map((s) => s.trim()).filter((s) => s && s.length <= 60))].slice(0, 200) },
    alerts: Object.fromEntries(Object.keys(ALERT_GROUPS).map((k) => [k, (t.alerts || {})[k] !== false])),
    horizon: { kinds: Object.fromEntries(Object.keys(HZ_KINDS).map((k) => [k, hzk[k] !== false])), range: within(hz.range, 14, 366, 90),
      watch: Array.isArray(hz.watch) ? [...new Set(strs(hz.watch).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s)))].slice(0, 60)
        : WATCH_DEFAULT.slice() },
    mutedSources: strs(t.mutedSources), mutedWords: strs(t.mutedWords),
    rules: Array.isArray(t.rules) ? t.rules.map(cleanRule).filter(Boolean).slice(0, 30) : RULE_DEFAULTS.map((r) => ({ ...r })),
    trend: Object.keys(trend).length ? trend : null,
    impReviews: t.impReviews === true,
    textSize: TEXT_SIZES.includes(t.textSize) ? t.textSize : 1,
    library: typeof t.library === "string" && /^https?:\/\/\S{4,300}$/i.test(t.library.trim()) ? t.library.trim() : "",
    // Today came in with v2: a phone that opened on Everything only because that was the default now opens on Today
    startOn: t.v !== 2 && startOn === "all" ? "today" : startOn,
    brief: { papers: within(b.papers, 1, 12, 5), stories: within(b.stories, 0, 8, 2), watchRows: within(b.watchRows, 1, 12, 4), local: within(b.local, 0, 8, 3),
      // your order of Today's parts; a part that no longer exists (Something lighter) just leaves it
      order: (() => { const o = Array.isArray(b.order) ? [...new Set(b.order.filter((x) => typeof x === "string" && BRIEF_PARTS[x]))] : []; return o.length ? o : null; })(),
      classic: b.classic !== false, foundations: b.foundations !== false, horizon: b.horizon !== false, radar: b.radar !== false, watch: b.watch !== false,
      week: [-1, 0, 1, 5, 6].includes(b.week) ? b.week : 6,
      wide: b.wide !== false, hzDays: within(b.hzDays, 1, 30, 7) },
    local: { scope: ["reno", "nevada", "all"].includes(obj(t.local).scope) ? t.local.scope : "nevada" },
    near: (() => { const n = obj(t.near), mag = num(n.mag, 3);
      return { quakes: n.quakes !== false, fires: n.fires !== false, mi: within(n.mi, 10, 300, 100), days: within(n.days, 1, 7, 2),
        mag: mag >= 2.5 && mag <= 7 ? Math.round(mag * 2) / 2 : 3, acres: within(n.acres, 0, 100000, 10), rx: n.rx === true, contained: n.contained === true,
        alerts: n.alerts !== false, roads: n.roads !== false, air: n.air !== false, aqi: [51, 101, 151].includes(n.aqi) ? n.aqi : 101 }; })(),
    alertDays: within(t.alertDays, 1, 14, 7), alertMax: within(t.alertMax, 0, 6, 2), alertTwo: t.alertTwo === true,
    maxAge: ints(t.maxAge, 1, 365), capBy: ints(t.capBy, 0, 20),
    guess: ["off", "brief", "all"].includes(t.guess) ? t.guess : "brief",
    pictures: t.pictures !== false,
    meetings: Object.fromEntries(Object.entries(obj(t.meetings)).filter(([, v]) => typeof v === "boolean")),
    taste: weights(t.taste, (x) => [-2, -1, 0, 1].includes(x)),
    learned: weights(t.learned, (x) => isFinite(x) && Math.abs(x) <= 1.5 && x !== 0),
    reacts: weights(t.reacts, (x) => x === 1 || x === -1),
    learnedAt: /^\d{4}-\d{2}-\d{2}$/.test(t.learnedAt || "") ? t.learnedAt : "",
    learnImplicit: t.learnImplicit !== false,
    learnRate: t.learnRate === 2 ? 2 : 1,
    fade: [0, 30, 120, 365].includes(t.fade) ? t.fade : 120,
    v: 2,
  };
}
let T = loadTune();
function setTune(patch) {
  T = { ...T, ...patch };
  store.set("tune", T);
  S.feedDirty = true;
  S.lastKey = null;          // new rules: start the feed from the top
  S.exploreKey = null;
  if (typeof choicesChanged === "function") choicesChanged();     // notifications follow the alert choices (push.js)
}

// ── reading metrics, counted on this phone ─────────────────────────────────
const STAT_IDX = { seen: 0, open: 1, save: 2, listen: 3, clear: 4 };
let stats = store.get("stats", null);
if (!stats || typeof stats.days !== "object" || !stats.days || Array.isArray(stats.days)) stats = { days: {} };
let seenToday = store.get("seenToday", null);
if (!seenToday || typeof seenToday !== "object") seenToday = { d: "" };      // what was counted today, so nothing counts twice
const localDay = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
const daysAgo = (i) => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate() - i); };
const itemKind = (it) => (it.pmid ? "paper" : (it.kind || "industry"));
let statsTimer;
let seenRecent = store.get("seenRecent", null);
if (!seenRecent || typeof seenRecent !== "object" || Array.isArray(seenRecent)) seenRecent = {};   // card → the day it was read
const SPECIAL = new Set(["top", "brief-cover", "brief-stories", "brief-end", "fd-next", "brief-horizon", "brief-radar", "brief-watch", "brief-week", "brief-cites", "brief-local", "brief-near", "alert"]);
function bump(type, it) {
  if (!it || SPECIAL.has(it.type)) return;
  const d = localDay();
  if (seenToday.d !== d || !Array.isArray(seenToday.seen)) seenToday = { d, seen: [], open: [], save: [], listen: [], clear: [] };
  const key = saveKey(it);
  const done = (seenToday[type] ||= []);
  if (done.includes(key)) return;
  if (type !== "seen") bump("seen", it);        // opening, saving or listening means you saw it
  done.push(key);
  if (type === "open" || type === "save" || type === "listen") learnFrom(it, type);   // learn.js: a small nudge toward cards like it
  if (type === "seen") seenRecent[key] = d;
  const day = stats.days[d] || (stats.days[d] = { k: {}, s: {}, y: {} });
  const i = STAT_IDX[type];
  const inc = (obj, key) => { const a = obj[key] || (obj[key] = [0, 0, 0, 0, 0]); a[i] = (a[i] || 0) + 1; };
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
  const cut2 = localDay(daysAgo(45));
  for (const [k, d] of Object.entries(seenRecent)) if (d < cut2) delete seenRecent[k];
  store.set("seenRecent", seenRecent);
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
        const t = out[grp][key] || (out[grp][key] = [0, 0, 0, 0, 0]);
        v.forEach((n, j) => { t[j] = (t[j] || 0) + (n || 0); });
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

const MIX_ORDER = ["paper", "industry", "societies", "science", "health", "general", "local", "business", "sff"];   // ties go in this order

// Everything takes turns: a kind with weight w gets w turns per round, spread evenly.
// Card j of a kind sits in round r = ⌊j / w⌋ at r + (j mod w + phase) / w, so a kind's turns in a
// round stay apart. With a seed, the kinds' places change from round to round (the same all day,
// new tomorrow), so the feed doesn't repeat one pattern; without one, the order is fixed.
function interleave(queues, weights, seed = null) {
  const keys = MIX_ORDER.concat(Object.keys(queues).filter((k) => !MIX_ORDER.includes(k)))
    .filter((k) => queues[k]?.length && (weights[k] ?? 1) > 0);
  const n = keys.length, perms = new Map();
  const phase = (i, r) => {
    if (seed == null) return (i + 0.5) / n;
    if (!perms.has(r)) {
      const o = seededOrder(n, `${seed}|${r}`);
      if (r === 0) { const z = o.indexOf(0); [o[0], o[z]] = [o[z], o[0]]; }    // the first round opens with the first kind (papers)
      perms.set(r, o);
    }
    return (perms.get(r)[i] + 0.5) / n;
  };
  const slots = [];
  keys.forEach((k, i) => {
    const w = Math.max(1, Math.round(weights[k] ?? 1));
    queues[k].forEach((it, j) => { const r = Math.floor(j / w); slots.push([r + ((j % w) + phase(i, r)) / w, i, it]); });
  });
  slots.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return slots.map((x) => x[2]);
}
// 0…n−1 in an order fixed by the seed
function seededOrder(n, seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    const j = ((h ^ (h >>> 16)) >>> 0) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// variety without losing the order much: take the first of the next few that doesn't clash with
// what came just before (the same outlet, journal or organ system)
function spreadOut(list, clash, look = 6) {
  const pool = list.slice(), out = [];
  while (pool.length) {
    let k = 0;
    for (let i = 0; i < Math.min(look, pool.length); i++) if (!clash(pool[i], out)) { k = i; break; }
    out.push(pool.splice(k, 1)[0]);
  }
  return out;
}
const paperClash = (p, out) => {
  const last = out.slice(-2);
  return last.some((o) => o.journal && o.journal === p.journal) || (!!out.length && (out[out.length - 1].systems || [])[0] === (p.systems || [])[0] && !!(p.systems || [])[0]);
};
const outletClash = (memory) => (n, out) => out.slice(-memory).some((o) => o.source === n.source);
// two neighbors alike (two papers, two of one news kind, one outlet twice): pull a different card
// from just ahead between them
function unclump(list, alike, look = 5) {
  const out = list.slice();
  for (let i = 1; i < out.length; i++) {
    if (!alike(out[i - 1], out[i])) continue;
    for (let j = i + 1; j < Math.min(out.length, i + 1 + look); j++) {
      if (!alike(out[i - 1], out[j]) && !alike(out[j], out[i])) { out.splice(i, 0, out.splice(j, 1)[0]); break; }
    }
  }
  return out;
}
const feedAlike = (a, b) => (a.type === "paper" && b.type === "paper")
  || (a.type === "news" && b.type === "news" && (a.kind === b.kind || a.source === b.source));

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
// whole words or phrases, plurals included (AI doesn't catch "air"; nodule catches "nodules");
// end one with * for any ending (radiolog* catches radiology and radiologist)
function wordRe(words) {
  const one = (x) => {
    const star = x.endsWith("*");
    const core = (star ? x.slice(0, -1) : x).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !core ? null : star ? core : `${core}(?:e?s)?(?![\\p{L}\\p{N}])`;
  };
  const w = (words || []).map((x) => one(String(x).trim())).filter(Boolean);
  return w.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${w.join("|")})`, "iu") : null;
}
function followRe() { return wordRe(T.follow); }
const followHit = (it, re = followRe()) => !!re && re.test(`${it.title} ${it.conclusion?.text || it.summary || ""}`);
function followingList(mute) {
  const re = followRe();
  if (!re) return [];
  const seen = new Set();
  const papers = (S.feed?.items || []).concat(Object.values(S.important?.papers || {}))
    .filter((p) => !seen.has(p.pmid) && seen.add(p.pmid) && followHit(p, re) && homeArea(p) && !hiddenByTaste(p))
    .map((p) => ({ ...p, type: "paper", _when: (p.epub || p.added || "") }));
  const news = (S.news?.items || []).filter((n) => followHit(n, re) && !(T.mutedSources || []).includes(n.source) && !hiddenByTaste({ ...n, type: "news" }))
    .map((n) => ({ ...n, type: "news", kind: kindOf(n), _when: (n.date || "").slice(0, 10) }));
  return papers.concat(news).filter((i) => !mutedHit(i, mute)).sort((a, b) => (a._when < b._when ? 1 : -1));
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
    const mine = areasOf(p);              // label only with an area the paper is actually in
    const area = areaPick() && pc[areaPick()] != null ? areaPick()
      : Object.keys(pc).filter((a) => (T.areas[a] ?? 2) > 0 && mine.includes(a)).sort((x, y) => pc[y] - pc[x])[0];
    if (area) p.impact = { ...p.impact, pct: pc[area], area };
  });
  if (system !== "all") list = list.filter((i) => (i.systems || []).includes(system));
  if (strong) list = list.filter((i) => (i.design?.strength || 0) >= 3);
  if (mute) list = list.filter((i) => !mutedHit(i, mute));
  return list.filter((i) => !hiddenByTaste(i));
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

// what hides cards everywhere: muted words, and topic filters (filters.js); null when there are none
function mutedRe() { const w = wordRe(T.mutedWords), r = compiledRules(); return w || r.length ? { w, r } : null; }
// the text a card shows under its headline: a paper's conclusion, a story's summary
const shownText = (it) => it?.conclusion?.text || it?.summary || "";
// a muted word in the headline, or (Tune → Rules → Mute, the default) in the text on the card too
const wordHit = (it, re) => re.test(T.muteIn === "title" ? it.title || "" : `${it.title || ""} ${shownText(it)}`);
// m: what mutedRe() returns, or one word's regex
const mutedHit = (it, m = mutedRe()) => !!m && !!it
  && (m instanceof RegExp ? wordHit(it, m) : (!!m.w && wordHit(it, m.w)) || (m.r.length > 0 && !!ruleHit(it, m.r)));

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
  return list.map((p) => [paperScore(p, now).score * Math.pow(1.5, p._t || 0), p]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
}

// Names as people write them: outlets and sections in their usual short forms (NYT, Health & Med)
// wherever the app writes them; Tune's settings keep the full names where they're edited
const SRC_SHORT = { "New York Times": "NYT", "New York Times Business": "NYT Business", "New York Times Health": "NYT Health",
  "New York Times Science": "NYT Science", "Wall Street Journal": "WSJ", "BBC News": "BBC", "NPR News": "NPR",
  "Nevada Public Radio": "KNPR", "High Country News": "HCN", "Scientific American": "SciAm", "Imaging Technology News": "ITN",
  "Medical Xpress Radiology": "Medical Xpress", "MedPage Today": "MedPage", "Planet Money and The Indicator": "Planet Money",
  "Quanta Magazine": "Quanta", "Science Friday": "SciFri", "The Imaging Wire": "Imaging Wire", "Renown Health": "Renown",
  "FDA press releases": "FDA", "FDA safety alerts": "FDA safety", "NIH News": "NIH" };
const srcName = (s) => SRC_SHORT[s] || String(s || "").replace(/ \(via ([^)]+)\)$/, " via $1");
const KIND_SHORT = { industry: "Industry", health: "Health & Med", general: "U.S. & World", local: "Reno & NV", business: "Business", sff: "Sci-fi" };
const CAT_SHORT = { policy: "Policy", ai_industry: "AI", deals: "Deals", regulatory: "FDA", technology: "Tech", nv_gov: "Gov & Politics",
  nv_health: "Health", nv_housing: "Housing", nv_env: "Environment", nv_schools: "Schools", nv_economy: "Economy",
  nv_safety: "Courts & Safety", nv_culture: "Arts", nv_opinion: "Opinion" };
const catLabel = (c) => (S.news?.categories?.[c] ? CAT_SHORT[c] || S.news.categories[c] : "");
let kindsMemo = [null, {}];
function newsKinds() {
  const k = S.news?.kinds || (S.news ? { industry: "Industry news", science: "Science & health" } : null);
  if (!k) return {};
  if (kindsMemo[0] !== k) kindsMemo = [k, Object.fromEntries(Object.entries(k).map(([key, label]) => [key, KIND_SHORT[key] || label]))];
  return kindsMemo[1];
}
const kindOf = (n) => n.kind || "industry";

// Today and the meeting chips are fixed lists: a filter (organ system, topic, strong evidence) means Everything
const leaveFixed = () => { if (S.kind === "today" || String(S.kind).startsWith("meeting:")) S.kind = "all"; };
function renderChips() {
  const box = $("#chips");
  box.replaceChildren();
  if (!S.feed && !S.news) return;
  if (S.topic) {
    box.append(el("button", { class: "chip chip-topic", "aria-pressed": "true", onclick: () => { S.topic = null; refreshFeed(); } },
      `${topicName(S.topic)}  ✕`));
  }
  const kindChip = ([k, label]) => el("button", { class: "chip" + (k === "important" ? " chip-imp" : ""), "aria-pressed": String(S.kind === k && !S.topic),
    onclick: () => { S.kind = k; S.topic = null; if (!["papers", "all", "important"].includes(k)) S.strong = false; if (k === "today") S.system = "all"; refreshFeed(); } }, label);
  const sep = () => el("span", { class: "chip-sep", "aria-hidden": "true" });
  // papers first, with their sub-filters right beside them; then news
  box.append(...[["today", "Today"], ["all", "Everything"], ["papers", "Papers"], ...(S.important ? [["important", "Most important"]] : []),
    ...(followRe() ? [["following", "Following"]] : [])].map(kindChip));
  const mc = meetingChips();
  if (mc.length) box.append(sep(), ...mc.map((m) => kindChip([`meeting:${m.id}`, m.name])));
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
      onclick: () => { S.system = S.system === k ? "all" : k; leaveFixed(); refreshFeed(); } }, label));
  }
}

const dayOf = (it) => (it.type === "news" ? it.date : it.added || it.epub || "").slice(0, 10);

// Death notices (the news job marks them, with how many publishers ran each): by default only
// those at least OBIT_MIN news organizations reported, or about someone who held high office.
// Industry and society news keep theirs: a radiologist's obituary there is the field's news.
const OBIT_MIN = 3;
const obitHidden = (it) => {
  if (!it?.obit || T.obits === "all") return false;
  const k = kindOf(it);
  if (k === "industry" || k === "societies") return false;
  return T.obits === "none" || !(it.obit.hi || (it.obit.n || 1) >= OBIT_MIN);
};

// The feed for the current chips. `f` overrides the chips; `report` (optional) counts what was left out.
// cards you swiped away (key → day), kept 90 days; Tune → Rules can bring them back.
// A card put off with "Not now" is stored as "z:" + the day it comes back.
let cleared = store.get("cleared", null);
if (!cleared || typeof cleared !== "object" || Array.isArray(cleared)) cleared = {};
const isCleared = (key) => { const v = cleared[key]; return !!v && (!v.startsWith("z:") || v.slice(2) > localDay()); };
function setCleared(key, on, until = null) {
  if (on) cleared[key] = until ? `z:${until}` : localDay(); else delete cleared[key];
  const cut = localDay(daysAgo(90)), today = localDay();
  for (const [k, d] of Object.entries(cleared)) {
    if (typeof d !== "string" || (d.startsWith("z:") ? d.slice(2) <= today : d < cut)) delete cleared[k];
  }
  store.set("cleared", cleared);
}
const clearedCount = () => Object.keys(cleared).filter(isCleared).length;
// why you cleared cards: a tally for Tune. Only "Not for me" teaches the feed (like Less in Rate).
const WHY = {
  know: ["Already know it", "Nothing changes in what you see."],
  notme: ["Not for me", "Fewer cards like this, the same as Less like this in Rate."],
  weak: ["Weak study", "Counted in Tune; the topic isn’t marked down."],
  later: ["Not now", "It comes back in 3 days."],
};
let whyTally = store.get("whyTally", null);
if (!whyTally || typeof whyTally !== "object" || Array.isArray(whyTally)) whyTally = {};
function tallyWhy(why, d) {
  whyTally[why] = Math.max(0, (whyTally[why] || 0) + d);
  if (!whyTally[why]) delete whyTally[why];
  store.set("whyTally", whyTally);
}
// cards you've seen go to the end. Which cards count as seen is fixed when a list is started fresh
// (opening the app, a chip, refresh), so nothing moves while you're reading.
const isRead = (it) => !!(T.readLast && S.readSet && it && it.type !== "top" && !SPECIAL.has(it.type) && S.readSet.has(listKey(it)));
function filtered(f = {}, report = null) {
  const list = buildList(f, report).filter((it) => it.type === "top" || SPECIAL.has(it.type) || !isCleared(listKey(it)));
  if (!T.readLast || (f.kind ?? S.kind) === "today" || !S.readSet?.size) return list;
  const fresh = [], read = [];
  for (const it of list) (isRead(it) ? read : fresh).push(it);
  if (report && read.length) report.readLast = read.length;
  return read.length ? fresh.concat(read) : list;
}
function buildList(f = {}, report = null) {
  const kind = f.kind ?? S.kind, system = f.system ?? S.system, strong = f.strong ?? S.strong, topic = f.topic ?? S.topic;
  const R = report || {};
  const drop = (why, n = 1) => { R[why] = (R[why] || 0) + n; };
  const mute = mutedRe();
  const mutedSrc = new Set(T.mutedSources || []);
  if (kind === "important") return importantList(system, strong, mute);
  if (kind === "following") return followingList(mute);
  if (kind === "today") return briefList();
  if (String(kind).startsWith("meeting:")) return meetingList(kind.slice(8), mute);
  const taste = hasTaste();
  // papers
  let papers = (S.feed?.items || []).map((i) => ({ ...i, type: "paper" }));
  if (T.hidePending) papers = papers.filter((i) => (i.conclusion?.kind || "none") !== "none" || (drop("pending"), false));
  if (mute) papers = papers.filter((i) => !mutedHit(i, mute) || (drop("muted"), false));
  if (taste) papers = papers.filter((i) => (i._t = tasteOf(i)) > -Infinity || (drop("taste"), false));
  if (system !== "all") papers = papers.filter((i) => (i.systems || []).includes(system));
  if (strong) papers = papers.filter((i) => (i.design?.strength || 0) >= 3);
  if (topic) papers = papers.filter((i) => (i.topics || []).includes(topic));
  const onlyArea = kind === "papers" ? areaPick() : null;
  papers = papers.filter((i) => homeArea(i, onlyArea) || (!onlyArea && drop("areaOff"), false));
  if (T.order === "ranked") papers = rankPapers(papers);
  else if (taste) papers = byTaste(papers, (p) => Date.parse(p.added || p.epub || "") || 0, 864e5);   // more like this: up to a few days higher
  // take turns between areas by the weights you set (Tune → Interests)
  const byArea = {};
  for (const p of papers) { const a = homeArea(p, onlyArea); (byArea[a] = byArea[a] || []).push(p); }
  for (const a of Object.keys(byArea)) byArea[a] = spreadOut(byArea[a], paperClash);    // journals and organ systems take turns
  papers = Object.keys(byArea).length > 1 ? interleave(byArea, T.areas) : papers.length ? byArea[Object.keys(byArea)[0]] : papers;
  if (T.guess === "all") {                  // guess the result here too: about one paper in six, spaced out
    let gap = 3;
    for (const p of papers) if (--gap <= 0 && guessable(p)) { p._guess = true; gap = 6; }
  }
  if (topic || strong || kind === "papers") return papers;
  // news
  let news = (S.news?.items || []).map((i) => ({ ...i, type: "news", kind: kindOf(i) }));
  news = news.filter((i) => (!mutedSrc.has(i.source) && !mutedHit(i, mute)) || (drop("muted"), false));
  news = news.filter((i) => !obitHidden(i) || (drop("obits"), false));
  news = news.filter((i) => !tooOld(i) || (drop("old"), false));
  if (typeof localInScope === "function") news = news.filter((i) => localInScope(i) || (drop("far"), false));   // Reno & Nevada: the area you chose
  if (taste) news = byTaste(news.filter((i) => (i._t = tasteOf(i)) > -Infinity || (drop("taste"), false)),
    (n) => Date.parse(n.date) || 0, 6 * 36e5);                       // an outlet you like: its stories a few hours higher
  if (system !== "all") news = news.filter((i) => (i.systems || []).includes(system));
  const only = kind === "all" ? null : kind;
  const tops = T.topCard && system === "all" && topStoryLists(only).length ? [{ type: "top", key: "top", only }] : [];
  const sameTitle = new Set();               // one press release (or wire story) under two names: one card
  const once = (i) => { const k = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); if (sameTitle.has(k)) { drop("dupes"); return false; } sameTitle.add(k); return true; };
  if (kind !== "all") return tops.concat(spreadOut(news.filter((i) => (i.kind === kind || (i.also || []).includes(kind)) && once(i)), outletClash(1)));
  // Everything: take turns by weight, each stream newest first (or ranked, for papers), so the
  // newest papers sit at the top even though news arrives hours sooner than PubMed records
  const perSource = new Map();
  const outletCap = new Map((S.news?.sources || []).filter((s) => Number.isInteger(s.feed_cap)).map((s) => [s.name, s.feed_cap]));
  const byTime = taste ? () => 0 : (a, b) => (a.date < b.date ? 1 : -1);      // already in order, rated outlets shifted
  const queues = { paper: papers };
  for (const n of news.sort(byTime)) {
    const own = T.capBy[n.source];                  // your own number for this outlet (Tune → Rules → Feed mix → Advanced)
    if (own != null || (T.cap && n.kind !== "industry")) {   // busy outlets: a few a day in Everything (more or fewer for outlets you rated)
      const k = `${dayOf(n)}|${n.source}`;
      const c = perSource.get(k) || 0;
      perSource.set(k, c + 1);
      if (c >= (own != null ? own : outletLimit(n.source, outletCap))) { drop("capped"); continue; }
    }
    (queues[n.kind] = queues[n.kind] || []).push(n);
  }
  for (const [k, q] of Object.entries(queues)) {
    if (q.length && (T.mix[k] ?? 1) <= 0) drop("off", q.length);
    else if (k !== "paper") queues[k] = spreadOut(q, outletClash(2));       // a kind's outlets take turns
  }
  // the same headline from two outlets (a society story an industry site also ran): show it once
  const said = new Set();
  const mixed = unclump(interleave(queues, T.mix, localDay()), feedAlike).filter((i) => {
    if (i.type !== "news") return true;
    const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (said.has(key)) { drop("dupes"); return false; }
    said.add(key);
    return true;
  });
  const classic = system === "all" && T.brief.classic ? classicToday() : null;   // today's classic, a few cards in
  if (classic) mixed.splice(Math.min(2, mixed.length), 0, classic);
  return (system === "all" ? alertCards() : []).concat(tops, mixed);
}

// an outlet's own setting moves it up or down from your limit (NYT Health +1, BBC Health −1 at the default 2), and so does Rate
function outletLimit(name, caps = new Map((S.news?.sources || []).filter((s) => Number.isInteger(s.feed_cap)).map((s) => [s.name, s.feed_cap]))) {
  const shift = caps.has(name) ? caps.get(name) - 2 : 0;
  return Math.max(1, T.cap + shift + Math.round(tasteW(`src:${name}`)));
}
const tooOld = (i) => !!T.maxAge[i.kind] && Date.now() - (Date.parse(i.date) || Date.now()) > T.maxAge[i.kind] * 864e5;

let feedObserver, seenObserver;
const listKey = (it) => (it.type === "top" ? `top:${it.only || ""}` : it.key && SPECIAL.has(it.type) ? it.key : saveKey(it));
// Phones show cards compact (as tall as what they hold) unless you chose one per screen; iPads and
// computers always do, in as many columns as fit.
const WIDE = matchMedia("(min-width: 700px)");
const isFlow = () => T.cardLayout !== "paged" || WIDE.matches;
function applyLayout() {
  const v = $("#view-feed");
  v.classList.toggle("flow", isFlow());
  v.classList.toggle("grid", WIDE.matches);
}
const feedCards = () => [...$("#view-feed").children].filter((n) => n._it);
// the card at the top of the screen: of those still showing, the one that starts highest (in columns too)
function currentIdx() {
  const v = $("#view-feed");
  if (!v.clientHeight) return 0;
  const y = v.scrollTop + 8;
  const cards = feedCards();
  let best = -1;
  cards.forEach((c, i) => { if (c.offsetTop + c.offsetHeight > y && (best < 0 || c.offsetTop < cards[best].offsetTop)) best = i; });
  return best < 0 ? Math.max(0, cards.length - 1) : best;
}
function currentKey(evenAtTop = false) {
  const v = $("#view-feed");
  if (!v.clientHeight) return null;
  const i = currentIdx(), it = S.list[i], c = feedCards()[i];
  if (!it || !(v.scrollTop > 0 || evenAtTop)) return null;
  S.keepAt = { key: listKey(it), delta: c ? v.scrollTop - c.offsetTop : 0 };      // how far into it you'd scrolled
  return S.keepAt.key;
}
// columns: each card spans as many 2px rows as it is tall, so short cards don't leave gaps (masonry)
const GRID_ROW = 2, GRID_GAP = 12;
function gridSpan(n) {
  if (!n.parentElement?.classList.contains("grid")) { n.style.gridRowEnd = ""; return; }
  const h = n.offsetHeight;
  if (h) n.style.gridRowEnd = `span ${Math.ceil((h + GRID_GAP) / GRID_ROW)}`;
}
const gridRO = typeof ResizeObserver === "function" ? new ResizeObserver((es) => es.forEach((e) => gridSpan(e.target))) : null;
// what a rendered card shows: the top-stories card changes with its stories
const shownSig = (it) => (it.type === "top" ? `top:${JSON.stringify(topStoryLists(it.only).map(([, l]) => l.map((s) => s.title)))}`
  : SPECIAL.has(it.type) ? `${it.key}:${it.sig || ""}` : `${listKey(it)}${it._guess ? ":g" : ""}${it.fig ? ":f" : ""}`);
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
function refreshFeed(keepKey, keepIdx) {
  S.feedDirty = false;
  if (keepKey == null && keepIdx == null) { S.readSet = new Set(Object.keys(seenRecent)); S.topFresh = Date.now(); }   // a fresh start: what you've seen goes last
  S.shownDay = localDay();
  const meeting = String(S.kind).startsWith("meeting:");
  if ((S.kind === "following" && !followRe()) || (meeting && !meetingChips().some((m) => `meeting:${m.id}` === S.kind))
      || (!meeting && !["all", "papers", "important", "following", "today"].includes(S.kind) && S.news && !newsKinds()[S.kind])) S.kind = "all";
  if (S.area && S.area !== "all" && (T.areas[S.area] ?? 2) <= 0) S.area = "all";
  renderChips();
  const view = $("#view-feed");
  applyLayout();
  gridRO?.disconnect();
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
  if (!S.list.length && meeting) {
    const m = (S.news?.meetings || []).find((x) => `meeting:${x.id}` === S.kind);
    view.append(el("section", { class: "empty" },
      el("h2", { text: `No ${m?.name || "meeting"} stories yet` }),
      el("p", { text: "Stories that mention the meeting gather here. Outlets usually start a day or two before it opens." }),
      el("button", { class: "btn", onclick: () => openMeeting(m) }, "About the meeting")));
    return;
  }
  if (!S.list.length) {
    view.append(el("section", { class: "empty" },
      el("h2", { text: "Nothing matches these filters" }),
      el("p", { text: "Try another organ system, or turn off Strong evidence." }),
      el("button", { class: "btn", onclick: () => { S.system = "all"; S.strong = false; S.topic = null; S.kind = "all"; refreshFeed(); } }, "Show everything")));
    return;
  }
  const sentinel = el("div", { class: "sentinel", "aria-hidden": "true" });
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
  let at = keepKey ? S.list.findIndex((it) => listKey(it) === keepKey) : -1;
  if (at < 0 && keepIdx > 0) at = Math.min(keepIdx, S.list.length - 1);      // that card left (you hid it): stay where you were
  if (at > 0 && at < 200) {
    while (S.rendered <= at + 1 && S.rendered < S.list.length) appendCards(10);
    const c = feedCards()[at];
    const d = S.keepAt?.key === keepKey && c ? Math.max(-24, Math.min(S.keepAt.delta, c.offsetHeight - 40)) : 0;
    view.scrollTop = c ? c.offsetTop + d : at * view.clientHeight;
  }
}

function appendCards(n) {
  const view = $("#view-feed");
  const sentinel = view.lastElementChild;
  const batch = S.list.slice(S.rendered, S.rendered + n);
  const made = batch.map((it) => { const c = cardEl(it); c._it = it; return c; });
  made.forEach((c) => { view.insertBefore(c, sentinel); seenObserver?.observe(c); gridRO?.observe(c); });
  S.rendered += batch.length;
  // compact cards are fitted (and, in columns, given their height) at once, so positions are right straight away
  if (isFlow()) made.forEach((c) => { fitCard(c); gridSpan(c); });
  else requestAnimationFrame(() => made.forEach(fitCard));
  if (S.rendered >= S.list.length && S.kind === "today") feedObserver?.disconnect();      // Today ends on its own card
  else if (S.rendered >= S.list.length && !view.querySelector(".feed-end")) {
    feedObserver?.disconnect();
    const last = S.list.length ? dayOf(S.list[S.list.length - 1]) : "";
    const end = el("section", { class: "feed-end" },
      el("h2", { text: "You’re at the end" }),
      el("p", { text: `${plural(S.list.length, "card")} here, back to ${fmtDate(last)}. Papers arrive every morning and news every few hours.` }),
      el("button", { class: "btn", onclick: () => { view.scrollTo({ top: 0 }); } }, "Back to newest"));
    view.insertBefore(end, sentinel);
    gridRO?.observe(end);
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
  const c = cardBody(it);
  if (it.type !== "top" && !SPECIAL.has(it.type)) c.append(clearBtn(it));
  return c;
}
function cardBody(it) {
  if (it.type === "news") return newsCardEl(it);
  if (it.type === "top") return topCardEl(it.only);
  if (SPECIAL.has(it.type)) return briefCardEl(it);
  if (it._guess) return guessCardEl(it);
  return paperCardEl(it);
}

const saveKey = (it) => it.pmid || `n:${it.id}`;

// a story's picture, straight from the outlet (only https, shown as an image and nothing else)
const imgUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]{4,600}$/.test(u) ? u : null);
function newsImgEl(it) {
  if (!T.pictures || !imgUrl(it.img)) return null;
  const box = el("div", { class: "fig news-img", "aria-hidden": "true" });
  const img = el("img", { src: imgUrl(it.img), alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => { const card = box.closest(".card"); box.remove(); if (card) fitCard(card); }, { once: true });
  box.append(img);
  return box;
}
const bylineText = (names) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] || "");
// writers' names: only where an outlet's license or terms ask that they be credited (credit, from
// the news job), unless you turn on every byline in Tune → Reading
let creditMemo = [null, new Set()];
const creditOutlets = () => (creditMemo[0] === S.news ? creditMemo[1]
  : (creditMemo = [S.news, new Set((S.news?.sources || []).filter((s) => s.credit).map((s) => s.name))])[1]);
const bylineShown = (it) => Array.isArray(it.by) && it.by.some((x) => typeof x === "string" && x) && (T.allBylines || creditOutlets().has(it.source));
function bylineEl(it) {
  return bylineShown(it) ? el("span", { class: "by-in" }, `by ${bylineText(it.by.filter((x) => typeof x === "string" && x))}`) : null;
}
// a card's picture beside its headline, a quarter of the card wide
const headRow = (pic, head) => (pic ? el("div", { class: "headrow" }, pic, el("div", { class: "headtext" }, head)) : head);
function newsCardEl(it) {
  const isNew = S.newsNew.has(it.id);
  const cats = (it.categories || []).map(catLabel).filter(Boolean);
  const saved = !!S.saved[saveKey(it)];
  const saveBtn = el("button", { class: "act save-btn", "aria-pressed": String(saved), onclick: () => toggleSave(it, saveBtn) },
    icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save");
  // one line above (it wraps): outlet, time, section and why, the byline where it must be credited
  return el("article", { class: "card news-card", "data-key": saveKey(it) },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, srcName(it.source)),
      el("span", {}, agoShort(it.date)),
      whyInline(it, newsKinds()[it.kind] || "News", it.kind),
      it.audio ? el("span", { class: "pod" }, `Podcast${it.duration ? `, ${it.duration} min` : ""}`) : null,
      bylineEl(it),
      followHit(it) ? el("span", { class: "lang follow" }, "Following") : null,
      isRead(it) ? el("span", { class: "lang seen" }, "Seen") : null,
      el("span", { class: "spacer" }),
      isNew ? el("span", { class: "tag-new" }, "New") : null),
    headRow(newsImgEl(it), el("h2", { class: "news-headline" }, el("a", { class: "head-link", href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, it.title))),
    el("div", { class: "concl" }, el("div", { class: "concl-inner" },
      it.summary ? el("p", { class: "concl-text news-teaser l3" }, it.summary) : null)),
    cats.length ? el("div", { class: "news-cats" }, cats.map((c) => el("span", {}, c))) : null,
    el("div", { class: "actions" + (it.audio ? " five" : "") },
      it.audio ? el("button", { class: "act", onclick: () => play(it) }, icon(ICONS.listen), "Listen") : null,
      el("a", { class: "act", href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, icon(ICONS.read), "Read"),
      saveBtn,
      el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share"),
      reactBtn(it)));
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
  if (!/^https:\/\//i.test(String(it.audio || ""))) return;
  if (a.dataset.id !== it.id) {
    savePos();                       // the episode you're leaving
    a.src = it.audio;
    a.dataset.id = it.id;
    a.dataset.src = srcName(it.source);
    const saved = (store.get("pos", {}) || {})[it.id];
    if (saved) {
      a.addEventListener("loadedmetadata", () => {
        if (saved[0] < a.duration - 20) { a.currentTime = saved[0]; toast(`Picking up at ${clock(saved[0])}`); }
      }, { once: true });
    }
    $("#pl-title").textContent = it.title;
    $("#pl-src").textContent = srcName(it.source);
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: it.title, artist: it.source, album: "Readout" });
    }
  }
  $("#player").hidden = false;
  document.body.classList.add("playing");
  bump("listen", it);
  a.play().catch((err) => {
    // a pause or close before it started isn't a failure
    if (err?.name === "AbortError" || $("#player").hidden || a.dataset.id !== it.id) return;
    toast("Couldn’t start the audio. Try Read to open the episode page.");
  });
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
  const byId = new Map((S.news?.items || []).map((i) => [i.id, i]));
  const keep = (l) => l.filter((st) => !mutedHit({ title: st.title, summary: byId.get(st.items?.[st.items.length - 1])?.summary }, mute)
    && st.sources.some((x) => !mutedSrc.has(x))
    && !obitHidden(byId.get(st.items?.[0])));
  if (Array.isArray(t)) return keep(t).length ? [["Industry news", keep(t)]] : [];
  return Object.entries(newsKinds()).filter(([k]) => !only || k === only)
    .map(([k, label]) => [label, keep(t[k] || []), k]).filter(([, l]) => l.length);
}

// The Top stories card shows a few stories per kind. Each fresh start (opening the app, a refresh,
// a chip) leads with ones you haven't been shown in the last day and a half (Tune: 12 hours to 3
// days); ones you have move down, unless at least two more outlets have picked them up since.
let topSeen = store.get("topSeen", null);
if (!topSeen || typeof topSeen !== "object" || Array.isArray(topSeen)) topSeen = {};
const storyKey = (st) => st.items?.[st.items.length - 1] || st.title;       // its first headline: the key stays as outlets join
function topPicks(only) {
  const slot = only || "";
  if (!S.topPick || S.topPick.at !== S.topFresh) S.topPick = { at: S.topFresh, lists: {} };
  if (S.topPick.lists[slot]) return S.topPick.lists[slot];
  const now = Date.now(), recent = now - (T.topAgain || 36) * 36e5;
  const lists = topStoryLists(only);
  const per = T.topPer || (lists.length > 2 ? 2 : 3);
  const picked = lists.map(([label, list, k]) => {
    const fresh = [], shown = [];
    for (const st of list) {
      const s = topSeen[storyKey(st)];
      (s && s.t > recent && indepOf(st) < (s.n || 0) + 2 ? shown : fresh).push(st);
    }
    shown.sort((a, b) => topSeen[storyKey(a)].t - topSeen[storyKey(b)].t);   // the longest ago first
    return [label, fresh.concat(shown).slice(0, per), k];
  });
  for (const [, l] of picked) for (const st of l) topSeen[storyKey(st)] = { t: now, n: indepOf(st) };
  for (const [key, s] of Object.entries(topSeen)) if (!s || s.t < now - 7 * 864e5) delete topSeen[key];
  store.set("topSeen", topSeen);
  return (S.topPick.lists[slot] = picked);
}
function topCardEl(only) {
  const byId = Object.fromEntries((S.news?.items || []).map((i) => [i.id, i]));
  const lists = topPicks(only);
  const ts = S.news?.settings?.top_stories || {};
  const span = !ts.days || ts.days === 7 ? "this week" : `in the last ${ts.days} days`;
  return el("article", { class: "card top-card", "data-key": "top" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Top stories"),
      el("span", {}, `covered by ${(ts.min_outlets || 2) > 2 ? `${ts.min_outlets} or more independent sources` : "more than one independent source"} ${span}`)),
    el("div", { class: "top-lists" },
      lists.map(([label, list]) => el("section", {},
        el("h3", { class: "top-h" }, label),
        el("ol", { class: "top-list" }, list.map((st) =>
          el("li", {}, el("button", { onclick: () => openStory(st, byId) },
            el("span", { class: "top-title" }, st.title),
            el("span", { class: "top-meta" }, coverageText(st, true))))))))),
    el("p", { class: "fine swipe-hint", style: "margin:0" }, "Swipe up for the latest papers and news."));
}

// Independent sources (the news job works them out): sister outlets of one publisher, copies of one
// press release, wire copies and articles republished from another outlet count once.
const indepOf = (st) => { const all = (st?.sources || []).length; return Number.isInteger(st?.n) && st.n > 0 ? Math.min(st.n, all || st.n) : all; };
function coverageText(st, names = false) {
  const all = (st.sources || []).length, n = indepOf(st);
  const head = n < all ? `${all} outlets, ${n} independent` : plural(all, "outlet");
  return names ? `${head}: ${st.sources.map(srcName).join(", ")}` : head;
}
const andList = (l) => (l.length <= 2 ? l.join(" and ") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);
function copiesNote(st) {
  const c = (st.copies || []).filter((g) => (g.sources || []).length > 1);
  return c.length ? el("p", { class: "fine" }, "Counted once: ", c.map((g) => `${andList(g.sources.map(srcName))} (${(g.why || []).join("; ")})`).join("; "), ".") : null;
}
function openStory(st, byId) {
  openSheet(
    el("h2", { id: "sheet-title" }, st.title),
    el("p", { class: "sheet-meta" }, el("span", {}, coverageText(st)), el("span", {}, agoShort(st.date))),
    copiesNote(st),
    el("ul", { class: "rows" }, st.items.map((id) => byId[id]).filter(Boolean).map((it) =>
      el("li", { class: "news-item" }, el("a", { href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) },
        el("span", { class: "news-src" }, el("b", {}, srcName(it.source)), el("span", {}, agoShort(it.date))),
        el("span", { class: "news-title" }, it.title),
        it.summary ? el("span", { class: "news-teaser" }, it.summary) : null)))));
}

function paperCardEl(it) {
  const isNew = S.newIds.has(it.pmid);
  const c = it.conclusion || { kind: "none" };
  const fig = figureEl(it);
  // a key result under a short conclusion; tall phones have room for it under longer ones too (fitCard drops it if not)
  const extra = !fig && c.kind === "structured" && (c.text || "").length < (innerHeight >= 880 ? 420 : 260) ? (it.extras || [])[0] : null;
  const old = Date.now() - Date.parse(it.added || it.epub || it.ppub || "") > 60 * 864e5;
  const card = el("article", { class: "card" + (fig ? " has-fig" : ""), "data-pmid": it.pmid, "data-key": it.pmid },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, it.journal),
      el("span", {}, fmtDate(it.epub || it.added)),
      it.translated ? el("span", { class: "lang", title: "PubMed’s English translation of the title" }, it.language ? `In ${it.language}` : "Translated title") : null,
      followHit(it) ? el("span", { class: "lang follow" }, "Following") : null,
      isRead(it) ? el("span", { class: "lang seen" }, "Seen") : null,
      it.classic ? el("span", { class: "lang classic" }, "Classic of the day") : null,
      it._wide ? el("span", { class: "lang wide" }, "Outside your areas") : null,
      fullTextOf(it)?.free ? el("span", { class: "lang free" }, "Free full text") : null,
      whyInline(it),
      el("span", { class: "spacer" }),
      isNew ? el("span", { class: "tag-new" }, "New") : null),
    it.classic ? classicLine(it) : it._wide ? wideLine(it) : impactEl(it),
    it.retracted ? el("div", { class: "warn" }, "Retracted. See the notice on PubMed before using this.") : null,
    it.concern ? el("div", { class: "warn" }, "Expression of concern published for this paper.") : null,
    headRow(fig, el("h2", { class: "card-title clamp" }, el("a", { class: "head-link", href: pubmedUrl(it.pmid),
      onclick: (e) => { e.preventDefault(); openAbstract(it); } }, it.title))),
    el("div", { class: "concl" }, el("div", { class: "concl-inner" },
      c.kind === "none"
        ? el("p", { class: "concl-text none" }, old ? "PubMed has no abstract for this paper. Abstract and PubMed open what there is."
          : "PubMed doesn’t have this abstract yet. It usually appears within a few days.")
        : [el("div", { class: "concl-label" + (c.kind === "structured" ? "" : " soft") }, conclLabel(c)),
          el("p", { class: `concl-text ${lenClass(c.text)}` }, c.text)],
      extra ? el("div", { class: "extra" },
        el("div", { class: "extra-label" }, extra.label),
        el("p", { class: "extra-text" }, extra.text)) : null)),
    evidenceEl(it.design, false, it.sample),
    (it.topics || []).length ? el("div", { class: "topic-tags" },
      it.topics.slice(0, 3).map((t) => el("button", { class: "topic-tag", onclick: () => { S.topic = t; S.system = "all"; leaveFixed(); refreshFeed(); } }, topicName(t)))) : null,
    actionsEl(it, true));
  return card;
}

function fullTextBtn(it) {
  const ft = fullTextOf(it);
  return ft ? el("a", { class: "act", href: safeUrl(ft.url), target: "_blank", rel: "noopener", "aria-label": `Full text, from ${FT_WHERE[ft.where] || "the journal"}`,
    onclick: () => bump("open", it) }, icon(ICONS.read), "Full text")
    : el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener", onclick: () => bump("open", it) }, icon(ICONS.pubmed), "PubMed");
}
function actionsEl(it, withShare) {
  const saved = !!S.saved[saveKey(it)];
  const saveBtn = el("button", { class: "act save-btn", "aria-pressed": String(saved), onclick: () => toggleSave(it, saveBtn) },
    icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save");
  return el("div", { class: "actions" + (withShare ? " five" : ""), style: withShare ? null : "grid-template-columns:repeat(3,1fr)" },
    el("button", { class: "act", onclick: () => openAbstract(it) }, icon(ICONS.abstract), "Abstract"),
    saveBtn,
    fullTextBtn(it),
    withShare ? el("button", { class: "act", onclick: () => share(it) }, icon(ICONS.share), "Share") : null,
    withShare ? reactBtn(it) : null);
}

// top stories: drop whole stories that don't fit (extra ones per kind first), never half a line
function fitTop(card) {
  const box = card.querySelector(".top-lists");
  if (!box || !box.clientHeight) return;
  box.querySelectorAll("section, li").forEach((n) => { n.hidden = false; });
  const over = () => box.scrollHeight > box.clientHeight + 1;
  const secs = [...box.children].reverse();
  for (const sec of secs) {
    const lis = [...sec.querySelectorAll("li")];
    for (let i = lis.length - 1; i > 0 && over(); i--) lis[i].hidden = true;
  }
  for (const sec of secs.slice(0, -1)) { if (!over()) break; sec.hidden = true; }
}
// a story card: a smaller picture, then fewer lines of the teaser (the article is one tap away);
// the picture goes only when even the headline needs its room
function fitNews(card, box, inner, p, fig, over) {
  const clamp = () => {
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 24;
    const head = box.querySelector(".news-headline");
    const n = Math.floor((box.clientHeight - (head ? head.offsetHeight + 8 : 0)) / lh);
    p.style.webkitLineClamp = String(Math.max(1, n));
    p.style.lineClamp = String(Math.max(1, n));
    return n;
  };
  if (!over()) return;
  if (fig) fig.classList.add("small");
  if (!over()) return;
  if (clamp() >= 2 || !fig) return;
  fig.classList.add("gone");
  p.style.webkitLineClamp = ""; p.style.lineClamp = "";
  if (over()) clamp();
}
// compact cards: no fitting to the screen. Titles up to four lines, conclusions up to nine (the rest
// continues in the abstract), story teasers three; the key result stays in the abstract.
function fitFlow(card) {
  if (card.classList.contains("top-card")) {
    if (card.classList.contains("brief-card")) return;
    const secs = [...card.querySelectorAll(".top-lists > section")];
    const per = secs.length > 3 ? 1 : 2;
    secs.forEach((sec, i) => { sec.hidden = i >= 6; sec.querySelectorAll("li").forEach((li, j) => { li.hidden = j >= per; }); });
    return;
  }
  if (card.classList.contains("brief-card")) return;
  if (card.classList.contains("guess-card") && !card.classList.contains("revealed")) return fitGuess(card);
  card.querySelector(".card-title")?.classList.add("clamp");
  card.querySelector(".more-note")?.remove();
  const extra = card.querySelector(".extra");
  if (extra) extra.hidden = true;
  card.querySelector(".fig")?.classList.remove("small", "tiny", "gone");
  const tags = card.querySelector(".topic-tags");
  if (tags) tags.hidden = false;
  const p = card.querySelector(".concl-text:not(.none)");
  if (!p) return;
  const sizes = ["l2", "l3", "l4"];
  const base = p.dataset.size ?? (p.dataset.size = sizes.find((c) => p.classList.contains(c)) || "");
  sizes.forEach((x) => p.classList.toggle(x, x === base));
  const news = card.classList.contains("news-card");
  p.style.webkitLineClamp = p.style.lineClamp = news ? "3" : "9";
  if (!news && p.scrollHeight > p.clientHeight + 1) {
    p.parentElement.append(el("button", { class: "concl-label more-note",
      onclick: () => openAbstract(card._it || S.list.find((i) => i.pmid === card.dataset.pmid)) }, "Continues in the abstract"));
  }
}
function fitCard(card) {
  if (isFlow()) return fitFlow(card);
  if (card.classList.contains("top-card")) return fitTop(card);
  if (card.classList.contains("brief-card")) return;
  if (card.classList.contains("guess-card") && !card.classList.contains("revealed")) return fitGuess(card);
  card.querySelector(".card-title")?.classList.add("clamp");
  const box = card.querySelector(".concl");
  const inner = box?.querySelector(".concl-inner");
  const p = box?.querySelector(".concl-text:not(.none)");
  if (box && !p && card.classList.contains("news-card")) {       // a story with no summary: only the picture can give way
    const f = card.querySelector(".fig");
    if (!f || !box.clientHeight) return;
    f.classList.remove("small", "gone");
    const over = () => inner.scrollHeight > box.clientHeight + 1;
    if (over()) f.classList.add("small");
    if (over()) f.classList.add("gone");
    return;
  }
  if (!box || !p) return;
  if (!box.clientHeight) return;      // feed not on screen (another tab): fit when it comes back
  // reset, so this can run again after fonts load or the screen rotates
  p.style.webkitLineClamp = "";
  p.style.lineClamp = "";
  card.querySelector(".more-note")?.remove();
  const extra = box.querySelector(".extra");
  if (extra) extra.hidden = false;
  const fig = card.querySelector(".fig");
  fig?.classList.remove("small", "tiny", "gone");
  const tags = fig ? card.querySelector(".topic-tags") : null;
  if (tags) tags.hidden = false;
  const sizes = ["", "l2", "l3", "l4"];
  const base = p.dataset.size ?? (p.dataset.size = sizes.find((c) => c && p.classList.contains(c)) || "");
  const setSize = (c) => { sizes.forEach((x) => x && p.classList.remove(x)); if (c) p.classList.add(c); };
  setSize(base);
  const over = () => inner.scrollHeight > box.clientHeight + 1;
  if (over() && extra) extra.hidden = true;
  if (card.classList.contains("news-card")) return fitNews(card, box, inner, p, fig, over);
  if (over() && tags) tags.hidden = true;                     // with a picture, topic tags go first
  if (over() && fig) fig.classList.add("small");              // a smaller picture before smaller type
  // smaller type before cutting text: the conclusion is the point of the card
  let shrank = false;
  const shrink = () => { for (let i = sizes.indexOf(base) + 1; over() && i < sizes.length; i++) { setSize(sizes[i]); shrank = true; } };
  shrink();
  if (over() && fig) fig.classList.add("tiny");               // a strip of the picture, still tappable
  if (over() && fig) {                // still too long: the conclusion wins; the picture stays in the abstract
    fig.classList.add("gone");
    if (tags) tags.hidden = false;
    setSize(base); shrank = false;
    if (over() && tags) tags.hidden = true;
    shrink();
  }
  if (!over()) {                     // room to spare: let a long title show in full, if the conclusion still fits
    const t = card.querySelector(".card-title.clamp");
    if (t && !shrank && !(extra && extra.hidden) && t.scrollHeight > t.clientHeight + 1) {
      t.classList.remove("clamp");
      if (over()) t.classList.add("clamp");
    }
    return;
  }
  if (card.classList.contains("news-card")) {      // a teaser: clamp it, the article is one tap away
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 24;
    const head = box.querySelector(".news-headline");
    const lines = String(Math.max(1, Math.floor((box.clientHeight - (head ? head.offsetHeight + 8 : 0)) / lh)));
    p.style.webkitLineClamp = lines;
    p.style.lineClamp = lines;
    return;
  }
  const note = el("button", { class: "concl-label more-note",
    onclick: () => openAbstract(card._it || S.list.find((i) => i.pmid === card.dataset.pmid)) }, "Continues in the abstract");
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
  document.querySelectorAll(`[data-key="${CSS.escape(key)}"] .act.save-btn`).forEach((b) => setSaveBtn(b, on));   // not the Rate button
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

// ── citations (AMA, as Radiology and AJR use) ──────────────────────────────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function fmtLong(s) {
  const [y, m, d] = String(s || "").split("-");
  return !m ? y || "" : !d ? `${MONTHS[+m - 1]} ${y}` : `${MONTHS[+m - 1]} ${+d}, ${y}`;
}
function fullPages(pg) {                 // "1123-30" → "1123-1130"
  const m = String(pg || "").match(/^(\d+)-(\d+)$/);
  if (!m || m[2].length >= m[1].length) return pg || "";
  return `${m[1]}-${m[1].slice(0, m[1].length - m[2].length)}${m[2]}`;
}
function amaCitation(it) {
  if (!it.pmid) {                        // a news story
    return `${it.title}. ${it.source}. Published ${fmtLong((it.date || "").slice(0, 10))}. ${it.link}`;
  }
  const c = it.cite || {};
  const au = c.au?.length ? c.au.join(", ") + (c.etal ? ", et al" : "")
    : String(it.authors || "").replace(/,?\s*et al\.?$/, ", et al");
  const title = String(it.title || "").trim().replace(/\.$/, "");
  const journal = String(it.journal || "").replace(/\./g, "");
  const year = (it.ppub || it.epub || it.added || "").slice(0, 4);
  const where = c.vol
    ? `${journal}. ${year};${c.vol}${c.iss ? `(${c.iss})` : ""}${c.pg ? `:${fullPages(c.pg)}` : ""}.`
    : `${journal}. Published online ${fmtLong(it.epub || it.added)}.`;
  return [au ? `${au}.` : "", `${title}${/[?!]$/.test(title) ? "" : "."}`, where, it.doi ? `doi:${it.doi}` : ""]
    .filter(Boolean).join(" ");
}
async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast("Couldn’t reach the clipboard"); }
}

// ── search: every paper and story on this phone ─────────────────────────────
const fold = (s) => String(s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
function searchIndex() {
  const key = [S.feed?.generated, S.important?.generated, S.explore?.generated, S.news?.generated, S.library?.generated, Object.keys(S.saved).length].join("|");
  if (S.searchIdx?.key === key) return S.searchIdx;
  const papers = new Map(), news = new Map();
  const addP = (p) => { if (p?.pmid && p.title && !papers.has(p.pmid)) papers.set(p.pmid, p); };
  (S.feed?.items || []).forEach(addP);
  Object.values(S.important?.papers || {}).forEach(addP);
  Object.values(S.explore?.papers || {}).forEach(addP);
  Object.values(S.library?.papers || {}).forEach(addP);
  (S.news?.items || []).forEach((n) => news.set(n.id, n));
  for (const it of Object.values(S.saved)) {
    if (it.pmid) addP(it); else if (it.id && it.title && !news.has(it.id)) news.set(it.id, it);
  }
  const row = (it, ...parts) => ({ it, t: fold(it.title), hay: fold([it.title, ...parts].join(" ")), when: it.epub || it.added || it.date || "" });
  S.searchIdx = {
    key,
    papers: [...papers.values()].map((p) => row(p, p.conclusion?.text, p.authors, (p.cite?.au || []).join(" "), p.journal, p.journal_full, `pmid ${p.pmid}`)),
    news: [...news.values()].map((n) => row(n, n.summary, n.source)),
  };
  return S.searchIdx;
}
function searchFind(q) {
  const words = fold(q).split(/\s+/).filter((w) => w.length > 1 || /\d/.test(w));
  if (!words.length) return null;
  const hit = (r) => words.every((w) => r.hay.includes(w));
  const score = (r) => words.filter((w) => r.t.includes(w)).length;
  const sort = (a, b) => score(b) - score(a) || (a.when < b.when ? 1 : -1);
  const idx = searchIndex();
  return { words, papers: idx.papers.filter(hit).sort(sort), news: idx.news.filter(hit).sort(sort) };
}
function marked(text, words) {                 // highlight the words, as text nodes (never HTML)
  const esc = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).filter(Boolean);
  if (!esc.length) return [text];
  return String(text).split(new RegExp(`(${esc.join("|")})`, "ig")).map((part, i) => (i % 2 ? el("mark", {}, part) : part));
}
function openSearch() {
  const input = el("input", { type: "search", class: "text-in search-in", placeholder: "Words, author or journal", "aria-label": "Search",
    autocapitalize: "off", autocomplete: "off", enterkeyhint: "search", value: S.searchQ || "" });
  const out = el("div", { class: "search-out", "aria-live": "polite" });
  const shown = { papers: 25, news: 15 };
  const draw = () => {
    S.searchQ = input.value;
    const r = searchFind(input.value);
    if (!r) {
      out.replaceChildren(el("p", { class: "fine" }, "Searches titles, conclusions, authors and journals of every paper here (feed, Most important, Explore, Foundations, classics, Saved) and every news story."));
      return;
    }
    const group = (label, list, kind, rowEl) => list.length ? el("section", { class: "search-group" },
      el("h3", { class: "sys-head" }, `${label} · ${list.length.toLocaleString()}`),
      el("ul", { class: "rows" }, list.slice(0, shown[kind]).map((x) => rowEl(x.it))),
      list.length > shown[kind] ? el("button", { class: "act wide", onclick: () => { shown[kind] += 50; draw(); } },
        `Show ${Math.min(50, list.length - shown[kind])} more`) : null) : null;
    const paperRow = (p) => el("li", { class: "news-item" }, el("button", { class: "search-hit", onclick: () => openAbstract(p) },
      el("span", { class: "news-src" }, el("b", {}, p.journal || ""), el("span", {}, fmtDate(p.epub || p.added || p.ppub))),
      el("span", { class: "news-title" }, marked(p.title, r.words)),
      p.conclusion?.text ? el("span", { class: "news-teaser clamp2" }, marked(p.conclusion.text, r.words)) : null));
    const newsRow = (n) => el("li", { class: "news-item" }, el("a", { href: safeUrl(n.link), target: "_blank", rel: "noopener", onclick: () => bump("open", n) },
      el("span", { class: "news-src" }, el("b", {}, srcName(n.source)), el("span", {}, agoShort(n.date))),
      el("span", { class: "news-title" }, marked(n.title, r.words))));
    const groups = [group("Papers", r.papers, "papers", paperRow), group("News", r.news, "news", newsRow)].filter(Boolean);
    out.replaceChildren(...(groups.length ? groups : [el("p", { class: "fine" }, `Nothing here matches “${input.value.trim()}”. Fewer or shorter words find more.`)]));
  };
  let t;
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(draw, 120); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  openSheet(el("h2", { id: "sheet-title" }, "Search"), input, out);
  draw();
  input.focus();
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
// a sheet whose first item is DONE_TOP gets a Done button up by the close button (Rate)
const DONE_TOP = { doneTop: true };
function openSheet(...content) {
  if (!$("#sheet").classList.contains("open")) sheetOpener = document.activeElement;
  S.onSheetClose = null;
  const card = $("#sheet-card");
  const done = content[0] === DONE_TOP;
  if (done) content = content.slice(1);
  card.replaceChildren(
    el("div", { class: "sheet-top" },
      el("div", { class: "grab" }),
      el("div", { class: "sheet-top-btns" },
        done ? el("button", { class: "act done-top", onclick: closeSheet }, "Done") : null,
        el("button", { class: "icon-btn", "aria-label": "Close", onclick: closeSheet }, icon(ICONS.close)))),
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
  const after = S.onSheetClose;
  S.onSheetClose = null;
  after?.();
}
// redraw the open sheet without jumping back to its top
function refillSheet(...content) {
  const top = $("#sheet-card").scrollTop;
  const opener = sheetOpener;
  openSheet(...content);
  sheetOpener = opener;
  $("#sheet-card").scrollTop = top;
}

// abstracts sit beside the data files in small buckets (pipeline/abstract_store.py)
const absCache = new Map();
// Some journals' PubMed records run the headings into one paragraph ("Background … Purpose … Materials and
// Methods …"). Split those back into sections, but only when at least three headings appear in order.
const INLINE_HEADS = [["BACKGROUND", "Background|Introduction|Context"], ["OBJECTIVE", "Purpose|Objectives?|Aims?|Rationale and Objectives"],
  ["METHODS", "Materials and Methods|Patients and Methods|Methods?|Design|Approach"], ["RESULTS", "Results|Findings"],
  ["CONCLUSIONS", "Conclusions?|Interpretation|Summary"]];
const INLINE_RE = new RegExp(`(^|[.?!]\\s+)(${INLINE_HEADS.map(([, w]) => w).join("|")}):?\\s+(?=[A-Z0-9(])`, "g");
function splitInline(secs) {
  if (secs.length !== 1 || secs[0].label || !secs[0].text) return secs;
  const text = secs[0].text, hits = [];
  for (const m of text.matchAll(INLINE_RE)) {
    const cat = INLINE_HEADS.find(([, w]) => new RegExp(`^(?:${w})$`).test(m[2]))[0];
    hits.push({ at: m.index + m[1].length, end: m.index + m[0].length, label: m[2], cat });
  }
  const order = hits.map((h) => INLINE_HEADS.findIndex(([c]) => c === h.cat));
  if (hits.length < 3 || order.some((o, i) => i && o < order[i - 1])) return secs;
  const out = [];
  if (hits[0].at > 0) out.push({ label: "", cat: "", text: text.slice(0, hits[0].at).trim() });
  hits.forEach((h, i) => out.push({ label: h.label, cat: h.cat, text: text.slice(h.end, i + 1 < hits.length ? hits[i + 1].at : text.length).trim() }));
  return out.filter((x) => x.text);
}
async function sectionsOf(it) {
  if (it.sections) return splitInline(it.sections);
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
  return splitInline(b?.[it.pmid] || []);
}
async function openAbstract(it) {
  if (!it) return;
  bump("open", it);
  let secs = [], missing = false;
  try { secs = await sectionsOf(it); } catch { missing = true; }
  const links = [
    el("a", { class: "act", href: pubmedUrl(it.pmid), target: "_blank", rel: "noopener" }, "PubMed"),
    doiUrl(it.doi) ? el("a", { class: "act", href: libraryUrl(doiUrl(it.doi)), target: "_blank", rel: "noopener" }, T.library ? "Journal (library)" : "Journal") : null,
    fullTextOf(it)?.free ? el("a", { class: "act", href: safeUrl(fullTextOf(it).url), target: "_blank", rel: "noopener" }, fullTextOf(it).pdf ? "Free PDF" : "Free full text") : null,
    el("button", { class: "act", onclick: () => copyText(amaCitation(it), "Citation copied (AMA style)") }, "Copy citation"),
    fdMeta(it.pmid) ? fdReadBtn(it.pmid) : null,
  ];
  const fd = fdMeta(it.pmid);
  openSheet(
    fd ? el("p", { class: "fd-note" }, el("b", {}, `Foundations · ${fdGroupName(fd.group)}`), ` ${fd.why}`) : null,
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
    !it.impact && (it.classic || it.cites?.n) ? el("p", { class: "imp-detail" }, citesText(it)) : null,
    figSrc(it.fig) && T.pictures ? el("button", { class: "fig in-sheet", "aria-label": `Open ${it.fig.n || "the figure"} with its caption`, onclick: () => openFigure(it) },
      el("img", { src: figSrc(it.fig), alt: `${it.fig.n || "Figure"} from the paper`, loading: "lazy", width: it.fig.w, height: it.fig.h }),
      el("span", { class: "fig-credit" }, `${it.fig.n || "Figure"} · ${it.fig.lic}`)) : null,
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
    el("p", {}, "The feed mixes papers with news of several kinds: radiology industry (AuntMinnie, Radiology Business, ITN, The Imaging Wire…), ACR & societies, health & medicine (STAT, KFF Health News, NPR Health, MedPage Today…), science (NPR Short Wave and Science, Science Friday, Radiolab, Quanta, Live Science, NASA…), Reno & Nevada (the Nevada Current, the Sierra Nevada Ally, Renown Health…), U.S. & world news (NPR, The New York Times, The Wall Street Journal, BBC), business & markets (WSJ, MarketWatch, NYT Business, NPR, Planet Money) and sci-fi & fantasy (Reactor, Locus, File 770, Strange Horizons…). The full list is in config/news.yaml. In Everything they take turns with papers (papers get two turns per round, each news kind one, in an order that changes from round to round and day to day), each busy outlet adds at most two stories a day, and a kind’s outlets, like the papers’ journals and organ systems, take turns rather than coming in runs; tap a chip to see one kind in full. You can change the mix, the outlet limit and the paper order in the Tune tab. Cards show the outlet, its section and why the card is there on one line, the picture the outlet supplies (small, beside the headline), the headline and the outlet’s own short summary; the writers are named only where an outlet’s terms ask for it, unless you turn on Every byline in Tune → Reading. Outlets and sections go by their usual short names (NYT, WSJ, Health & Med). Read opens the article, and podcast episodes have Listen, which keeps playing while you scroll. The first card lists stories more than one independent source covered this week: sister outlets of one publisher (NPR’s feeds, The New York Times’s sections), copies of one press release (ScienceDaily, Medical Xpress, Phys.org), wire copies and articles republished from another outlet count once, and a story’s page says which were counted together. Alerts and the Radar count the same way."),
    el("h3", {}, "Your interests"),
    el("p", {}, "Papers come from four areas: nuclear medicine (every paper in the NM journals), body imaging, cardiac & vascular CT (TAVR planning, CCTA, CT-FFR, calcium), and general radiology (Radiology, AJR, RadioGraphics, JACR). In Tune → Interests you turn areas on or off, set how much of the feed each gets, follow words like “TAVR” (they get their own chip), and pick which organ-system chips show. ACR, SNMMI, RSNA and SCCT news arrive as “ACR & societies”, along with industry stories that mention them."),
    el("h3", {}, "Radar"),
    el("p", {}, "Explore → Radar follows emerging ideas before they’re mainstream: research news (Phys.org and Tech Xplore), new arXiv preprints and the outlets you read. At the Early setting a development counts when one credible source reports it (research news, a preprint, a journal’s news desk or a major newsroom) or when two independent sources do; Tune can ask for 2+ or 3+ independent sources instead. Each topic shows headlines this month against the usual (Heating up at twice the usual, or what you set in Tune → Interests → Radar) and research papers a year from OpenAlex. The Radar also spots phrases new to science, health and markets headlines; one that keeps turning up for three weeks joins by itself, unless it’s an established field that just happens to be in the news, and one that never heats up retires after a year and a half."),
    el("h3", {}, "Watch"),
    el("p", {}, "Explore → Watch lists what changed in the public records: trials on ClinicalTrials.gov in your topics (radioligand therapy, PET and SPECT tracers, TAVR, cardiac CT, screening, AI) that registered, changed status, posted results, or reached or moved their primary completion; the FDA’s radiology-panel device clearances (AI software marked) and new heart-valve approvals; new radiopharmaceuticals and contrast agents and new indications for them; and Medicare payment, NRC Part 35 and FDA radiology rules and guidance. A card in Today shows what’s new once. Major changes are alerts. Phase 3 readouts ahead and rule deadlines appear in Coming up. Follow a trial from its page to see every change to it. Rate on a change’s page, or on any alert, hides or moves down ones like it (a device type, a company, 510(k) clearances, a topic, words in the name) or moves them up; Less keeps them out of Today’s card and alerts, and notifications follow the same choices."),
    el("h3", {}, "Death notices"),
    el("p", {}, "Obituaries show only when at least 3 news organizations reported the death within 3 days, or the person held high office (a president, prime minister, pope or chief justice), so a head of state's death always shows and a less-known person's doesn't. Tune → Rules → Death notices can show all or none. Industry and society news always keep theirs."),
    el("h3", {}, "Alerts"),
    el("p", {}, "Rare cards pinned at the top of Everything and Today for a week: FDA approvals and safety warnings for radiopharmaceuticals and imaging agents, and guideline changes from the USPSTF, the American Cancer Society and the imaging and cardiac societies. A news story makes one only when two different publishers carry it, or when the FDA or the society says it itself; new guidelines also come straight from PubMed (USPSTF statements in JAMA, American Cancer Society guidelines in CA, and the ACR, SAR, SNMMI, EANM, SCCT, Fleischner, ACC/AHA, ESC and AASLD). Dismiss one and it’s gone; Tune → Rules → Alerts turns each kind off."),
    el("h3", {}, "Outside your areas"),
    el("p", {}, "One paper a day in Today from NEJM, The Lancet, JAMA, BMJ, Nature Medicine, Annals and the big oncology and cardiology journals: papers from the last six months that none of your area searches found, ranked weekly by early citations (NIH iCite) and study design, so a large trial beats a cohort study cited as often. Imaging papers are left out because your areas already have them. Each paper shows once."),
    el("h3", {}, "Most important"),
    el("p", {}, "Every paper from the same journals over the last three years, ranked by how often it’s cited compared with body-imaging papers published in the same quarter (citations from NIH iCite). “1 year” and “3 years” list original research at least four months old, by that percentile. “New” covers the last six months: early citations count for more as a paper ages, and until then its journal’s record stands in. Case reports, editorials and letters are left out; reviews and guidelines can be added in Tune. Readership counts aren’t publicly available, so citations are the measure."),
    el("h3", {}, "Tune"),
    el("p", {}, "The Tune tab shows what you read (counted only on this phone), lets you change how the feed and Explore are put together, and reports how each update job is doing, with links to edit its settings on GitHub. Text size, your library’s off-campus link and Back up and restore are under Tune → Reading."),
    el("h3", {}, "Today"),
    el("p", {}, "Readout opens on Today: a short stack with the best new papers for your areas, the stories most outlets covered, the classic of the day and your next Foundations paper, with Coming up, the Radar, Watch and Reno & Nevada cards spread between the papers, ending with “You’re caught up.” Two of the papers are Guess the result: the card shows the question and methods, and the authors’ conclusion appears when you tap. The classic of the day is a highly cited paper at least five years old from your areas (NIH iCite), different each day. Foundations, under Explore, is a reading path of the guidelines and landmark studies of body imaging, with your progress."),
    el("h3", {}, "General and business news"),
    el("p", {}, "U.S. & world news is the day’s top and national stories from NPR, The New York Times, The Wall Street Journal and the BBC; Business & markets comes from WSJ, MarketWatch, NYT Business and NPR. AP and Reuters no longer publish feeds Readout may use. Each has its own chip, takes one turn per round in Everything, and can be turned up, down or off in Tune → Rules → Feed mix."),
    el("h3", {}, "Pictures"),
    el("p", {}, "News cards show the picture the outlet puts in its own feed, loaded from the outlet’s servers (Readout tells them nothing about where you came from). Papers that are open access under a Creative Commons license show one figure, chosen to be an image (CT, MRI, ultrasound, PET) rather than a chart or flowchart. It comes from NLM’s PMC Open Access dataset, resized for a phone, and is credited with the figure number, the license and a link to the article. Turn pictures off in Tune → Reading."),
    el("h3", {}, "Telling Readout what you like"),
    el("p", {}, "Rate on a card opens a page where you choose, for each thing about the card (organ system, topic, journal, kind of study, outlet, subjects like AI or children), whether you want more, less, the same or none of it; the same for the story’s writers or the paper’s first listed authors. “More like this” and “Less like this” nudge all of them a little, but not names. Below that, words from the headline and from the summary or conclusion can be followed (their own chip) or muted (by default a muted word hides cards with it in the headline or the text; Tune → Rules → Mute can limit that to headlines). Cards you’d like more of move up; less, down; hidden ones leave every list. All of it is in Tune → Interests, where you can change or undo it."),
    el("h3", {}, "Meetings"),
    el("p", {}, "Four months before a meeting you follow (RSNA, SNMMI, SCCT and others in config/meetings.yaml), a banner under the chips counts down; close it with ✕. From a week before until a week after, a chip gathers every story that mentions the meeting."),
    el("h3", {}, "Weather"),
    el("p", {}, "Today’s and tomorrow’s highs, lows and forecast for Reno come from the National Weather Service (NOAA), fetched by your phone straight from api.weather.gov about every half hour, and on pull-down. Tap it for the detailed forecast; turn it off in Tune → Reading."),
    el("h3", {}, "Near Reno"),
    el("p", {}, "A card in Today while something nearby is worth knowing, and nothing when it\u2019s quiet. Weather alerts: National Weather Service warnings, watches and advisories for Reno, Donner Summit and South Lake Tahoe; tap one for the NWS\u2019s own text. Sierra roads (October to May): Caltrans chain controls on I-80, US-50 and the Tahoe and Truckee roads, from Caltrans\u2019s own feed when your phone can reach it, else from the copy a roads job makes every half hour; and new snow in Donner Summit\u2019s NWS forecast. Air: the U.S. AQI for Reno from the CAMS model via Open-Meteo, an estimate that tracks smoke (AirNow has monitor readings), when it reaches the level you choose. Earthquakes (USGS, magnitude 2.5 and up) and active fires (the interagency data NIFC publishes) within reach: 100 miles unless you change it. A quake opens its USGS page; a fire opens on a map, and the card links to InciWeb for the crews\u2019 updates. Tune \u2192 Interests \u2192 Near Reno turns each part on or off and sets its limits."),
    el("h3", {}, "Coming up"),
    el("p", {}, "A card in Today shows the next 7 days of events you follow; Explore → Coming up shows 90 days, by week. Markets and the economy: Fed decisions (Federal Reserve calendar), jobs and CPI reports (Bureau of Labor Statistics), GDP and PCE reports (Bureau of Economic Analysis), stock market holidays (NYSE rules) and earnings for the companies you watch. Medicine: your meetings, FDA advisory panels on imaging and heart devices (from their Federal Register notices), J.P. Morgan Healthcare week. Science: notable launches (Launch Library 2, The Space Devs). Night sky: full and new moons and meteor shower peaks with how much of the Moon is lit (worked out by the job), eclipses (NASA), and nights NOAA forecasts a geomagnetic storm strong enough for aurora low in Reno\u2019s northern sky. News: CES and other set dates, plus a list of events expected without a date yet. A daily job reads the calendars; times show in your phone’s time zone."),
    el("p", {}, "Personal finance: IRS deadlines (worked out each year from the IRS’s rules, so a weekend or holiday moves them), each year’s new contribution limits, the big sales weekends, and at the start of each month the things usually discounted then. Culture: awards nights, festivals, Comic-Con and Burning Man, and a list of events expected without a date yet. Sci-fi and fantasy movies: the big theatrical releases, from the studios’ announced dates; Explore → Coming up can show the next 12 months."),
    el("p", {}, "Sci-fi and fantasy release dates come from TMDB (The Movie Database) once its token is added on GitHub (Tune → Updates → Set up), checked daily and linked to each film’s IMDb page; IMDb itself doesn’t allow automated use. Until then, a hand-checked list is used."),
    typeof tmdbCredit === "function" ? tmdbCredit() : null,
    el("p", {}, "Earnings dates come from Alpha Vantage, straight to your phone, with your own free key (Tune → Interests → Coming up). The key stays on this phone, out of backups, and goes only to alphavantage.co about once a day. Until you add one, each earnings season’s start is estimated. Tap any event for details and Add to Calendar; Subscribe in Calendar adds them all (not earnings) as a calendar that keeps itself up to date."),
    el("h3", {}, "Moving around"),
    el("p", {}, "Cards are compact: each is as tall as what it holds, so the next one starts right below, and very long conclusions continue in the abstract. Tune → Reading → Cards switches a phone back to one card per screen. On an iPad or a computer, Readout lays the feed out in columns by itself, with the tabs down the left side on wide screens; with a mouse, a small ✕ on the card you point at clears it."),
    el("p", {}, "Swipe a card left to save it, right to clear it: the next card takes its place, and Undo brings it back. Why? after a clear lets you say why: Already know it, Not for me (fewer like this, the same as Less in Rate), Weak study, or Not now (back in 3 days); only Not for me changes what you see (Tune → Rules → Feed mix can bring back every card you cleared). Tap a headline to open it: a story opens the article, a paper its abstract. Pull the feed down from the first card to check for new papers and news; with a GitHub token in Tune → Updates, that also runs the news update on GitHub (about 2 minutes). Cards you’ve already seen go to the end of each list, marked Seen, whenever a list starts fresh (opening the app, a chip, a refresh); turn that off in Tune → Rules."),
    el("p", {}, "Reno & Nevada is local news from the Nevada Current, the Sierra Nevada Ally and High Country News (its stories about Nevada and the Sierra). Each story is tagged with where it is and what it’s about; Tune → Interests → Reno & Nevada keeps to the Reno area or all of Nevada, sets its turns in Everything and Today’s card, and moves each topic and outlet up, down or out."),
    el("p", {}, "Tune has two levels. Each section’s main switches are up front; Advanced, under them, holds exact numbers: how many papers and stories Today holds and the order of its parts, each outlet’s stories a day and rating, the oldest story shown per kind, how long alerts stay pinned, how far Coming up looks. What the jobs on GitHub do (outlets, what counts as a top story or an alert, Watch’s trial topics, the Radar’s topics, including ones of your own) is in Tune → Updates → each job → Change settings; changes are sent to GitHub, checked, and used from each job’s next run."),
    el("h3", {}, "Full text, citations and notifications"),
    el("p", {}, "Full text on a paper opens a free copy when there is one (PubMed Central, the journal’s own free version, or a repository copy Unpaywall knows, found nightly through Europe PMC and marked Free full text), else your library’s link (Tune → Reading), else PubMed. Saved papers are watched for new papers citing them: once a day your phone asks NIH iCite (PubMed’s links if iCite doesn’t answer), sending only their PubMed IDs, and new ones show in Today and at the top of Saved. Alerts can also arrive as notifications on this phone: turn them on in Tune → Rules → Alerts and paste the setup into GitHub once. Tune → Rules → Topic filters hides a subject everywhere unless it mentions what you choose (Heart valves, unless CT or radiology, comes on): no AI, just lists of the words, abbreviations and device names each subject goes by. Tune → Rules → What your filters hid lists what each filter, mute, Hide rating and death-notice setting kept out in the last week, with a one-tap undo."),
    el("h3", {}, "Search and citations"),
    el("p", {}, "The magnifier searches every paper and story on this phone (titles, conclusions, authors, journals). Copy citation in an abstract, and Copy list in Saved, give AMA-style references."),
    el("h3", {}, "Sources"),
    el("p", {}, "Papers from MEDLINE®/PubMed®, a database of the U.S. National Library of Medicine. NLM does not endorse Readout. ",
      el("a", { href: "https://www.ncbi.nlm.nih.gov/home/about/policies/", target: "_blank", rel: "noopener" }, "NCBI disclaimer and copyright notice"),
      ". Citation data from NIH iCite; trials from ClinicalTrials.gov; pictures from the PMC Open Access subset, each under its own Creative Commons license. News is each outlet’s own headline and summary, credited and linked; outlets whose terms ask for it (ScienceDaily, Medical Xpress, Phys.org, The New York Times) appear exactly as their feeds supply them. Fonts: Literata, Atkinson Hyperlegible Next (SIL Open Font License).")));
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
    fdEntryEl(),
    typeof hzEntryEl === "function" ? hzEntryEl() : null,
    typeof radarEntryEl === "function" ? radarEntryEl() : null,
    typeof watchEntryEl === "function" ? watchEntryEl() : null,
    typeof weekEntryEl === "function" ? weekEntryEl() : null,
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
          ? el("div", { class: "term-chips" }, tr.terms.filter((t) => t.ids.some((id) => byId[id])).map((t) => el("button", { class: "term-chip",
              onclick: () => openSheet(
                el("h2", { id: "sheet-title" }, `“${t.term}” in the news`),
                // the count covers every headline in the window; older ones may have left the feed
                el("p", { class: "sheet-meta" }, el("span", {}, (() => {
                  const shown = t.ids.filter((id) => byId[id]).length;
                  return shown < t.count ? `${plural(t.count, "headline")}, ${shown} still in the feed` : plural(t.count, "headline");
                })()), el("span", {}, t.sources.map(srcName).join(", "))),
                el("ul", { class: "rows" }, t.ids.map((id) => byId[id]).filter(Boolean).map((it) =>
                  el("li", { class: "news-item" }, el("a", { href: safeUrl(it.link), target: "_blank", rel: "noopener", onclick: () => bump("open", it) },
                    el("span", { class: "news-src" }, el("b", {}, srcName(it.source)), el("span", {}, agoShort(it.date))),
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
          inFeed ? el("button", { class: "act", onclick: () => { S.topic = tp.id; S.system = "all"; leaveFixed(); closeTopic(); switchTab("feed"); refreshFeed(); } },
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
  S.overlay = "topic";
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
  const wasFd = S.overlay === "fd";
  if (S.overlay === "hz") S.hzFilter = null;
  if (S.overlay === "radar") S.radarTopic = null;
  S.overlay = null;
  if (S.tab === "explore") renderExplore(wasFd);   // no-op unless something changed on the page
  if (wasFd && S.tab === "feed") updateFeedQuietly(1e9);     // Today's Foundations card shows your progress
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
    el("div", { class: "paper-meta" }, el("b", {}, srcName(it.source)), el("span", {}, fmtDate((it.date || "").slice(0, 10)))),
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
  const copy = () => copyText(items.map((i, n) => `${n + 1}. ${amaCitation(i)}`).join("\n"),
    `Copied ${plural(items.length, "reference")} (AMA style)`);
  view.append(
    el("div", { class: "saved-tools" }, el("button", { class: "act", style: "padding:0 14px", onclick: copy }, "Copy list")),
    typeof citeSavedEl === "function" ? citeSavedEl() : null,
    el("div", { class: "saved-list" }, items.map((i) => {
      const e = paperEl(i);
      const line = typeof citeLineEl === "function" ? citeLineEl(i) : null;
      if (line) e.append(line);
      return e;
    })));
  view.scrollTop = keep;
}

// ── tabs, header, boot ─────────────────────────────────────────────────────
function updateHeadNote() {
  const note = $("#head-note");
  const fresh = S.list.filter((i) => (i.type === "paper" ? S.newIds.has(i.pmid) : i.type === "news" && S.newsNew.has(i.id))).length;
  if (S.tab === "feed" && S.offline) note.textContent = S.feed ? `Offline · ${ago(S.feed.generated)}` : "Offline";
  else if (S.tab === "feed" && S.newsUpdating) note.textContent = "Updating news…";
  else if (S.tab === "feed" && S.kind === "important" && S.important) note.textContent = `Ranked ${ago(S.important.generated)}`;
  else if (S.tab === "feed" && fresh) note.textContent = `${fresh} new`;
  else if (S.tab === "feed" && S.feed) note.textContent = `Updated ${ago(S.feed.generated)}`;
  else note.textContent = "";
}

function switchTab(tab) {
  const tt = $("#toast");
  if (tt.classList.contains("act")) { clearTimeout(toastTimer); tt.classList.remove("show", "act"); }   // Undo belongs to the feed
  if (S.tab === "feed" && tab !== "feed") S.lastKey = currentKey();
  S.tab = tab;
  document.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  $("#view-feed").hidden = tab !== "feed";
  $("#view-explore").hidden = tab !== "explore";
  $("#view-saved").hidden = tab !== "saved";
  const tv = $("#view-tune");
  if (tv) tv.hidden = tab !== "tune";
  $("#chips").hidden = tab !== "feed";
  renderBanner();
  $("#title").textContent = { feed: "Readout", explore: "Explore", saved: "Saved", tune: "Tune" }[tab];
  updateHeadNote();
  if (tab === "feed") {
    if (S.feedDirty) refreshFeed(S.lastKey);
    else requestAnimationFrame(fitAll);       // the screen may have turned while you were away
  }
  if (tab === "explore") renderExplore();
  if (tab === "saved") { renderSaved(); if (typeof citeCheck === "function") citeCheck(); }
  if (tab === "tune" && typeof renderTune === "function") renderTune();
}

async function reload(announce) {
  const before = new Set((S.feed?.items || []).map((i) => i.pmid));
  const was = { feed: S.feed?.generated, explore: S.explore?.generated, news: S.news?.generated };
  S.offline = false;
  const wasImp = S.important?.generated, wasLib = S.library?.generated;
  const wasHz = S.horizon?.generated;
  const [feed, newsData, important, library, hz, rd, wt] = await Promise.all([
    loadJSON("data/feed.json").catch(() => null),
    loadJSON("data/news.json").catch(() => null),
    loadJSON("data/important.json").catch(() => null),
    loadJSON("data/library.json").catch(() => null),
    loadJSON("data/horizon.json").catch(() => null),
    loadJSON("data/radar.json").catch(() => null),
    loadJSON("data/watch.json").catch(() => null),
  ]);
  if (hz) S.horizon = hz;
  if (rd) S.radar = rd;
  if (wt) S.watch = wt;
  const hzChanged = !!S.horizon && S.horizon.generated !== wasHz;
  if (typeof citeCheck === "function") setTimeout(() => citeCheck(), 2500);
  if (typeof earnRefresh === "function") earnRefresh(false);      // earnings dates, with your key, at most once a day
  if (library) S.library = library;
  const libChanged = !!S.library && S.library.generated !== wasLib;
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
  if (newsData && !(S.news?.generated && newsData.generated < S.news.generated)) S.news = newsData;   // never an older copy
  const newsChanged = !!S.news && S.news.generated !== was.news;
  markNewsNew();
  if (feed) S.feed = feed;
  if (feed || newsData) S.loadedAt = Date.now();
  const feedChanged = !S.feed || S.feed.generated !== was.feed;
  markNew();
  if (typeof openAlertsFromHash === "function") openAlertsFromHash();      // a tapped notification
  // rebuilding resets the feed; when it's on screen keep your place (unless you tapped refresh),
  // when it isn't, rebuild on the way back
  if (announce || feedChanged || newsChanged || (impChanged && (S.kind === "important" || !wasImp)) || (libChanged && !wasLib) || (hzChanged && S.kind === "today")) {
    if (S.tab === "feed") { if (announce) refreshFeed(null); else updateFeedQuietly(Date.now() - (S.shownAt || 0)); }
    else { S.feedDirty = true; if (announce) S.lastKey = null; }
  } else updateHeadNote();
  if (newsChanged) S.exploreKey = null;
  if (S.tab === "tune" && typeof renderTune === "function" && (announce || feedChanged || newsChanged)) renderTune(true);
  if ((libChanged || hzChanged) && S.tab === "explore") renderExplore(true);
  if (hzChanged && S.overlay === "hz" && typeof drawHorizon === "function") drawHorizon();
  if (!feed && !newsData && navigator.onLine === false) S.offline = true;
  updateHeadNote();
  renderBanner();
  if (typeof wxRefresh === "function") wxRefresh(announce ? 5 : 30);      // minutes before a forecast counts as old
  if (typeof nearRefresh === "function") nearRefresh(announce ? 2 : 15);   // Near Reno: alerts, roads, air, quakes and fires (near.js)
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
  const [feed, newsData, important, library, hz, rd, wt] = await Promise.all(["feed", "news", "important", "library", "horizon", "radar", "watch"].map((f) => keptJSON(`data/${f}.json`)));
  if (!feed && !newsData) return;
  if (S.feed || S.news) return;             // the network won the race
  S.feed = feed; S.news = newsData; S.important = important; S.library = library;
  if (hz && !S.horizon) S.horizon = hz;
  if (rd && !S.radar) S.radar = rd;
  if (wt && !S.watch) S.watch = wt;
  if (typeof citeCheck === "function") setTimeout(() => citeCheck(), 4000);     // new papers citing your saved ones, once a day
  renderBanner();
  S.loadedAt = Date.now();
  markNewsNew(); markNew();
  if (S.tab === "feed") refreshFeed(); else S.feedDirty = true;
  S.shownAt = Date.now();
  keptJSON("data/explore.json").then((x) => { if (x && !S.explore) { S.explore = x; S.exploreKey = null; if (S.tab === "explore") renderExplore(); } });
}

// ── swipe a card: left saves it, right clears it and the next card takes its place ──
function setupSwipe() {
  const view = $("#view-feed");
  if (!view) return;
  let st = null;
  const th = () => Math.max(90, (st?.card.clientWidth || view.clientWidth) * 0.28);
  view.addEventListener("touchstart", (e) => {
    st = null;
    if (!T.swipe || e.touches.length !== 1 || $("#sheet").classList.contains("open")) return;
    const card = e.target.closest(".card");
    const it = card?._it;
    if (!it || it.type === "top" || SPECIAL.has(it.type) || card.classList.contains("swiping")) return;
    for (let n = e.target; n && n !== card; n = n.parentElement)      // a row that scrolls sideways keeps its own swipe
      if (n.scrollWidth > n.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return;
    st = { card, it, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, lock: null };
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (!st) return;
    const t = e.touches[0], dx = t.clientX - st.x0, dy = t.clientY - st.y0;
    if (!st.lock) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      st.lock = Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";          // mostly sideways, or it's a scroll
      if (st.lock === "y") { st = null; return; }
      swipeStart(st);
    }
    e.preventDefault();
    st.dx = dx;
    swipeMove(st, th());
  }, { passive: false });
  const end = (ok) => { if (st?.lock === "x") swipeEnd(st, ok && Math.abs(st.dx) >= th()); st = null; };
  view.addEventListener("touchend", () => end(true));
  view.addEventListener("touchcancel", () => end(false));
  // a swipe that ends over a headline or button isn't also a tap on it
  view.addEventListener("click", (e) => { if (Date.now() - (S.swipedAt || 0) < 450) { e.preventDefault(); e.stopPropagation(); } }, true);
}
function swipeStart(st) {
  const saved = !!S.saved[saveKey(st.it)];
  const c = st.card;
  st.under = el("div", { class: "swipe-under", "aria-hidden": "true",
    style: `top:${c.offsetTop}px;left:${c.offsetLeft}px;width:${c.offsetWidth}px;height:${c.offsetHeight}px` },
    el("span", { class: "su su-clear" }, icon(ICONS.close), "Clear"),
    el("span", { class: "su su-save" }, icon(saved ? ICONS.saved : ICONS.save), saved ? "Saved" : "Save"));
  st.card.parentNode.insertBefore(st.under, st.card);
  st.card.classList.add("swiping");
}
function swipeMove(st, th) {
  st.card.style.transform = `translateX(${st.dx}px)`;
  st.under.classList.toggle("left", st.dx < 0);
  st.under.classList.toggle("right", st.dx > 0);
  st.under.classList.toggle("armed", Math.abs(st.dx) >= th);
}
function swipeEnd(st, commit) {
  const { card, it, under } = st;
  S.swipedAt = Date.now();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settle = () => { card.style.transition = ""; card.style.transform = ""; card.style.opacity = ""; card.classList.remove("swiping"); under.remove(); };
  const back = () => {
    if (still) return settle();
    card.style.transition = "transform .2s ease-out";
    card.style.transform = "";
    setTimeout(settle, 220);
  };
  if (!commit) return back();
  if (st.dx < 0) {                                   // left: save (and stay)
    if (S.saved[saveKey(it)]) toast("Already in Saved");
    else toggleSave(it, null);
    return back();
  }
  if (still) { settle(); clearCard(card, it); return; }      // right: clear
  card.style.transition = "transform .2s ease-in, opacity .2s ease-in";
  card.style.transform = `translateX(${card.clientWidth}px)`;
  card.style.opacity = "0";
  setTimeout(() => { under.remove(); clearCard(card, it); }, 200);
}
// with a mouse there's no swipe: a small ✕ shows on the card you point at
function clearBtn(it) {
  return el("button", { class: "card-x", "aria-label": "Clear this card", title: "Clear this card",
    onclick: (e) => { const card = e.currentTarget.closest(".card"); if (card) clearCard(card, card._it || it); } }, icon(ICONS.close));
}
function clearCard(card, it) {
  const view = $("#view-feed");
  const key = listKey(it);
  const idx = S.list.indexOf(it);
  setCleared(key, true);
  bump("seen", it);
  bump("clear", it);                  // counted for Tune's suggestions; it doesn't teach the feed anything
  seenObserver?.unobserve(card);
  gridRO?.unobserve(card);
  const top = card.offsetTop, keep = view.scrollTop;
  card.remove();
  if (idx >= 0) { S.list.splice(idx, 1); if (idx < S.rendered) S.rendered--; }
  if (S.rendered < S.list.length && S.rendered < idx + 3) appendCards(5);      // the next ones ready
  view.scrollTop = Math.min(keep, top);     // the next card where this one was (the browser would snap back a card)
  updateHeadNote();
  const listNow = S.list;
  if (it.type === "alert") {          // an alert isn't a story to learn from: dismiss it, nothing more
    const undo = () => { setCleared(key, false); S.feedDirty = true; if (S.tab === "feed" && S.list === listNow) refreshFeed(); };
    toastAction("Alert dismissed", "Undo", undo);
    return;
  }
  const undo = () => {
    setCleared(key, false);
    if (S.list !== listNow || S.tab !== "feed") { S.feedDirty = true; toast("It’s back in your lists"); return; }   // the list has changed since
    const cards = [...view.children].filter((n) => n._it);
    const at = Math.max(0, Math.min(idx, cards.length));
    const c = cardEl(it);
    c._it = it;
    view.insertBefore(c, cards[at] || view.querySelector(".feed-end") || view.lastElementChild);
    S.list.splice(at, 0, it);
    S.rendered++;
    seenObserver?.observe(c);
    gridRO?.observe(c);
    if (isFlow()) requestAnimationFrame(() => { fitCard(c); const r = c.getBoundingClientRect(), vr = view.getBoundingClientRect(); if (r.top < vr.top || r.bottom > vr.bottom) view.scrollTop = c.offsetTop - 8; });
    else { view.scrollTop = c.offsetTop; requestAnimationFrame(() => fitCard(c)); }
  };
  toastActions("Cleared", [["Why?", () => openClearWhy(it, key, undo)], ["Undo", undo]]);
}
// the reasons sheet after a clear: what each choice does is said on the button
function openClearWhy(it, key, undo) {
  const paper = !isNewsItem(it);
  const pick = (why) => {
    closeSheet();
    let reacted = false;
    if (why === "notme" && (T.reacts[saveKey(it)] || 0) !== -1) { react(it, -1); reacted = true; }
    if (why === "later") {              // back in 3 days, as new: not among the cards you've seen (they go last)
      setCleared(key, true, localDay(daysAgo(-3)));
      delete seenRecent[saveKey(it)];
      store.set("seenRecent", seenRecent);
    }
    tallyWhy(why, 1);
    const msg = { know: "Noted: already known", notme: "Got it: fewer like this", weak: "Noted: weak study", later: "Back in 3 days" }[why];
    toastAction(msg, "Undo", () => {
      tallyWhy(why, -1);
      if (reacted && T.reacts[saveKey(it)] === -1) react(it, -1);
      undo();
    });
  };
  openSheet(
    el("h2", { id: "sheet-title" }, "Why clear it?"),
    el("p", { class: "sheet-meta fb-title" }, el("span", {}, it.title)),
    el("div", { class: "why-list" }, Object.entries(WHY).filter(([k]) => paper || k !== "weak").map(([k, [label, what]]) =>
      el("button", { class: "why-btn", onclick: () => pick(k) }, el("b", {}, label), el("span", {}, what)))),
    el("p", { class: "fine" }, "Only “Not for me” changes what Readout shows you. The tally is in Tune → Rules."));
}

// pull the feed down from its first card to check for new papers and news
function setupPullToRefresh() {
  const view = $("#view-feed"), ptr = $("#ptr");
  if (!view || !ptr) return;
  const TH = 64;                     // how far (after damping) counts as a pull
  let y0 = null, x0 = 0, pull = 0, busy = false;
  const label = ptr.querySelector("span");
  const place = (d, text) => {
    ptr.style.top = `${view.getBoundingClientRect().top}px`;
    ptr.style.transform = `translate(-50%, ${Math.round(Math.min(d, TH + 36) - 20)}px)`;
    ptr.style.opacity = String(Math.min(1, d / (TH * 0.6)));
    ptr.classList.toggle("ready", d >= TH && !busy);
    label.textContent = text;
  };
  const hide = () => {
    ptr.classList.add("settle");
    ptr.style.transform = "translate(-50%, -60px)";
    ptr.style.opacity = "0";
    setTimeout(() => ptr.classList.remove("settle"), 250);
  };
  view.addEventListener("touchstart", (e) => {
    y0 = !busy && view.scrollTop <= 0 && e.touches.length === 1 && !$("#sheet").classList.contains("open") ? e.touches[0].clientY : null;
    x0 = e.touches[0]?.clientX || 0;
    pull = 0;
    ptr.classList.remove("settle");
  }, { passive: true });
  view.addEventListener("touchmove", (e) => {
    if (y0 == null) return;
    const dy = e.touches[0].clientY - y0, dx = Math.abs(e.touches[0].clientX - x0);
    if (dy <= 0 || view.scrollTop > 0 || dx > dy) {          // scrolling on, or sideways: not a pull
      if (pull) { pull = 0; hide(); }
      if (dy < 0) y0 = null;
      return;
    }
    e.preventDefault();                                     // the feed stays put; the pill comes down
    pull = dy * 0.5;
    place(pull, pull >= TH ? "Release to check for new papers" : "Pull to check for new papers");
  }, { passive: false });
  const end = async () => {
    if (y0 == null) return;
    y0 = null;
    if (pull < TH || busy) { pull = 0; hide(); return; }
    busy = true;
    pull = 0;
    ptr.classList.add("busy", "settle");
    place(TH, "Checking…");
    try {
      await reload(true);
      if (typeof newsOnPull === "function") newsOnPull();     // with a GitHub token: update the news too
    } finally { busy = false; ptr.classList.remove("busy"); hide(); }
  };
  view.addEventListener("touchend", end);
  view.addEventListener("touchcancel", () => { y0 = null; pull = 0; hide(); });
}
function boot() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#btn-refresh").addEventListener("click", () => reload(true));
  setupPullToRefresh();
  setupSwipe();
  applyLayout();
  WIDE.addEventListener?.("change", () => {
    if (S.list?.length && S.tab === "feed") { const k = currentKey(true); S.keepAt = null; refreshFeed(k, currentIdx()); }   // a new layout: start at that card
    else { applyLayout(); S.feedDirty = true; }
  });
  $("#btn-search").addEventListener("click", openSearch);
  applyTextSize();
  $("#btn-info").addEventListener("click", openInfo);
  $("#topic-back").addEventListener("click", closeTopic);
  const pa = $("#pl-audio");
  $("#pl-toggle").addEventListener("click", () => (pa.paused ? pa.play().catch(() => {}) : pa.pause()));
  $("#pl-close").addEventListener("click", () => {
    savePos();
    pa.pause();
    pa.removeAttribute("src"); pa.load(); delete pa.dataset.id;     // stop downloading the episode
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    $("#player").hidden = true; document.body.classList.remove("playing");
  });
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
    if (document.visibilityState === "hidden") { rememberSeen(); saveStats(); savePos(); return; }
    if (S.updateReady && $("#player").hidden) { location.reload(); return; }
    if (S.swReg && Date.now() - (S.swCheck || 0) > 3 * 36e5) { S.swCheck = Date.now(); S.swReg.update().catch(() => {}); }   // look for a new version
    if (S.kind === "today" && S.tab === "feed" && S.shownDay && S.shownDay !== localDay()) refreshFeed(null);   // a new day: a new brief
    if (Date.now() - S.loadedAt > 60 * 60 * 1000) reload(false);   // home-screen apps stay open for days
    renderBanner();
  });
  window.addEventListener("pagehide", () => { rememberSeen(); saveStats(); savePos(); });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(fitAll, 200); });
  document.fonts?.ready.then(fitAll);
  document.fonts?.addEventListener?.("loadingdone", fitAll);
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").then((reg) => { S.swReg = reg; }).catch(() => {});
    // a new version took over: switch to it the next time you come back to the app, never mid-read
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (had) S.updateReady = true; });
  }
  S.kind = T.startOn;
  S.exploreLoading = true;
  showKept().finally(() => reload(false));
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
