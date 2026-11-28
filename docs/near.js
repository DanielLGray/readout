// ── Near Reno: weather alerts, Sierra roads, air, quakes and fires ─────────
// Like the weather, the phone asks public sources itself:
//   weather alerts and Donner Summit's snow forecast: the National Weather Service (public domain)
//   chain controls: Caltrans's own feed (public domain); when the phone can't reach it, the copy the
//     roads job keeps (data/roads.json, every half hour October to May)
//   air quality: the Copernicus Atmosphere Monitoring Service (CAMS) model through Open-Meteo, free
//     for non-commercial use under CC BY 4.0: an estimate, not a monitor reading
//   earthquakes: the U.S. Geological Survey's M2.5+ feeds (public domain)
//   fires: the interagency wildland-fire locations NIFC publishes (WFIGS current incidents), as facts:
//     name, size, containment, place. InciWeb's own write-ups come from many agencies without stated
//     reuse terms, so the card links to InciWeb rather than showing them.
// Today gets a card while something is worth knowing; nothing shows when it's quiet.
const QK_DAY = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";
const QK_WEEK = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson";
const FIRE_URL = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Incident_Locations_Current/FeatureServer/0/query";
const INCIWEB = "https://inciweb.wildfire.gov/";
const NWS_ALERTS = "https://api.weather.gov/alerts/active";
// where alerts are read: Reno, Donner Summit (I-80) and South Lake Tahoe (US-50)
const NEAR_SPOTS = [{ n: "Reno", lat: 39.5296, lon: -119.8138 }, { n: "Donner Summit", lat: 39.3166, lon: -120.3297 },
  { n: "South Lake Tahoe", lat: 38.9399, lon: -119.9772 }];
const DONNER = NEAR_SPOTS[1];
const CC_URL = "https://cwwp2.dot.ca.gov/data/d3/cc/ccStatusD03.json";
const CC_ROUTES = ["I-80", "US-50", "SR-89", "SR-267", "SR-28", "SR-20"];
const QUICKMAP = "https://quickmap.dot.ca.gov/";
const AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const AIRNOW = "https://www.airnow.gov/?city=Reno&state=NV&country=USA";
const wxPage = (spot) => `https://forecast.weather.gov/MapClick.php?lat=${spot.lat}&lon=${spot.lon}`;
const inSnowSeason = (d = new Date()) => { const m = d.getMonth() + 1; return m >= 10 || m <= 5; };
const NEAR_MAX_MI = 300;                      // the farthest Tune allows; quakes are kept this far out
const MI = 1.609344;

function nearBlank() {
  return { q: [], f: [], qAt: 0, qWeekAt: 0, qErr: 0, fAt: 0, fMi: 0, fErr: 0,
    al: [], alAt: 0, alErr: 0, cc: [], ccAt: 0, ccAsOf: 0, ccVia: "", ccErr: 0, ccDirectFail: 0,
    sn: [], snAt: 0, snErr: 0, snUrl: "", air: null, airAt: 0, airErr: 0 };
}
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
    fAt: fin(d.fAt) ? d.fAt : 0, fMi: fin(d.fMi) ? d.fMi : 0, fErr: fin(d.fErr) ? d.fErr : 0,
    al: (Array.isArray(d.al) ? d.al : []).filter((x) => x && typeof x.id === "string" && typeof x.ev === "string")
      .map((x) => ({ id: x.id.slice(0, 120), ev: x.ev.slice(0, 60), sev: str(x.sev, 12), area: str(x.area, 200), head: str(x.head, 240),
        on: fin(x.on) ? x.on : null, end: fin(x.end) ? x.end : null, desc: str(x.desc, 3000), ins: str(x.ins, 1200), at: Number.isInteger(x.at) ? x.at : 0 })).slice(0, 20),
    alAt: fin(d.alAt) ? d.alAt : 0, alErr: fin(d.alErr) ? d.alErr : 0,
    cc: (Array.isArray(d.cc) ? d.cc : []).filter((x) => x && CC_ROUTES.includes(x.r) && typeof x.s === "string")
      .map((x) => ({ r: x.r, dir: str(x.dir, 12), loc: str(x.loc, 80), near: str(x.near, 40), pm: fin(x.pm) ? x.pm : null, s: x.s.slice(0, 12),
        d: str(x.d, 240), t: str(x.t, 19) })).slice(0, 200),
    ccAt: fin(d.ccAt) ? d.ccAt : 0, ccAsOf: fin(d.ccAsOf) ? d.ccAsOf : 0, ccVia: ["caltrans", "readout"].includes(d.ccVia) ? d.ccVia : "",
    ccErr: fin(d.ccErr) ? d.ccErr : 0, ccDirectFail: fin(d.ccDirectFail) ? d.ccDirectFail : 0,
    sn: (Array.isArray(d.sn) ? d.sn : []).filter((x) => x && typeof x.n === "string" && typeof x.acc === "string")
      .map((x) => ({ n: x.n.slice(0, 40), acc: x.acc.slice(0, 240), e: str(x.e, 30) })).slice(0, 6),
    snAt: fin(d.snAt) ? d.snAt : 0, snErr: fin(d.snErr) ? d.snErr : 0,
    snUrl: typeof d.snUrl === "string" && /^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast$/.test(d.snUrl) ? d.snUrl : "",
    air: d.air && fin(d.air.aqi) ? { aqi: d.air.aqi, pm: fin(d.air.pm) ? d.air.pm : null, main: str(d.air.main, 8),
      max: fin(d.air.max) ? d.air.max : null, maxT: str(d.air.maxT, 20), t: str(d.air.t, 20) } : null,
    airAt: fin(d.airAt) ? d.airAt : 0, airErr: fin(d.airErr) ? d.airErr : 0 };
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

// NWS alerts (CAP as GeoJSON): what, how serious, where, until when, and its own words
function parseAlerts(d, spot = 0) {
  const out = [];
  for (const f of Array.isArray(d?.features) ? d.features : []) {
    const p = f?.properties || {};
    if (p.status !== "Actual" || p.messageType === "Cancel" || typeof p.id !== "string" || typeof p.event !== "string") continue;
    if (/^test\b/i.test(p.event)) continue;
    const t = (v) => { const n = Date.parse(v || ""); return isFinite(n) ? n : null; };
    out.push({ id: p.id.slice(0, 120), ev: p.event.slice(0, 60), sev: String(p.severity || "").slice(0, 12),
      area: String(p.areaDesc || "").slice(0, 200), head: String(p.headline || "").slice(0, 240),
      on: t(p.onset || p.effective), end: t(p.ends || p.expires), desc: String(p.description || "").slice(0, 3000),
      ins: String(p.instruction || "").slice(0, 1200), at: spot });
  }
  return out;
}
const alertKind = (a) => (/air quality|smoke|dust/i.test(a.ev) ? "air" : /red flag|fire weather/i.test(a.ev) ? "fire" : "wx");
// Caltrans chain controls (the same reading as pipeline/roads.py)
function parseControls(d) {
  const s = (v, n = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const out = [];
  for (const row of Array.isArray(d?.data) ? d.data : []) {
    const cc = row?.cc, loc = cc?.location || {}, st = cc?.statusData || {};
    if (!cc || !CC_ROUTES.includes(s(loc.route, 12)) || String(cc.inService ?? "true").toLowerCase() !== "true") continue;
    const status = s(st.status, 12), desc = s(st.statusDescription, 240);
    if (!status || /^R-?0$/i.test(status) || /^no chain controls/i.test(desc)) continue;
    const ts = st.statusTimestamp || {}, when = `${s(ts.statusDate, 10)}T${s(ts.statusTime, 8)}`;
    const pm = Number(loc.postmile);
    out.push({ r: s(loc.route, 12), dir: s(loc.direction, 12), loc: s(loc.locationName), near: s(loc.nearbyPlace, 40),
      pm: isFinite(pm) ? Math.round(pm * 100) / 100 : null, s: status, d: desc, t: /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(when) ? when : "" });
  }
  return out;
}
// the snow lines in Donner Summit's forecast ("New snow accumulation of 8 to 12 inches possible.")
function parseSnow(d) {
  const out = [];
  for (const p of (d?.properties?.periods || []).slice(0, 6)) {
    const m = String(p.detailedForecast || "").match(/(?:new |total (?:daytime |nighttime )?)?snow accumulation[^.]*\./i);
    if (m && typeof p.name === "string") out.push({ n: p.name.slice(0, 40), acc: m[0].replace(/^./, (c) => c.toUpperCase()).slice(0, 240), e: String(p.endTime || "").slice(0, 30) });
  }
  return out;
}
// Open-Meteo's CAMS air quality: the U.S. AQI now, what drives it, and the next day's highest
function parseAir(d, now = Date.now()) {
  const c = d?.current, aqi = Number(c?.us_aqi);
  if (!c || !isFinite(aqi)) throw new Error("no air quality");
  const pm = Number(c.us_aqi_pm2_5), oz = Number(c.us_aqi_ozone);
  let max = null, maxT = "";
  const times = d?.hourly?.time || [], vals = d?.hourly?.us_aqi || [];
  const off = Number(d?.utc_offset_seconds) || 0;
  times.forEach((t, i) => {
    const v = Number(vals[i]), at = Date.parse(`${t}:00Z`) - off * 1000;
    if (isFinite(v) && at > now && at <= now + 864e5 && (max == null || v > max)) { max = Math.round(v); maxT = String(t).slice(0, 16); }
  });
  return { aqi: Math.round(aqi), pm: isFinite(Number(c.pm2_5)) ? Math.round(Number(c.pm2_5)) : null,
    main: isFinite(pm) && isFinite(oz) ? (pm >= oz ? "pm" : "ozone") : "", max, maxT, t: String(c.time || "").slice(0, 16) };
}
// the EPA's categories and colors
const AQI_CATS = [[50, "Good", "#00e400"], [100, "Moderate", "#ffff00"], [150, "Unhealthy for sensitive groups", "#ff7e00"],
  [200, "Unhealthy", "#ff0000"], [300, "Very unhealthy", "#8f3f97"], [Infinity, "Hazardous", "#7e0023"]];
const aqiCat = (v) => AQI_CATS.find(([hi]) => v <= hi);

async function nearRefresh(maxAgeMin = 15) {
  const N = T.near;
  if (nearBusy || !(N.quakes || N.fires || N.alerts || N.roads || N.air)) return;
  const now = Date.now(), season = inSnowSeason();
  const wantQ = N.quakes && now - near.qAt >= maxAgeMin * 60e3;
  const wantF = N.fires && (now - near.fAt >= Math.max(maxAgeMin, 30) * 60e3 || near.fMi < N.mi);
  const wantAl = N.alerts && now - near.alAt >= Math.max(maxAgeMin, 10) * 60e3;
  const wantCc = N.roads && season && now - near.ccAt >= maxAgeMin * 60e3;
  const wantSn = N.roads && season && now - near.snAt >= Math.max(maxAgeMin, 60) * 60e3;
  const wantAir = N.air && now - near.airAt >= Math.max(maxAgeMin, 30) * 60e3;
  if (!wantQ && !wantF && !wantAl && !wantCc && !wantSn && !wantAir) return;
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
    const get = (url, accept) => fetch(url, { cache: "no-cache", referrerPolicy: "no-referrer", ...(accept ? { headers: { Accept: accept } } : {}) })
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });
    if (wantAl) {
      jobs.push(Promise.all(NEAR_SPOTS.map((sp, i) => get(`${NWS_ALERTS}?point=${sp.lat},${sp.lon}`, "application/geo+json").then((d) => parseAlerts(d, i))))
        .then((lists) => {
          const seen = new Set();
          near.al = lists.flat().filter((a) => !seen.has(a.id) && seen.add(a.id)).slice(0, 20);
          near.alAt = now; near.alErr = 0;
        })
        .catch(() => { near.alAt = now - 5 * 60e3; near.alErr = now; }));
    }
    if (wantCc) {
      // Caltrans directly when this phone can reach it; else the roads job's copy (a day before trying Caltrans again)
      const direct = now - near.ccDirectFail > 864e5;
      const viaReadout = () => get(`data/roads.json?t=${Math.floor(now / 6e4)}`).then((d) => {
        if (!Array.isArray(d?.controls)) throw new Error("roads");
        near.cc = parseControls({ data: d.controls.map((c) => ({ cc: { location: { route: c.r, direction: c.dir, locationName: c.loc, nearbyPlace: c.near, postmile: c.pm },
          statusData: { status: c.s, statusDescription: c.d, statusTimestamp: { statusDate: String(c.t || "").slice(0, 10), statusTime: String(c.t || "").slice(11, 19) } } } })) });
        near.ccAsOf = Date.parse(d.checked || "") || 0; near.ccVia = "readout";
      });
      jobs.push((direct ? get(CC_URL).then((d) => {
        if (!Array.isArray(d?.data)) throw new Error("caltrans");
        near.cc = parseControls(d); near.ccAsOf = now; near.ccVia = "caltrans";
      }).catch(() => { near.ccDirectFail = now; return viaReadout(); }) : viaReadout())
        .then(() => { near.ccAt = now; near.ccErr = 0; })
        .catch(() => { near.ccAt = now - 10 * 60e3; near.ccErr = now; }));
    }
    if (wantSn) {
      jobs.push((near.snUrl ? Promise.resolve(near.snUrl) : get(`https://api.weather.gov/points/${DONNER.lat},${DONNER.lon}`, "application/geo+json")
        .then((d) => {
          const u = String(d?.properties?.forecast || "");
          if (!/^https:\/\/api\.weather\.gov\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast$/.test(u)) throw new Error("points");
          near.snUrl = u; return u;
        }))
        .then((u) => get(u, "application/geo+json"))
        .then((d) => { near.sn = parseSnow(d); near.snAt = now; near.snErr = 0; })
        .catch(() => { near.snAt = now - 50 * 60e3; near.snErr = now; near.snUrl = ""; }));
    }
    if (wantAir) {
      const q = new URLSearchParams({ latitude: String(WX.lat), longitude: String(WX.lon), current: "us_aqi,pm2_5,us_aqi_pm2_5,us_aqi_ozone",
        hourly: "us_aqi", forecast_days: "2", timezone: "America/Los_Angeles" });
      jobs.push(get(`${AQ_URL}?${q}`).then((d) => { near.air = parseAir(d, now); near.airAt = now; near.airErr = 0; })
        .catch(() => { near.airAt = now - 25 * 60e3; near.airErr = now; }));
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
function nearAlerts() {
  const now = Date.now();
  return near.al.filter((a) => (a.end == null || a.end > now) && (alertKind(a) === "air" ? T.near.air || T.near.alerts : alertKind(a) === "fire" ? T.near.fires || T.near.alerts : T.near.alerts));
}
// chain controls, one row per road and direction: the strictest control, and the places it covers
const CC_RANK = (s) => { const m = /^R-?(\d)$/i.exec(s); return m ? Number(m[1]) : 9; };
function nearRoads() {
  if (!T.near.roads || !inSnowSeason()) return [];
  const groups = new Map();
  for (const c of near.cc) {
    const k = `${c.r} ${c.dir}`;
    const g = groups.get(k) || { r: c.r, dir: c.dir, s: c.s, d: c.d, near: [], t: c.t };
    if (CC_RANK(c.s) > CC_RANK(g.s)) Object.assign(g, { s: c.s, d: c.d, t: c.t });
    if (c.near && !g.near.includes(c.near)) g.near.push(c.near);
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => CC_ROUTES.indexOf(a.r) - CC_ROUTES.indexOf(b.r) || a.dir.localeCompare(b.dir));
}
function nearSnow() {
  if (!T.near.roads || !inSnowSeason()) return [];
  return near.sn.filter((p) => !p.e || Date.parse(p.e) > Date.now()).slice(0, 3);
}
// the air, when it reaches your line now or in the next day
function nearAir() {
  const a = near.air;
  if (!T.near.air || !a || Date.now() - near.airAt > 6 * 36e5) return null;
  return a.aqi >= T.near.aqi || (a.max ?? 0) >= T.near.aqi ? a : null;
}
function nearSig() {
  const air = nearAir();
  return [...nearAlerts().map((a) => a.id), ...nearRoads().map((g) => `${g.r}${g.dir}${g.s}`), ...nearSnow().map((p) => p.acc),
    air ? `aqi${Math.round(air.aqi / 10)}:${Math.round((air.max ?? 0) / 10)}` : "",
    ...nearQuakes().map((q) => `${q.id}${q.m}`), ...nearFires().map((f) => `${f.id}${f.ac}${f.pc}`)].join(",");
}
function nearCardItem() {
  const quakes = nearQuakes(), fires = nearFires(), alerts = nearAlerts(), roads = nearRoads(), snow = nearSnow(), air = nearAir();
  if (!quakes.length && !fires.length && !alerts.length && !roads.length && !snow.length && !air) return null;
  return { type: "brief-near", key: "brief:near", sig: nearSig(), quakes, fires, alerts, roads, snow, air };
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
const untilText = (t) => {
  if (!t) return "";
  const d = new Date(t), today = new Date();
  const day = d.toDateString() === today.toDateString() ? "" : `${d.toLocaleDateString("en-US", { weekday: "short" })} `;
  return `until ${day}${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
};
// the NWS's own "* WHAT..." line, when it has one: what the alert is about, in a sentence or two
const alertWhat = (a) => (/\*\s*WHAT\.\.\.([\s\S]*?)(?:\n\s*\n|\n\s*\*|$)/.exec(a.desc)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 220);
function alertRow(a) {
  return el("li", { class: "news-item near-a" },
    el("button", { class: "w-row", onclick: () => openNearAlert(a) },
      el("span", { class: "news-src" }, el("b", { class: `near-al sev-${a.sev.toLowerCase()}` }, a.ev), a.end ? el("span", {}, untilText(a.end)) : null,
        el("span", {}, a.area.split(";")[0].trim())),
      el("span", { class: "news-title" }, alertWhat(a) || a.head || a.area)));
}
function openNearAlert(a) {
  const spot = NEAR_SPOTS[a.at] || NEAR_SPOTS[0];
  openSheet(
    el("h2", { id: "sheet-title" }, a.ev),
    el("p", { class: "sheet-meta" }, el("span", {}, [a.end ? untilText(a.end) : "", a.area].filter(Boolean).join(" · "))),
    a.desc ? a.desc.split(/\n\s*\n/).map((x) => el("p", {}, x.replace(/\s*\n\s*/g, " "))) : el("p", {}, a.head),
    a.ins ? el("p", {}, el("b", {}, "What to do: "), a.ins.replace(/\s*\n\s*/g, " ")) : null,
    el("p", { class: "fine" }, "From the National Weather Service, in its own words."),
    el("div", { class: "link-row" }, el("a", { class: "act", href: wxPage(spot), target: "_blank", rel: "noopener" }, `Forecast for ${spot.n}`)));
}
const ccLabel = (s) => (CC_RANK(s) <= 3 ? `Chains ${s.replace("-", "")}` : s);
function roadRow(g) {
  return el("li", { class: "news-item near-r" },
    el("a", { class: "w-row", href: QUICKMAP, target: "_blank", rel: "noopener", "aria-label": `${g.r} ${g.dir}: ${g.d}. Opens Caltrans QuickMap.` },
      el("span", { class: "news-src" }, el("b", { class: `near-cc cc-${CC_RANK(g.s)}` }, ccLabel(g.s)), el("span", {}, `${g.r} ${g.dir.toLowerCase()}bound`),
        g.near.length ? el("span", {}, `near ${g.near.slice(0, 3).join(", ")}`) : null),
      el("span", { class: "news-title" }, g.d)));
}
function snowRow(list) {
  return el("li", { class: "news-item near-s" },
    el("a", { class: "w-row", href: wxPage(DONNER), target: "_blank", rel: "noopener" },
      el("span", { class: "news-src" }, el("b", { class: "near-snow" }, "Snow"), el("span", {}, DONNER.n)),
      el("span", { class: "news-title" }, list.map((p) => `${p.n}: ${p.acc}`).join(" "))));
}
const aqiChip = (v) => { const [, , color] = aqiCat(v); return el("b", { class: "near-aqi", style: `--aqi:${color}` }, `AQI ${v}`); };
function airRow(a) {
  const peak = a.max != null && a.max > a.aqi ? `up to ${a.max} (${aqiCat(a.max)[1].toLowerCase()}) in the next day` : "";
  return el("li", { class: "news-item near-air" },
    el("a", { class: "w-row", href: AIRNOW, target: "_blank", rel: "noopener", "aria-label": `Air quality index ${a.aqi}, ${aqiCat(a.aqi)[1]}. Opens AirNow.` },
      el("span", { class: "news-src" }, aqiChip(a.aqi), el("span", {}, aqiCat(a.aqi)[1]), el("span", {}, "model estimate")),
      el("span", { class: "news-title" }, [a.main === "pm" ? `Mostly fine particles${a.pm != null ? ` (PM2.5 ${a.pm} µg/m³)` : ""}, the kind smoke brings` : a.main === "ozone" ? "Mostly ozone" : "", peak]
        .filter(Boolean).join(" · ") || "Air quality in Reno")));
}
function nearCardEl(it) {
  const parts = [it.alerts.length ? plural(it.alerts.length, "alert") : "", it.roads.length ? "chain controls" : "", it.snow.length ? "snow" : "",
    it.air ? `AQI ${it.air.aqi}` : "", it.fires.length ? plural(it.fires.length, "fire") : "", it.quakes.length ? plural(it.quakes.length, "quake") : ""].filter(Boolean);
  const checked = Math.max(it.quakes.length ? near.qAt : 0, it.fires.length ? near.fAt : 0, it.alerts.length || it.snow.length ? near.alAt : 0,
    it.air ? near.airAt : 0, it.roads.length && near.ccVia === "caltrans" ? near.ccAt : 0);
  const credits = [
    it.alerts.length || it.snow.length ? "alerts and snow: National Weather Service" : "",
    it.roads.length ? `chain controls: Caltrans${near.ccVia === "readout" && near.ccAsOf ? ` (as of ${ago(new Date(near.ccAsOf).toISOString())}; a roads job checks every half hour)` : ""}` : "",
    it.air ? "air: a CAMS model estimate via Open-Meteo (CC BY 4.0), not a monitor reading" : "",
    it.fires.length ? "fires: interagency fire data (NIFC)" : "", it.quakes.length ? "quakes: USGS" : ""].filter(Boolean).join("; ");
  return el("article", { class: "card brief-card near-card", "data-key": "brief:near" },
    el("div", { class: "card-meta" }, el("span", { class: "card-journal" }, `Near ${WX.short}`), el("span", {}, parts.join(", "))),
    el("ul", { class: "rows" }, it.alerts.map(alertRow), it.roads.map(roadRow), it.snow.length ? snowRow(it.snow) : null, it.air ? airRow(it.air) : null,
      it.fires.map(fireRow), it.quakes.map(quakeRow)),
    el("p", { class: "fine", style: "margin:6px 0 0" }, credits.charAt(0).toUpperCase() + credits.slice(1) + (checked ? `. Checked ${ago(new Date(checked).toISOString())}.` : ".")),
    el("div", { class: "link-row", style: "margin:0" },
      it.roads.length || it.snow.length ? el("a", { class: "act", href: QUICKMAP, target: "_blank", rel: "noopener" }, "Caltrans QuickMap") : null,
      it.air ? el("a", { class: "act", href: "https://fire.airnow.gov/", target: "_blank", rel: "noopener" }, "AirNow smoke map") : null,
      it.fires.length ? el("a", { class: "act", href: INCIWEB, target: "_blank", rel: "noopener" }, "Fire updates at InciWeb") : null,
      it.quakes.length ? el("a", { class: "act", href: "https://earthquake.usgs.gov/earthquakes/map/", target: "_blank", rel: "noopener" }, "USGS quake map") : null,
      el("button", { class: "act", onclick: () => { switchTab("tune"); setPane("interests", "tune-near"); } }, "Tune")));
}
// the weather sheet's line: the air now, whatever it is
function airLine() {
  const a = near.air;
  if (!T.near.air || !a || Date.now() - near.airAt > 6 * 36e5) return null;
  return el("p", { class: "air-line" }, aqiChip(a.aqi), ` ${aqiCat(a.aqi)[1]}${a.max != null && a.max > a.aqi ? `; up to ${a.max} in the next day` : ""}. `,
    el("span", { class: "fine" }, "Air quality: a CAMS model estimate via Open-Meteo (CC BY 4.0). Monitor readings: "),
    el("a", { href: AIRNOW, target: "_blank", rel: "noopener" }, "AirNow"), ".");
}

// ── Tune → Today ───────────────────────────────────────────────────────────
function nearSection() {
  const N = T.near, set = (p) => { setTune({ near: { ...T.near, ...p } }); if (p.quakes || p.fires || p.alerts || p.roads || p.air || p.mi > near.fMi) nearRefresh(0); rerender(); };
  const week = near.q.filter((q) => q.m >= N.mag - 1e-9 && milesFrom(q.lat, q.lon) <= N.mi).length;
  const fires = nearFires().length;
  const status = [
    N.quakes ? (near.qErr && near.qErr >= near.qAt - 6e4 ? "Couldn’t reach the USGS last time." : near.qAt
      ? `Quakes: ${week} of M${N.mag} or more within ${N.mi} mi in the past week (checked ${ago(new Date(near.qAt).toISOString())}).` : "") : "",
    N.fires ? (near.fErr && near.fErr >= near.fAt ? "Couldn’t reach the fire data last time." : near.fAt
      ? `Fires: ${fires} shown now (checked ${ago(new Date(near.fAt).toISOString())}).` : "") : ""].filter(Boolean).join(" ");
  const roadStatus = !N.roads ? "" : !inSnowSeason() ? "Chain controls and Donner Summit snow are checked October to May."
    : near.ccErr && near.ccErr >= near.ccAt - 6e4 ? "Couldn’t reach Caltrans or the roads job’s copy last time."
      : near.ccAt ? `Chain controls on ${CC_ROUTES.join(", ")}: ${nearRoads().length ? nearRoads().map((g) => `${g.r} ${g.dir.toLowerCase()}bound ${g.s}`).join(", ") : "none"} (${near.ccVia === "readout" ? `the roads job’s copy, as of ${near.ccAsOf ? ago(new Date(near.ccAsOf).toISOString()) : "?"}` : `from Caltrans, checked ${ago(new Date(near.ccAt).toISOString())}`}).` : "";
  const airStatus = !N.air ? "" : near.airErr && near.airErr >= near.airAt - 6e4 ? "Couldn’t reach the air quality model last time."
    : near.air ? `Air now: AQI ${near.air.aqi}, ${aqiCat(near.air.aqi)[1].toLowerCase()} (checked ${ago(new Date(near.airAt).toISOString())}).` : "";
  return el("section", { class: "sect", id: "tune-near" }, el("h2", {}, `Near ${WX.short}`),
    el("p", { class: "sub" }, "A card in Today while something nearby is worth knowing: a weather alert, chain controls over the Sierra, snow on Donner Summit, smoky air, an earthquake or an active fire. Nothing shows when it’s quiet. Your phone asks each source directly, every 10 to 30 minutes while Readout is open."),
    status ? el("p", { class: "fine" }, status) : null,
    roadStatus ? el("p", { class: "fine" }, roadStatus) : null,
    airStatus ? el("p", { class: "fine" }, airStatus) : null,
    switchRow("Weather alerts", "National Weather Service warnings, watches and advisories for Reno, Donner Summit and South Lake Tahoe: winter storms, wind, heat, floods. Tap one for the NWS’s own text.", N.alerts, (on) => set({ alerts: on })),
    switchRow("Sierra roads & snow", `October to May: Caltrans chain controls on ${CC_ROUTES.join(", ")} (I-80 over Donner Summit, US-50 over Echo Summit, and the Tahoe and Truckee roads), and new snow in Donner Summit’s NWS forecast. Caltrans’s feed comes straight to your phone when it can; otherwise a roads job copies it every half hour. Nevada’s side (Mt. Rose, I-80 at Verdi) is on nvroads.com.`, N.roads, (on) => set({ roads: on })),
    switchRow("Air quality", "The U.S. AQI for Reno from the Copernicus Atmosphere Monitoring Service model (CAMS, via Open-Meteo, CC BY 4.0): an estimate that tracks smoke, not a monitor reading; AirNow has those. Also in the weather sheet.", N.air, (on) => set({ air: on })),
    N.air ? segPick("Show the air in Today from", [[51, "Moderate"], [101, "Sensitive groups"], [151, "Unhealthy"]], N.aqi, (v) => set({ aqi: Number(v) }),
      "AQI 51 is Moderate, 101 Unhealthy for sensitive groups, 151 Unhealthy for everyone. The card also shows when the next day’s forecast reaches it.") : null,
    stepRow("How far from Reno", null, N.mi, { min: 10, max: NEAR_MAX_MI, step: 10, unit: "mi" }, (v) => set({ mi: v })),
    switchRow("Earthquakes", "Magnitude 2.5 and up, from the USGS (public domain). Tap one for its USGS page: shaking, felt reports, aftershocks.", N.quakes, (on) => set({ quakes: on })),
    N.quakes ? stepRow("Smallest magnitude", "Each whole step up is about 32 times the energy.", N.mag, { min: 2.5, max: 7, step: 0.5 }, (v) => set({ mag: v })) : null,
    N.quakes ? stepRow("Keep on the card for", null, N.days, { min: 1, max: 7, unit: N.days === 1 ? "day" : "days" }, (v) => set({ days: v })) : null,
    switchRow("Wildfires", "Active fires from the interagency wildland-fire data (NIFC): name, size, containment and where. Tap one for a map; the card links to InciWeb for the crews’ updates, which come from many agencies without stated reuse terms.", N.fires, (on) => set({ fires: on })),
    N.fires ? stepRow("Smallest fire", "Summer brings many small fires that are out within hours.", N.acres, { min: 0, max: 100000, step: 10, unit: "acres" }, (v) => set({ acres: v })) : null,
    N.fires ? switchRow("Prescribed burns", "Planned burns, often the smoke you see in spring and fall.", N.rx, (on) => set({ rx: on })) : null,
    N.fires ? switchRow("Fully contained fires", "Until they’re declared out.", N.contained, (on) => set({ contained: on })) : null);
}
