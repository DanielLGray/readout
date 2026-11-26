/* Readout — Coming up: events on the horizon (Today card, Explore → Coming up, Tune → Interests).
   Most events come from data/horizon.json, built daily from official calendars. Earnings dates come
   straight to this phone from Alpha Vantage with your own free key, kept only here. */
"use strict";

const AV_URL = "https://www.alphavantage.co/query";
const BANKS = new Set(["JPM", "BAC", "WFC", "C", "GS"]);
ICONS.calendar = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';

// ── dates ──────────────────────────────────────────────────────────────────
const hzDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const hzStart = (e) => (e.allDay ? hzDate(e.start) : new Date(e.start));
function hzEnd(e) {
  if (e.allDay) { const d = hzDate(e.end || e.start); d.setHours(23, 59, 59); return d; }
  return e.end && e.end.includes("T") ? new Date(e.end) : new Date(new Date(e.start).getTime() + 3600e3);
}
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
function dayDiff(d) { const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); return Math.round((x - t) / 864e5); }
const MD = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const clockOf = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" AM", " am").replace(" PM", " pm");
function dayWord(d) {
  const n = dayDiff(d);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
function hzSpan(e) {
  const s = hzStart(e), en = e.end ? hzDate(e.end) : null;
  if (!e.allDay || !en || sameDay(s, en)) return null;
  return s.getMonth() === en.getMonth() ? `${MD(s)}–${en.getDate()}` : `${MD(s)}–${MD(en)}`;
}
// "Thursday · 11 am", "Jan 11–14", "About Jan 14"
function hzWhen(e, long = false) {
  const s = hzStart(e);
  let t = hzSpan(e) || (long ? s.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : dayWord(s));
  if (!e.allDay) t += ` · ${clockOf(s)}`;
  if (e.approx === "about") t = `About ${t}`;
  else if (e.approx) t = `No earlier than ${t}`;
  if (hzStart(e) < new Date() && hzEnd(e) > new Date() && e.allDay && hzSpan(e)) t += " (on now)";
  return t;
}

// ── earnings, from Alpha Vantage with your key ─────────────────────────────
const EARN = { busy: false };
function csvRows(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}
function parseEarnings(text, watch) {
  const rows = csvRows(text);
  const head = (rows.shift() || []).map((h) => h.trim().toLowerCase());
  const col = (n) => head.indexOf(n.toLowerCase());
  const [iS, iN, iD, iF, iE, iT] = ["symbol", "name", "reportDate", "fiscalDateEnding", "estimate", "timeOfTheDay"].map(col);
  if (iS < 0 || iD < 0) throw new Error("Alpha Vantage sent something other than the earnings calendar");
  const out = [];
  for (const r of rows) {
    const s = (r[iS] || "").trim().toUpperCase();
    if (!watch.has(s) || !/^\d{4}-\d{2}-\d{2}$/.test(r[iD] || "")) continue;
    out.push({ s, n: (r[iN] || "").trim(), d: r[iD], f: iF >= 0 ? r[iF] : "", e: iE >= 0 ? r[iE] : "", t: iT >= 0 ? (r[iT] || "").trim() : "" });
  }
  return out;
}
async function earnRefresh(force) {
  const key = store.get("avKey", "");
  if (!key || EARN.busy) return;
  const c = store.get("earn", null);
  const watch = T.horizon.watch.join(",");
  const age = c?.at ? Date.now() - c.at : Infinity;
  if (!force && c && c.watch === watch && age < 20 * 36e5) return;
  if (!force && c?.errAt && Date.now() - c.errAt < 36e5) return;       // tried in the last hour
  EARN.busy = true;
  try {
    const r = await fetch(`${AV_URL}?function=EARNINGS_CALENDAR&horizon=3month&apikey=${encodeURIComponent(key)}`, { cache: "no-store", referrerPolicy: "no-referrer" });
    const text = await r.text();
    if (!r.ok) throw new Error(`Alpha Vantage answered ${r.status}`);
    if (/^\s*\{/.test(text)) {          // a JSON answer is a message: a bad key or the daily limit
      let msg = "Alpha Vantage didn’t send the calendar";
      try { const j = JSON.parse(text); msg = j.Information || j.Note || j["Error Message"] || msg; } catch { /* keep the generic message */ }
      throw new Error(msg);
    }
    store.set("earn", { at: Date.now(), watch, items: parseEarnings(text, new Set(T.horizon.watch)) });
  } catch (err) {
    const msg = err instanceof TypeError ? "Couldn’t reach Alpha Vantage from this phone." : String(err.message || err).slice(0, 300);
    store.set("earn", { ...(c || {}), err: msg, errAt: Date.now() });
  } finally {
    EARN.busy = false;
    hzRedraw();
  }
}
function earnEvents() {
  const c = store.get("earn", null);
  if (!store.get("avKey", "") || !Array.isArray(c?.items)) return [];
  const watch = new Set(T.horizon.watch);
  return c.items.filter((x) => watch.has(x.s)).map((x) => {
    const when = /pre/i.test(x.t) ? "before the market opens" : /post|after/i.test(x.t) ? "after the market closes" : "";
    const q = /^\d{4}-\d{2}/.test(x.f || "") ? `quarter ending ${hzDate(x.f).toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : "";
    return { id: `earn-${x.s}-${x.d}`, kind: "markets", title: `${WATCH_NAMES[x.s] || x.n || x.s} earnings`, start: x.d, allDay: true,
      sub: [x.s, q, when].filter(Boolean).join(" · "), src: "Alpha Vantage", earn: x.s,
      about: x.e && isFinite(+x.e) ? `Analysts expect earnings of ${(+x.e).toFixed(2)} a share.` : "" };
  });
}

// ── the merged list ────────────────────────────────────────────────────────
function hzMeetingOn(id) {
  const m = (S.news?.meetings || []).find((x) => x.id === id);
  return m ? meetingOn(m) : T.meetings[id] !== false;
}
function hzEvents(days = 90) {
  const kinds = T.horizon.kinds;
  const now = new Date(), stop = new Date(); stop.setHours(23, 59, 59); stop.setDate(stop.getDate() + days);
  const earn = kinds.markets ? earnEvents() : [];
  let evs = (S.horizon?.events || []).filter((e) => kinds[e.kind] !== false && (!e.meeting || hzMeetingOn(e.meeting)));
  // the banks' real dates replace the estimated start of earnings season
  const banks = earn.filter((e) => BANKS.has(e.earn)).sort((a, b) => a.start.localeCompare(b.start));
  evs = evs.filter((e) => !e.id.startsWith("season-") || !banks.some((b) => Math.abs(dayDiff(hzDate(b.start)) - dayDiff(hzDate(e.start))) <= 14));
  const firsts = new Set();
  for (const b of banks) if (![...firsts].some((f) => Math.abs(dayDiff(hzDate(f)) - dayDiff(hzDate(b.start))) <= 20)) firsts.add(b.start);
  earn.forEach((e) => { if (BANKS.has(e.earn) && firsts.has(e.start)) e.lead = "The big banks open earnings season."; });
  return evs.concat(earn).filter((e) => hzEnd(e) >= now && hzStart(e) <= stop)
    .sort((a, b) => hzStart(a) - hzStart(b) || (a.earn ? 1 : 0) - (b.earn ? 1 : 0) || a.title.localeCompare(b.title));
}
function hzRedraw() {
  if (S.overlay === "hz") drawHorizon();
  if (S.tab === "explore") renderExplore(true);
  if (S.tab === "tune" && typeof renderTune === "function") renderTune(true);
  if (S.tab === "feed" && S.kind === "today") updateFeedQuietly(1e9);
  else if (S.kind === "today") S.feedDirty = true;
}

// ── pieces ─────────────────────────────────────────────────────────────────
const hzDot = (k) => el("span", { class: "hz-dot", "data-kind": k, "aria-hidden": "true" });
const hzSub = (e) => e.lead || (e.kind === "movies" ? ["In theaters", e.sub].filter(Boolean).join(" · ") : e.sub);
function hzRowEl(e, showDay = true) {
  const s = hzStart(e);
  const day = hzSpan(e) || (showDay ? dayWord(s) : `${s.toLocaleDateString("en-US", { weekday: "short" })} ${s.getDate()}`);
  return el("li", {}, el("button", { class: "hz-row", onclick: () => openHzEvent(e) },
    el("span", { class: "hz-when" }, el("b", {}, e.approx === "about" ? `~${day}` : day), e.allDay ? null : el("span", {}, clockOf(s))),
    el("span", { class: "hz-what" }, el("span", { class: "hz-t" }, hzDot(e.kind), e.title),
      hzSub(e) ? el("span", { class: "hz-s" }, hzSub(e)) : null)));
}
function hzCardEl(it) {
  const days = T.brief.hzDays || 7, show = days > 7 ? 10 : 7;
  const evs = hzEvents(days);
  const span = days === 7 ? "this week" : `in ${days} days`;
  return el("article", { class: "card brief-card hz-card", "data-key": "brief:horizon" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, "Coming up"), el("span", {}, `the next ${days} days`)),
    evs.length ? el("ol", { class: "hz-list" }, evs.slice(0, show).map((e) => hzRowEl(e))) : el("p", { class: "nothing" }, `Nothing scheduled ${days === 7 ? "this week" : `in the next ${days} days`}.`),
    el("div", { class: "link-row", style: "margin-top:2px" },
      el("button", { class: "act", onclick: openHorizon }, icon(ICONS.calendar), evs.length > show ? `All ${evs.length} ${span}, and the next 90 days` : "The next 90 days")));
}
function hzEntryEl() {
  if (!S.horizon && !store.get("avKey", "")) return null;
  const evs = hzEvents(90);
  return el("button", { class: "fd-entry hz-entry", onclick: openHorizon },
    el("span", { class: "fd-entry-h" }, el("b", {}, "Coming up"), el("span", {}, `${plural(evs.length, "event")} in 90 days`)),
    el("span", { class: "hz-mini" }, evs.slice(0, 3).map((e) => el("span", {}, hzDot(e.kind), `${hzSpan(e) || dayWord(hzStart(e))}: ${e.title}`))));
}

// ── the full list (Explore → Coming up) ─────────────────────────────────────
function openHorizon() {
  if ($("#sheet").classList.contains("open")) closeSheet();
  $("#topic-title").textContent = "Coming up";
  S.overlay = "hz";
  drawHorizon();
  const ov = $("#topic");
  if (!ov.classList.contains("open")) topicOpener = document.activeElement;
  ov.classList.add("open");
  ov.setAttribute("aria-hidden", "false");
  setInert();
  $("#topic-body").scrollTop = 0;
  $("#topic-back").focus({ preventScroll: true });
}
function weekLabel(d) {
  const monday = (x) => { const m = new Date(x); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const w = Math.round((monday(d) - monday(new Date())) / (7 * 864e5));
  return w <= 0 ? "This week" : w === 1 ? "Next week" : `Week of ${MD(monday(d))}`;
}
function drawHorizon() {
  const body = $("#topic-body");
  const keep = body.scrollTop;
  const days = S.hzDays || 90;
  const all = hzEvents(days);
  const f = S.hzFilter && T.horizon.kinds[S.hzFilter] ? S.hzFilter : "all";
  const evs = f === "all" ? all : all.filter((e) => e.kind === f);
  const counts = {};
  all.forEach((e) => { counts[e.kind] = (counts[e.kind] || 0) + 1; });
  const groups = [];
  for (const e of evs) {
    const d = hzStart(e) < new Date() ? new Date() : hzStart(e);
    let label = weekLabel(d);
    if (days > 90 && !/^(This|Next) week$/.test(label)) label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });   // a year: by month
    if (!groups.length || groups[groups.length - 1][0] !== label) groups.push([label, []]);
    groups[groups.length - 1][1].push(e);
  }
  const H = S.horizon;
  const key = store.get("avKey", ""), earn = store.get("earn", null);
  const bad = Object.entries(H?.sources || {}).filter(([, v]) => !v.ok && !v.fallback).map(([k]) => ({ fed: "the Federal Reserve", bls: "BLS", bea: "BEA", fda: "FDA", launches: "Launch Library 2" }[k] || k));
  const unsched = (H?.unscheduled || []).filter((u) => T.horizon.kinds[u.kind] !== false && (f === "all" || u.kind === f));
  const webcal = `webcal://${location.host}${location.pathname.replace(/[^/]*$/, "")}data/horizon.ics`;
  body.replaceChildren(el("div", { class: "hz-page" },
    el("div", { class: "chips wrap hz-chips" },
      el("button", { class: "chip", "aria-pressed": String(f === "all"), onclick: () => { S.hzFilter = null; drawHorizon(); } }, `All ${all.length}`),
      Object.entries(HZ_KINDS).filter(([k]) => T.horizon.kinds[k] && counts[k]).map(([k, label]) =>
        el("button", { class: "chip", "aria-pressed": String(f === k), onclick: () => { S.hzFilter = k; drawHorizon(); } }, hzDot(k), `${label} ${counts[k]}`))),
    !H ? el("p", { class: "nothing" }, "Events arrive with the first daily update.") : null,
    groups.map(([label, list]) => el("section", { class: "hz-week" }, el("h3", { class: "sys-head" }, label),
      el("ol", { class: "hz-list" }, list.map((e) => hzRowEl(e, label === "This week"))))),
    H && !evs.length ? el("p", { class: "nothing" }, `Nothing in the next ${days === 90 ? "90 days" : "12 months"}.`) : null,
    H ? el("div", { class: "link-row" }, el("button", { class: "act", onclick: () => { S.hzDays = days === 90 ? 366 : 90; drawHorizon(); } },
      days === 90 ? "Show the next 12 months" : "Back to the next 90 days")) : null,
    T.horizon.kinds.markets && (f === "all" || f === "markets") ? el("div", { class: "fd-note" },
      !key ? [el("b", {}, "Earnings dates: "), "add your free Alpha Vantage key in Tune → Interests → Coming up. Until then, the start of each earnings season is estimated. ",
        el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("interests", "tune-horizon"); } }, "Add a key")]
        : earn?.err && (!earn.at || earn.errAt > earn.at) ? [el("b", {}, "Earnings: "), earn.err, earn.at ? ` Showing the dates from ${ago(new Date(earn.at).toISOString())}.` : ""]
          : [el("b", {}, "Earnings: "), `${plural(T.horizon.watch.length, "company", "companies")} you watch, from Alpha Vantage${earn?.at ? `, updated ${ago(new Date(earn.at).toISOString())}` : ""}. `,
            el("button", { class: "inline-link", onclick: () => { closeTopic(); switchTab("tune"); setPane("interests", "tune-horizon"); } }, "Change the list")]) : null,
    unsched.length ? el("section", { class: "hz-week" }, el("h3", { class: "sys-head" }, "Expected, no date yet"),
      el("ul", { class: "rows plain" }, unsched.map((u) => el("li", { class: "hz-un" }, el("span", { class: "hz-t" }, hzDot(u.kind), u.title), el("span", { class: "hz-s" }, u.when))))) : null,
    H ? el("div", { class: "link-row" }, el("a", { class: "act wide", href: webcal }, icon(ICONS.calendar), "Subscribe in Calendar")) : null,
    H ? el("p", { class: "fine" }, "Subscribing adds these events (not earnings) to your phone’s Calendar app as a calendar of its own, and it keeps itself up to date.") : null,
    H?.sources?.movies?.via === "tmdb" ? tmdbCredit() : null,
    H ? el("p", { class: "fine" }, `From the Federal Reserve, the Bureau of Labor Statistics, the Bureau of Economic Analysis, FDA notices in the Federal Register, NYSE’s holiday rules, Launch Library 2 (The Space Devs), your meetings and dates checked by hand${key ? ", with earnings from Alpha Vantage" : ""}. Updated ${ago(H.generated)}.`,
      bad.length ? ` Couldn’t read ${bad.join(", ")} on the last update; its dates are from the run before.` : "") : null));
  body.scrollTop = keep;
}

// TMDB asks for its logo and this notice wherever its data shows
function tmdbCredit() {
  return el("p", { class: "fine tmdb-credit" },
    el("a", { href: "https://www.themoviedb.org/", target: "_blank", rel: "noopener", "aria-label": "TMDB" },
      el("img", { src: "icons/tmdb.svg", alt: "TMDB", width: "18", height: "18" })),
    "Movie release dates from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.");
}

// ── one event ──────────────────────────────────────────────────────────────
function icsFor(e) {
  const esc = (s) => String(s || "").replace(/\r\n?|\n/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const d = (iso) => iso.slice(0, 10).replace(/-/g, "");
  const next = hzDate(e.end || e.start); next.setDate(next.getDate() + 1);
  const nd = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Readout//Coming up//EN", "BEGIN:VEVENT", `UID:${e.id}@readout`,
    `DTSTAMP:${d(e.start)}T000000Z`, `DTSTART;VALUE=DATE:${d(e.start)}`, `DTEND;VALUE=DATE:${nd}`, `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc([e.sub, e.about, e.src ? `Source: ${e.src}.` : ""].filter(Boolean).join(" "))}`, "TRANSP:TRANSPARENT", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
}
function calBtn(e) {
  if (!e.earn) {
    return el("a", { class: "act", href: `data/ics/${encodeURIComponent(e.id)}.ics`, target: "_blank", rel: "noopener" }, icon(ICONS.calendar), "Add to Calendar");
  }
  return el("button", { class: "act", onclick: () => {
    const url = URL.createObjectURL(new Blob([icsFor(e)], { type: "text/calendar" }));
    const a = el("a", { href: url, download: `${e.id}.ics` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } }, icon(ICONS.calendar), "Add to Calendar");
}
function openHzEvent(e) {
  openSheet(
    el("p", { class: "hz-kind" }, hzDot(e.kind), HZ_KINDS[e.kind] || ""),
    el("h2", { id: "sheet-title" }, e.title),
    el("p", { class: "sheet-meta" }, el("span", {}, hzWhen(e, true)), e.place ? el("span", {}, e.place) : null),
    e.lead ? el("p", { class: "hz-lead" }, e.lead) : null,
    hzSub(e) && !e.lead ? el("p", { class: "hz-sub" }, hzSub(e)) : e.sub ? el("p", { class: "hz-sub" }, e.sub) : null,
    e.about ? el("p", { class: "hz-about" }, e.about) : null,
    e.approx === "about" ? el("p", { class: "fine" }, "An estimate: the exact date isn’t set yet.")
      : e.approx ? el("p", { class: "fine" }, "The earliest it could happen; launch dates often slip.") : null,
    !e.allDay ? el("p", { class: "fine" }, `Times are in your phone’s time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ")}).`) : null,
    el("div", { class: "link-row" }, calBtn(e),
      e.url ? el("a", { class: "act", href: safeUrl(e.url), target: "_blank", rel: "noopener" }, icon(ICONS.read),
        /imdb\.com/.test(e.url) ? "IMDb" : /themoviedb\.org/.test(e.url) ? "TMDB" : "Details") : null),
    e.src === "TMDB" ? tmdbCredit() : e.src ? el("p", { class: "fine" }, `Source: ${e.src}.`) : null);
}

// ── Tune → Interests → Coming up ───────────────────────────────────────────
function horizonSection() {
  const key = store.get("avKey", "");
  const earn = store.get("earn", null);
  const kinds = T.horizon.kinds;
  const setKinds = (k, v) => { setTune({ horizon: { ...T.horizon, kinds: { ...kinds, [k]: v } } }); rerender(); };
  const setWatch = (w) => { setTune({ horizon: { ...T.horizon, watch: w } }); rerender(); if (key) earnRefresh(true); };
  const add = el("input", { class: "text-in", placeholder: "Ticker, e.g. ISRG", "aria-label": "Add a company by its ticker", autocapitalize: "characters",
    autocomplete: "off", enterkeyhint: "done", maxlength: "10" });
  const addIt = () => {
    const s = add.value.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)) { toast("Type a ticker symbol, like ISRG"); return; }
    if (T.horizon.watch.includes(s)) { toast(`${s} is already on the list`); return; }
    setWatch([...T.horizon.watch, s]);
  };
  add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
  const keyIn = el("input", { type: "password", class: "text-in", placeholder: "Paste your Alpha Vantage key", "aria-label": "Alpha Vantage key",
    autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done" });
  const saveKey = () => {
    const v = keyIn.value.trim();
    if (!/^[A-Za-z0-9]{8,40}$/.test(v)) { toast("That doesn’t look like an Alpha Vantage key"); return; }
    store.set("avKey", v); store.set("earn", null); toast("Key saved on this phone"); rerender(); earnRefresh(true);
  };
  keyIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); saveKey(); } });
  return el("section", { class: "sect", id: "tune-horizon" }, el("h2", {}, "Coming up"),
    el("p", { class: "sub" }, "Events on the horizon: a card in Today for the next 7 days, and Explore → Coming up for the next 90."),
    Object.entries(HZ_KINDS).map(([k, label]) => switchRow(label, {
      markets: "Earnings, Fed decisions, jobs, CPI, GDP and PCE reports, stock market holidays.",
      medicine: "Your meetings (switch them under Meetings), FDA panels on imaging and heart devices, J.P. Morgan Healthcare week.",
      science: "Notable launches (crewed, Starship, probes) and eclipses.",
      news: "CES, the State of the Union, the end of the Supreme Court term, Apple’s WWDC, once their dates are set.",
      money: "IRS deadlines, new contribution limits, the big sales weekends, and each month’s usual good buys.",
      culture: "Awards nights, Sundance, the Super Bowl, Comic-Con, Burning Man and Reno’s big events.",
      movies: "Big theatrical releases in the next year, from TMDB with your token (see Tune → Updates → Set up), each linked to IMDb.",
    }[k], kinds[k], (v) => setKinds(k, v))),
    el("h3", { class: "ctl-label" }, "Earnings to watch"),
    el("div", { class: "term-chips", style: "margin-top:8px" }, T.horizon.watch.map((s) => el("button", { class: "term-chip", "aria-label": `Remove ${WATCH_NAMES[s] || s}`,
      onclick: () => setWatch(T.horizon.watch.filter((x) => x !== s)) }, WATCH_NAMES[s] || s, el("b", {}, "✕")))),
    el("div", { class: "word-add", style: "margin-top:10px" }, add, el("button", { class: "act", onclick: addIt }, "Add")),
    T.horizon.watch.join() !== WATCH_DEFAULT.join() ? el("button", { class: "fb-forget", onclick: () => setWatch(WATCH_DEFAULT.slice()) }, "Back to the suggested list") : null,
    el("h3", { class: "ctl-label" }, "Alpha Vantage key"),
    key ? [
      el("p", { class: "fine" }, "Saved on this phone only (not in backups). It’s sent only to alphavantage.co, about once a day, to get the earnings calendar.",
        earn?.at ? ` Last update ${ago(new Date(earn.at).toISOString())}: ${plural((earn.items || []).length, "report")} in the next 3 months.` : "",
        earn?.err && (!earn.at || earn.errAt > earn.at) ? [" ", el("span", { class: "warn-text" }, earn.err)] : ""),
      el("div", { class: "link-row" },
        el("button", { class: "act", onclick: () => { toast("Getting earnings dates…"); earnRefresh(true); } }, "Update now"),
        el("button", { class: "act danger", onclick: () => { store.set("avKey", ""); store.set("earn", null); toast("Key removed from this phone"); rerender(); } }, "Remove key"))]
      : [el("p", { class: "fine" }, "Exact earnings dates need a free key from Alpha Vantage (free for personal use, about a minute to get). It stays on this phone and goes only to alphavantage.co. ",
          el("a", { class: "inline-link", href: "https://www.alphavantage.co/support/#api-key", target: "_blank", rel: "noopener" }, "Get a free key")),
        el("div", { class: "word-add" }, keyIn, el("button", { class: "act", onclick: saveKey }, "Save"))]);
}
