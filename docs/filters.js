/* Readout: topic filters. Hide a subject everywhere unless it mentions something you want
   ("heart valves, unless CT or radiology"). No AI: each subject is the list of words,
   abbreviations and device names stories use for it, so Heart valves catches TAVR, MitraClip and
   Navitor without the word valve. A card is about a subject when its headline names it, or the
   text under the headline does twice. Any mention of an exception keeps it, and so does a radiology
   journal or outlet (a TAVR story in AuntMinnie is a radiology story).
   Loaded before app.js, which checks stored filters against these lists. */

// i: any case, whole words (and plurals), * for any ending; c: exact case (abbreviations, brands)
const SUBJECTS = {
  valves: { label: "Heart valves", eg: "TAVR and TAVI, aortic stenosis, mitral and tricuspid repair, valve devices like Sapien and Navitor",
    i: ["heart valve", "aortic valve", "pulmonary valve", "pulmonic valve", "prosthetic valve", "bioprosthetic valve", "transcatheter valve",
      "valve replacement", "valve repair", "valve disease", "valve surgery", "valve implantation", "valve-in-valve", "valvul*", "paravalvular",
      "aortic stenosis", "aortic regurgitation", "aortic insufficiency", "bicuspid aortic", "transcatheter aortic", "mitral*", "tricuspid*",
      "annuloplast*", "edge-to-edge", "MitraClip", "TriClip", "Evolut", "Navitor", "Acurate", "Evoque", "Tendyne"],
    c: ["TAVR", "TAVRs", "TAVI", "TAVIs", "SAVR", "TMVR", "TMVr", "TTVR", "TTVI", "TEER", "PVL", "SAPIEN", "Sapien 3", "PASCAL"] },
  rhythm: { label: "Heart rhythm", eg: "AFib, ablation, pacemakers and defibrillators, LAA closure",
    i: ["atrial fibrillation", "afib", "a-fib", "atrial flutter", "arrhythmi*", "pacemaker", "leadless", "cardiac pacing", "conduction system pacing",
      "left bundle branch", "defibrillator", "implantable cardioverter", "electrophysiolog*", "atrial appendage", "Watchman", "catheter ablation",
      "pulsed field", "cardiac ablation", "ventricular tachycardia", "long QT", "sudden cardiac"],
    c: ["AF", "AFib", "LAAO", "LAAC", "PFA", "CIED", "CIEDs", "LBBAP", "ILR", "LBBB", "S-ICD"] },
  stents: { label: "Stents & bypass", eg: "PCI and coronary stents, angioplasty, bypass surgery, the cath lab",
    i: ["coronary stent", "drug-eluting", "percutaneous coronary", "coronary angioplasty", "balloon angioplasty", "bypass surgery",
      "coronary artery bypass", "cath lab", "catheterization lab", "intravascular ultrasound", "chronic total occlusion", "left main"],
    c: ["PCI", "CABG", "IVUS"] },
  hf: { label: "Heart failure", eg: "HFpEF and HFrEF, LVADs, heart transplant, heart failure drugs",
    i: ["heart failure", "ventricular assist", "cardiomyopath*", "ejection fraction", "heart transplant*"],
    c: ["HFpEF", "HFrEF", "HFmrEF", "LVAD", "LVADs", "GDMT"] },
  glp1: { label: "Weight-loss drugs", eg: "GLP-1s like Ozempic, Wegovy and Zepbound, diabetes drugs, insulin",
    i: ["GLP-1", "semaglutide", "tirzepatide", "liraglutide", "orforglipron", "retatrutide", "cagrilintide", "CagriSema", "Ozempic", "Wegovy",
      "Mounjaro", "Zepbound", "Rybelsus", "weight-loss drug", "weight loss drug", "obesity drug", "anti-obesity", "insulin", "diabetes drug"] },
  vaccines: { label: "Vaccines", eg: "vaccines, boosters, immunization schedules, ACIP",
    i: ["vaccin*", "immuniz*", "immunis*", "booster shot", "anti-vax*", "antivax*"], c: ["ACIP"] },
  covid: { label: "COVID & flu", eg: "COVID, flu, bird flu, RSV",
    i: ["COVID*", "coronavirus", "SARS-CoV-2", "influenza", "flu", "bird flu", "long COVID"], c: ["H5N1", "RSV"] },
  dental: { label: "Dental", eg: "dentists, teeth, orthodontics, oral health",
    i: ["dental", "dentist*", "tooth", "teeth", "orthodont*", "periodont*", "oral health"] },
  eyes: { label: "Eye care", eg: "ophthalmology, retina, cataracts, glaucoma, macular degeneration",
    i: ["ophthalm*", "retina", "retinal", "cataract", "glaucoma", "macular degeneration", "eye drop", "optometr*", "myopia"], c: ["LASIK"] },
  joints: { label: "Joint & spine surgery", eg: "knee and hip replacement, arthroplasty, spinal fusion",
    i: ["knee replacement", "hip replacement", "joint replacement", "arthroplast*", "spinal fusion", "orthopedic implant", "orthopaedic implant"] },
  sports: { label: "Sports", eg: "the NFL, NBA and other leagues, the Olympics, playoffs",
    i: ["Super Bowl", "World Cup", "World Series", "Stanley Cup", "March Madness", "quarterback", "playoff", "Olympic", "Olympic Games", "Premier League",
      "touchdown", "Wimbledon", "Formula 1"],
    c: ["NFL", "NBA", "MLB", "NHL", "WNBA", "NCAA", "FIFA", "UFC", "MLS", "F1"] },
  crypto: { label: "Crypto", eg: "bitcoin, stablecoins, crypto markets",
    i: ["crypto", "cryptocurrenc*", "bitcoin", "ethereum", "stablecoin", "blockchain"], c: ["NFT", "NFTs"] },
};
const KEEP_CT = { i: ["computed tomograph*", "CT scan", "CT angiograph*", "cardiac CT", "photon-counting", "photon counting"],
  c: ["CT", "CTs", "CTA", "CCTA", "4D-CT", "4DCT", "MDCT", "HRCT", "PCCT", "DECT", "CTP", "FFRct", "FFRCT", "FFR-CT", "SCCT"] };
const KEEP_MRI = { i: ["magnetic resonance", "cardiac MR"], c: ["MRI", "MRIs", "fMRI", "CMR", "MRA"] };
const KEEP_NM = { i: ["nuclear medicine", "nuclear cardiology", "scintigraph*", "radiotracer*", "radiopharm*", "radioligand*", "theranostic*",
  "lutetium", "molecular imaging", "positron"], c: ["PET", "SPECT", "PSMA", "FDG", "FAPI", "SNMMI", "Lu-177", "177Lu", "Tc-99m", "99mTc"] };
const KEEPS = {
  ct: { label: "CT & CTA", ...KEEP_CT },
  imaging: { label: "Radiology & imaging",       // any modality, and the radiology outlets and societies
    i: ["radiolog*", "imaging", "image-guided", "mammogra*", "breast density", "ultrasound", "sonograph*", "x-ray", "radiograph*", "scan", "scanner",
      "AuntMinnie", ...KEEP_CT.i, ...KEEP_MRI.i, ...KEEP_NM.i],
    c: ["RSNA", "ACR", "ARRS", ...KEEP_CT.c, ...KEEP_MRI.c, ...KEEP_NM.c] },
  mri: { label: "MRI", ...KEEP_MRI },
  nm: { label: "Nuclear medicine", ...KEEP_NM },
  ai: { label: "AI", i: ["artificial intelligence", "deep learning", "machine learning", "neural network", "algorithm"], c: ["AI", "LLM", "LLMs"] },
};
const RULE_DEFAULTS = [{ s: "valves", words: [], keep: ["ct", "imaging"], keepWords: [] }];
// a stored filter, checked: a known subject or your own words, known exceptions, short words
function cleanRule(r) {
  if (!r || typeof r !== "object") return null;
  const words = (list) => [...new Set((Array.isArray(list) ? list : []).filter((w) => typeof w === "string")
    .map((w) => w.trim().replace(/\s+/g, " ")).filter((w) => w && w.length <= 60))].slice(0, 20);
  const s = typeof r.s === "string" && SUBJECTS[r.s] ? r.s : "";
  const out = { s, words: words(r.words), keep: [...new Set((Array.isArray(r.keep) ? r.keep : []).filter((k) => KEEPS[k]))], keepWords: words(r.keepWords) };
  return out.s || out.words.length ? out : null;
}

// a set of words as two regexes, one for any case and one exact; has(), count() and first()
const escRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function termSet(i = [], c = []) {
  const ci = wordRe(i), cc = c.length ? `(?:^|[^\\p{L}\\p{N}])(?:${c.map(escRe).join("|")})(?![\\p{L}\\p{N}])` : null;
  const res = [ci && new RegExp(ci.source, "giu"), cc && new RegExp(cc, "gu")].filter(Boolean);
  if (!res.length) return null;
  return {
    has: (t) => res.some((re) => t.search(re) >= 0),
    count: (t) => res.reduce((n, re) => n + (t.match(re) || []).length, 0),
    first: (t) => {                     // the word as written, whole (radiolog* → radiology)
      for (const re of res) {
        re.lastIndex = 0;
        const m = re.exec(t);
        if (m) return (m[0] + t.slice(m.index + m[0].length).match(/^[\p{L}\p{N}]*/u)[0]).replace(/^[^\p{L}\p{N}]/u, "");
      }
      return "";
    },
  };
}
// a filter's words: h the subject's (any case), hc exact case; k and kc what keeps a card anyway.
// Notifications get these too (push.js), so pipeline/notify.py needs no copy of the lists above.
function ruleTerms(r) {
  const subj = r.s ? SUBJECTS[r.s] : null;
  return { h: [...(subj?.i || []), ...r.words], hc: [...(subj?.c || [])],
    k: [...new Set([...r.keep.flatMap((k) => KEEPS[k].i || []), ...r.keepWords])], kc: [...new Set(r.keep.flatMap((k) => KEEPS[k].c || []))] };
}
function compileRule(r) {
  const t = ruleTerms(r);
  const hide = termSet(t.h, t.hc), keep = termSet(t.k, t.kc);
  return hide ? { r, hide, keep } : null;
}
let ruleMemo = [null, []];
function compiledRules() {
  if (ruleMemo[0] !== T.rules) ruleMemo = [T.rules, (T.rules || []).map(compileRule).filter(Boolean)];
  return ruleMemo[1];
}
const subjectMemo = {};
const subjectSet = (s) => subjectMemo[s] || (subjectMemo[s] = termSet(SUBJECTS[s].i, SUBJECTS[s].c));

// what a card says, in three parts: the headline, the text under it, and where it's from
function ruleTexts(it) {
  if (it.type === "watch" || it.ev) {
    const e = it.ev || it;
    return { head: `${e.acr || ""} ${e.title || ""}`, body: `${e.what || ""} ${e.sub || ""} ${e.pcn || ""}`, from: "" };
  }
  if (it.pmid || it.type === "paper") {
    const tp = (it.topics || []).map((k) => S.feed?.topics?.[k]?.name || "").join(" ");
    return { head: it.title || "", body: it.conclusion?.text || "", from: `${it.journal_full || ""} ${it.journal || ""} ${tp}` };
  }
  return { head: it.title || "", body: it.summary || "", from: it.source || "" };
}
const isAbout = (set, t) => set.has(t.head) || set.count(t.body) >= 2;
// the first filter that hides this card, or null; kept: the filter and the word that kept it
function ruleHit(it, rules = compiledRules()) {
  if (!it || !rules.length) return null;
  const t = ruleTexts(it);
  for (const x of rules) if (isAbout(x.hide, t) && !(x.keep && x.keep.has(`${t.head} ${t.body} ${t.from}`))) return x;
  return null;
}
function ruleKept(it, rules = compiledRules()) {
  if (!it || !rules.length) return null;
  const t = ruleTexts(it);
  for (const x of rules) {
    if (!isAbout(x.hide, t) || !x.keep) continue;
    const w = x.keep.first(`${t.head} ${t.body}`) || x.keep.first(t.from);
    if (w) return { x, word: w, from: !x.keep.has(`${t.head} ${t.body}`) };
  }
  return null;
}
// the subjects a card is about that no filter hides yet (Rate offers them)
function subjectsOf(it) {
  const t = ruleTexts(it);
  const have = new Set((T.rules || []).map((r) => r.s).filter(Boolean));
  return Object.keys(SUBJECTS).filter((s) => !have.has(s) && isAbout(subjectSet(s), t));
}

const ruleKey = (r) => JSON.stringify([r.s, r.words, r.keep, r.keepWords]);
const quoteList = (ws) => ws.map((w) => `“${w}”`);
const orList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`);
const ruleName = (r) => (r.s ? SUBJECTS[r.s].label : orList(quoteList(r.words))) + (r.s && r.words.length ? `, ${quoteList(r.words).join(", ")}` : "");
const ruleUnless = (r) => {
  const xs = r.keep.map((k) => KEEPS[k].label).concat(quoteList(r.keepWords));
  return xs.length ? `unless it mentions ${orList(xs)}` : "everywhere";
};
function removeRule(r) { setTune({ rules: (T.rules || []).filter((x) => ruleKey(x) !== ruleKey(r)) }); }
function putRule(r, old = null) {
  const list = (T.rules || []).filter((x) => ruleKey(x) !== ruleKey(r) && (!old || ruleKey(x) !== ruleKey(old)));
  const at = old ? (T.rules || []).findIndex((x) => ruleKey(x) === ruleKey(old)) : -1;
  list.splice(at < 0 ? list.length : Math.min(at, list.length), 0, r);
  setTune({ rules: list.slice(0, 30) });
}

// what a filter would do with the last week's cards and Watch changes
function ruleReach(r, days = 7) {
  const x = compileRule(r);
  const out = { hid: [], kept: [] };
  if (!x) return out;
  const cut = Date.now() - days * 864e5, wcut = localDay(daysAgo(days));
  const items = (S.feed?.items || []).filter((p) => (Date.parse(p.added || p.epub || "") || 0) >= cut).map((p) => ({ ...p, type: "paper" }))
    .concat((S.news?.items || []).filter((n) => (Date.parse(n.date || "") || 0) >= cut).map((n) => ({ ...n, type: "news" })))
    .concat((S.watch?.events || []).filter((e) => e?.title && (e.seen || e.date || "") >= wcut && !(typeof wFollowing === "function" && wFollowing(e.nct)))
      .map((e) => ({ type: "watch", ev: e, title: e.acr ? `${e.acr}: ${e.title}` : e.title })));
  for (const it of items) {
    const t = ruleTexts(it);
    if (!isAbout(x.hide, t)) continue;
    (x.keep && x.keep.has(`${t.head} ${t.body} ${t.from}`) ? out.kept : out.hid).push(it);
  }
  return out;
}

// the form for a filter: a subject (or your own words), then what keeps a card anyway
function ruleForm(start, { onSave, onCancel, saveLabel = "Save filter", pickSubject = true }) {
  const d = { s: start?.s ?? "valves", words: (start?.words || []).join(", "), keep: [...(start?.keep || ["imaging"])], keepWords: (start?.keepWords || []).join(", ") };
  const box = el("div", { class: "rule-form" });
  const split = (s) => s.split(",").map((w) => w.trim()).filter(Boolean);
  const rule = () => cleanRule({ s: d.s, words: split(d.words), keep: d.keep, keepWords: split(d.keepWords) });
  const note = el("p", { class: "fine rule-reach" });
  const reach = () => {
    const r = rule();
    if (!r) { note.textContent = d.s ? "" : "Type a word or two, separated by commas."; return; }
    const { hid, kept } = ruleReach(r);
    note.textContent = `In the last 7 days: would hide ${plural(hid.length, "card")}`
      + (kept.length ? `, and keep ${kept.length} that mention${kept.length === 1 ? "s" : ""} what you chose.` : ".");
  };
  const wordsIn = (key, ph, label) => {
    const input = el("input", { type: "text", class: "text-in", value: d[key], maxlength: "300", placeholder: ph, "aria-label": label,
      autocapitalize: "off", autocomplete: "off", spellcheck: "false", enterkeyhint: "done" });
    input.addEventListener("input", () => { d[key] = input.value; reach(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); input.blur(); } });
    return input;
  };
  const draw = () => {
    const subj = d.s ? SUBJECTS[d.s] : null;
    box.replaceChildren(...[
      pickSubject ? el("div", { class: "ctl-label" }, "Hide cards about") : null,
      pickSubject ? el("div", { class: "chips wrap" },
        Object.entries(SUBJECTS).map(([k, v]) => el("button", { class: "chip", "aria-pressed": String(d.s === k), onclick: () => { d.s = k; draw(); } }, v.label)),
        el("button", { class: "chip", "aria-pressed": String(!d.s), onclick: () => { d.s = ""; draw(); } }, "Your own words")) : null,
      subj ? el("p", { class: "fine" }, `Catches ${subj.eg}, by name or abbreviation.`) : null,
      el("div", { class: "word-add" }, wordsIn("words", subj ? "More words, if you like" : "Words, separated by commas", "Words for this subject")),
      el("div", { class: "ctl-label" }, "Unless they mention"),
      el("div", { class: "chips wrap" },
        Object.entries(KEEPS).map(([k, v]) => el("button", { class: "chip", "aria-pressed": String(d.keep.includes(k)),
          onclick: () => { d.keep = d.keep.includes(k) ? d.keep.filter((x) => x !== k) : [...d.keep, k]; draw(); } }, v.label))),
      el("div", { class: "word-add" }, wordsIn("keepWords", "Other words, like echo", "Other words that keep a card")),
      note,
      el("div", { class: "link-row" },
        el("button", { class: "act", onclick: () => { const r = rule(); if (!r) { toast(d.s ? "Pick a subject" : "Type a word first"); return; } onSave(r); } }, saveLabel),
        onCancel ? el("button", { class: "act", onclick: onCancel }, "Cancel") : null)].filter(Boolean));
    reach();
  };
  draw();
  return box;
}

// Rate: the subjects this card is about, to hide with a filter, and a filter that let it through
function subjectOffer(it, redraw) {
  const kept = ruleKept(it);
  const subs = subjectsOf(it);
  if (!kept && !subs.length) return null;
  const sect = el("div", { class: "fb-subjects" });
  const draw = (pick) => sect.replaceChildren(...[
    el("div", { class: "ctl-label" }, "Topic filter"),
    kept ? el("p", { class: "fine", style: "margin-top:2px" },
      `Your ${ruleName(kept.x.r)} filter let this through: ${kept.from ? "it’s from" : "it mentions"} “${kept.word}”. Change it in Tune → Feed → Topic filters.`) : null,
    subs.length ? el("div", {},
      el("p", { class: "fine", style: "margin-top:2px" }, "Hide everything on this subject, unless it mentions what you choose:"),
      el("div", { class: "chips wrap" }, subs.map((s) => el("button", { class: "chip" + (pick === s ? " chip-topic" : ""), "aria-expanded": String(pick === s),
        onclick: () => draw(pick === s ? null : s) }, `Hide ${SUBJECTS[s].label}…`))),
      pick ? ruleForm({ s: pick, keep: ["imaging"] }, { saveLabel: "Hide them", pickSubject: false, onCancel: () => draw(null),
        onSave: (r) => { putRule(r); toast(`Filter on: ${ruleName(r)}, ${ruleUnless(r)}`); redraw(); } }) : null) : null].filter(Boolean));
  draw(null);
  return sect;
}
