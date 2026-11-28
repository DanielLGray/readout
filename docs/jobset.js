/* Readout — job settings from the phone (Tune → You → a job → Change settings): what the jobs
   on GitHub read from config/*.yaml (outlets, topics, thresholds), changed here and sent to the
   settings job (settings.yml), which checks them against pipeline/overrides.py and saves
   config/overrides.json. data/config.json lists what can change and what the files say.
   Loaded after push.js. */
"use strict";

let jobCfg = null, jobCfgAsked = 0;
let jobDraft = store.get("jobDraft", null);         // the settings you're editing, not sent yet (null: none)
let jobSent = store.get("jobSent", null);           // { at, canon }: sent, waiting for the settings job
if (!jobDraft || typeof jobDraft !== "object" || jobDraft.v !== 1) jobDraft = null;
if (!jobSent || typeof jobSent !== "object" || typeof jobSent.at !== "number") jobSent = null;
const jobOpen = new Set();                          // which settings panels are open, so a redraw keeps them
const jobForms = {};                                 // what you've typed into an Add form

async function loadJobCfg(force = false) {
  if (!force && (jobCfg || Date.now() - jobCfgAsked < 60e3)) return;
  jobCfgAsked = Date.now();
  try {
    const r = await fetch("data/config.json", { cache: "no-cache" });
    if (r.ok) jobCfg = await r.json();
  } catch { /* offline: try again later */ }
  if (jobCfg && jobSent && jobCfg.last && Date.parse(jobCfg.last.at) >= jobSent.at - 5000) {
    if (jobCfg.last.ok && jobDraft && jCanon(jobDraft) === jobSent.canon) { jobDraft = null; store.set("jobDraft", null); }
  }
  if (S.tab === "tune" && TU.pane === "you") rerender();
}

// ── the document you're editing ────────────────────────────────────────────
const jClone = (x) => JSON.parse(JSON.stringify(x));
function jSort(x) {
  if (Array.isArray(x)) return x.map(jSort);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).filter((k) => k !== "at").sort().map((k) => [k, jSort(x[k])]));
  return x;
}
const jCanon = (d) => JSON.stringify(jSort(d || { v: 1 }));
const jSaved = () => jobCfg?.overrides || { v: 1 };
const jCur = () => jobDraft || jSaved();
const jSame = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function jPrune(x) {
  for (const k of Object.keys(x)) {
    const v = x[k];
    if (v && typeof v === "object" && !Array.isArray(v)) { jPrune(v); if (!Object.keys(v).length) delete x[k]; }
    else if (Array.isArray(v) && !v.length && k !== "v") delete x[k];
  }
  return x;
}
function jEdit(fn) {
  const d = jClone(jCur());
  delete d.at;
  fn(d);
  jPrune(d);
  d.v = 1;
  jobDraft = jCanon(d) === jCanon(jSaved()) ? null : d;
  store.set("jobDraft", jobDraft);
  rerender();
}
function jFlat(x, pre = "", out = {}) {
  if (x && typeof x === "object" && !Array.isArray(x)) { for (const [k, v] of Object.entries(x)) if (k !== "at" && k !== "v") jFlat(v, pre ? `${pre}.${k}` : k, out); }
  else out[pre] = JSON.stringify(x);
  return out;
}
function jChanges(name) {             // how many settings differ from what's saved (one file, or all)
  const a = jFlat(name ? { [name]: jCur()[name] } : jCur()), b = jFlat(name ? { [name]: jSaved()[name] } : jSaved());
  return new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => a[k] !== b[k]).map((k) => k.replace(/^(\w+\.add\.\w+)\..*$/, "$1"))).size;
}
function jMine(name) {                // how many settings differ from the files (what's saved plus what's not sent)
  return Object.keys(jFlat({ [name]: jCur()[name] })).length;
}

// ── one setting ────────────────────────────────────────────────────────────
const jVal = (name, f) => { const v = jCur()[name]?.set?.[f.path]; return v === undefined ? f.base : v; };
function jSet(name, f, v) {
  jEdit((d) => {
    const s = ((d[name] ||= {}).set ||= {});
    if (jSame(v, f.base) || (Array.isArray(v) && !v.length && (!Array.isArray(f.base) || !f.base.length))) delete s[f.path];
    else s[f.path] = v;
  });
}
function wordsEl(label, help, list, onChange, codes = false) {
  const input = el("input", { type: "text", class: "text-in", maxlength: codes ? "40" : "300", "aria-label": label,
    placeholder: codes ? "Codes, like NPT" : "Words or phrases, separated by commas" });
  const add = () => {
    const words = input.value.split(",").map((w) => w.trim().replace(/\s+/g, " ")).filter(Boolean).map((w) => (codes ? w.toUpperCase() : w));
    if (!words.length) return;
    const bad = words.find((w) => (codes ? !/^[A-Z0-9]{3}$/.test(w) : w.length > 60 || /[<>{}\\\u0000-\u001f]/.test(w)));
    if (bad) { toast(codes ? `${bad}: FDA product codes are three letters or digits` : `“${bad.slice(0, 30)}”: plain words only, up to 60 characters`); return; }
    const have = new Set(list.map((w) => w.toLowerCase()));
    onChange([...list, ...words.filter((w) => !have.has(w.toLowerCase()) && have.add(w.toLowerCase()))].slice(0, 60));
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, label), help ? el("p", { class: "fine", style: "margin:2px 0 6px" }, help) : null,
    list.length ? el("div", { class: "chips wrap" }, list.map((w) => el("button", { class: "chip", "aria-pressed": "true", "aria-label": `Remove ${w}`,
      onclick: () => onChange(list.filter((x) => x !== w)) }, `${w}  ✕`))) : null,
    el("div", { class: "word-add" }, input, el("button", { class: "act", onclick: add }, "Add")));
}
function chipsEl(label, help, opts, on, onChange) {     // opts: [[value, label]]
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, label), help ? el("p", { class: "fine", style: "margin:2px 0 6px" }, help) : null,
    el("div", { class: "chips wrap" }, opts.map(([v, l]) => el("button", { class: "chip", "aria-pressed": String(on.includes(v)),
      onclick: () => onChange(on.includes(v) ? on.filter((x) => x !== v) : opts.map(([x]) => x).filter((x) => x === v || on.includes(x))) }, l))));
}
function controlEl(f, val, set) {
  switch (f.type) {
    case "int": case "float":
      return stepRow(f.label, f.help, val, { min: f.min, max: f.max, step: f.step || (f.type === "float" ? 0.05 : 1), unit: f.unit, empty: f.empty }, set);
    case "bool": return switchRow(f.label, f.help, !!val, set);
    case "choice": return segPick(f.label, f.options, val, (v) => set(f.options.find(([x]) => String(x) === String(v))?.[0] ?? v), f.help);
    case "multi": return chipsEl(f.label, f.help, f.options, val || [], set);
    case "subset": return chipsEl(f.label, f.help || "Tap to leave one out.", (f.base || []).map((x) => [x, x]), val || [], set);
    case "words": return wordsEl(f.label, f.help, val || [], set);
    case "codes": return wordsEl(f.label, f.help, val || [], set, true);
    default: return null;
  }
}
// a setting, marked when it differs from the file, with a way back
function fieldEl(f, val, set) {
  const changed = !jSame(val, f.base) && !(Array.isArray(val) && !val.length && (!f.base || !f.base.length));
  return el("div", { class: "jf" + (changed ? " changed" : "") }, controlEl(f, val, set),
    changed ? el("button", { class: "inline-link jf-reset", onclick: () => set(f.type === "words" ? [] : f.base) },
      `Back to the file’s ${f.type === "words" ? "list" : "value"}${f.type === "words" || f.base == null || typeof f.base === "object" ? "" : ` (${f.base === true ? "on" : f.base === false ? "off" : f.base}${f.unit ? ` ${f.unit}` : ""})`}`) : null);
}

// ── lists: outlets, trial topics, rules, Radar topics ──────────────────────
const jItem = (name, L, it) => jCur()[name]?.items?.[L.key]?.[it.id] || {};
function jItemSet(name, L, it, k, v) {
  jEdit((d) => {
    const m = (((d[name] ||= {}).items ||= {})[L.key] ||= {});
    const c = (m[it.id] ||= {});
    const base = k === "off" ? false : it.base[k];
    if (jSame(v, base) || (Array.isArray(v) && !v.length && !(base || []).length)) delete c[k]; else c[k] = v;
  });
}
function itemEl(name, L, it) {
  const c = jItem(name, L, it), off = c.off === true;
  const val = (f) => (c[f.path] === undefined ? it.base[f.path] : c[f.path]);
  const head = switchRow(it.label, it.sub || null, !off, (on) => jItemSet(name, L, it, "off", !on));
  if (off || !L.fields.length) return el("div", { class: "jl-item" + (off ? " off" : "") }, head);
  return el("div", { class: "jl-item" }, head,
    el("div", { class: "jl-fields" }, L.fields.map((f) => fieldEl({ ...f, base: it.base[f.path] }, val(f), (v) => jItemSet(name, L, it, f.path, v)))));
}
function addFormEl(name, L) {
  const key = `${name}.${L.key}`;
  const form = (jobForms[key] ||= {});
  const A = L.add;
  const inputs = A.fields.map((f) => {
    if (f.type === "text" || f.type === "words") {
      const i = el("input", { type: "text", class: "text-in", maxlength: f.type === "text" ? "60" : "600", value: form[f.path] || "",
        placeholder: f.type === "text" ? "A short name" : "Separated by commas", "aria-label": f.label });
      i.addEventListener("input", () => { form[f.path] = i.value; });
      return el("label", { class: "ctl jl-add-field" }, el("span", { class: "ctl-label" }, f.label), i);
    }
    if (form[f.path] === undefined) form[f.path] = f.default;
    if (f.type === "multi") return chipsEl(f.label, null, f.options, form[f.path] || [], (v) => { form[f.path] = v; rerender(); });
    if (f.type === "int") return stepRow(f.label, null, form[f.path] ?? f.min, { min: f.min, max: f.max, step: f.step || 1 }, (v) => { form[f.path] = v; rerender(); });
    return null;
  });
  const add = () => {
    const item = {};
    for (const f of A.fields) {
      const v = form[f.path];
      if (f.type === "text") item[f.path] = String(v || "").trim().replace(/\s+/g, " ");
      else if (f.type === "words") item[f.path] = String(v || "").split(",").map((w) => w.trim().replace(/\s+/g, " ")).filter(Boolean).slice(0, 60);
      else if (v !== undefined) item[f.path] = v;
      if (Array.isArray(item[f.path]) && !item[f.path].length) delete item[f.path];
    }
    if (!item.name) { toast("Give it a name"); return; }
    if (!item.words?.length) { toast("Give at least one word, so the job knows what to look for"); return; }
    const bad = Object.values(item).flat().find((w) => typeof w === "string" && (w.length > 60 || /[<>{}\\\u0000-\u001f]/.test(w)));
    if (bad) { toast(`“${bad.slice(0, 30)}”: plain words only, up to 60 characters`); return; }
    const id = `my-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}`;
    const taken = L.items.some((x) => x.id === id) || (jCur()[name]?.add?.[L.key] || []).some((x) => `my-${x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}` === id);
    if (taken || id.length < 4) { toast(`There’s already a topic called ${item.name}`); return; }
    delete jobForms[key];
    jEdit((d) => { (((d[name] ||= {}).add ||= {})[L.key] ||= []).push(item); });
    toast(`${item.name} added. Send it below.`);
  };
  return el("details", { class: "outlets jl-add", ...(jobOpen.has(`${key}:add`) ? { open: true } : {}), ontoggle: (e) => jToggle(`${key}:add`, e) },
    el("summary", {}, A.label), inputs, el("div", { class: "link-row" }, el("button", { class: "act", onclick: add }, "Add")));
}
function addedEl(name, L) {
  const list = jCur()[name]?.add?.[L.key] || [];
  if (!list.length) return null;
  return el("div", { class: "ctl" }, el("div", { class: "ctl-label" }, "Yours"),
    list.map((x, i) => el("div", { class: "switch-row" },
      el("div", {}, el("div", { class: "ctl-label", style: "margin:0" }, x.name), el("p", { class: "fine", style: "margin:2px 0 0" },
        [x.words?.join(", "), x.require?.length ? `must mention ${x.require.join(", ")}` : null, x.exclude?.length ? `never with ${x.exclude.join(", ")}` : null,
          x.phases ? x.phases.map((p) => p.replace("PHASE", "Phase ").replace("NA", "no phase")).join(", ") : null, x.min_n ? `${x.min_n}+ patients` : null].filter(Boolean).join(" · "))),
      el("button", { class: "act", onclick: () => jEdit((d) => { d[name].add[L.key].splice(i, 1); }) }, "Remove"))));
}
function jToggle(key, e) { if (e.currentTarget.open) jobOpen.add(key); else jobOpen.delete(key); }
function listEl(name, L) {
  const key = `${name}.${L.key}`;
  const offN = L.items.filter((it) => jItem(name, L, it).off).length;
  const groups = {};
  L.items.forEach((it) => { (groups[it.group || ""] ||= []).push(it); });
  const body = Object.keys(groups).length > 1
    ? Object.entries(groups).map(([g, items]) => el("details", { class: "outlets jl-group", ...(jobOpen.has(`${key}:${g}`) ? { open: true } : {}), ontoggle: (e) => jToggle(`${key}:${g}`, e) },
      el("summary", {}, g, el("span", { class: "fine" }, `${items.length}${items.some((it) => jItem(name, L, it).off) ? `, ${items.filter((it) => jItem(name, L, it).off).length} off` : ""}`)),
      items.map((it) => itemEl(name, L, it))))
    : L.items.map((it) => itemEl(name, L, it));
  return el("details", { class: "outlets jl", ...(jobOpen.has(key) ? { open: true } : {}), ontoggle: (e) => jToggle(key, e) },
    el("summary", {}, L.label, el("span", { class: "fine" }, `${L.items.length}${offN ? `, ${offN} off` : ""}${(jCur()[name]?.add?.[L.key] || []).length ? `, ${(jCur()[name].add[L.key]).length} yours` : ""}`)),
    body, L.add ? [addedEl(name, L), addFormEl(name, L)] : null);
}

// ── a job's settings, in its section of Tune → You ─────────────────────
function jobSettingsEl(name) {
  if (!jobCfg) { loadJobCfg(); return el("p", { class: "fine" }, "Settings you can change here appear after the settings job’s first run."); }
  const F = jobCfg.files?.[name];
  if (!F) return null;
  const n = jMine(name);
  return el("details", { class: "outlets job-set", ...(jobOpen.has(name) ? { open: true } : {}), ontoggle: (e) => jToggle(name, e) },
    el("summary", {}, "Change settings", el("span", { class: "fine" }, n ? `${plural(n, "change")} from the file` : `config/${F.file}`)),
    el("p", { class: "fine" }, `What the ${F.label} job reads from config/${F.file}. Changes stay on this phone until you send them; the job uses them from its next run, and the file itself isn’t changed.`),
    F.fields.map((f) => fieldEl(f, jVal(name, f), (v) => jSet(name, f, v))),
    F.lists.map((L) => listEl(name, L)),
    jobChangesBar());
}

// ── sending ────────────────────────────────────────────────────────────────
async function sendJobSettings() {
  const d = jClone(jobDraft || jSaved());
  delete d.at;
  const r = await ghFetch(`/actions/workflows/${JOBS.settings.wf}/dispatches`, { method: "POST",
    body: JSON.stringify({ ref: "main", inputs: { changes: JSON.stringify(d), run_jobs: "true" } }), headers: { "Content-Type": "application/json" } });
  if (r.status !== 204 && r.status !== 200) throw new Error(ghProblem(r.status));
  jobSent = { at: Date.now(), canon: jCanon(d) };
  store.set("jobSent", jobSent);
  [120, 240, 420].forEach((s) => setTimeout(() => loadJobCfg(true), s * 1000));
}
function jobChangesBar() {
  if (!jobCfg) return null;
  const n = jChanges();
  const last = jobCfg.last;
  const sentAt = jobSent?.at || 0;
  const answered = last && sentAt && Date.parse(last.at) >= sentAt - 5000;
  const waiting = sentAt && !answered && Date.now() - sentAt < 20 * 60e3;
  const jobsText = (js) => (js?.length ? js.map((j) => JOBS[j]?.title || j).join(", ") : "");
  return el("div", { class: "job-bar" + (n ? " pending" : "") },
    waiting ? el("p", { class: "fine" }, `Sent ${agoShort(new Date(sentAt).toISOString())} ago: the settings job checks and saves them, then runs the jobs they’re for. The result shows here in a few minutes. `,
      el("button", { class: "inline-link", onclick: () => loadJobCfg(true) }, "Check now")) : null,
    answered && last.ok && !n ? el("p", { class: "fine" }, `Saved ${ago(last.at)}${last.jobs?.length ? `; ${jobsText(last.jobs)} ran with them` : ""}.`) : null,
    answered && !last.ok ? el("p", { class: "fine warn-text" }, `${last.error}. Change it and send again.`) : null,
    n ? [el("p", { class: "fine" }, el("b", {}, `${plural(n, "change")} not sent yet.`), " The jobs use them once they’re saved on GitHub."),
      el("div", { class: "link-row" },
        ghToken() ? el("button", { class: "act", onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await sendJobSettings(); toast("Sent to GitHub"); rerender(); } catch (err) { toast(String(err.message || err)); b.disabled = false; }
        } }, "Send to GitHub")
          : el("button", { class: "act", onclick: () => { const d = jClone(jobDraft || jSaved()); delete d.at; copyText(JSON.stringify(d), "Changes copied"); jobSent = { at: Date.now(), canon: jCanon(d) }; store.set("jobSent", jobSent); } }, "Copy changes"),
        twoTap("jobDiscard", "Discard", "Tap again to discard", () => { jobDraft = null; store.set("jobDraft", null); Object.keys(jobForms).forEach((k) => delete jobForms[k]); toast("Changes discarded"); rerender(); })),
      ghToken() ? null : el("p", { class: "fine" }, "Then on GitHub, ",
        el("a", { class: "inline-link", href: `https://github.com/${REPO}/actions/workflows/${JOBS.settings.wf}`, target: "_blank", rel: "noopener" }, "run “Apply settings”"),
        ", paste them under Settings from the app, and run it. With a GitHub token (Tune → You, at the top) Send does this for you.")] : null);
}
// at the top of Tune → You: changes not sent, from any job
function jobPendingTop() {
  if (!jobCfg) { loadJobCfg(); return null; }
  const n = jChanges();
  const last = jobCfg.last, sentAt = jobSent?.at || 0;
  const failed = last && !last.ok && sentAt && Date.parse(last.at) >= sentAt - 5000;
  if (!n && !failed) return null;
  return el("section", { class: "sect job-top" }, jobChangesBar());
}
