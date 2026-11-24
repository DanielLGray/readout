/* Readout — Tune tab: what you read, the rules that build the feed, and how the update jobs are doing.
   Feed rules live on this phone (localStorage); the update jobs' settings live in config/*.yaml on GitHub. */
"use strict";

const REPO = location.hostname.endsWith("github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1] || "readout"}`
  : "DanielLGray/readout";
const GH = `https://github.com/${REPO}`;
const TU = { pane: store.get("tunePane", "reading"), span: "7", armed: null, wordDraft: "" };

const KIND_COLOR = { paper: "var(--ink)", industry: "var(--h3)", societies: "var(--k-soc)", health: "var(--h2)", science: "var(--h4)", sff: "var(--h5)" };
const kindColor = (k) => KIND_COLOR[k] || "var(--muted)";
const kindLabel = (k) => (k === "paper" ? "Papers" : newsKinds()[k] || k);
const pctOf = (n, d) => (d ? Math.round((n / d) * 100) : 0);

// ── small controls ─────────────────────────────────────────────────────────
function tsec(title, sub, ...kids) {
  return el("section", { class: "sect" }, el("h2", {}, title), sub ? el("p", { class: "sub" }, sub) : null, ...kids);
}
function segPick(label, opts, value, onpick, note) {
  return el("div", { class: "ctl" },
    label ? el("div", { class: "ctl-label" }, label) : null,
    el("div", { class: "seg", role: "group", "aria-label": label || "Choose", style: `grid-template-columns:repeat(${opts.length},1fr)` },
      opts.map(([v, l]) => el("button", { "aria-pressed": String(String(v) === String(value)), onclick: () => onpick(v) }, l))),
    note ? el("p", { class: "fine" }, note) : null);
}
function switchRow(label, sub, on, onchange) {
  return el("div", { class: "switch-row" },
    el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, label), sub ? el("p", { class: "fine", style: "margin:2px 0 0" }, sub) : null),
    el("button", { class: "switch", role: "switch", "aria-checked": String(!!on), "aria-label": label, onclick: () => onchange(!on) }));
}
function swatch(k) { return el("span", { class: "sw" + (k === "sff" ? " round" : ""), style: `background:${kindColor(k)}` }); }
function hbar(frac, color) {
  const w = Math.max(frac > 0 ? 2 : 0, Math.round(Math.min(1, frac) * 100));
  return el("span", { class: "hbar" }, el("i", { style: `width:${w}%;background:${color}` }));
}
function stack(parts) {          // [[count, color, label]]
  const total = parts.reduce((a, p) => a + p[0], 0) || 1;
  return el("div", { class: "stack", role: "img", "aria-label": parts.map((p) => `${p[2]} ${pctOf(p[0], total)}%`).join(", ") },
    parts.filter((p) => p[0]).map((p) => el("i", { style: `flex-grow:${p[0]};background:${p[1]}` })));
}
function legend(parts) {
  const total = parts.reduce((a, p) => a + p[0], 0) || 1;
  return el("ul", { class: "legend" }, parts.map(([n, color, label, k]) => el("li", {},
    k ? swatch(k) : el("span", { class: "sw", style: `background:${color}` }), el("span", {}, label),
    el("b", {}, n.toLocaleString()), el("span", { class: "lg-pct" }, `${pctOf(n, total)}%`))));
}
function dayBars(values, labels, opts = {}) {      // values: [[back, front]]
  const n = values.length, w = 340, h = opts.h || 64, gap = n > 14 ? 2 : 6;
  const bw = (w - gap * (n - 1)) / n;
  const max = Math.max(1, ...values.map((v) => v[0]));
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", height: h, preserveAspectRatio: "none", class: "daybars", "aria-hidden": "true" });
  values.forEach(([a, b], i) => {
    const x = i * (bw + gap);
    const ha = Math.max(a ? 2 : 1, (a / max) * h), hb = (b / max) * h;
    const r1 = svgEl("rect", { x, y: h - ha, width: bw, height: ha, rx: 1.5 }); r1.style.fill = "var(--h0)"; svg.append(r1);
    if (b) { const r2 = svgEl("rect", { x, y: h - hb, width: bw, height: Math.max(2, hb), rx: 1.5 }); r2.style.fill = opts.front || "var(--h3)"; svg.append(r2); }
  });
  return el("div", { class: "chart" }, svg,
    labels ? el("div", { class: "chart-years" }, labels.map((l) => el("span", {}, l))) : null);
}
function twoTap(id, label, confirmLabel, action) {
  const armed = TU.armed === id;
  return el("button", { class: "act wide" + (armed ? " danger" : ""), onclick: () => {
    if (!armed) { TU.armed = id; renderTune(true); setTimeout(() => { if (TU.armed === id) { TU.armed = null; renderTune(true); } }, 4000); return; }
    TU.armed = null; action();
  } }, armed ? confirmLabel : label);
}
function linkBtn(href, label) { return el("a", { class: "act", href, target: "_blank", rel: "noopener" }, label); }

// ── tab ────────────────────────────────────────────────────────────────────
function setPane(p, anchor) {
  TU.pane = p;
  store.set("tunePane", p);
  renderTune();
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }));
}
function renderTune(keepScroll) {
  const view = $("#view-tune");
  const top = view.scrollTop;
  const panes = { reading: readingPane, interests: interestsPane, algorithms: algoPane, pipeline: pipelinePane };
  if (!panes[TU.pane]) TU.pane = "reading";
  let body;
  try { body = panes[TU.pane](); } catch (err) {
    body = el("section", { class: "sect" }, el("h2", {}, "This page didn’t draw"),
      el("p", { class: "sub" }, `${err?.message || err}. Resetting the feed rules usually fixes it; your saved items stay.`),
      el("div", { class: "link-row" }, el("button", { class: "act wide", onclick: () => {
        store.set("tune", {}); T = loadTune(); S.feedDirty = true; S.exploreKey = null; renderTune();
      } }, "Reset feed rules")));
  }
  view.replaceChildren(el("div", { class: "tune" },
    el("div", { class: "seg pane-seg", role: "tablist", "aria-label": "Tune sections" },
      [["reading", "Reading"], ["interests", "Interests"], ["algorithms", "Rules"], ["pipeline", "Updates"]].map(([k, l]) =>
        el("button", { role: "tab", "aria-selected": String(TU.pane === k), "aria-pressed": String(TU.pane === k), onclick: () => setPane(k) }, l))),
    body));
  view.scrollTop = keepScroll ? top : 0;
}
const rerender = () => renderTune(true);

// ── your reading ───────────────────────────────────────────────────────────
function readingPane() {
  const days = Number(TU.span);
  const agg = statsFor(days);
  const kinds = ["paper", ...Object.keys(newsKinds())];
  const sum = [0, 0, 0, 0];
  kinds.forEach((k) => (agg.k[k] || [0, 0, 0, 0]).forEach((n, i) => { sum[i] += n; }));
  const [seen, opened, saved, listened] = sum;
  const out = [
    segPick(null, [["7", "Last 7 days"], ["30", "Last 30 days"]], TU.span, (v) => { TU.span = v; rerender(); }),
  ];
  if (!seen && !opened) {
    out.push(el("section", { class: "sect" }, el("h2", {}, "Nothing counted yet"),
      el("p", { class: "sub" }, "Scroll the feed for a while and come back. A card counts as read once it stays on screen for about a second; opening an abstract, article or PubMed page counts as opened.")));
  } else {
    out.push(el("p", { class: "lede" },
      `You read ${plural(seen, "card")} and opened ${opened.toLocaleString()}`, seen ? ` (${pctOf(opened, seen)}%)` : "", ". ",
      saved || listened ? `${saved ? `Saved ${saved}` : ""}${saved && listened ? ", listened to " : listened ? "Listened to " : ""}${listened ? plural(listened, "episode") : ""}.` : ""));
    const labels = days === 7
      ? agg.daily.map((d) => "SMTWTFS"[new Date(d.d + "T12:00").getDay()])
      : [fmtDate(agg.daily[0].d), "today"];
    out.push(dayBars(agg.daily.map((d) => [d.seen, d.open]), labels),
      el("p", { class: "fine", style: "margin-top:2px" }, el("span", { class: "key", style: "background:var(--h0)" }), " read  ",
        el("span", { class: "key", style: "background:var(--h3)" }, ""), " opened"));

    // by kind: what you open, relative to what you're shown
    const rows = kinds.filter((k) => agg.k[k]).map((k) => {
      const [s, o] = agg.k[k];
      return { k, s, o, rate: s ? o / s : 0 };
    });
    const maxRate = Math.max(0.01, ...rows.map((r) => r.rate));
    out.push(tsec("By kind", "How often you open what the feed shows you.",
      el("ul", { class: "rows" }, rows.map((r) => el("li", { class: "row" }, el("div", { class: "row-static" },
        el("span", { class: "row-name" }, swatch(r.k), kindLabel(r.k)),
        el("span", { class: "row-fig" }, r.s ? `${pctOf(r.o, r.s)}%` : "—"),
        el("span", { class: "row-sub" }, hbar(r.rate / maxRate, kindColor(r.k)), el("span", {}, `${r.o} of ${r.s}`))))))));
    const hints = suggestions(rows, seen, opened);
    if (hints.length) out.push(el("div", { class: "hints" }, hints));

    const srcs = Object.entries(agg.s).filter(([, v]) => v[1]).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]).slice(0, 6);
    if (srcs.length) {
      out.push(tsec("Opened most", "Journals and outlets.",
        el("ul", { class: "rows" }, srcs.map(([name, v]) => el("li", { class: "row" }, el("div", { class: "row-static" },
          el("span", { class: "row-name" }, name), el("span", { class: "row-fig" }, String(v[1])),
          el("span", { class: "row-sub" }, `${plural(v[0], "card")} read${v[2] ? `, ${v[2]} saved` : ""}`)))))));
    }
    const sys = S.feed?.systems || {};
    const ys = Object.keys(sys).filter((y) => agg.y[y]).sort((a, b) => agg.y[b][0] - agg.y[a][0]);
    if (ys.length) {
      const maxS = Math.max(...ys.map((y) => agg.y[y][0]));
      out.push(tsec("Papers by organ system", "Papers read, and how many you opened.",
        el("div", { class: "ladder" }, ys.map((y) => el("div", { class: "rung" },
          el("span", {}, sys[y]), el("b", {}, `${agg.y[y][1]} of ${agg.y[y][0]}`), hbar(agg.y[y][0] / maxS, "var(--faint)"))))));
    }
  }
  out.push(feedNowSection());
  out.push(el("p", { class: "fine" }, "Counted on this phone only, never sent anywhere. History older than 120 days is dropped."),
    el("div", { class: "link-row" }, twoTap("clear", "Clear reading history", "Tap again to clear", () => {
      stats = { days: {} }; seenToday = { d: "" }; saveStats(); toast("Reading history cleared"); rerender();
    })));
  return out;
}

function suggestions(rows, seen, opened) {
  if (!opened || seen < 30) return [];
  const avg = opened / seen;
  const out = [];
  for (const r of rows) {
    const w = T.mix[r.k] ?? 1;
    if (r.s >= 12 && r.rate >= 1.6 * avg && w < 4) {
      out.push(el("div", { class: "hint" },
        el("p", {}, `You open ${kindLabel(r.k).toLowerCase()} ${(r.rate / avg).toFixed(1)}× as often as the rest of the feed.`),
        el("button", { class: "act", onclick: () => { setTune({ mix: { ...T.mix, [r.k]: w + 1 } }); toast(`${kindLabel(r.k)}: ${w + 1} turns per round`); rerender(); } },
          `Give ${kindLabel(r.k).toLowerCase()} more turns`)));
    } else if (r.s >= 25 && r.rate <= 0.35 * avg && w > 0) {
      out.push(el("div", { class: "hint" },
        el("p", {}, `You open ${pctOf(r.o, r.s)}% of ${kindLabel(r.k).toLowerCase()} cards, well below your average of ${pctOf(opened, seen)}%.`),
        el("button", { class: "act", onclick: () => { setTune({ mix: { ...T.mix, [r.k]: w - 1 } }); toast(w - 1 ? `${kindLabel(r.k)}: ${w - 1} turn per round` : `${kindLabel(r.k)} left Everything`); rerender(); } },
          w - 1 ? `Fewer ${kindLabel(r.k).toLowerCase()}` : `Take ${kindLabel(r.k).toLowerCase()} out of Everything`)));
    }
  }
  return out.slice(0, 2);
}

function feedNowSection() {
  const R = {};
  const list = filtered({ kind: "all", system: "all", strong: false, topic: null }, R).filter((i) => i.type !== "top");
  const by = {};
  list.forEach((i) => { const k = i.type === "paper" ? "paper" : i.kind; by[k] = (by[k] || 0) + 1; });
  const parts = ["paper", ...Object.keys(newsKinds())].filter((k) => by[k]).map((k) => [by[k], kindColor(k), kindLabel(k), k]);
  const left = [
    R.capped ? `${R.capped.toLocaleString()} held back by the per-outlet limit` : null,
    R.off ? `${R.off.toLocaleString()} from kinds you turned off` : null,
    R.muted ? `${R.muted.toLocaleString()} muted` : null,
    R.pending ? `${R.pending.toLocaleString()} papers waiting for an abstract` : null,
    R.areaOff ? `${R.areaOff.toLocaleString()} papers from areas you turned off` : null,
    R.dupes ? `${R.dupes.toLocaleString()} repeat headlines` : null,
  ].filter(Boolean);
  return tsec("Your feed right now", `Everything has ${plural(list.length, "card")}, going back ${S.feed?.settings?.keep_days || 180} days for papers.`,
    stack(parts), legend(parts),
    left.length ? el("p", { class: "fine" }, `Left out of Everything: ${left.join("; ")}. Each kind’s chip still shows its full list.`) : null,
    el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => setPane("algorithms") }, "Change the mix")));
}

// ── interests ──────────────────────────────────────────────────────────────
const FOLLOW_IDEAS = ["TAVR", "PSMA", "FAPI", "theranostics", "LI-RADS", "CAD-RADS", "photon-counting", "appropriateness criteria", "amyloid", "incidental"];
function interestsPane() {
  const feedN = {}, impN = {};
  (S.feed?.items || []).forEach((p) => areasOf(p).forEach((a) => { feedN[a] = (feedN[a] || 0) + 1; }));
  Object.values(S.important?.papers || {}).forEach((p) => areasOf(p).forEach((a) => { impN[a] = (impN[a] || 0) + 1; }));
  const setArea = (a, v) => {
    const next = { ...T.areas, [a]: Number(v) };
    if (!areaList().some(([k]) => (next[k] ?? 2) > 0)) { toast("Keep at least one area on"); return; }
    setTune({ areas: next }); if (S.area === a && !v) S.area = "all"; rerender();
  };
  const re = followRe();
  const count = (term) => {
    const r = wordRe([term]);
    if (!r) return 0;
    return (S.feed?.items || []).filter((p) => r.test(`${p.title} ${p.conclusion?.text || ""}`)).length
      + (S.news?.items || []).filter((n) => r.test(`${n.title} ${n.summary || ""}`)).length;
  };
  const input = el("input", { type: "text", class: "text-in", placeholder: "A word or phrase, like TAVR", "aria-label": "Word to follow",
    value: TU.followDraft || "", autocapitalize: "off", autocomplete: "off", enterkeyhint: "done" });
  const add = (w0) => {
    const w = (w0 ?? input.value).trim();
    TU.followDraft = "";
    if (!w || T.follow.some((x) => x.toLowerCase() === w.toLowerCase())) { input.value = ""; return; }
    setTune({ follow: [...T.follow, w] }); toast(`Following “${w}”`); rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  input.addEventListener("input", () => { TU.followDraft = input.value; });
  const systems = S.feed?.systems || {};
  return [
    el("p", { class: "lede small" }, "What Readout brings you. Changes here apply on this phone right away."),
    el("section", { class: "sect", id: "tune-areas" }, el("h2", {}, "Areas"),
      el("p", { class: "sub" }, "How much of your feed each area gets. Off hides it everywhere: Everything, Papers and Most important."),
      areaList().map(([a, info]) => el("div", { class: "area" },
        el("div", { class: "area-head" }, el("b", {}, info.label || a),
          el("span", { class: "fine", style: "margin:0" }, `${(feedN[a] || 0).toLocaleString()} in the feed · ${(impN[a] || 0).toLocaleString()} most important`)),
        info.about ? el("p", { class: "fine", style: "margin:2px 0 0" }, info.about) : null,
        segPick(null, [[0, "Off"], [1, "Less"], [2, "Normal"], [3, "More"]], T.areas[a] ?? 2, (v) => setArea(a, v))))),
    el("section", { class: "sect", id: "tune-follow" }, el("h2", {}, "Following"),
      el("p", { class: "sub" }, "Papers and news that mention these get a Following chip of their own and a tag on the card. Whole words; end one with * for any ending, like radiolog*."),
      el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: () => add() }, "Follow")),
      T.follow.length ? el("div", { class: "chips wrap" }, T.follow.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Stop following ${w}`,
        onclick: () => { setTune({ follow: T.follow.filter((x) => x !== w) }); rerender(); } }, `${w} · ${count(w)}  ✕`))) : null,
      el("div", { class: "ctl-label" }, "Ideas"),
      el("div", { class: "chips wrap" }, FOLLOW_IDEAS.filter((w) => !T.follow.some((x) => x.toLowerCase() === w.toLowerCase()))
        .map((w) => el("button", { class: "chip", onclick: () => add(w) }, `+ ${w}`))),
      re ? el("p", { class: "fine" }, `${plural(followingList(null).length, "item")} match right now.`) : null),
    el("section", { class: "sect" }, el("h2", {}, "Filter chips"),
      el("p", { class: "sub" }, "Which organ-system chips appear at the top of the feed."),
      el("div", { class: "chips wrap" }, Object.entries(systems).map(([k, label]) => el("button", { class: "chip", "aria-pressed": String(!T.hiddenSystems.includes(k)),
        onclick: () => { setTune({ hiddenSystems: T.hiddenSystems.includes(k) ? T.hiddenSystems.filter((x) => x !== k) : [...T.hiddenSystems, k] }); rerender(); } }, label)))),
    el("section", { class: "sect" }, el("h2", {}, "News"),
      el("p", { class: "sub" }, `${Object.values(newsKinds()).join(", ")}. Turn kinds up, down or off in Rules → Feed mix; mute single outlets in Rules → Mute.`),
      el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => setPane("algorithms") }, "Open Rules"))),
    el("section", { class: "sect" }, el("h2", {}, "Change what Readout fetches"),
      el("p", { class: "sub" }, "The areas’ journals and searches, the news outlets and the Explore topics live in files on GitHub. Edit one there and the next update uses it."),
      settingsList([
        ...areaList().map(([a, info]) => `${info.label || a}: ${(info.streams || []).length || "—"} PubMed searches; papers stay ${info.keep_days || 180} days.`),
        `${(S.news?.sources || []).length} news outlets; ${(S.explore?.topics || []).length} Explore topics.`,
      ]),
      el("div", { class: "link-row" },
        linkBtn(`${GH}/edit/main/config/feeds.yaml`, "Areas and journals"),
        linkBtn(`${GH}/edit/main/config/news.yaml`, "News outlets"),
        linkBtn(`${GH}/edit/main/config/topics.yaml`, "Explore topics"))),
  ];
}

// ── feed rules ─────────────────────────────────────────────────────────────
function presentKinds() {
  const ks = [];
  if (S.feed?.items?.length) ks.push("paper");
  const counts = {};
  (S.news?.items || []).forEach((i) => { counts[kindOf(i)] = (counts[kindOf(i)] || 0) + 1; });
  Object.keys(newsKinds()).forEach((k) => { if (counts[k]) ks.push(k); });
  return ks;
}
function mixPreview(n) {
  const q = Object.fromEntries(presentKinds().map((k) => [k, Array.from({ length: n }, () => k)]));
  return interleave(q, T.mix).slice(0, n);
}

function algoPane() {
  return [importantSection(), mixSection(), orderSection(), muteSection(), trendSection(),
    el("section", { class: "sect" }, el("h2", {}, "Start over"),
      el("p", { class: "sub" }, "Puts the mix, paper order, mutes and trend rules back to how they came. Your reading history and saved items stay."),
      el("div", { class: "link-row" }, twoTap("reset", "Reset feed rules", "Tap again to reset", () => {
        const keep = { mutedSources: [], mutedWords: [] };
        T = { ...TUNE_DEFAULTS, ...keep }; store.set("tune", T); S.feedDirty = true; S.exploreKey = null;
        toast("Feed rules reset"); rerender();
      })))];
}

function importantSection() {
  const I = S.important;
  return el("section", { class: "sect", id: "tune-important" }, el("h2", {}, "Most important papers"),
    el("p", { class: "sub" }, I
      ? `Ranked weekly from ${I.stats.checked.toLocaleString()} papers in your journals over the last ${I.settings.years} years, by citations against papers of the same age.`
      : "Ranked weekly by citations against papers of the same age. Not built yet."),
    segPick("Open the app on", [["all", "Everything"], ["papers", "Papers"], ["important", "Most important"]], T.startOn,
      (v) => { setTune({ startOn: v }); rerender(); }, "The view you see when you open Readout."),
    switchRow("Include reviews, meta-analyses and guidelines", "Off: original research only.", T.impReviews,
      (on) => { setTune({ impReviews: on }); rerender(); }));
}

function mixSection() {
  const ks = presentKinds();
  const seq = mixPreview(24);
  const W = ks.reduce((a, k) => a + (T.mix[k] ?? 1), 0) || 1;
  const setW = (k, v) => {
    const next = { ...T.mix, [k]: v };
    if (!ks.some((x) => (next[x] ?? 1) > 0)) { toast("Keep at least one kind in Everything"); return; }
    setTune({ mix: next }); rerender();
  };
  return tsec("Feed mix", "Everything takes turns. Each kind gets this many turns per round, spread out evenly.",
    el("div", { class: "strip", role: "img", "aria-label": `Next 24 cards: ${seq.map(kindLabel).join(", ")}` },
      seq.map((k) => el("i", { class: k === "sff" ? "round" : "", style: `background:${kindColor(k)}` }))),
    el("p", { class: "fine", style: "margin-top:6px" }, "The next 24 cards in Everything."),
    el("ul", { class: "rows", style: "margin-top:10px" }, ks.map((k) => {
      const w = T.mix[k] ?? 1;
      return el("li", { class: "row mix-row" },
        el("span", { class: "row-name" }, swatch(k), kindLabel(k)),
        el("span", { class: "mix-share" }, w ? `${pctOf(w, W)}%` : "Off"),
        el("div", { class: "stepper", role: "group", "aria-label": `${kindLabel(k)} turns per round` },
          el("button", { "aria-label": "Fewer", disabled: w <= 0, onclick: () => setW(k, w - 1) }, "−"),
          el("output", {}, w ? `${w}×` : "0"),
          el("button", { "aria-label": "More", disabled: w >= 4, onclick: () => setW(k, w + 1) }, "+")));
    })),
    segPick("Most stories from one outlet per day", [[1, "1"], [2, "2"], [3, "3"], [5, "5"], [0, "No limit"]], T.cap,
      (v) => { setTune({ cap: Number(v) }); rerender(); },
      "Keeps busy outlets from flooding Everything. Industry news is never limited, and held-back stories still show under their kind’s chip."),
    switchRow("Top stories card", "Opens the feed with stories that several outlets covered this week.", T.topCard,
      (on) => { setTune({ topCard: on }); rerender(); }));
}

const WEIGHTS = [[0, "Off"], [0.5, "Low"], [1, "Medium"], [2, "High"]];
function orderSection() {
  const papers = S.feed?.items || [];
  const pending = papers.filter((p) => (p.conclusion?.kind || "none") === "none").length;
  const setRank = (k, v) => { setTune({ rank: { ...T.rank, [k]: Number(v) } }); rerender(); };
  const kids = [
    segPick(null, [["newest", "Newest first"], ["ranked", "Ranked"]], T.order, (v) => { setTune({ order: v }); rerender(); }),
  ];
  if (T.order === "ranked") {
    const sys = S.feed?.systems || {};
    kids.push(
      el("p", { class: "fine" }, "Score = freshness × (1 + evidence + study size + labeled conclusion + your systems). Each part runs from 0 to 1 and is multiplied by the weight you pick."),
      segPick("Freshness", [[3, "3 days"], [7, "1 week"], [14, "2 weeks"], [30, "1 month"]], T.rank.fresh, (v) => setRank("fresh", v),
        "A paper’s score halves after this long."),
      segPick("Evidence strength", WEIGHTS, T.rank.evidence, (v) => setRank("evidence", v), "Meta-analyses, trials and guidelines count most."),
      segPick("Study size", WEIGHTS, T.rank.size, (v) => setRank("size", v), "Read from the abstract; 10,000 or more counts fully."),
      segPick("Labeled conclusion", WEIGHTS, T.rank.concl, (v) => setRank("concl", v), "Favors abstracts that state a conclusion."),
      segPick("Your organ systems", WEIGHTS, T.rank.systems, (v) => setRank("systems", v)),
      el("div", { class: "chips wrap" }, Object.entries(sys).map(([k, label]) => el("button", { class: "chip", "aria-pressed": String(T.fav.includes(k)),
        onclick: () => { setTune({ fav: T.fav.includes(k) ? T.fav.filter((x) => x !== k) : [...T.fav, k] }); rerender(); } }, label))),
      T.fav.length ? null : el("p", { class: "fine" }, "Pick the systems you want lifted."),
      rankPreview());
  } else {
    kids.push(el("p", { class: "fine" }, "Papers appear in the order PubMed adds them, newest first."));
  }
  kids.push(switchRow("Hide papers without an abstract yet", `${plural(pending, "paper")} right now. PubMed usually adds the abstract within days.`,
    T.hidePending, (on) => { setTune({ hidePending: on }); rerender(); }));
  return tsec("Paper order", null, ...kids);
}
function rankPreview() {
  const now = Date.now();
  const top = filtered({ kind: "papers", system: "all", strong: false, topic: null }).slice(0, 5);
  const names = { evidence: "evidence", size: "size", concl: "conclusion", systems: "your systems" };
  return el("div", { class: "preview" },
    el("div", { class: "ctl-label" }, "Top of your feed with these settings"),
    el("ol", { class: "rows plain" }, top.map((p) => {
      const sc = paperScore(p, now);
      return el("li", { class: "row" }, el("button", { class: "row-static", onclick: () => openAbstract(p) },
        el("span", { class: "row-name clamp2" }, p.title),
        el("span", { class: "row-fig" }, sc.score.toFixed(2)),
        el("span", { class: "row-sub wrap" },
          el("span", {}, `${p.journal}, ${fmtDate(p.added || p.epub)}`),
          el("span", { class: "factor" }, `fresh ${Math.round(sc.fresh * 100)}%`),
          Object.entries(sc.parts).filter(([, v]) => v > 0.005).map(([k, v]) => el("span", { class: "factor" }, `${names[k]} +${v.toFixed(2)}`)))));
    })));
}

function muteSection() {
  const words = T.mutedWords || [];
  const input = el("input", { type: "text", class: "text-in", placeholder: "A word or phrase", "aria-label": "Word to mute",
    value: TU.wordDraft, autocapitalize: "off", autocomplete: "off", enterkeyhint: "done" });
  const add = () => {
    const w = input.value.trim();
    TU.wordDraft = "";
    if (!w || words.some((x) => x.toLowerCase() === w.toLowerCase())) { input.value = ""; return; }
    setTune({ mutedWords: [...words, w] }); toast(`Muted “${w}”`); rerender();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  input.addEventListener("input", () => { TU.wordDraft = input.value; });
  const muted = new Set(T.mutedSources || []);
  const counts = {};
  (S.news?.items || []).forEach((i) => { counts[i.source] = (counts[i.source] || 0) + 1; });
  const sources = S.news?.sources || [];
  return el("section", { class: "sect", id: "tune-mute" }, el("h2", {}, "Mute"),
    el("p", { class: "sub" }, "Hide words or whole outlets everywhere in the feed. Whole words, so AI doesn’t hide “air”; end one with * for any ending."),
    el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: add }, "Mute")),
    words.length ? el("div", { class: "chips wrap" }, words.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Unmute ${w}`,
      onclick: () => { setTune({ mutedWords: words.filter((x) => x !== w) }); rerender(); } }, `${w}  ✕`))) : null,
    el("p", { class: "fine" }, "Matches the start of words in titles, so “Marvel” also hides “Marvel’s”."),
    Object.entries(newsKinds()).map(([k, label]) => {
      const list = sources.filter((x) => (x.kind || "industry") === k);
      if (!list.length) return null;
      const off = list.filter((x) => muted.has(x.name)).length;
      return el("details", { class: "outlets", open: TU.openKind === k },
        el("summary", { onclick: (e) => { TU.openKind = e.currentTarget.parentElement.open ? null : k; } },
          swatch(k), el("span", {}, label), el("span", { class: "fine", style: "margin:0" }, `${list.length} outlets${off ? `, ${off} muted` : ""}`)),
        list.map((x) => switchRow(x.name, `${plural(counts[x.name] || 0, "story", "stories")} now${x.ok ? "" : " · feed not working"}`, !muted.has(x.name), (on) => {
          setTune({ mutedSources: on ? T.mutedSources.filter((n) => n !== x.name) : [...T.mutedSources, x.name] }); rerender();
        })));
    }));
}

function trendSection() {
  const r = trendRules();
  const b = r.base;
  const cur = T.trend || {};
  const setR = (k, v) => {
    const next = { ...cur, [k]: Number(v) };
    const same = (next.breakout ?? b.breakout) === b.breakout && (next.rising ?? b.rising) === b.rising
      && (next.cooling ?? b.cooling) === b.cooling && (next.minScale ?? 1) === 1;
    setTune({ trend: same ? null : next }); rerender();
  };
  const x = S.explore;
  const yrs = { 1: "1-year", 2: "2-year", 5: "5-year" }[S.win];
  let live = null;
  if (x?.topics) {
    const L = trendLists(x, S.win);
    live = el("p", { class: "lede small" }, `With these rules, the ${yrs} window has ${plural(L.breakouts.length, "breakout")}, ${L.rising.length} rising and ${L.cooling.length} cooling.`);
  }
  const pctTxt = (g) => `${g > 0 ? "+" : "−"}${Math.round(Math.abs(g) * 100)}%`;
  const bTxt = (g) => (g === 1 ? "doubled" : g === 2 ? "tripled" : pctTxt(g));
  return el("section", { class: "sect", id: "tune-trends" }, el("h2", {}, "Explore trend rules"),
    el("p", { class: "sub" }, "How much a topic’s share of imaging research must change to land in Breakouts, Rising or Cooling."),
    live,
    segPick("Breakout", [[0.5, "+50%"], [1, "Doubled"], [2, "Tripled"]], r.breakout, (v) => setR("breakout", v)),
    segPick("Rising", [[0.1, "+10%"], [0.15, "+15%"], [0.25, "+25%"], [0.5, "+50%"]], r.rising, (v) => setR("rising", v)),
    segPick("Cooling", [[-0.1, "−10%"], [-0.15, "−15%"], [-0.25, "−25%"]], r.cooling, (v) => setR("cooling", v)),
    segPick("Papers a topic needs first", [[0.5, "Fewer"], [1, "Standard"], [2, "More"]], cur.minScale ?? 1, (v) => setR("minScale", v),
      `${r.min[1]}, ${r.min[2]} and ${r.min[5]} papers for the 1-, 2- and 5-year windows. Small topics swing wildly, so this keeps noise out.`),
    el("p", { class: "fine" }, `The weekly job’s own rules are ${bTxt(b.breakout)}, ${pctTxt(b.rising)} and ${pctTxt(b.cooling)}${r.custom ? "; yours apply on this phone only" : ""}. `,
      el("a", { href: `${GH}/edit/main/config/topics.yaml`, target: "_blank", rel: "noopener" }, "Change them on GitHub"), "."));
}

// ── updates: the jobs that build the data ──────────────────────────────────
const JOBS = {
  feed: { wf: "feed.yml", cfg: "feeds.yaml", every: 26, title: "Papers", sub: "PubMed, every morning" },
  news: { wf: "news.yml", cfg: "news.yaml", every: 7, title: "News", sub: "Outlet feeds, every 6 hours" },
  explore: { wf: "explore.yml", cfg: "topics.yaml", every: 8 * 24, title: "Trends", sub: "PubMed, iCite and ClinicalTrials.gov, every Monday" },
  important: { wf: "important.yml", cfg: "feeds.yaml", every: 8 * 24, title: "Most important papers", sub: "PubMed and NIH iCite, every Tuesday" },
};
async function loadRuns() {
  if (S.runs && Date.now() - S.runs.at < 10 * 60 * 1000) return;
  S.runs = { at: Date.now(), wf: {} };
  await Promise.all(Object.values(JOBS).map(async (j) => {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${j.wf}/runs?per_page=1`, { headers: { Accept: "application/vnd.github+json" } });
      if (r.ok) S.runs.wf[j.wf] = (await r.json()).workflow_runs?.[0] || null;
    } catch { /* offline or rate-limited: show what the data files say */ }
  }));
  if (S.tab === "tune" && TU.pane === "pipeline") rerender();
}

function jobStatus(key, generated) {
  const j = JOBS[key];
  const run = S.runs?.wf?.[j.wf];
  const hours = generated ? (Date.now() - new Date(generated).getTime()) / 36e5 : Infinity;
  const late = hours > j.every;
  const bits = [el("span", { class: late ? "warn-text" : "" }, generated ? `Data from ${ago(generated)}${late ? ", later than expected" : ""}` : "Not built yet")];
  if (run) {
    const when = ago(run.updated_at || run.created_at);
    if (run.status !== "completed") bits.push(el("span", {}, `Running now (started ${ago(run.created_at)})`));
    else if (run.conclusion === "success") bits.push(el("span", {}, `Last run worked, ${when}`));
    else bits.push(el("a", { class: "warn-text", href: /^https:\/\/github\.com\//.test(run.html_url || "") ? run.html_url : GH, target: "_blank", rel: "noopener" }, `Last run ${run.conclusion === "cancelled" ? "was cancelled" : "failed"}, ${when}. See the log`));
  }
  return el("p", { class: "status" }, bits);
}
function settingsList(rows) {
  const r = rows.filter(Boolean);
  return r.length ? el("ul", { class: "settings-list" }, r.map((t) => el("li", {}, t)))
    : el("p", { class: "fine" }, "Settings show here after the next update.");
}
function jobLinks(key, editLabel) {
  const j = JOBS[key];
  return el("div", { class: "link-row" }, linkBtn(`${GH}/edit/main/config/${j.cfg}`, editLabel), linkBtn(`${GH}/actions/workflows/${j.wf}`, "Run now"));
}

function pipelinePane() {
  loadRuns();
  return [
    el("p", { class: "lede small" }, "Three jobs on GitHub build what you read. Their settings live in files you can edit on GitHub; changes apply at the next run."),
    papersJob(), importantJob(), newsJob(), exploreJob(),
    el("p", { class: "fine" }, "Edit opens the settings file on GitHub. Sign in, tap the pencil, change a value and commit. Run now opens the job; tap Run workflow to start it instead of waiting."),
  ];
}

function papersJob() {
  const f = S.feed;
  const items = f?.items || [];
  const st = f?.settings || {};
  const daysBack = 14;
  const perDay = Array.from({ length: daysBack }, (_, i) => {
    const d = new Date(Date.now() - (daysBack - 1 - i) * 864e5).toISOString().slice(0, 10);
    return [items.filter((p) => p.added === d).length, 0];
  });
  const week = perDay.slice(-7).reduce((a, v) => a + v[0], 0);
  const ck = { structured: 0, closing: 0, opening: 0, none: 0 };
  items.forEach((p) => { ck[p.conclusion?.kind || "none"] = (ck[p.conclusion?.kind || "none"] || 0) + 1; });
  const ev = [0, 0, 0, 0, 0];
  items.forEach((p) => { ev[Math.min(4, p.design?.strength || 0)]++; });
  const evMax = Math.max(1, ...ev);
  const streams = f?.streams || {};
  const journals = {};
  items.forEach((p) => { journals[p.journal] = (journals[p.journal] || 0) + 1; });
  const topJ = Object.entries(journals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const concl = [[ck.structured, "var(--ink)", "Labeled conclusion"], [ck.closing, "var(--muted)", "Last lines of the abstract"],
    [ck.opening, "var(--faint)", "Opening of a review"], [ck.none, "var(--h0)", "Abstract not out yet"]];
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.feed.title), el("p", { class: "sub" }, JOBS.feed.sub),
    jobStatus("feed", f?.generated),
    !items.length ? el("p", { class: "nothing" }, "No papers yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Cards in the feed"), el("dd", {}, items.length.toLocaleString()),
        el("dt", {}, "Added in the last 7 days"), el("dd", {}, week.toLocaleString())),
      f?.failed_streams?.length ? el("p", { class: "fine warn-text" },
        `Last run couldn’t search ${f.failed_streams.map((s) => f.streams?.[s] || s).join(", ")}; those papers will catch up on the next run. If this repeats, the search wording in config/feeds.yaml needs a look.`) : null,
      dayBars(perDay, [fmtDate(new Date(Date.now() - (daysBack - 1) * 864e5).toISOString().slice(0, 10)), "today"], { h: 48 }),
      el("div", { class: "ctl-label" }, "What the big text on each card is"),
      stack(concl), legend(concl),
      el("div", { class: "ctl-label" }, "Evidence strength"),
      el("div", { class: "ev-bars" }, ev.map((n, i) => el("div", {},
        el("span", { class: "evb" }, el("i", { style: `height:${Math.max(n ? 4 : 0, Math.round((n / evMax) * 100))}%;background:var(--h${i ? i + (i === 4 ? 1 : 0) : 0})` })),
        el("b", {}, String(n)), el("span", {}, ["None", "1", "2", "3", "4"][i])))),
      el("p", { class: "fine" }, "0 means the design isn’t stated; 4 is a meta-analysis, randomized trial or guideline."),
      el("div", { class: "ctl-label" }, "Where they come from"),
      el("dl", { class: "facts" }, Object.entries(streams).map(([k, name]) => [el("dt", {}, name),
        el("dd", {}, items.filter((p) => (p.streams || []).includes(k)).length.toLocaleString())])),
      el("div", { class: "ctl-label" }, "Busiest journals"),
      el("dl", { class: "facts" }, topJ.map(([j, n]) => [el("dt", {}, j), el("dd", {}, String(n))])),
    ],
    el("div", { class: "ctl-label" }, "Settings in config/feeds.yaml"),
    settingsList(st.keep_days ? [
      `Searches ${st.journals} radiology, ${st.nm_journals} nuclear medicine and ${st.general_journals} high-impact journals.`,
      `Each run re-checks the last ${st.recheck_days} days, since abstracts often reach PubMed late.`,
      `Cards stay ${st.keep_days} days, ${st.max_items.toLocaleString()} at most.`,
      `${st.topics} Explore topics tag the cards.`,
    ] : []),
    jobLinks("feed", "Edit journals and settings"));
}

function newsJob() {
  const n = S.news;
  const items = n?.items || [];
  const st = n?.settings || {};
  const sources = n?.sources || [];
  const okN = sources.filter((x) => x.ok && !x.stale).length;
  const stale = sources.filter((x) => x.ok && x.stale);
  const counts = {};
  items.forEach((i) => { counts[i.source] = (counts[i.source] || 0) + 1; });
  const byKind = {};
  items.forEach((i) => { byKind[kindOf(i)] = (byKind[kindOf(i)] || 0) + 1; });
  const parts = Object.keys(newsKinds()).filter((k) => byKind[k]).map((k) => [byKind[k], kindColor(k), kindLabel(k), k]);
  const failing = sources.filter((x) => !x.ok);
  const ts = st.top_stories, tr = st.trending;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.news.title), el("p", { class: "sub" }, JOBS.news.sub),
    jobStatus("news", n?.generated),
    !items.length ? el("p", { class: "nothing" }, "No stories yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Stories"), el("dd", {}, items.length.toLocaleString()),
        el("dt", {}, "Outlets working"), el("dd", { class: failing.length || stale.length ? "warn-text" : "" }, `${okN} of ${sources.length}`),
        el("dt", {}, "Podcast episodes"), el("dd", {}, String(items.filter((i) => i.audio).length))),
      stack(parts), legend(parts),
      failing.length ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Not working"),
        el("ul", { class: "settings-list" }, failing.map((x) => el("li", {}, el("b", {}, x.name), ": ", (x.tried || [])[0] || "no feed answered")))) : null,
      stale.length ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Not updating"),
        el("ul", { class: "settings-list" }, stale.map((x) => el("li", {}, el("b", {}, x.name), `: newest story is from ${fmtDate(x.newest.slice(0, 10))}. The outlet may have moved its feed.`)))) : null,
      sources.some((x) => x.offsite) ? el("div", {}, el("div", { class: "ctl-label warn-text" }, "Links to other sites dropped"),
        el("p", { class: "fine" }, "Stories that pointed away from the outlet’s own site, which can mean a hacked feed. If one keeps showing up for an outlet you trust, add the site to its link_domains in config/news.yaml."),
        el("ul", { class: "settings-list" }, sources.filter((x) => x.offsite).map((x) => el("li", {}, el("b", {}, x.name), `: ${plural(x.offsite, "link")} in the last update`)))) : null,
      el("details", { class: "outlets" }, el("summary", {}, el("span", {}, "Every outlet"), el("span", { class: "fine", style: "margin:0" }, "stories now, newest")),
        el("dl", { class: "facts small" }, sources.slice().sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0)).map((x) => [
          el("dt", {}, swatch(x.kind || "industry"), x.name),
          el("dd", { class: x.ok && !x.stale ? "" : "warn-text" }, !x.ok ? "not working" : x.stale ? "not updating" : `${counts[x.name] || 0} · ${x.newest ? agoShort(x.newest) : "—"}`)]))),
    ],
    el("div", { class: "ctl-label" }, "Settings in config/news.yaml"),
    settingsList(st.keep_days ? [
      `${st.outlets} outlets. Industry stories stay ${st.keep_days} days; other news ${st.other_keep_days} days.`,
      ts ? `Top stories: at least ${ts.min_outlets} publishers in ${ts.days} days, with headlines sharing ${Math.round(ts.match * 100)}% of their key words.` : null,
      tr ? `Trending: the last ${tr.week[0]} days against the ${tr.week[1]} before, and the last ${tr.month[0]} against the ${tr.month[1]} before; ${tr.phrases} phrases per kind.` : null,
      st.promo_filter ? "Gift guides, deals and sponsored posts are skipped outside industry news." : null,
      `Headlines are kept ${Math.round(st.archive_days / 365 * 10) / 10} years for trend lines.`,
    ] : []),
    jobLinks("news", "Edit outlets and settings"));
}

function importantJob() {
  const I = S.important;
  const st = I?.stats || {}, set = I?.settings || {};
  const sizes = (w) => {                // per area since areas came in; one list before
    const v = I?.windows?.[w] || {};
    return String(v.research ? v.research.length : new Set(Object.values(v).flatMap((x) => x.research || [])).size);
  };
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.important.title), el("p", { class: "sub" }, JOBS.important.sub),
    jobStatus("important", I?.generated),
    !I ? el("p", { class: "nothing" }, "Not built yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Papers checked"), el("dd", {}, (st.checked || 0).toLocaleString()),
        el("dt", {}, "Original research"), el("dd", {}, (st.research || 0).toLocaleString()),
        el("dt", {}, "Reviews and guidelines"), el("dd", {}, (st.other || 0).toLocaleString()),
        el("dt", {}, "Left out (case reports, editorials…)"), el("dd", {}, (st.skipped || 0).toLocaleString()),
        el("dt", {}, "Cited at least once"), el("dd", {}, `${Math.round(100 * (st.with_citations || 0) / Math.max(1, st.kept || 1))}%`),
        el("dt", {}, "Papers in New, 1 year, 3 years"), el("dd", {}, `${sizes("6m")}, ${sizes("1y")}, ${sizes("3y")}`)),
      (st.journals || []).length ? [el("div", { class: "ctl-label" }, "Journals by citation record"),
        el("p", { class: "fine", style: "margin-top:2px" }, "Average percentile of their papers that are 1 to 3 years old; new papers borrow it."),
        el("dl", { class: "facts small" }, st.journals.slice(0, 10).map(([j, p, n]) => [el("dt", {}, j), el("dd", {}, `${Math.round(p)} · ${n.toLocaleString()} papers`)]))] : null,
    ],
    el("div", { class: "ctl-label" }, "Settings in config/feeds.yaml (important:)"),
    settingsList(set.years ? [
      `Looks back ${set.years} years over the same journals and filters as the feed.`,
      `Keeps ${set.per_window["6m"]} new, ${set.per_window["1y"]} one-year and ${set.per_window["3y"]} three-year papers; ${set.other_per_window} reviews and guidelines per list.`,
      `The 1- and 3-year lists skip papers younger than ${set.min_age_months} months.`,
    ] : []),
    jobLinks("important", "Edit settings"));
}

function exploreJob() {
  const x = S.explore;
  const st = x?.settings || {};
  const papers = Object.values(x?.papers || {});
  const withAbs = papers.filter((p) => (p.sections || []).length).length;
  const notes = Object.keys(x?.query_notes || {});
  const stale = (x?.topics || []).filter((t) => t.stale);
  const mp = st.min_papers || x?.min_recent;
  return el("section", { class: "sect job" }, el("h2", {}, JOBS.explore.title), el("p", { class: "sub" }, JOBS.explore.sub),
    jobStatus("explore", x?.generated),
    !x ? el("p", { class: "nothing" }, "Not built yet.") : [
      el("dl", { class: "facts" },
        el("dt", {}, "Topics"), el("dd", {}, String(x.topics.length)),
        el("dt", {}, "Key papers with abstracts"), el("dd", {}, `${withAbs} of ${papers.length}`),
        el("dt", {}, "Topics kept from last week"), el("dd", { class: stale.length ? "warn-text" : "" }, String(stale.length)),
        el("dt", {}, "Searches that found nothing"), el("dd", {}, String(notes.length))),
      notes.length ? el("details", { class: "outlets" }, el("summary", {}, el("span", {}, "Which searches"),
        el("span", { class: "fine", style: "margin:0" }, "often guideline searches for young topics")),
        el("ul", { class: "settings-list small" }, notes.map((q) => el("li", {}, q.length >= 160 ? q + "…" : q)))) : null,
    ],
    el("div", { class: "ctl-label" }, "Settings in config/topics.yaml"),
    settingsList(st.breakout != null ? [
      `Breakout: share up ${st.breakout === 1 ? "2×" : `${Math.round(st.breakout * 100)}%`} or more. Rising: up ${Math.round(st.rising * 100)}%. Cooling: down ${Math.round(-st.cooling * 100)}%.`,
      mp ? `A topic needs ${mp[1]}, ${mp[2]} and ${mp[5]} papers in the 1-, 2- and 5-year windows before it can trend.` : null,
      `${st.influential} topics under Most influential; ${st.title_phrases} phrases under New in titles.`,
      T.trend ? "You’ve changed these rules on this phone (Feed rules)." : null,
    ] : []),
    jobLinks("explore", "Edit topics and rules"));
}
