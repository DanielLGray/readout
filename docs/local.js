/* Readout — Reno & Nevada: local news from outlets whose terms allow it, with where each story is
   (the news job tags Reno and northern Nevada, or elsewhere in Nevada) and what it's about (topics,
   and opinion pieces). Quality varies, so most of it is tunable: which stories, each topic and each
   outlet (Hide, Less, Same, More, as in Rate), how often it takes a turn in Everything, and a
   card in Today. Loaded after jobset.js. */
"use strict";

const LOCAL_SCOPES = [["reno", "Reno area"], ["nevada", "Nevada"], ["all", "Everything"]];
// a local story you'd want, by where it is (other kinds always pass)
function localInScope(i) {
  if (i.kind !== "local" || T.local.scope === "all") return true;
  return T.local.scope === "nevada" ? !!i.place : i.place === "reno";
}

// ── Today: new local stories since the card last showed ───────────────────
let localSeen = store.get("localSeen", null);
if (!localSeen || typeof localSeen !== "object" || Array.isArray(localSeen)) localSeen = {};
function localPool(days = 3) {
  const cut = Date.now() - days * 864e5;
  const mute = mutedRe();
  const mutedSrc = new Set(T.mutedSources || []);
  return (S.news?.items || []).filter((i) => i.kind === "local" && (Date.parse(i.date) || 0) >= cut && localInScope(i)
    && !mutedSrc.has(i.source) && !mutedHit(i, mute) && tasteOf({ ...i, type: "news" }) > -Infinity);
}
function localCardItem() {
  const n = T.brief.local;
  if (!n || !S.news) return null;
  const today = localDay();
  const fresh = localPool().filter((i) => !localSeen[i.id] || localSeen[i.id] === today)
    .map((i) => [tasteOf({ ...i, type: "news" }), i]).sort((a, b) => b[0] - a[0] || (a[1].date < b[1].date ? 1 : -1)).map((x) => x[1]);
  if (!fresh.length) return null;
  const items = fresh.slice(0, n);
  return { type: "brief-local", key: "brief:local", sig: items.map((i) => i.id).join(","), items, more: fresh.length - items.length };
}
function localCardEl(it) {
  const cats = Object.fromEntries((S.news?.local?.topics || []).map((c) => [c, catLabel(c)]));
  const card = el("article", { class: "card brief-card local-card", "data-key": "brief:local" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Reno & Nevada"), el("span", {}, plural(it.items.length, "new story", "new stories"))),
    el("ul", { class: "rows" }, it.items.map((i) => el("li", { class: "news-item" },
      el("a", { class: "w-row", href: safeUrl(i.link), target: "_blank", rel: "noopener", onclick: () => learnFrom({ ...i, type: "news" }, "open") },
        el("span", { class: "news-src" }, el("b", {}, srcName(i.source)), el("span", {}, agoShort(i.date)),
          (i.categories || []).filter((c) => cats[c]).slice(0, 2).map((c) => el("span", {}, cats[c]))),
        el("span", { class: "news-title" }, i.title))))),
    el("div", { class: "link-row", style: "margin:0" },
      el("button", { class: "act", onclick: () => { S.kind = "local"; S.topic = null; refreshFeed(); } }, it.more > 0 ? `All Reno & Nevada (${it.more} more)` : "All Reno & Nevada"),
      el("button", { class: "act", onclick: () => { switchTab("tune"); setPane("interests", "tune-local"); } }, "Tune")));
  const d = localDay();
  it.items.forEach((i) => { localSeen[i.id] ||= d; });
  const cut = localDay(daysAgo(60));
  for (const [k, v] of Object.entries(localSeen)) if (v < cut) delete localSeen[k];
  store.set("localSeen", localSeen);
  return card;
}

// ── Tune → Interests ───────────────────────────────────────────────────────
function localSection() {
  const N = S.news;
  if (!N?.kinds?.local) return null;
  const topics = (N.local?.topics || []).filter((c) => N.categories?.[c]);
  const outlets = (N.sources || []).filter((s) => s.kind === "local");
  const week = (N.items || []).filter((i) => i.kind === "local" && Date.now() - (Date.parse(i.date) || 0) < 7 * 864e5);
  const reno = week.filter((i) => i.place === "reno").length, nv = week.filter((i) => i.place === "nevada").length;
  const redraw = () => rerender();
  return el("section", { class: "sect", id: "tune-local" }, el("h2", {}, "Reno & Nevada"),
    el("p", { class: "sub" }, "Local news from outlets whose terms let Readout show it: the Nevada Current, the Sierra Nevada Ally, High Country News’ and CalMatters’ stories about Nevada, Tahoe and the Sierra, Nevada Public Radio’s rundowns and Renown Health’s press releases (those two as headlines only). They differ in focus and in how much opinion they run, so each topic and each outlet can be hidden, moved down or moved up."),
    el("p", { class: "fine" }, `Last 7 days: ${plural(week.length, "story", "stories")}; ${reno} about Reno and northern Nevada, ${nv} elsewhere in Nevada, ${week.length - reno - nv} naming neither.`),
    segPick("Which stories", LOCAL_SCOPES, T.local.scope, (v) => { setTune({ local: { ...T.local, scope: v } }); rerender(); },
      "Reno area: stories naming Reno, Washoe, Tahoe, Carson City, the Truckee Meadows and nearby. Nevada: also Las Vegas and the rest of the state. Everything: also the outlets’ stories that name neither."),
    stepRow("Turns in Everything", "Per round, like the other kinds (Tune → Rules → Feed mix). 0 keeps local news to its own chip and Today’s card.",
      T.mix.local ?? 1, { min: 0, max: 6 }, (v) => { setTune({ mix: { ...T.mix, local: v } }); rerender(); }),
    stepRow("Stories on Today’s card", "New ones since the card last showed, best-rated first. 0 turns the card off.",
      T.brief.local, { min: 0, max: 8 }, (v) => { setTune({ brief: { ...T.brief, local: v } }); rerender(); }),
    topics.length ? el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Topics"),
      el("p", { class: "fine", style: "margin:2px 0 6px" }, "From each story’s headline and summary; a story can have several. Hide takes it out wherever it shows; Less and More move it."),
      el("section", { class: "fb-sect" }, topics.map((c) => rateRow(`cat:${c}`, redraw)))) : null,
    outlets.length ? el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Outlets"),
      el("p", { class: "fine", style: "margin:2px 0 6px" }, "What you think of each, and how many of its stories a day Everything shows."),
      el("section", { class: "fb-sect" }, outlets.map((o) => [rateRow(`src:${o.name}`, redraw), outletRowEl(o, true)]))) : null,
    el("p", { class: "fine" }, "Turn an outlet off, change how many stories it keeps or add place names: Tune → Updates → News → Change settings. Left out for their terms: Reno News & Review, KOLO 8, UNR’s Nevada Today and The Nevada Independent don’t allow it; KUNR and This Is Reno don’t say, and can be added once they do. Pictures stay out: the outlets’ photo rights are separate."));
}
