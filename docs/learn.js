/* Readout — Today's brief, guess the result, the classic of the day, Foundations, meetings,
   pictures, and what you've told Readout you like. Loaded after app.js, before tune.js. */
"use strict";

// ── what you like ──────────────────────────────────────────────────────────
// A card has features: its organ systems, topics, journal, kind of study, outlet and subjects
// (AI, children…). You can rate each one (taste: hide, less, more); 👍 and 👎 nudge every feature
// of the card a little (learned). The feed adds them up: more-liked cards rise, less-liked sink.
const FLAVORS = {
  ai: ["AI, deep learning and radiomics", /\b(artificial intelligence|deep[- ]learning|machine[- ]learning|radiomics?|radiomic\w*|neural networks?|convolutional|large language models?|LLMs?|ChatGPT|GPT-4\w*|foundation models?|transformer-based)\b/i],
  peds: ["Children", /\b(child|children|childhood|pediatric|paediatric|infants?|neonat\w*|newborns?|adolescen\w*)\b/i],
  tech: ["Technique and physics", /\b(phantoms?|pulse sequences?|image reconstruction|reconstruction algorithms?|image quality|dose reduction|k-space|artifacts?|artefacts?|denois\w*|compressed sensing|acquisition time)\b/i],
  lab: ["Animal and lab studies", /\b(mice|mouse|murine|rats|porcine|swine|rabbits?|canine|xenografts?|in vitro|preclinical)\b/i],
  therapy: ["Radionuclide therapy", /\b(theranostic\w*|radioligand therap\w*|PRRT|177Lu|Lu-177|lutetium|radioemboli[sz]ation|SIRT|radioiodine therap\w*|radium-223|225Ac|actinium)\b/i],
  ir: ["Biopsy, ablation and procedures", /\b(ablation|emboli[sz]ation|TACE|TIPS|biops(?:y|ies)|percutaneous|interventional)\b/i],
  practice: ["Practice, policy and training", /\b(workforce|burnout|reimbursement|Medicare|residents?|residency|trainees?|workflow|turnaround|cost-effectiveness|health policy|staffing|survey)\b/i],
  covid: ["COVID-19", /\b(COVID|SARS-CoV-2)\b/i],
};
const DESIGN_NAMES = { "Randomized trial": "Randomized trials", "Meta-analysis": "Meta-analyses", "Systematic review": "Systematic reviews",
  "Review": "Reviews", "Case report": "Case reports", "Guideline / consensus": "Guidelines and consensus statements",
  "Prospective": "Prospective studies", "Retrospective": "Retrospective studies", "Secondary analysis": "Secondary analyses",
  "Prospective + retrospective data": "Studies with prospective and retrospective data" };
const HIDE = -2;
const isNewsItem = (it) => it.type === "news" || (!it.pmid && !!it.source);
const hasTaste = () => Object.keys(T.taste).length > 0 || Object.keys(T.learned).length > 0;
const tasteW = (f) => (T.taste[f] != null ? T.taste[f] : T.learned[f] || 0);
function designOf(it) {
  return (it.design?.badges || []).filter((b) => b.strength > 0).sort((a, b) => b.strength - a.strength)[0]?.label || null;
}
function featuresOf(it) {
  const f = [];
  if (isNewsItem(it)) {
    if (it.source) f.push(`src:${it.source}`);
    (it.systems || []).forEach((y) => f.push(`sys:${y}`));         // the same organ systems as papers
    (it.categories || []).forEach((c) => f.push(`cat:${c}`));      // industry news: FDA & safety, AI, business…
  } else {
    (it.systems || []).forEach((y) => f.push(`sys:${y}`));
    (it.topics || []).forEach((t) => f.push(`tp:${t}`));
    if (it.journal) f.push(`jr:${it.journal}`);
    const d = designOf(it);
    if (d) f.push(`ds:${d}`);
  }
  const text = `${it.title || ""} ${it.conclusion?.text || it.summary || ""}`;
  for (const [k, [, re]] of Object.entries(FLAVORS)) if (re.test(text)) f.push(`fl:${k}`);
  return f;
}
// −Infinity: hidden. Otherwise the sum, kept within ±3.
function tasteOf(it) {
  if (!hasTaste()) return 0;
  let s = 0;
  for (const f of featuresOf(it)) {
    if (T.taste[f] === HIDE) return -Infinity;
    s += tasteW(f);
  }
  return Math.max(-3, Math.min(3, s));
}
const hiddenByTaste = (it) => hasTaste() && tasteOf(it) === -Infinity;
// newest first, with each card moved up or down by its taste (unit: how far one point moves it)
function byTaste(list, timeOf, unit) {
  return list.map((x, i) => [timeOf(x) + (x._t || 0) * unit, i, x]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((r) => r[2]);
}
function featureName(f) {
  const [k, v] = [f.slice(0, f.indexOf(":")), f.slice(f.indexOf(":") + 1)];
  switch (k) {
    case "sys": return [S.feed?.systems?.[v] || S.important?.systems?.[v] || v, "Organ system"];
    case "tp": return [topicName(v), "Topic"];
    case "jr": return [v, "Journal"];
    case "ds": return [DESIGN_NAMES[v] || v, "Kind of study"];
    case "fl": return [FLAVORS[v]?.[0] || v, "Subject"];
    case "src": return [v, "Outlet"];
    case "cat": return [S.news?.categories?.[v] || v, "News category"];
    default: return [v, k];
  }
}
// Same clears your choice; if 👍/👎 taught Readout a leaning for it, Same also overrides that (stored as 0)
function setTaste(f, v) {
  const taste = { ...T.taste };
  if (v || T.learned[f]) taste[f] = v; else delete taste[f];
  setTune({ taste });
}
const tastePressed = (f, x) => (T.taste[f] != null ? T.taste[f] === x : x === 0 && !T.learned[f]);
function react(it, dir) {
  const key = saveKey(it);
  const was = T.reacts[key] || 0;
  const now = was === dir ? 0 : dir;
  const learned = { ...T.learned };
  for (const f of featuresOf(it)) {
    const v = Math.round(((learned[f] || 0) + 0.5 * (now - was)) * 20) / 20;
    const c = Math.max(-1.5, Math.min(1.5, v));
    if (c) learned[f] = c; else delete learned[f];
  }
  const reacts = { ...T.reacts };
  delete reacts[key];
  if (now) reacts[key] = now;
  const keys = Object.keys(reacts);
  if (keys.length > 600) keys.slice(0, keys.length - 600).forEach((k) => delete reacts[k]);
  setTune({ learned, reacts });
  return now;
}
// What you open, save or listen to teaches a little too (a tenth, or a quarter for a save, of a
// More like this), once per card. Nothing you skip or clear counts against anything: only Less like
// this and Not for me do. Tune → Interests → What you like can turn this off.
const NUDGE = { open: 0.1, listen: 0.1, save: 0.25 };
let taught = store.get("taught", null);
if (!taught || typeof taught !== "object" || Array.isArray(taught)) taught = {};
function learnFrom(it, type) {
  if (!T.learnImplicit || !NUDGE[type] || !it || SPECIAL.has(it.type)) return;
  const key = saveKey(it);
  if ((T.reacts[key] || 0) < 0 || (taught[key] || "").includes(type[0])) return;     // you said less like this; or already counted
  const learned = { ...T.learned };
  for (const f of featuresOf(it)) {
    const v = Math.max(-1.5, Math.min(1.5, Math.round(((learned[f] || 0) + NUDGE[type]) * 20) / 20));
    if (v) learned[f] = v; else delete learned[f];
  }
  taught[key] = (taught[key] || "") + type[0];
  const keys = Object.keys(taught);
  if (keys.length > 1500) keys.slice(0, keys.length - 1500).forEach((k) => delete taught[k]);
  store.set("taught", taught);
  T = { ...T, learned };                 // not setTune: the feed you're reading stays put; this counts from the next fresh start
  store.set("tune", T);
}
// Learned leanings fade (they halve over about four months), so an old phase or a one-off rating
// doesn't steer the feed for good. Your own choices in Rate don't fade.
(function fadeLearned() {
  const today = localDay();
  if (!T.learnedAt) { T = { ...T, learnedAt: today }; store.set("tune", T); return; }
  const days = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${T.learnedAt}T12:00:00`)) / 864e5);
  if (!(days >= 7)) return;
  const k = Math.pow(0.5, days / 120);
  const learned = {};
  for (const [f, v] of Object.entries(T.learned)) { const x = Math.round(v * k * 20) / 20; if (x) learned[f] = x; }
  T = { ...T, learned, learnedAt: today };
  store.set("tune", T);
})();
function reactBtn(it) {
  const r = T.reacts[saveKey(it)] || 0;
  return el("button", { class: "act react", "aria-pressed": String(!!r), "aria-label": "Tell Readout what you think of this",
    onclick: () => openFeedback(it) }, icon(r < 0 ? ICONS.down : r > 0 ? ICONS.reacted : ICONS.react), r > 0 ? "Liked" : r < 0 ? "Less" : "Rate");
}
// candidate words and phrases from a headline or title, for following or muting
const STOP = new Set(("a an and are as at be by for from has have how in into is it its of on or our the their this to was were what when which who why with without versus vs using use used study studies patients patient based new after before between during among than via does can may "
  + "one two three four five first second year years month months day days week weeks assessing assessment evaluating evaluation evaluate comparing comparison compared analysis analyses association associated outcome outcomes "
  + "result results clinical imaging multicenter multicentre retrospective prospective single center centre cohort review systematic diagnostic performance accuracy role value impact effect effects predicting prediction predictive "
  + "prognostic early late progress current adult adults case cases report series trial randomized model models approach method methods novel towards toward insights update experience real-world "
  + "change changes significance significant longitudinal factors features patterns characteristics findings detection identification management response levels measurement measurements").split(" "));
function phrasesOf(title) {
  const words = String(title || "").replace(/[“”"’‘()[\]:;,.?!]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  const ok = (w) => w.length > 2 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (ok(w) && (/[A-Z]{2,}|-|\d/.test(w) || w.length >= 9)) out.push(w);       // acronyms, hyphenated terms, long words
    if (i + 1 < words.length && ok(w) && ok(words[i + 1])) out.push(`${w} ${words[i + 1]}`.toLowerCase());
  }
  const seen = new Set();
  return out.filter((p) => { const k = p.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 10);
}

function openFeedback(it, picked = null) {
  const news = isNewsItem(it);
  const key = saveKey(it);
  const r = T.reacts[key] || 0;
  let changed = false;
  const redraw = (p = picked) => { changed = true; draw(p); };
  const draw = (p) => {
    picked = p;
    const feats = featuresOf(it);
    const order = ["sys", "tp", "jr", "ds", "src", "fl"];
    feats.sort((a, b) => order.indexOf(a.split(":")[0]) - order.indexOf(b.split(":")[0]));
    const row = (f) => {
      const [name, kind] = featureName(f);
      const lw = T.learned[f] || 0;
      return el("div", { class: "fb-row" },
        el("div", { class: "fb-name" }, el("b", {}, name), el("span", {}, kind),
          T.taste[f] == null && lw ? el("span", { class: "fb-learned" }, lw > 0 ? "leaning more" : "leaning less") : null),
        el("div", { class: "seg fb-seg", role: "group", "aria-label": name },
          [[HIDE, "Hide"], [-1, "Less"], [0, "Same"], [1, "More"]].map(([x, l]) => el("button", { "aria-pressed": String(tastePressed(f, x)),
            onclick: () => { setTaste(f, x); if (x === HIDE) toast(`${name} hidden. Undo here or in Tune → Interests.`); redraw(); } }, l))));
    };
    const area = !news ? homeArea(it) : null;
    const kind = news ? kindOf(it) : null;
    const phrases = phrasesOf(it.title);
    const followed = (T.follow || []).filter((w) => wordRe([w])?.test(`${it.title} ${it.conclusion?.text || it.summary || ""}`));
    const muted = (T.mutedWords || []).filter((w) => wordRe([w])?.test(it.title));
    refillSheet(
      el("h2", { id: "sheet-title" }, "What do you think?"),
      el("p", { class: "sheet-meta fb-title" }, el("span", {}, it.title)),
      el("div", { class: "fb-quick" },
        el("button", { class: "act", "aria-pressed": String(r > 0 || T.reacts[key] > 0), onclick: () => {
          const now = react(it, 1); toast(now ? "Got it: a little more like this" : "Taken back"); redraw();
        } }, icon(ICONS.react), "More like this"),
        el("button", { class: "act", "aria-pressed": String(r < 0 || T.reacts[key] < 0), onclick: () => {
          const now = react(it, -1); toast(now ? "Got it: a little less like this" : "Taken back"); redraw();
        } }, icon(ICONS.down), "Less like this")),
      el("p", { class: "fine" }, "These nudge everything below a little. To be exact, choose what should change:"),
      el("section", { class: "fb-sect" }, feats.map(row),
        area ? el("div", { class: "fb-row" },
          el("div", { class: "fb-name" }, el("b", {}, (areaList().find(([a]) => a === area)?.[1]?.label) || area), el("span", {}, "Area")),
          el("div", { class: "seg fb-seg", role: "group", "aria-label": "Area" },
            [[0, "Off"], [1, "Less"], [2, "Normal"], [3, "More"]].map(([x, l]) => el("button", { "aria-pressed": String((T.areas[area] ?? 2) === x),
              onclick: () => {
                const next = { ...T.areas, [area]: x };
                if (!areaList().some(([k]) => (next[k] ?? 2) > 0)) { toast("Keep at least one area on"); return; }
                setTune({ areas: next }); redraw();
              } }, l)))) : null,
        kind ? el("div", { class: "fb-row" },
          el("div", { class: "fb-name" }, el("b", {}, newsKinds()[kind] || kind), el("span", {}, "Turns in Everything")),
          el("div", { class: "seg fb-seg", role: "group", "aria-label": "Turns in Everything" },
            [[0, "Off"], [1, "1"], [2, "2"], [3, "3"]].map(([x, l]) => el("button", { "aria-pressed": String((T.mix[kind] ?? 1) === x),
              onclick: () => { setTune({ mix: { ...T.mix, [kind]: x } }); redraw(); } }, l)))) : null),
      el("div", { class: "ctl-label" }, "Words"),
      el("p", { class: "fine", style: "margin-top:2px" }, "Tap one to follow it (its own chip) or mute it (gone everywhere), or type your own."),
      el("div", { class: "chips wrap" },
        followed.map((w) => el("button", { class: "chip", "aria-pressed": "true", onclick: () => { setTune({ follow: T.follow.filter((x) => x !== w) }); redraw(); } }, `Following ${w}  ✕`)),
        muted.map((w) => el("button", { class: "chip", "aria-pressed": "true", onclick: () => { setTune({ mutedWords: T.mutedWords.filter((x) => x !== w) }); redraw(); } }, `Muted ${w}  ✕`)),
        phrases.filter((w) => !followed.concat(muted).some((x) => x.toLowerCase() === w.toLowerCase()))
          .map((w) => el("button", { class: "chip" + (picked === w ? " chip-topic" : ""), onclick: () => draw(picked === w ? null : w) }, w)),
        el("button", { class: "chip chip-own" + (picked === OWN_WORD ? " chip-topic" : ""), "aria-expanded": String(picked === OWN_WORD),
          onclick: () => draw(picked === OWN_WORD ? null : OWN_WORD) }, "＋ Your own")),
      picked ? wordPicker(picked === OWN_WORD ? "" : picked, () => redraw(null)) : null,
      el("p", { class: "fine" }, "Changes apply at once, on this phone. Everything you’ve told Readout is in Tune → Interests, where you can change or undo it."),
      el("div", { class: "link-row" },
        el("button", { class: "act", onclick: closeSheet }, "Done"),
        el("button", { class: "act", onclick: () => { closeSheet(); switchTab("tune"); setPane("interests", "tune-taste"); } }, "See all")));
    S.onSheetClose = () => {
      document.querySelectorAll(`[data-key="${CSS.escape(key)}"] .act.react`).forEach((b) => b.replaceWith(reactBtn(it)));
      if (!changed) return;
      if (S.tab === "feed") refreshFeed(currentKey(true), currentIdx());
    };
  };
  draw(picked);
  if (!$("#sheet").classList.contains("open")) openSheet();
}
// a word or phrase to follow or mute: a chip from the title to edit (say, "PSMA PET/CT" down to
// "PSMA"), or your own. Shows how many cards it matches right now.
const OWN_WORD = "\u0000own";
function wordPicker(start, done) {
  const input = el("input", { type: "text", class: "text-in", value: start, maxlength: "60", placeholder: "A word or phrase, like PSMA",
    "aria-label": "Word or phrase to follow or mute", autocapitalize: "off", autocomplete: "off", spellcheck: "false", enterkeyhint: "done" });
  const note = el("p", { class: "fine fb-word-note" });
  const count = () => {
    const w = input.value.trim(), r = w ? wordRe([w]) : null;
    if (!r) { note.textContent = "Whole words, so AI doesn’t catch “air”; end one with * for any ending, like radiomic*."; return; }
    const n = (S.feed?.items || []).filter((p) => r.test(`${p.title} ${p.conclusion?.text || ""}`)).length
      + (S.news?.items || []).filter((x) => r.test(`${x.title} ${x.summary || ""}`)).length;
    note.textContent = `In ${plural(n, "card")} right now.`;
  };
  const add = (kind) => {
    const w = input.value.trim().replace(/\s+/g, " ");
    if (!w || !wordRe([w])) { input.focus(); return; }
    const k = kind === "follow" ? "follow" : "mutedWords";
    if (!(T[k] || []).some((x) => x.toLowerCase() === w.toLowerCase())) setTune({ [k]: [...(T[k] || []), w] });
    toast(kind === "follow" ? `Following “${w}”: it has its own chip` : `Muted “${w}” everywhere`);
    done();
  };
  input.addEventListener("input", count);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
  count();
  if (!start) requestAnimationFrame(() => input.focus({ preventScroll: true }));
  return el("div", { class: "fb-word" },
    el("div", { class: "word-add two" }, input,
      el("button", { class: "act", onclick: () => add("follow") }, "Follow"),
      el("button", { class: "act", onclick: () => add("mute") }, "Mute")),
    note);
}

// ── pictures ───────────────────────────────────────────────────────────────
const figSrc = (fig) => (fig && /^figs\/PMC\d{1,10}\.webp$/.test(String(fig.src || "")) ? `data/${fig.src}` : null);
function figureEl(it) {
  if (!T.pictures || !figSrc(it.fig)) return null;
  const btn = el("button", { class: "fig", "aria-label": `${it.fig.n || "Figure"} from the paper. Opens with its caption.`, onclick: () => openFigure(it) });
  const img = el("img", { src: figSrc(it.fig), alt: "", loading: "lazy", decoding: "async", width: it.fig.w, height: it.fig.h });
  img.addEventListener("error", () => { const card = btn.closest(".card"); btn.remove(); card?.classList.remove("has-fig"); if (card) fitCard(card); }, { once: true });
  btn.append(img, el("span", { class: "fig-credit" }, `${it.fig.n || "Figure"} · ${it.fig.lic}`));
  return btn;
}
function openFigure(it) {
  const f = it.fig;
  if (!figSrc(f)) return;
  const year = (it.epub || it.ppub || it.added || "").slice(0, 4);
  const au = it.cite?.au?.length ? `${it.cite.au[0]}${it.cite.au.length > 1 || it.cite.etal ? " et al" : ""}` : (it.authors || "").replace(/,.*$/, " et al");
  openSheet(
    el("h2", { id: "sheet-title" }, f.n || "Figure"),
    el("a", { class: "fig-full", href: figSrc(f), target: "_blank", rel: "noopener", "aria-label": "Open the picture on its own, to zoom" },
      el("img", { src: figSrc(f), alt: f.cap ? `${f.n}: ${f.cap.slice(0, 200)}` : `${f.n} from the paper`, width: f.w, height: f.h })),
    f.cap ? el("p", { class: "fig-cap" }, f.cap) : null,
    el("p", { class: "fine" }, `From ${au ? `${au}, ` : ""}“${it.title}” ${it.journal}${year ? `, ${year}` : ""}. Licensed under `,
      el("a", { href: safeUrl(f.lu), target: "_blank", rel: "noopener" }, f.lic), ". Resized for this app; the article has the original."),
    el("div", { class: "link-row" },
      el("button", { class: "act", onclick: () => openAbstract(it) }, "Abstract"),
      pmcUrl(it.pmcid) ? el("a", { class: "act", href: pmcUrl(it.pmcid), target: "_blank", rel: "noopener" }, "Full article") : null,
      el("a", { class: "act", href: figSrc(f), target: "_blank", rel: "noopener" }, "Zoom")));
}

// ── the classic of the day ─────────────────────────────────────────────────
function citesText(it) {
  const c = it.cites || {};
  if (!c.n) return "";
  return `${it.classic ? "Classic: " : ""}cited ${plural(c.n, "time")}${c.cpy ? `, about ${Math.round(c.cpy).toLocaleString()} a year` : ""}${c.rcr != null ? `; Relative Citation Ratio ${c.rcr}` : ""}. Source: NIH iCite.`;
}
function classicLine(it) {
  const c = it.cites || {};
  return el("div", { class: "impact" }, el("b", {}, `${c.year || (it.epub || it.ppub || "").slice(0, 4)}`),
    c.n ? ` · cited ${plural(c.n, "time")}` : null, c.cpy ? `, about ${Math.round(c.cpy).toLocaleString()} a year` : null);
}
function classicToday() {
  const L = S.library;
  if (!L?.classics || !L.papers) return null;
  const d = localDay();
  const cd = store.get("classicDay", null);
  const card = (p) => ({ ...L.papers[p], type: "paper", classic: true });
  if (cd?.d === d && L.papers[cd.pmid] && !hiddenByTaste(L.papers[cd.pmid])) return card(cd.pmid);
  const areas = Object.entries(L.classics).filter(([a, ids]) => (T.areas[a] ?? 2) > 0 && ids?.length);
  if (!areas.length) return null;
  const n = Math.floor(Date.parse(`${d}T12:00:00`) / 864e5);
  const wheel = areas.flatMap(([a]) => Array(T.areas[a] ?? 2).fill(a));         // areas you weight more come round more often
  const area = wheel[n % wheel.length];
  let hist = store.get("classicHist", {});
  if (!hist || typeof hist !== "object") hist = {};
  const ids = L.classics[area].filter((p) => L.papers[p] && !hiddenByTaste(L.papers[p]));
  let pool = ids.filter((p) => !hist[p]);
  if (!pool.length) {                                   // every one shown: start the area again
    ids.forEach((p) => delete hist[p]);
    pool = ids;
  }
  if (!pool.length) return null;
  const pick = pool[n % Math.min(pool.length, 8)];      // the best few, in a different order each round
  hist[pick] = d;
  store.set("classicHist", hist);
  store.set("classicDay", { d, pmid: pick });
  return card(pick);
}

// ── Alerts: rare, pinned at the top of Everything and Today for a week ─────
// FDA actions on radiopharmaceuticals and imaging agents and guideline changes (news job: two
// outlets or a primary source), and new guidelines straight from PubMed (papers job).
function activeAlerts() {
  const cut = Date.now() - 7.5 * 864e5;
  const seen = new Set();
  return [...(S.feed?.alerts || []), ...(S.news?.alerts || [])]
    .filter((a) => a?.id && a.title && !seen.has(a.id) && seen.add(a.id) && T.alerts?.[a.group] !== false && Date.parse(a.date) >= cut)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
function alertCards() {
  const live = activeAlerts().filter((a) => !isCleared(`alert:${a.id}`));
  const rules = new Set(), shown = [];
  for (const a of live) {                      // at most two, and not two of one kind
    if (rules.has(a.rule)) continue;
    rules.add(a.rule);
    shown.push(a);
    if (shown.length === 2) break;
  }
  const more = live.length - shown.length;
  return shown.map((a, i) => {
    const m = i === shown.length - 1 ? more : 0;
    return { type: "alert", key: `alert:${a.id}`, sig: `${a.id}|${(a.sources || []).length}|${m}`, a, more: m };
  });
}
const outletsText = (s = []) => (s.length <= 2 ? s.join(" and ") : `${s.slice(0, 2).join(", ")} and ${plural(s.length - 2, "more outlet")}`);
// a guideline carries the day PubMed listed it, not a time: count whole days, not hours since midnight UTC
function alertWhen(a) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date || "")) return agoShort(a.date);
  const [y, m, d] = a.date.split("-").map(Number);
  const days = Math.round((Date.parse(`${localDay()}T12:00:00`) - new Date(y, m - 1, d, 12).getTime()) / 864e5);
  return days <= 0 ? "today" : `${days} d`;
}
function alertSrc(a) { return a.via === "pubmed" ? `${a.journal} · from PubMed` : outletsText(a.sources); }
function alertOpen(a) {
  if (a.via === "pubmed") {
    const p = (S.feed?.items || []).find((x) => x.pmid === a.pmid) || a.card;
    if (p) openAbstract({ ...p, type: "paper" });
    return;
  }
  const byId = Object.fromEntries((S.news?.items || []).map((i) => [i.id, i]));
  const items = (a.items || []).filter((id) => byId[id]);
  if (items.length > 1) openStory({ title: a.title, sources: a.sources, date: a.updated || a.date, items }, byId);
  else { const u = safeUrl(a.link || byId[items[0]]?.link || ""); if (u && u !== "#") window.open(u, "_blank", "noopener"); }
}
function alertCardEl(it) {
  const a = it.a;
  const what = a.via === "pubmed" ? "New guideline" : a.rule === "fda" ? "FDA action" : "Guideline change";
  return el("article", { class: "card brief-card alert-card", "data-key": it.key, "data-group": a.group },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal alert-label" }, a.label), el("span", {}, what),
      el("span", { class: "spacer" }), el("span", {}, alertWhen(a))),
    el("h2", { class: "card-title" }, el("a", { class: "head-link", href: a.via === "pubmed" ? pubmedUrl(a.pmid) : safeUrl(a.link || ""),
      onclick: (e) => { e.preventDefault(); alertOpen(a); } }, a.title)),
    el("p", { class: "alert-src" }, alertSrc(a)),
    el("div", { class: "alert-acts" },
      el("button", { class: "act", onclick: () => alertOpen(a) }, a.via === "pubmed" ? "Abstract" : (a.items || []).length > 1 ? `All ${a.sources.length} outlets` : "Read"),
      el("button", { class: "act", onclick: (e) => clearCard(e.currentTarget.closest(".card"), it) }, "Dismiss"),
      it.more ? el("button", { class: "act", onclick: openAlerts }, `${it.more} more`) : null));
}
function openAlerts() {
  const all = activeAlerts();
  openSheet(
    el("h2", { id: "sheet-title" }, "This week’s alerts"),
    el("p", { class: "sheet-meta" }, el("span", {}, "FDA actions on imaging agents and radiopharmaceuticals, and guideline changes. Each stays a week.")),
    all.length ? el("ul", { class: "rows" }, all.map((a) => el("li", { class: "news-item" },
      el("button", { class: "alert-row", onclick: () => alertOpen(a) },
        el("span", { class: "news-src" }, el("b", {}, a.label), el("span", {}, alertWhen(a)), isCleared(`alert:${a.id}`) ? el("span", {}, "dismissed") : null),
        el("span", { class: "news-title" }, a.title),
        el("span", { class: "alert-src" }, alertSrc(a))))))
      : el("p", { class: "fine" }, "None this week. Most weeks have none: they’re meant to be rare."),
    el("p", { class: "fine" }, "Choose which kinds in Tune → Rules → Alerts."));
}

// ── Outside your areas: one paper a day from the big general journals ─────
// The weekly Most important job keeps the recent papers in NEJM, Lancet, JAMA, BMJ and the like
// that your area searches didn't find, ranked by early citations and design. Each shows once.
function wideToday() {
  const I = S.important;
  if (!I?.wide?.length || !I.papers) return null;
  const d = localDay();
  const mute = mutedRe();
  const ok = (p) => I.papers[p] && !hiddenByTaste({ ...I.papers[p], type: "paper" }) && !isCleared(p) && !(mute && mute.test(I.papers[p].title));
  const card = (p) => ({ ...I.papers[p], type: "paper", _wide: true });
  const wd = store.get("wideDay", null);
  if (wd?.d === d) return I.papers[wd.pmid] && ok(wd.pmid) ? card(wd.pmid) : null;    // one a day: clearing it doesn't bring another
  let hist = store.get("wideHist", {});
  if (!hist || typeof hist !== "object" || Array.isArray(hist)) hist = {};
  const cut = localDay(daysAgo(365));
  for (const [p, day] of Object.entries(hist)) if (typeof day !== "string" || day < cut) delete hist[p];
  const pick = I.wide.find((p) => ok(p) && !hist[p] && !S.saved[p]);
  if (!pick) return null;                     // all shown: next week's list brings new ones
  hist[pick] = d;
  store.set("wideHist", hist);
  store.set("wideDay", { d, pmid: pick });
  return card(pick);
}
function wideLine(it) {
  const w = it.wide || {};
  const age = Math.max(1, Math.round(w.age || 1));
  return el("div", { class: "impact" }, el("b", {}, w.cites ? `Cited ${plural(w.cites, "time")}` : "Just out"),
    ` in ${plural(age, "month")}`, w.clin ? `, ${w.clin} by clinical papers` : null, " · NIH iCite");
}

// ── Foundations ────────────────────────────────────────────────────────────
let fdRead = store.get("fdRead", null);
if (!fdRead || typeof fdRead !== "object" || Array.isArray(fdRead)) fdRead = {};
const fdMeta = (pmid) => S.library?.foundations?.meta?.[pmid] || null;
const fdGroupName = (g) => S.library?.foundations?.groups?.find((x) => x.id === g)?.name || g;
function fdState() {
  const F = S.library?.foundations;
  if (!F?.groups?.length) return null;
  const all = F.groups.flatMap((g) => g.items).filter((p) => S.library.papers[p]);
  const read = all.filter((p) => fdRead[p]).length;
  const next = all.find((p) => !fdRead[p]) || null;
  return { all, read, next, total: all.length };
}
function setRead(pmid, on) {
  if (on) fdRead[pmid] = localDay(); else delete fdRead[pmid];
  store.set("fdRead", fdRead);
  const st = fdState();
  if (on && st) toast(st.read === st.total ? "Foundations complete. Well done." : `${st.read} of ${st.total} read`);
}
function fdReadBtn(pmid) {
  const b = el("button", { class: "act", "aria-pressed": String(!!fdRead[pmid]), onclick: () => {
    setRead(pmid, !fdRead[pmid]);
    b.setAttribute("aria-pressed", String(!!fdRead[pmid]));
    b.replaceChildren(fdRead[pmid] ? icon(ICONS.check) : "", fdRead[pmid] ? "Read" : "Mark as read");
    if (S.overlay === "fd") drawFoundations();
  } }, fdRead[pmid] ? icon(ICONS.check) : null, fdRead[pmid] ? "Read" : "Mark as read");
  return b;
}
function progressEl(read, total) {
  return el("span", { class: "progress", role: "img", "aria-label": `${read} of ${total} read` },
    el("i", { style: `width:${total ? Math.round((read / total) * 100) : 0}%` }));
}
function fdEntryEl() {
  const st = fdState();
  if (!st) return null;
  const F = S.library.foundations;
  const next = st.next ? fdMeta(st.next) : null;
  return el("button", { class: "fd-entry", onclick: openFoundations },
    el("span", { class: "fd-entry-h" }, el("b", {}, F.title || "Foundations"), el("span", {}, `${st.read} of ${st.total} read`)),
    progressEl(st.read, st.total),
    el("span", { class: "fd-entry-next" }, next ? `Next: ${next.label}` : "All read. Revisit any of them."));
}
function openFoundations() {
  $("#topic-title").textContent = S.library?.foundations?.title || "Foundations";
  S.overlay = "fd";
  drawFoundations();
  const ov = $("#topic");
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-back").focus({ preventScroll: true });
}
function drawFoundations() {
  const L = S.library, F = L?.foundations, st = fdState();
  const body = $("#topic-body");
  if (!F || !st) { body.replaceChildren(el("p", { class: "nothing" }, "Foundations arrive with the next monthly update.")); return; }
  const keep = body.scrollTop;
  const rowEl = (p) => {
    const c = L.papers[p], m = F.meta[p] || {};
    const read = !!fdRead[p];
    const year = (c.epub || c.ppub || "").slice(0, 4) || c.cites?.year || "";
    return el("li", { class: "fd-row" + (read ? " read" : "") },
      el("button", { class: "fd-check", role: "checkbox", "aria-checked": String(read), "aria-label": `${m.label}: ${read ? "read" : "not read yet"}`,
        onclick: () => { setRead(p, !read); drawFoundations(); } }, read ? icon(ICONS.check) : null),
      el("button", { class: "fd-open", onclick: () => openAbstract({ ...c, type: "paper" }) },
        el("b", {}, m.label || c.title),
        el("span", { class: "fd-why" }, m.why || ""),
        el("span", { class: "fd-src" }, [c.journal, year, c.cites?.n ? `${c.cites.n.toLocaleString()} citations` : null].filter(Boolean).join(" · "))));
  };
  body.replaceChildren(el("div", { class: "fd-page" },
    el("p", { class: "lede small" }, F.about || ""),
    el("div", { class: "fd-total" }, el("b", {}, `${st.read} of ${st.total} read`), progressEl(st.read, st.total)),
    F.groups.map((g) => {
      const items = g.items.filter((p) => L.papers[p]);
      const done = items.filter((p) => fdRead[p]).length;
      return el("section", { class: "sect" },
        el("h2", {}, g.name, el("span", { class: "fd-count" }, `${done} of ${items.length}`)),
        el("ul", { class: "rows fd-list" }, items.map(rowEl)));
    }),
    el("p", { class: "fine" }, "Chosen for how often they’re cited and used in practice (NIH iCite). Tap one for its abstract and links; tap the circle to mark it read. Progress stays on this phone. The list lives in config/foundations.yaml on GitHub.")));
  body.scrollTop = keep;
}

// ── weather: Reno, NV, from the National Weather Service (NOAA) ───────────
// The phone asks api.weather.gov itself (public domain, no key, open to web pages), keeps the last
// forecast for when it's offline, and shows today and tomorrow under the chips.
const WX = { place: "Reno, NV", short: "Reno", grid: "REV/45,106", lat: 39.5296, lon: -119.8138 };
const WX_URL = `https://api.weather.gov/gridpoints/${WX.grid}/forecast`;
const WX_PAGE = `https://forecast.weather.gov/MapClick.php?lat=${WX.lat}&lon=${WX.lon}`;
let wxData = store.get("wx", null);
if (!wxData || typeof wxData !== "object" || !Array.isArray(wxData.periods)) wxData = null;
let wxBusy = false;
async function wxRefresh(maxAgeMin = 30) {
  if (!T.weather || wxBusy) { renderWx(); return; }
  if (wxData?.at && Date.now() - wxData.at < maxAgeMin * 60e3) { renderWx(); return; }
  wxBusy = true;
  try {
    const r = await fetch(WX_URL, { headers: { Accept: "application/geo+json" }, cache: "no-cache", referrerPolicy: "no-referrer" });
    if (!r.ok) throw new Error(`NWS ${r.status}`);
    const d = await r.json();
    const iso = (v) => (typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(v) ? v : null);
    const periods = (d?.properties?.periods || []).slice(0, 8).map((p) => ({
      n: String(p.name || "").slice(0, 40), s: iso(p.startTime), e: iso(p.endTime), day: !!p.isDaytime,
      t: Number.isFinite(p.temperature) ? Math.round(p.temperature) : null, sf: String(p.shortForecast || "").slice(0, 90),
      pop: Number.isFinite(p.probabilityOfPrecipitation?.value) ? p.probabilityOfPrecipitation.value : null,
      df: String(p.detailedForecast || "").slice(0, 500) })).filter((p) => p.s && p.e && p.t != null);
    if (!periods.length) throw new Error("no forecast");
    wxData = { at: Date.now(), up: String(d.properties.updateTime || d.properties.generatedAt || "").slice(0, 30), periods };
    store.set("wx", wxData);
  } catch { /* offline or the NWS busy: keep the last forecast */ }
  finally { wxBusy = false; }
  renderWx();
}
// the forecast's own clock (Reno time): a date string for "now", from the periods' UTC offset
function wxDate(offset, plusDays = 0) {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(offset || "");
  const mins = m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(Date.now() + mins * 60e3 + plusDays * 864e5).toISOString().slice(0, 10);
}
function wxDays() {
  const left = (wxData?.periods || []).filter((p) => Date.parse(p.e) > Date.now());
  if (!left.length) return null;
  const off = left[0].s.slice(19), today = wxDate(off), tom = wxDate(off, 1);
  const day = (d) => left.find((p) => p.day && p.s.slice(0, 10) === d);
  const night = (d) => left.find((p) => !p.day && p.s.slice(0, 10) === d && Number(p.s.slice(11, 13)) >= 12);
  const dow = new Date(`${tom}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return [{ label: "Today", hi: day(today), lo: night(today) }, { label: dow, hi: day(tom), lo: night(tom) }]
    .filter((x) => x.hi || x.lo);
}
const WX_ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  cloud: '<path d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.6 5.6 0 0 0-10.9-1.3A4.5 4.5 0 0 0 7 18.5z"/>',
  partly: '<path d="M8 3.5v1.6M3.5 8h1.6M4.9 4.9l1.1 1.1M11.1 4.9 10 6"/><path d="M5.6 10.6A3 3 0 1 1 10.4 7"/><path d="M9 19.5h8.6a3.2 3.2 0 0 0 .3-6.4 4.7 4.7 0 0 0-9.1-1A3.7 3.7 0 0 0 9 19.5z"/>',
  partlyNight: '<path d="M10.8 4.6A4 4 0 0 0 5.4 10a4 4 0 0 0 5.4-5.4z"/><path d="M9 19.5h8.6a3.2 3.2 0 0 0 .3-6.4 4.7 4.7 0 0 0-9.1-1A3.7 3.7 0 0 0 9 19.5z"/>',
  rain: '<path d="M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.5-1.2A4.2 4.2 0 0 0 7 14.5z"/><path d="M8.5 17.5l-1 2.5M12.5 17.5l-1 2.5M16.5 17.5l-1 2.5"/>',
  snow: '<path d="M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.5-1.2A4.2 4.2 0 0 0 7 14.5z"/><path d="M8 18.5h.01M12 20h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01"/>',
  storm: '<path d="M7 14.5h10.2a3.6 3.6 0 0 0 .4-7.2 5.4 5.4 0 0 0-10.5-1.2A4.2 4.2 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>',
  fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
  wind: '<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h8"/>',
};
function wxKind(sf, day) {
  const s = String(sf || "").toLowerCase();
  if (/thunder|t-storm/.test(s)) return "storm";
  if (/snow|flurr|sleet|blizzard|freezing|ice/.test(s)) return "snow";
  if (/rain|shower|drizzle/.test(s)) return "rain";
  if (/fog|haze|smoke|dust/.test(s)) return "fog";
  if (/mostly cloudy|^cloudy|overcast/.test(s)) return "cloud";
  if (/partly|mostly sunny|mostly clear/.test(s)) return day ? "partly" : "partlyNight";
  if (/sunny|clear|fair/.test(s)) return day ? "sun" : "moon";
  if (/wind|breezy|blustery|gust/.test(s)) return "wind";
  return "cloud";
}
const wxIcon = (p) => {
  const k = wxKind(p.sf, p.day);
  return icon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="wx-i wx-${k}">${WX_ICONS[k]}</svg>`);
};
function renderWx() {
  const box = $("#wx");
  if (!box) return;
  const days = T.weather && S.tab === "feed" ? wxDays() : null;
  const was = !box.hidden;
  if (!days?.length) { box.hidden = true; box.replaceChildren(); }
  else {
    const rain = (x) => Math.max(x.hi?.pop ?? 0, x.lo?.pop ?? 0);
    box.hidden = false;
    box.replaceChildren(el("button", { class: "wx-main", onclick: openWx,
      "aria-label": days.map((x) => `${x.label}: ${x.hi ? `high ${x.hi.t}°, ${x.hi.sf}` : ""}${x.lo ? `, low ${x.lo.t}°` : ""}`).join("; ") + `. ${WX.place}. Opens the forecast.` },
      days.map((x) => el("span", { class: "wx-day" }, wxIcon(x.hi || x.lo),
        el("b", {}, x.hi ? x.label : x.label === "Today" ? "Tonight" : x.label),
        x.hi ? el("span", { class: "wx-hi" }, `${x.hi.t}°`) : null,
        x.lo ? el("span", { class: "wx-lo" }, `${x.hi ? "/ " : ""}${x.lo.t}°`) : null,
        rain(x) >= 30 ? el("span", { class: "wx-pop" }, `${rain(x)}%`) : null)),
      el("span", { class: "wx-place" }, WX.short)));
  }
  if (was !== !box.hidden) requestAnimationFrame(fitAll);
}
function openWx() {
  const left = (wxData?.periods || []).filter((p) => Date.parse(p.e) > Date.now()).slice(0, 5);
  const fetched = wxData?.at ? ago(new Date(wxData.at).toISOString()) : "";
  openSheet(
    el("h2", { id: "sheet-title" }, `${WX.place} weather`),
    el("ul", { class: "rows wx-list" }, left.map((p) => el("li", { class: "row wx-row" },
      el("div", { class: "wx-row-h" }, wxIcon(p), el("b", {}, p.n), el("span", { class: p.day ? "wx-hi" : "wx-lo" }, `${p.day ? "High" : "Low"} ${p.t}°`),
        p.pop >= 10 ? el("span", { class: "wx-pop" }, `${p.pop}% chance of rain or snow`) : null),
      el("p", {}, p.df || p.sf)))),
    el("p", { class: "fine" }, `National Weather Service forecast for ${WX.place}${wxData?.up ? `, issued ${new Date(wxData.up).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}${fetched ? `; checked ${fetched}` : ""}.`),
    el("div", { class: "link-row" },
      el("a", { class: "act", href: WX_PAGE, target: "_blank", rel: "noopener" }, "Full forecast at weather.gov"),
      el("button", { class: "act", onclick: () => { closeSheet(); switchTab("tune"); setPane("reading", "tune-weather"); } }, "Weather settings")));
}

// ── meetings ───────────────────────────────────────────────────────────────
const dayNo = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T12:00:00`) / 864e5);
const meetingOn = (m) => T.meetings[m.id] ?? !m.off;
function meetingPhase(m) {
  const t = dayNo(localDay()), s = dayNo(m.start), e = dayNo(m.end);
  if (t < s) return { phase: "before", days: s - t };
  if (t <= e) return { phase: "on", day: t - s + 1, of: e - s + 1 };
  return { phase: "after", days: t - e };
}
function meetingChips() {
  return (S.news?.meetings || []).filter((m) => {
    if (!meetingOn(m)) return false;
    const p = meetingPhase(m);
    return (p.phase === "before" && p.days <= 7) || p.phase === "on" || (p.phase === "after" && p.days <= 7);
  });
}
function meetingStories(id, mute = mutedRe()) {
  const mutedSrc = new Set(T.mutedSources || []);
  return (S.news?.items || []).filter((n) => (n.meetings || []).includes(id) && !mutedSrc.has(n.source)
    && !(mute && mute.test(n.title)) && !hiddenByTaste({ ...n, type: "news" }))
    .map((n) => ({ ...n, type: "news", kind: kindOf(n) }));
}
const meetingList = (id, mute) => meetingStories(id, mute);
function fmtRange(a, b) {
  const [ya, ma, da] = a.split("-").map(Number), [yb, mb, db] = b.split("-").map(Number);
  if (ma === mb && ya === yb) return `${MON[ma - 1]} ${da}–${db}`;
  return `${MON[ma - 1]} ${da} – ${MON[mb - 1]} ${db}`;
}
function whenText(m) {
  const p = meetingPhase(m);
  if (p.phase === "on") return `on now, day ${p.day} of ${p.of}`;
  if (p.phase === "after") return `ended ${p.days === 1 ? "yesterday" : `${p.days} days ago`}`;
  if (p.days === 0) return "starts today";
  if (p.days === 1) return "starts tomorrow";
  if (p.days < 7) return `starts ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${m.start}T12:00`).getDay()]}`;
  if (p.days < 21) return `starts in ${p.days} days`;
  if (p.days < 63) return `starts in ${Math.round(p.days / 7)} weeks`;
  return `starts in ${Math.round(p.days / 30.4)} months`;
}
function bannerMeeting() {
  let gone = store.get("meetingsClosed", {});
  if (!gone || typeof gone !== "object") gone = {};
  const last = Object.values(gone).filter((d) => typeof d === "string").sort().pop();
  if (last && dayNo(localDay()) - dayNo(last) < 3) return null;       // you just closed one: the next waits a few days
  return (S.news?.meetings || []).find((m) => {
    if (!meetingOn(m) || gone[m.id]) return false;
    const p = meetingPhase(m);
    return (p.phase === "before" && p.days <= 122) || p.phase === "on";       // four months ahead, through the last day
  }) || null;
}
function closeBanner(m) {
  const gone = store.get("meetingsClosed", {}) || {};
  gone[m.id] = localDay();
  store.set("meetingsClosed", gone);
  renderBanner();
  toast(`${m.name} banner closed. Turn meetings on or off in Tune → Interests.`);
}
function renderBanner() {
  renderWx();
  const b = $("#banner");
  if (!b) return;
  const m = S.tab === "feed" ? bannerMeeting() : null;
  const was = !b.hidden;
  if (!m) {
    b.hidden = true;
    b.replaceChildren();
  } else {
    const n = meetingStories(m.id).length;
    const place = (m.place || "").split(",").pop().trim();
    b.hidden = false;
    b.replaceChildren(
      el("button", { class: "banner-main", onclick: () => openMeeting(m) },
        el("b", {}, m.name), el("span", {}, ` ${whenText(m)}`),
        el("span", { class: "banner-sub" }, [fmtRange(m.start, m.end), place, n ? plural(n, "story", "stories") : null].filter(Boolean).join(" · "))),
      el("button", { class: "icon-btn", "aria-label": `Close the ${m.name} banner`, onclick: () => closeBanner(m) }, icon(ICONS.close)));
  }
  if (was !== !b.hidden) requestAnimationFrame(fitAll);
}
function openMeeting(m) {
  if (!m) return;
  const stories = meetingStories(m.id);
  const chip = meetingChips().some((x) => x.id === m.id);
  const longDate = (iso) => new Date(`${iso}T12:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  openSheet(
    el("h2", { id: "sheet-title" }, m.name),
    m.full ? el("p", { class: "sheet-meta" }, el("span", {}, m.full)) : null,
    el("dl", { class: "facts" },
      el("dt", {}, "When"), el("dd", {}, `${longDate(m.start)} to ${longDate(m.end)}`),
      m.place ? [el("dt", {}, "Where"), el("dd", {}, m.place)] : null,
      el("dt", {}, "Stories"), el("dd", {}, stories.length ? `${plural(stories.length, "story", "stories")} so far` : "None yet")),
    el("p", { class: "fine" }, chip ? "A chip for the meeting is in the feed now, with every story that mentions it."
      : "A week before it opens, a chip in the feed gathers every story that mentions it."),
    el("div", { class: "link-row" },
      chip ? el("button", { class: "act", onclick: () => { closeSheet(); S.kind = `meeting:${m.id}`; S.topic = null; refreshFeed(); } }, "Show the coverage") : null,
      /^https:\/\//.test(m.url || "") ? el("a", { class: "act", href: m.url, target: "_blank", rel: "noopener" }, "Meeting website") : null,
      el("button", { class: "act", onclick: () => { closeSheet(); closeBanner(m); } }, "Close the banner"),
      el("button", { class: "act", onclick: () => { closeSheet(); switchTab("tune"); setPane("interests", "tune-meetings"); } }, "Meeting settings")));
}

// ── guess the result ───────────────────────────────────────────────────────
let QUIZ = store.get("quiz", null);
if (!QUIZ || typeof QUIZ !== "object" || typeof QUIZ.by !== "object") QUIZ = { by: {}, days: {} };
const quizTotals = (days = null) => {
  const t = { r: 0, p: 0, w: 0 };
  const cut = days ? localDay(daysAgo(days - 1)) : "";
  for (const [d, v] of Object.entries(QUIZ.days || {})) if (d >= cut) ["r", "p", "w"].forEach((k, i) => { t[k] += v[i] || 0; });
  return t;
};
function recordGuess(pmid, how) {
  if (QUIZ.by[pmid]) return;
  QUIZ.by[pmid] = how;
  const d = localDay();
  const v = QUIZ.days[d] || (QUIZ.days[d] = [0, 0, 0]);
  v[{ r: 0, p: 1, w: 2 }[how]]++;
  const keys = Object.keys(QUIZ.by);
  if (keys.length > 800) keys.slice(0, keys.length - 800).forEach((k) => delete QUIZ.by[k]);
  const no = Object.keys(QUIZ.no || {});
  if (no.length > 400) no.slice(0, no.length - 400).forEach((k) => delete QUIZ.no[k]);
  const cut = localDay(daysAgo(365));
  for (const k of Object.keys(QUIZ.days)) if (k < cut) delete QUIZ.days[k];
  store.set("quiz", QUIZ);
}
const guessable = (p) => p.conclusion?.kind === "structured" && !!(p.abs || p.sections) && !QUIZ.by[p.pmid] && !QUIZ.no?.[p.pmid];
function guessCardEl(it) {
  if (QUIZ.by[it.pmid]) return paperCardEl(it);
  const inner = el("div", { class: "concl-inner" }, el("p", { class: "guess-wait" }, "Loading the question…"));
  const box = el("div", { class: "concl guess-box" }, inner);
  const reveal = el("button", { class: "reveal", onclick: () => doReveal() },
    el("b", {}, "What did they find?"), el("span", {}, "Make your guess, then tap for the authors’ conclusion"));
  const card = el("article", { class: "card guess-card", "data-pmid": it.pmid, "data-key": it.pmid },
    el("div", { class: "card-meta" },
      el("span", { class: "card-journal" }, it.journal),
      el("span", {}, fmtDate(it.epub || it.added)),
      el("span", { class: "spacer" }),
      el("span", { class: "lang guess-tag" }, "Guess the result")),
    el("h2", { class: "card-title clamp" }, it.title),
    box, evidenceEl(it.design, false, it.sample), reveal, actionsEl(it, true));
  const plain = (unfit) => {               // no question or methods to show: the ordinary card
    if (unfit) { QUIZ.no = { ...(QUIZ.no || {}), [it.pmid]: 1 }; store.set("quiz", QUIZ); }     // and never chosen to guess again
    if (!card.isConnected) return;
    const c = paperCardEl(it);
    c._it = it;
    c.append(clearBtn(it));
    card.replaceWith(c);
    gridRO?.observe(c);
    seenObserver?.observe(c);
    requestAnimationFrame(() => fitCard(c));
  };
  sectionsOf(it).then((secs) => {
    const q = secs.find((s) => s.cat === "OBJECTIVE") || secs.find((s) => /purpose|objective|aim|question|hypothes/i.test(s.label))
      || secs.find((s) => s.cat === "BACKGROUND" || /^(background|introduction|context)/i.test(s.label));
    const m = secs.find((s) => s.cat === "METHODS") || secs.find((s) => /method|design|materials|patients|participants|population/i.test(s.label));
    if (!q && !m) { plain(true); return; }
    const qLabel = q && (q.cat === "BACKGROUND" || /^(background|introduction|context)/i.test(q.label)) ? "Background" : "The question";
    Object.assign(card, { _q: q, _m: m, _qLabel: qLabel, _reveal: doReveal });
    inner.replaceChildren(
      q ? el("div", { class: "concl-label" }, qLabel) : null,
      q ? el("p", { class: "guess-text", "data-part": "q" }, q.text) : null,
      m ? el("div", { class: "concl-label" }, "How they did it") : null,
      m ? el("p", { class: "guess-text small", "data-part": "m" }, m.text) : null);
    requestAnimationFrame(() => fitGuess(card));
  }).catch(() => plain(false));
  function doReveal() {
    const c = it.conclusion;
    card.classList.add("revealed");
    inner.replaceChildren(el("div", { class: "concl-label" }, conclLabel(c)), el("p", { class: `concl-text ${lenClass(c.text)}` }, c.text));
    const done = (how) => {
      recordGuess(it.pmid, how);
      const t = quizTotals();
      ask.replaceChildren(el("p", { class: "guess-score" }, { r: "You called it.", p: "Close.", w: "A surprise, then." }[how],
        ` ${t.r} right${t.p ? `, ${t.p} close` : ""} of ${t.r + t.p + t.w} so far.`));
    };
    const ask = el("div", { class: "guess-ask" }, el("span", {}, "Did you call it?"),
      [["r", "Yes"], ["p", "Partly"], ["w", "No"]].map(([k, l]) => el("button", { class: "act", onclick: () => done(k) }, l)));
    reveal.replaceWith(ask);
    requestAnimationFrame(() => fitCard(card));
  }
  return card;
}
// The question and methods in full whenever they fit. If not: smaller type (methods first), then
// fewer lines of the methods, then of the question, with the full text a tap away.
function fitGuess(card) {
  const box = card.querySelector(".guess-box"), inner = box?.querySelector(".concl-inner");
  const q = inner?.querySelector('.guess-text[data-part="q"]'), m = inner?.querySelector('.guess-text[data-part="m"]');
  if (!box?.clientHeight || !(q || m)) return;
  const clamp = (p, n) => { p.style.webkitLineClamp = n; p.style.lineClamp = n; };
  inner.querySelector(".more-note")?.remove();
  for (const p of [q, m]) if (p) { clamp(p, "none"); p.classList.remove("tight"); p.hidden = false; }
  const mLabel = m?.previousElementSibling;
  if (mLabel) mLabel.hidden = false;
  const title = card.querySelector(".card-title");
  title?.classList.add("clamp");
  if (isFlow()) {                    // compact: the question up to six lines, the methods four, the rest a tap away
    if (q) clamp(q, "6");
    if (m) clamp(m, "4");
    if ([q, m].some((p) => p && p.scrollHeight > p.clientHeight + 1))
      inner.append(el("button", { class: "concl-label more-note", onclick: () => openGuessText(card) }, "Read the full question and methods"));
    return;
  }
  const over = () => inner.scrollHeight > box.clientHeight + 1;
  if (!over()) {                                            // room to spare: the whole title too, if it fits
    if (title && title.scrollHeight > title.clientHeight + 1) { title.classList.remove("clamp"); if (over()) title.classList.add("clamp"); }
    return;
  }
  for (const p of [m, q]) if (p && over()) p.classList.add("tight");
  if (!over()) return;
  inner.append(el("button", { class: "concl-label more-note", onclick: () => openGuessText(card) }, "Read the full question and methods"));
  // the question is what you guess from: the methods give way first, all the way, before it's shortened
  const fitLines = (p) => {
    const lh = parseFloat(getComputedStyle(p).lineHeight) || 22;
    clamp(p, String(Math.max(2, Math.floor((p.offsetHeight - (inner.scrollHeight - box.clientHeight)) / lh))));
    for (let n = 0; n < 12 && over() && Number(p.style.webkitLineClamp) > 2; n++) clamp(p, String(Number(p.style.webkitLineClamp) - 1));
  };
  if (m && over()) fitLines(m);
  if (m && q && over()) { m.hidden = true; if (mLabel) mLabel.hidden = true; }
  if (q && over()) fitLines(q);
}
// the whole question and methods, still without the answer
function openGuessText(card) {
  const { _q: q, _m: m } = card;
  openSheet(
    el("h2", { id: "sheet-title" }, card.querySelector(".card-title")?.textContent || "The study"),
    q ? [el("div", { class: "concl-label" }, card._qLabel || "The question"), el("p", { class: "guess-full" }, q.text)] : null,
    m ? [el("div", { class: "concl-label" }, "How they did it"), el("p", { class: "guess-full small" }, m.text)] : null,
    el("p", { class: "fine" }, "Make your guess, then see what they found."),
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => { closeSheet(); card._reveal?.(); } }, "What did they find?")));
}

// ── Today ──────────────────────────────────────────────────────────────────
// A short stack each morning: the best new papers for your areas (a couple to guess), the
// day's big stories, the classic of the day and your next Foundations paper, then the end.
function briefPlan() {
  const d = localDay();
  const N = T.brief.papers;
  let plan = store.get("brief", null);
  const items = S.feed?.items || [];
  const byId = new Map(items.map((p) => [p.pmid, p]));
  if (!plan || typeof plan !== "object" || plan.d !== d) {
    let hist = store.get("briefHist", {});            // papers earlier briefs showed: not again
    if (!hist || typeof hist !== "object") hist = {};
    if (plan?.d && Array.isArray(plan.papers)) plan.papers.forEach((p) => { hist[p] = plan.d; });
    const cut = localDay(daysAgo(45));
    for (const [k, v] of Object.entries(hist)) if (v < cut) delete hist[k];
    store.set("briefHist", hist);
    plan = { d, papers: [], guess: [], stories: null, gen: null };
  }
  const hist = store.get("briefHist", {}) || {};
  plan.papers = plan.papers.filter((p) => byId.has(p) && !hiddenByTaste(byId.get(p))).slice(0, N);
  if (plan.papers.length < N && (plan.gen !== S.feed?.generated || plan.n !== N)) {    // new papers since, or a longer brief: top it up
    const since = localDay(daysAgo(7));
    const now = Date.now();
    const re = followRe();
    const pool = items.filter((p) => !plan.papers.includes(p.pmid) && !hist[p.pmid] && (p.added || "") >= since
      && (p.conclusion?.kind || "none") !== "none" && homeArea(p) && !(seenRecent[p.pmid] && seenRecent[p.pmid] < d))
      .map((p) => ({ p, t: tasteOf(p) })).filter((x) => x.t > -1.5)
      .map((x) => ({ ...x, s: paperScore(x.p, now).score * Math.pow(1.7, x.t) * (re && followHit(x.p, re) ? 1.6 : 1) }))
      .sort((a, b) => b.s - a.s);
    const queues = {};
    for (const x of pool) (queues[homeArea(x.p)] = queues[homeArea(x.p)] || []).push(x.p);
    const sys = {};
    for (const p of plan.papers) { const y = (byId.get(p).systems || [])[0]; if (y) sys[y] = (sys[y] || 0) + 1; }
    for (const p of (Object.keys(queues).length > 1 ? interleave(queues, T.areas) : pool.map((x) => x.p))) {
      if (plan.papers.length >= N) break;
      const y = (p.systems || [])[0];
      if (y && (sys[y] || 0) >= 2) continue;            // no more than two from one organ system
      if (y) sys[y] = (sys[y] || 0) + 1;
      plan.papers.push(p.pmid);
    }
    plan.gen = S.feed?.generated || null;
  }
  plan.n = N;
  // guess the result: two papers a day (one when the brief is short)
  const want = T.guess === "off" ? 0 : plan.papers.length >= 4 ? 2 : plan.papers.length ? 1 : 0;
  plan.guess = (plan.guess || []).filter((p) => plan.papers.includes(p)).slice(0, want);
  for (const p of plan.papers) {
    if (plan.guess.length >= want) break;
    if (!plan.guess.includes(p) && plan.papers.indexOf(p) > 0 && guessable(byId.get(p))) plan.guess.push(p);
  }
  if ((!plan.stories || plan.sn !== T.brief.stories) && S.news) { plan.stories = pickStories(T.brief.stories); plan.sn = T.brief.stories; }
  const newsById = new Map((S.news?.items || []).map((i) => [i.id, i]));
  if (plan.light && (!newsById.has(plan.light) || hiddenByTaste({ ...newsById.get(plan.light), type: "news" }))) plan.light = null;
  if (T.brief.light && !plan.light && S.news) plan.light = pickLight(d);
  store.set("brief", plan);
  return plan;
}
// something lighter: one Light reading story a day, from a different outlet each day, never one shown before
function pickLight(d) {
  let seen = store.get("briefLight", {});
  if (!seen || typeof seen !== "object") seen = {};
  const cut = localDay(daysAgo(60));
  for (const [k, v] of Object.entries(seen)) if (v < cut) delete seen[k];
  const since = new Date(Date.now() - 4 * 864e5).toISOString();
  const mutedSrc = new Set(T.mutedSources || []);
  const pool = (S.news?.items || []).filter((i) => kindOf(i) === "light" && (i.date || "") >= since && !seen[i.id]
    && !mutedSrc.has(i.source) && !hiddenByTaste({ ...i, type: "news" }) && !obitHidden(i));
  if (!pool.length) return null;
  const srcs = [...new Set(pool.map((i) => i.source))].sort();
  const src = srcs[dayNo(d) % srcs.length];
  const pick = pool.filter((i) => i.source === src).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  seen[pick.id] = d;
  store.set("briefLight", seen);
  return pick.id;
}
function pickStories(n) {
  if (!n) return [];
  const newsById = new Map((S.news?.items || []).map((i) => [i.id, i]));
  const mutedSrc = new Set(T.mutedSources || []);
  const tops = topStoryLists(null).flatMap(([label, list, k]) => ((T.mix[k] ?? 1) > 0 ? list.map((st) => ({ st, k, label })) : []))
    .filter(({ st }) => !hiddenByTaste({ type: "news", source: st.sources[0], title: st.title }))
    .map((x) => { const lead = newsById.get(x.st.items?.[0]); return { ...x, t: lead ? Math.max(-2, tasteOf({ ...lead, type: "news" })) : 0 }; })
    .sort((a, b) => (b.st.sources.length + b.t) - (a.st.sources.length + a.t) || (a.st.date < b.st.date ? 1 : -1));
  const out = [];
  for (const pass of [1, 2]) {               // one story per kind first, so one busy kind can't take every slot
    for (const { st, label } of tops) {
      if (out.length >= n) break;
      if (out.some((o) => o.title === st.title) || (pass === 1 && out.some((o) => o.label === label))) continue;
      out.push({ title: st.title, items: st.items, sources: st.sources, date: st.date, label });
    }
  }
  if (out.length < n) {                      // a quiet week: the newest industry stories instead
    const newest = (S.news?.items || []).filter((i) => kindOf(i) === "industry" && !mutedSrc.has(i.source) && !hiddenByTaste({ ...i, type: "news" }) && !obitHidden(i))
      .slice(0, 12).filter((i) => !out.some((o) => o.items.includes(i.id)));
    for (const i of newest.slice(0, n - out.length)) out.push({ title: i.title, items: [i.id], sources: [i.source], date: i.date, label: newsKinds().industry || "Industry news" });
  }
  return out;
}
function briefList() {
  if (!S.feed && !S.news) return [];
  const plan = briefPlan();
  const byId = new Map((S.feed?.items || []).map((p) => [p.pmid, p]));
  const papers = plan.papers.map((p) => ({ ...byId.get(p), type: "paper", _guess: plan.guess.includes(p) }));
  const classic = T.brief.classic ? classicToday() : null;
  const wide = T.brief.wide ? wideToday() : null;
  const fd = T.brief.foundations ? fdState() : null;
  const stories = (plan.stories || []).filter((s) => s.items?.length);
  const lightItem = T.brief.light && plan.light ? (S.news?.items || []).find((i) => i.id === plan.light) : null;
  const light = lightItem ? { ...lightItem, type: "news", kind: kindOf(lightItem), _light: true } : null;
  const sig = [plan.papers.join(","), plan.guess.join(","), stories.length, classic?.pmid, wide?.pmid, fd?.read, fd?.next, light?.id].join("|");
  const out = [...alertCards(), { type: "brief-cover", key: "brief:cover", sig, plan, classic, wide, fd, stories, light }];
  const soon = T.brief.horizon && typeof hzEvents === "function" ? hzEvents(7) : [];
  if (soon.length) out.push({ type: "brief-horizon", key: "brief:horizon", sig: soon.map((e) => e.id).join(","), events: soon });
  papers.forEach((p, i) => {
    out.push(p);
    if (i === 1 && stories.length) out.push({ type: "brief-stories", key: "brief:stories", sig: stories.map((s) => s.title).join("|"), stories });
    if (i === 2 && classic) out.push(classic);
    if (i === 3 && wide) out.push(wide);
  });
  if (papers.length < 2 && stories.length) out.push({ type: "brief-stories", key: "brief:stories", sig: stories.map((s) => s.title).join("|"), stories });
  if (papers.length < 3 && classic) out.push(classic);
  if (papers.length < 4 && wide) out.push(wide);
  if (light) out.push(light);
  if (fd?.next) out.push({ type: "fd-next", key: "fd:next", sig: `${fd.next}|${fd.read}`, fd });
  out.push({ type: "brief-end", key: "brief:end", sig, plan });
  return out;
}
function briefCardEl(it) {
  if (it.type === "alert") return alertCardEl(it);
  if (it.type === "brief-horizon") return hzCardEl(it);
  if (it.type === "brief-cover") return briefCoverEl(it);
  if (it.type === "brief-stories") return briefStoriesEl(it);
  if (it.type === "fd-next") return fdNextEl(it);
  return briefEndEl(it);
}
function briefCoverEl(it) {
  const now = new Date();
  const n = it.plan.papers.length, g = it.plan.guess.length;
  const parts = [n ? plural(n, "new paper") : null, it.stories.length ? plural(it.stories.length, "story", "stories") : null,
    it.classic ? "a classic" : null, it.wide ? "one from outside your areas" : null, it.light ? "something lighter" : null, it.fd?.next ? "your next Foundations paper" : null].filter(Boolean);
  const mins = Math.max(2, Math.round(n * 1.2 + it.stories.length * 0.6 + (it.classic ? 1.5 : 0) + (it.wide ? 1.5 : 0) + (it.light ? 1 : 0) + (it.fd?.next ? 1 : 0)));
  const m = bannerMeeting() ? null : meetingChips()[0];          // the banner already says it
  const hour = now.getHours();
  return el("article", { class: "card brief-card brief-cover", "data-key": "brief:cover" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Today"),
      el("span", {}, hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening")),
    el("div", { class: "brief-date" },
      el("span", { class: "brief-day" }, now.toLocaleDateString("en-US", { weekday: "long" })),
      el("span", { class: "brief-md" }, now.toLocaleDateString("en-US", { month: "long", day: "numeric" }))),
    el("p", { class: "brief-lede" }, parts.length
      ? `${parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1] : parts[0]}. About ${mins} minutes.`
      : "A quiet day: nothing new in your areas yet. The papers arrive each morning."),
    el("ul", { class: "brief-notes" },
      g ? el("li", {}, el("b", {}, "Guess the result. "), `${g === 1 ? "One paper hides" : "Two papers hide"} the conclusion until you’ve thought it through.`) : null,
      it.fd ? el("li", {}, el("b", {}, "Foundations. "), `${it.fd.read} of ${it.fd.total} read.`) : null,
      m ? el("li", {}, el("b", {}, `${m.name}. `), `${whenText(m)[0].toUpperCase()}${whenText(m).slice(1)}${m.place ? `, ${m.place.split(",").pop().trim()}` : ""}.`) : null),
    el("p", { class: "fine brief-swipe swipe-hint" }, n || it.stories.length ? "Swipe up to start." : "Swipe up for the rest."));
}
function briefStoriesEl(it) {
  const byId = Object.fromEntries((S.news?.items || []).map((i) => [i.id, i]));
  return el("article", { class: "card brief-card top-card", "data-key": "brief:stories" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, it.stories.length === 1 ? "Today’s story" : "Today’s stories"),
      el("span", {}, "the ones most outlets covered")),
    el("div", { class: "top-lists" }, el("ol", { class: "top-list brief-stories" }, it.stories.map((st) => {
      const first = byId[st.items[0]];
      return el("li", {}, el("button", { onclick: () => (st.items.length > 1 ? openStory(st, byId) : first && window.open(safeUrl(first.link), "_blank", "noopener")) },
        el("span", { class: "top-meta" }, `${st.label} · ${st.sources.length > 1 ? `${st.sources.length} outlets` : st.sources[0]}`),
        el("span", { class: "top-title" }, st.title),
        first?.summary ? el("span", { class: "news-teaser clamp2" }, first.summary) : null));
    }))),
    el("p", { class: "fine", style: "margin:0" }, "Tap one for every outlet’s take."));
}
function fdNextEl(it) {
  const L = S.library, p = it.fd.next, c = L.papers[p], m = fdMeta(p) || {};
  return el("article", { class: "card brief-card fd-card", "data-key": "fd:next" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Foundations"), el("span", {}, `${it.fd.read} of ${it.fd.total} read`)),
    progressEl(it.fd.read, it.fd.total),
    el("div", { class: "concl" }, el("div", { class: "concl-inner" },
      el("div", { class: "concl-label" }, `Next · ${fdGroupName(m.group)}`),
      el("h2", { class: "fd-label" }, m.label || c.title),
      el("p", { class: "fd-why-big" }, m.why || ""),
      el("p", { class: "fine" }, [c.journal, (c.epub || c.ppub || "").slice(0, 4), c.cites?.n ? `${c.cites.n.toLocaleString()} citations` : null].filter(Boolean).join(" · ")))),
    el("div", { class: "actions", style: "grid-template-columns:repeat(3,1fr)" },
      el("button", { class: "act", onclick: () => openAbstract({ ...c, type: "paper" }) }, icon(ICONS.abstract), "Abstract"),
      el("button", { class: "act", onclick: () => { setRead(p, true); updateFeedQuietly(1e9); } }, icon(ICONS.check), "Read it"),
      el("button", { class: "act", onclick: openFoundations }, "All")));
}
function briefEndEl(it) {
  const seen = new Set(seenToday.d === localDay() ? seenToday.seen || [] : []);
  const read = it.plan.papers.filter((p) => seen.has(p)).length;
  const q = quizTotals(1);
  const tried = q.r + q.p + q.w;
  return el("article", { class: "card brief-card brief-end", "data-key": "brief:end" },
    el("div", { class: "brief-end-in" },
      el("span", { class: "brief-check" }, icon(ICONS.check)),
      el("h2", {}, "You’re caught up"),
      el("p", {}, it.plan.papers.length ? `${read} of ${plural(it.plan.papers.length, "paper")} in today’s brief read.` : "Nothing new in your areas today.",
        tried ? ` You called ${q.r}${q.p ? ` (and nearly ${q.p})` : ""} of ${plural(tried, "result")}.` : ""),
      el("div", { class: "link-row", style: "justify-content:center" },
        el("button", { class: "act", onclick: () => { S.kind = "all"; S.topic = null; refreshFeed(); } }, "Keep reading: Everything"),
        fdState() ? el("button", { class: "act", onclick: openFoundations }, "Foundations") : null),
      readingHints().length ? el("p", { class: "fine" }, "Readout noticed something in your reading. ",
        el("button", { class: "inline-link", onclick: () => { switchTab("tune"); setPane("reading", "tune-hints"); } }, "See the suggestion")) : null,
      el("p", { class: "fine" }, "Tomorrow’s brief comes with the morning’s papers.")));
}
