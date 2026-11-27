// ── Quakes and fires near Reno ─────────────────────────────────────────────
// Like the weather, the phone asks two public sources itself:
//   earthquakes: the U.S. Geological Survey's M2.5+ feeds (public domain)
//   fires: the interagency wildland-fire locations NIFC publishes (WFIGS current incidents), as facts:
//     name, size, containment, place. InciWeb's own write-ups come from many agencies without stated
//     reuse terms, so the card links to InciWeb rather than showing them.
// Today gets a card while something is within reach; nothing shows when it's quiet.
const QK_DAY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
const QK_WEEK = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
const FIRE_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";
const INCIWEB = "https://inciweb.wildfire.gov/";
const NEAR_MAX_MI = 300;                      // the farthest Tune allows; quakes are kept this far out
const MI = 1.609344;

function nearBlank() { return { q: [], f: [], qAt: 0, qWeekAt: 0, qErr: 0, fAt: 0, fMi: 0, fErr: 0 }; }
function nearLoad() {
  const d = store.get("near", null);
  if (!d || typeof d !== "object" || !Array.isArray(d.q) || !Array.isArray(d.f)) return nearBlank();
  const fin = (v) => typeof v === "number" && isFinite(v);
  const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
  return {
    q: d.q.filter((x) => x && typeof x.id === "string" && fin(x.m) && fin(x.t) && fin(x.lat) && fin(x.lon))
      .map((x) => ({ id: x.id.slice(0, 40), m: x.m, t: x.t, lat: x.lat, lon: x.lon, p: str(x.p, 120), u: str(x.u, 200),
        felt: Number.isInteger(x.felt) ? x.felt : null, al: str(x.al, 8), rev: !!x.rev })),
    f: d.f.filter((x) => x && typeof x.id === "string" && typeof x.n === "string" && fin(x.lat) && fin(x.lon))
      .map((x) => ({ id: x.id.slice(0, 60), n: x.n.slice(0, 70), cat: str(x.cat, 2), lat: x.lat, lon: x.lon,
        ac: fin(x.ac) ? x.ac : null, pc: fin(x.pc) ? x.pc : null, disc: fin(x.disc) ? x.disc : null, mod: fin(x.mod) ? x.mod : null,
        county: str(x.county, 40), st: str(x.st, 4), crew: Number.isInteger(x.crew) ? x.crew : null })),
    qAt: fin(d.qAt) ? d.qAt : 0, qWeekAt: fin(d.qWeekAt) ? d.qWeekAt : 0, qErr: fin(d.qErr) ? d.qErr : 0,
    fAt: fin(d.fAt) ? d.fAt : 0, fMi: fin(d.fMi) ? d.fMi : 0, fErr: fin(d.fErr) ? d.fErr : 0 };
}
let near = nearLoad();
let nearBusy = false;

// distance (miles) and compass direction from home
function milesFrom(lat, lon) {
  const r = (x) => (x * Math.PI) / 180;
  const dLat = r(lat - WX.lat), dLon = r(lon - WX.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(r(WX.lat)) * Math.cos(r(lat)) * Math.sin(dLon / 2) ** 2;
  return (2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))) / MI;
}
function compass(lat, lon) {
  const r = (x) => (x * Math.PI) / 180;
  const y = Math.sin(r(lon - WX.lon)) * Math.cos(r(lat));
  const x = Math.cos(r(WX.lat)) * Math.sin(r(lat)) - Math.sin(r(WX.lat)) * Math.cos(r(lat)) * Math.cos(r(lon - WX.lon));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
}
function fromHome(lat, lon) {
  const d = milesFrom(lat, lon);
  return d < 3 ? `in ${WX.short}` : `${Math.round(d)} mi ${compass(lat, lon)} of ${WX.short}`;
}
// USGS says "12 km NE of Sun Valley, Nevada": the same in miles
function placeInMiles(p) {
  const m = /^(\d+(?:\.\d+)?) km ([NSEW]{1,3}) of (.+)$/.exec(p || "");
  return m ? `${Math.max(1, Math.round(Number(m[1]) / MI))} mi ${m[2]} of ${m[3]}` : p || "";
}

// ── reading the two sources ────────────────────────────────────────────────
function parseQuakes(d) {
  const out = [];
  for (const f of Array.isArray(d?.features) ? d.features : []) {
    const p = f?.properties || {}, c = f?.geometry?.coordinates || [];
    const [lon, lat] = c, m = p.mag;
    if (p.type !== "earthquake" || ![lat, lon, m, p.time].every((v) => typeof v === "number" && isFinite(v))) continue;
    if (milesFrom(lat, lon) > NEAR_MAX_MI) continue;
    const id = String(f.id || "").slice(0, 40);
    if (!/^[a-z0-9]+$/i.test(id)) continue;
    const u = typeof p.url === "string" && /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/eventpage\/[a-z0-9]+$/i.test(p.url)
      ? p.url : `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
    out.push({ id, m: Math.round(m * 10) / 10, t: p.time, lat, lon, p: String(p.place || "").slice(0, 120), u,
      felt: Number.isInteger(p.felt) && p.felt > 0 ? p.felt : null,
      al: ["green", "yellow", "orange", "red"].includes(p.alert) ? p.alert : "", rev: p.status === "reviewed" });
  }
  return out;
}
const fireNum = (...vs) => vs.find((v) => typeof v === "number" && isFinite(v)) ?? null;
function fireName(raw, cat) {
  let n = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!n) return "";
  if (n === n.toUpperCase() && /[A-Z]/.test(n)) n = n.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  if (cat === "CX" && !/\bcomplex\b/i.test(n)) n += " Complex";
  else if (cat === "WF" && !/\b(fire|complex)\b/i.test(n)) n += " Fire";
  return n;
}
function parseFires(d) {
  if (d?.error) throw new Error("fire data");
  const out = [];
  for (const f of Array.isArray(d?.features) ? d.features : []) {
    const a = f?.attributes || {};
    const cat = String(a.IncidentTypeCategory || "").toUpperCase().slice(0, 2);
    if (!["WF", "CX", "RX"].includes(cat) || a.IsCpxChild === 1 || a.IsCpxChild === true) continue;   // complexes count once
    if (fireNum(a.FireOutDateTime) != null) continue;                                              // declared out
    const lat = fireNum(f?.geometry?.y, a.InitialLatitude), lon = fireNum(f?.geometry?.x, a.InitialLongitude);
    const n = fireName(a.IncidentName, cat);
    if (lat == null || lon == null || !n || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const id = String(a.IrwinID || a.UniqueFireIdentifier || a.GlobalID || a.OBJECTID || "").replace(/[{}]/g, "").slice(0, 60);
    if (!id) continue;
    const pc = fireNum(a.PercentContained);
    out.push({ id, n, cat, lat, lon, ac: fireNum(a.IncidentSize, a.DailyAcres, a.CalculatedAcres, a.DiscoveryAcres),
      pc: pc == null ? null : Math.max(0, Math.min(100, Math.round(pc))),
      disc: fireNum(a.FireDiscoveryDateTime), mod: fireNum(a.ModifiedOnDateTime_dt, a.ModifiedOnDateTime, a.ICS209ReportDateTime),
      county: String(a.POOCounty || "").slice(0, 40), st: String(a.POOState || "").replace(/^US-/, "").slice(0, 4),
      crew: Number.isInteger(a.TotalIncidentPersonnel) && a.TotalIncidentPersonnel > 0 ? a.TotalIncidentPersonnel : null });
  }
  return out;
}

async function nearRefresh(maxAgeMin = 15) {
  if (nearBusy || !(T.near.quakes || T.near.fires)) return;
  const now = Date.now();
  const wantQ = T.near.quakes && now - near.qAt >= maxAgeMin * 60e3;
  const wantF = T.near.fires && (now - near.fAt >= Math.max(maxAgeMin, 30) * 60e3 || near.fMi < T.near.mi);
  if (!wantQ && !wantF) return;
  const before = nearSig();
  nearBusy = true;
  try {
    const jobs = [];
    if (wantQ) {
      const week = now - near.qWeekAt > 6 * 36e5;      // the week's feed a few times a day, the day's in between
      jobs.push(fetch(week ? QK_WEEK : QK_DAY, { cache: "no-cache", referrerPolicy: "no-referrer" })
        .then((r) => { if (!r.ok) throw new Error(`USGS ${r.status}`); return r.json(); })
        .then((d) => {
          const got = parseQuakes(d);
          const gen = Number(d?.metadata?.generated) || now;
          const from = gen - (week ? 7 : 1) * 864e5;        // the feed's span: what it covers, it says in full
          const ids = new Set(got.map((q) => q.id));
          near.q = near.q.filter((q) => q.t < from && !ids.has(q.id)).concat(got)
            .filter((q) => q.t >= now - 7 * 864e5).sort((a, b) => b.t - a.t).slice(0, 300);
          near.qAt = now;
          if (week) near.qWeekAt = now;
          near.qErr = 0;
        })
        .catch(() => { near.qAt = now - Math.max(0, maxAgeMin - 5) * 60e3; near.qErr = now; }));    // try again in ~5 minutes
    }
    if (wantF) {
      const mi = T.near.mi;
      const q = new URLSearchParams({ where: "1=1", geometry: `${WX.lon},${WX.lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
        spatialRel: "esriSpatialRelIntersects", distance: String(Math.round(mi * MI)), units: "esriSRUnit_Kilometer",
        outFields: "*", returnGeometry: "true", outSR: "4326", resultRecordCount: "200", f: "json" });
      jobs.push(fetch(`${FIRE_URL}?${q}`, { cache: "no-cache", referrerPolicy: "no-referrer" })
        .then((r) => { if (!r.ok) throw new Error(`NIFC ${r.status}`); return r.json(); })
        .then((d) => { near.f = parseFires(d).slice(0, 200); near.fAt = now; near.fMi = mi; near.fErr = 0; })
        .catch(() => { near.fAt = now - 25 * 60e3; near.fErr = now; }));
    }
    await Promise.all(jobs);
    store.set("near", near);
  } finally { nearBusy = false; }
  if (nearSig() !== before) {
    if (S.tab === "feed" && S.kind === "today") updateFeedQuietly(Date.now() - (S.shownAt || 0));
    else S.feedDirty = true;
    if (S.tab === "tune" && typeof renderTune === "function") renderTune(true);
  }
}

// ── what the card shows ────────────────────────────────────────────────────
function nearQuakes() {
  if (!T.near.quakes) return [];
  const cut = Date.now() - T.near.days * 864e5;
  return near.q.filter((q) => q.m >= T.near.mag - 1e-9 && q.t >= cut && milesFrom(q.lat, q.lon) <= T.near.mi).slice(0, 6);
}
function nearFires() {
  if (!T.near.fires) return [];
  return near.f.filter((f) => (f.cat !== "RX" || T.near.rx) && (T.near.contained || f.pc == null || f.pc < 100)
      && (f.ac ?? 0) >= T.near.acres && milesFrom(f.lat, f.lon) <= T.near.mi)
    .sort((a, b) => milesFrom(a.lat, a.lon) - milesFrom(b.lat, b.lon)).slice(0, 6);
}
function nearSig() { return [...nearQuakes().map((q) => `${q.id}${q.m}`), ...nearFires().map((f) => `${f.id}${f.ac}${f.pc}`)].join(","); }
function nearCardItem() {
  const quakes = nearQuakes(), fires = nearFires();
  if (!quakes.length && !fires.length) return null;
  return { type: "brief-near", key: "brief:near", sig: nearSig(), quakes, fires };
}
const acres = (n) => `${n >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(1))} ${n === 1 ? "acre" : "acres"}`;
const fireKind = (f) => (f.cat === "RX" ? "Prescribed burn" : f.cat === "CX" ? "Fire complex" : "Wildfire");
const fireMap = (f) => `https://maps.apple.com/?ll=${f.lat.toFixed(4)},${f.lon.toFixed(4)}&q=${encodeURIComponent(f.n)}`;
function quakeRow(q) {
  const felt = q.felt ? ` · felt by ${q.felt.toLocaleString("en-US")}` : "";
  return el("li", { class: "news-item near-q" },
    el("a", { class: "w-row", href: q.u, target: "_blank", rel: "noopener" },
      el("span", { class: "news-src" }, el("b", { class: "near-mag" }, `M ${q.m.toFixed(1)}`),
        el("span", {}, agoShort(new Date(q.t).toISOString())), el("span", {}, fromHome(q.lat, q.lon))),
      el("span", { class: "news-title" }, `Earthquake ${placeInMiles(q.p)}${felt}`)));
}
function fireRow(f) {
  const bits = [f.ac != null ? acres(f.ac) : "", f.pc != null ? `${f.pc}% contained` : "", f.crew ? `${f.crew.toLocaleString("en-US")} people assigned` : ""].filter(Boolean);
  const when = f.mod || f.disc;
  return el("li", { class: "news-item near-f" },
    el("a", { class: "w-row", href: fireMap(f), target: "_blank", rel: "noopener", "aria-label": `${f.n}, ${fireKind(f)}. Opens a map.` },
      el("span", { class: "news-src" }, el("b", { class: "near-fire" }, fireKind(f)),
        when ? el("span", {}, `${f.mod ? "updated " : "found "}${agoShort(new Date(when).toISOString())}`) : null,
        el("span", {}, fromHome(f.lat, f.lon))),
      el("span", { class: "news-title" }, `${f.n}${bits.length ? ` · ${bits.join(" · ")}` : ""}`)));
}
function nearCardEl(it) {
  const parts = [it.quakes.length ? plural(it.quakes.length, "quake") : "", it.fires.length ? plural(it.fires.length, "fire") : ""].filter(Boolean);
  const checked = Math.max(it.quakes.length ? near.qAt : 0, it.fires.length ? near.fAt : 0);
  return el("article", { class: "card brief-card near-card", "data-key": "brief:near" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, `Near ${WX.short}`), el("span", {}, parts.join(", "))),
    el("ul", { class: "rows" }, it.quakes.map(quakeRow), it.fires.map(fireRow)),
    el("p", { class: "fine", style: "margin:6px 0 0" }, [it.quakes.length ? "Quakes: U.S. Geological Survey" : "", it.fires.length ? "fires: interagency fire data (NIFC); a fire opens on a map" : ""]
      .filter(Boolean).join("; ") + (checked ? `. Checked ${ago(new Date(checked).toISOString())}.` : ".")),
    el("div", { class: "link-row", style: "margin:0" },
      it.fires.length ? el("a", { class: "act", href: INCIWEB, target: "_blank", rel: "noopener" }, "Fire updates at InciWeb") : null,
      it.quakes.length ? el("a", { class: "act", href: "https://earthquake.usgs.gov/earthquakes/map/", target: "_blank", rel: "noopener" }, "USGS quake map") : null,
      el("button", { class: "act", onclick: () => { switchTab("tune"); setPane("interests", "tune-near"); } }, "Tune")));
}

// ── Tune → Interests ───────────────────────────────────────────────────────
function nearSection() {
  const N = T.near, set = (p) => { setTune({ near: { ...T.near, ...p } }); if (p.quakes || p.fires || p.mi > near.fMi) nearRefresh(0); rerender(); };
  const week = near.q.filter((q) => q.m >= N.mag - 1e-9 && milesFrom(q.lat, q.lon) <= N.mi).length;
  const fires = nearFires().length;
  const status = [
    N.quakes ? (near.qErr && near.qErr >= near.qAt - 6e4 ? "Couldn’t reach the USGS last time." : near.qAt
      ? `Quakes: ${week} of M${N.mag} or more within ${N.mi} mi in the past week (checked ${ago(new Date(near.qAt).toISOString())}).` : "") : "",
    N.fires ? (near.fErr && near.fErr >= near.fAt ? "Couldn’t reach the fire data last time." : near.fAt
      ? `Fires: ${fires} shown now (checked ${ago(new Date(near.fAt).toISOString())}).` : "") : ""].filter(Boolean).join(" ");
  return el("section", { class: "sect", id: "tune-near" }, el("h2", {}, `Quakes & fires near ${WX.short}`),
    el("p", { class: "sub" }, "A card in Today while an earthquake or an active fire is within reach; nothing shows when it’s quiet. Your phone asks the U.S. Geological Survey and the National Interagency Fire Center directly, every 15 to 30 minutes while Readout is open."),
    status ? el("p", { class: "fine" }, status) : null,
    stepRow("How far from Reno", null, N.mi, { min: 10, max: NEAR_MAX_MI, step: 10, unit: "mi" }, (v) => set({ mi: v })),
    switchRow("Earthquakes", "Magnitude 2.5 and up, from the USGS (public domain). Tap one for its USGS page: shaking, felt reports, aftershocks.", N.quakes, (on) => set({ quakes: on })),
    N.quakes ? stepRow("Smallest magnitude", "Each whole step up is about 32 times the energy.", N.mag, { min: 2.5, max: 7, step: 0.5 }, (v) => set({ mag: v })) : null,
    N.quakes ? stepRow("Keep on the card for", null, N.days, { min: 1, max: 7, unit: N.days === 1 ? "day" : "days" }, (v) => set({ days: v })) : null,
    switchRow("Wildfires", "Active fires from the interagency wildland-fire data (NIFC): name, size, containment and where. Tap one for a map; the card links to InciWeb for the crews’ updates, which come from many agencies without stated reuse terms.", N.fires, (on) => set({ fires: on })),
    N.fires ? stepRow("Smallest fire", "Summer brings many small fires that are out within hours.", N.acres, { min: 0, max: 100000, step: 10, unit: "acres" }, (v) => set({ acres: v })) : null,
    N.fires ? switchRow("Prescribed burns", "Planned burns, often the smoke you see in spring and fall.", N.rx, (on) => set({ rx: on })) : null,
    N.fires ? switchRow("Fully contained fires", "Until they’re declared out.", N.contained, (on) => set({ contained: on })) : null);
}
