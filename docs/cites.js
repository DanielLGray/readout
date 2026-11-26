/* Readout — new papers that cite the ones you saved. Once a day this phone asks NIH iCite (or,
   if that doesn't answer, PubMed's own "cited in" links) which papers cite each saved paper, and
   keeps the list to compare with next time. Only the saved papers' PubMed IDs are sent.
   Loaded after week.js. */
"use strict";

const ICITE = "https://icite.od.nih.gov/api/pubs";
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const CITE_KEEP = 400;            // citing papers remembered per saved paper (newest PubMed IDs); older ones count as known
const isPmid = (x) => /^\d{1,9}$/.test(String(x));

let citeWatch = store.get("citeWatch", null);
if (!citeWatch || typeof citeWatch !== "object" || Array.isArray(citeWatch)) citeWatch = {};
citeWatch = {
  known: citeWatch.known && typeof citeWatch.known === "object" ? citeWatch.known : {},
  floor: citeWatch.floor && typeof citeWatch.floor === "object" ? citeWatch.floor : {},
  fresh: Array.isArray(citeWatch.fresh) ? citeWatch.fresh.filter((f) => f && isPmid(f.pmid) && typeof f.title === "string") : [],
  at: typeof citeWatch.at === "string" ? citeWatch.at : "", src: citeWatch.src || "", err: citeWatch.err || "",
};
let citeSeen = store.get("citeSeen", null);
if (!citeSeen || typeof citeSeen !== "object" || Array.isArray(citeSeen)) citeSeen = {};

const savedPmids = () => [...new Set(Object.values(S.saved).map((i) => String(i.pmid || "")).filter(isPmid))];
async function citeJSON(url) {
  const r = await fetch(url, { cache: "no-store", referrerPolicy: "no-referrer", credentials: "omit" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
// {saved pmid: [citing pmids]}
async function citedByIcite(pmids) {
  const out = {};
  for (let i = 0; i < pmids.length; i += 200) {
    const j = await citeJSON(`${ICITE}?pmids=${pmids.slice(i, i + 200).join(",")}&fl=pmid,cited_by`);
    for (const d of j?.data || []) if (isPmid(d.pmid)) out[String(d.pmid)] = (d.cited_by || []).map(String).filter(isPmid);
  }
  return out;
}
async function citedByPubmed(pmids) {
  const out = {};
  for (let i = 0; i < pmids.length; i += 100) {
    const ids = pmids.slice(i, i + 100).map((p) => `id=${p}`).join("&");      // one id= each: one linkset per paper
    const j = await citeJSON(`${EUTILS}/elink.fcgi?dbfrom=pubmed&db=pubmed&linkname=pubmed_pubmed_citedin&retmode=json&${ids}`);
    for (const ls of j?.linksets || []) {
      const id = String(ls.ids?.[0] || "");
      const db = (ls.linksetdbs || []).find((x) => x.linkname === "pubmed_pubmed_citedin");
      if (isPmid(id)) out[id] = (db?.links || []).map(String).filter(isPmid);
    }
    if (i + 100 < pmids.length) await new Promise((r) => setTimeout(r, 400));     // NCBI asks for at most 3 a second
  }
  return out;
}
async function citeDetails(pmids) {
  const ids = pmids.filter(isPmid).slice(0, 200);
  if (!ids.length) return [];
  try {
    const j = await citeJSON(`${ICITE}?pmids=${ids.join(",")}&fl=pmid,title,journal,year`);
    return (j?.data || []).map((d) => ({ pmid: String(d.pmid), title: String(d.title || ""), journal: String(d.journal || ""), year: String(d.year || "") }));
  } catch {
    const j = await citeJSON(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`);
    const r = j?.result || {};
    return (r.uids || []).map((u) => ({ pmid: String(u), title: String(r[u]?.title || ""), journal: String(r[u]?.source || ""), year: String(r[u]?.pubdate || "").slice(0, 4) }));
  }
}

let citeBusy = false;
async function citeCheck(force = false) {
  if (!T.citeAlerts || citeBusy || !navigator.onLine) return;
  const today = localDay();
  if (!force && citeWatch.at === today) return;
  const pmids = savedPmids().slice(0, 400);
  if (!pmids.length) return;
  citeBusy = true;
  try {
    let by, src = "NIH iCite";
    try { by = await citedByIcite(pmids); } catch { by = await citedByPubmed(pmids); src = "PubMed"; }
    const fresh = {};
    const mine = new Set(pmids);
    for (const p of pmids) {
      const list = by[p];
      if (!list) continue;
      const before = citeWatch.known[p];
      if (before) {                       // the first look at a paper only learns what's there
        const set = new Set(before), floor = citeWatch.floor[p] || 0;
        for (const c of list) if (!set.has(c) && +c > floor && !mine.has(c)) (fresh[c] ||= []).push(p);
      }
      const sorted = [...new Set(list)].sort((a, b) => b - a);
      citeWatch.known[p] = sorted.slice(0, CITE_KEEP);
      citeWatch.floor[p] = sorted.length > CITE_KEEP ? +sorted[CITE_KEEP - 1] : 0;
    }
    for (const p of Object.keys(citeWatch.known)) if (!mine.has(p)) { delete citeWatch.known[p]; delete citeWatch.floor[p]; }
    const ids = Object.keys(fresh).filter((c) => !citeWatch.fresh.some((f) => f.pmid === c));
    if (ids.length) {
      const det = await citeDetails(ids);
      for (const d of det) if (d.title) citeWatch.fresh.unshift({ ...d, cites: fresh[d.pmid] || [], seen: today });
    }
    const cut = localDay(daysAgo(90));
    citeWatch.fresh = citeWatch.fresh.filter((f) => f.seen >= cut).slice(0, 200);
    Object.assign(citeWatch, { at: today, src, err: "" });
    if (!store.set("citeWatch", citeWatch)) {          // the phone's storage is full: remember less of each list
      for (const p of Object.keys(citeWatch.known)) citeWatch.known[p] = citeWatch.known[p].slice(0, 80);
      store.set("citeWatch", citeWatch);
    }
    if (ids.length) {
      if (S.tab === "feed" && S.kind === "today") updateFeedQuietly(1e9); else S.feedDirty = true;
      if (S.tab === "saved") renderSaved();
    }
  } catch (e) {
    Object.assign(citeWatch, { at: today, err: String(e?.message || e).slice(0, 120) });
    store.set("citeWatch", citeWatch);
  } finally {
    citeBusy = false;
  }
}

// ── showing them ───────────────────────────────────────────────────────────
const savedTitle = (pmid) => { const s = Object.values(S.saved).find((i) => String(i.pmid) === String(pmid)); return s?.title || `PMID ${pmid}`; };
const shortTitle = (t, n = 70) => (t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t);
function citeRowEl(f) {
  return el("li", { class: "news-item" }, el("a", { class: "w-row", href: pubmedUrl(f.pmid), target: "_blank", rel: "noopener" },
    el("span", { class: "news-src" }, el("b", {}, f.journal || "PubMed"), f.year ? el("span", {}, f.year) : null),
    el("span", { class: "news-title" }, f.title),
    (f.cites || []).length ? el("span", { class: "fine" }, `Cites ${(f.cites || []).map((p) => `“${shortTitle(savedTitle(p), 60)}”`).join(" and ")}`) : null));
}
function citeCardItem() {
  if (!T.citeAlerts || !citeWatch.fresh.length) return null;
  const today = localDay(), cut = localDay(daysAgo(7));
  const fresh = citeWatch.fresh.filter((f) => f.seen >= cut && (!citeSeen[f.pmid] || citeSeen[f.pmid] === today));
  return fresh.length ? { type: "brief-cites", key: "brief:cites", sig: fresh.map((f) => f.pmid).join(","), fresh } : null;
}
function citeCardEl(it) {
  const card = el("article", { class: "card brief-card w-card", "data-key": "brief:cites" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "New citations"),
      el("span", {}, `${plural(it.fresh.length, "new paper")} citing ones you saved`)),
    el("ul", { class: "rows" }, it.fresh.slice(0, 4).map(citeRowEl)),
    el("div", { class: "link-row", style: "margin:0" }, el("button", { class: "act", onclick: () => switchTab("saved") },
      it.fresh.length > 4 ? `All ${it.fresh.length} in Saved` : "Saved")));
  const d = localDay();
  it.fresh.forEach((f) => { citeSeen[f.pmid] ||= d; });
  const cut = localDay(daysAgo(120));
  for (const [k, v] of Object.entries(citeSeen)) if (v < cut) delete citeSeen[k];
  store.set("citeSeen", citeSeen);
  return card;
}
// Saved: what's new at the top; on each paper, how many cite it, and the newest of them on tap
function citeSavedEl() {
  if (!T.citeAlerts) return null;
  const fresh = citeWatch.fresh.slice(0, 30);
  if (!fresh.length) return null;
  return el("section", { class: "cite-new" }, el("h3", { class: "sys-head" }, "New papers citing ones you saved"),
    el("p", { class: "fine", style: "margin:0 0 6px" }, `In the last 90 days, from ${citeWatch.src || "NIH iCite"} (it adds citations about once a month).`),
    el("ul", { class: "rows" }, fresh.map(citeRowEl)));
}
function citeLineEl(p) {
  if (!T.citeAlerts || !isPmid(p.pmid)) return null;
  const known = citeWatch.known[String(p.pmid)];
  if (!known) return null;
  const n = known.length, extra = citeWatch.floor[String(p.pmid)] ? "+" : "";
  const fresh = citeWatch.fresh.filter((f) => (f.cites || []).includes(String(p.pmid))).length;
  return el("button", { class: "why-line cite-line", onclick: () => openCiting(p) },
    el("span", { class: "why-k" }, "Cited"), el("span", { class: "why-t" }, `${n ? `by ${n}${extra} papers` : "by none yet"}${fresh ? ` · ${fresh} new` : ""}`));
}
async function openCiting(p) {
  const ids = (citeWatch.known[String(p.pmid)] || []).slice(0, 15);
  openSheet(el("h2", { id: "sheet-title" }, "Papers citing this"), el("p", { class: "sheet-meta fb-title" }, el("span", {}, p.title)),
    el("p", { class: "fine", id: "cite-wait" }, ids.length ? "Loading the newest…" : "None yet."));
  if (!ids.length) return;
  let det = [];
  try { det = await citeDetails(ids); } catch { /* offline */ }
  if (!$("#sheet").classList.contains("open")) return;
  const order = new Map(ids.map((x, i) => [x, i]));
  refillSheet(el("h2", { id: "sheet-title" }, "Papers citing this"), el("p", { class: "sheet-meta fb-title" }, el("span", {}, p.title)),
    det.length ? el("ul", { class: "rows" }, det.sort((a, b) => order.get(a.pmid) - order.get(b.pmid)).map((f) => citeRowEl({ ...f, cites: [] })))
      : el("p", { class: "fine" }, "Couldn’t load them just now."),
    el("p", { class: "fine" }, `The ${Math.min(15, ids.length)} newest, by PubMed ID. Source: ${citeWatch.src || "NIH iCite"}.`),
    el("div", { class: "link-row" }, el("a", { class: "act", href: `https://pubmed.ncbi.nlm.nih.gov/?linkname=pubmed_pubmed_citedin&from_uid=${p.pmid}`, target: "_blank", rel: "noopener" }, "All in PubMed")));
}
// Tune → Rules → Alerts
function citeSettingEl() {
  const n = savedPmids().length;
  const status = !T.citeAlerts ? "" : citeWatch.err ? `Last check (${citeWatch.at}) couldn’t reach NIH iCite or PubMed: ${citeWatch.err}.`
    : citeWatch.at ? `Checked ${citeWatch.at === localDay() ? "today" : citeWatch.at} with ${citeWatch.src}: ${plural(n, "saved paper")} watched, ${plural(citeWatch.fresh.length, "new citing paper")} in 90 days.`
      : n ? "First check when the app next opens." : "Save a paper to start.";
  return el("div", {},
    switchRow("New papers citing ones you saved", "Once a day this phone asks NIH iCite which papers cite your saved ones (only their PubMed IDs are sent) and shows new ones in Today and Saved. iCite adds citations about once a month.",
      T.citeAlerts, (on) => { setTune({ citeAlerts: on }); if (on) citeCheck(true); rerender(); }),
    status ? el("p", { class: "fine", style: "margin-top:-4px" }, status) : null);
}
