/* Cockpit app · interface. Portage du Cockpit (Systeme/Cockpit/cockpit.html) sans copilote ni connecteurs :
 * les données viennent de store.js (IndexedDB + dépôt GitHub). */
(function () {
  "use strict";
  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
  const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const MOIS_L = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
  const JOURS_C = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];
  const JOURS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const short = (d) => d.getDate() + " " + MOIS[d.getMonth()];
  const daysBetween = (a, b) => Math.round((b - a) / 864e5);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "text") el.textContent = attrs[k];
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    }
    for (const c of kids) if (c != null) el.append(c);
    return el;
  }
  const SVGNS = "http://www.w3.org/2000/svg";
  function s(tag, attrs, text) { const el = document.createElementNS(SVGNS, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); if (text != null) el.textContent = text; return el; }
  let toastT;
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4500); }
  function armDelete(btn, fn) {
    if (btn.classList.contains("arm")) { fn(); return; }
    btn.classList.add("arm"); const was = btn.textContent; btn.textContent = "Supprimer ?";
    setTimeout(() => { btn.classList.remove("arm"); btn.textContent = was; }, 3000);
  }

  // ---------- state ----------
  const state = { tasks: [], habits: [], habitLog: {}, goals: [], mood: {}, inbox: [], brief: null, day: null, planning: {}, equipe: { tickets: [] } };
  const Store = window.CockpitStore;
  const DOCS = Store.DOCS;
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const raw = {}; // dernière version de chaque document : on garde les champs que l'app ne connaît pas
  function pruneLog(log) { const cut = keyOf(addDays(today(), -400)), out = {}; for (const k in log) if (k >= cut) out[k] = log[k]; return out; }
  function bodyOf(n) {
    const base = Object.assign({}, raw[n] || {});
    if (n === "tasks") return Object.assign(base, { items: state.tasks });
    if (n === "habits") return Object.assign(base, { items: state.habits, log: pruneLog(state.habitLog) });
    if (n === "goals") return Object.assign(base, { items: state.goals });
    if (n === "mood") return Object.assign(base, { log: pruneLog(state.mood) });
    if (n === "day") return state.day || {};
    if (n === "planning") return state.planning || {};
    if (n === "equipe") return state.equipe || { tickets: [] };
    return Object.assign(base, { items: state.inbox.slice(-300) });
  }
  function applyDoc(n, d) {
    d = d || {}; raw[n] = clone(d);
    if (n === "tasks") state.tasks = clone(d.items || []);
    else if (n === "habits") { state.habits = clone(d.items || []); state.habitLog = clone(d.log || {}); }
    else if (n === "goals") state.goals = clone(d.items || []);
    else if (n === "mood") state.mood = clone(d.log || {});
    else if (n === "inbox") state.inbox = clone(d.items || []);
    else if (n === "brief") state.brief = d && (d.matin || d.soir) ? clone(d) : null;
    else if (n === "day") state.day = d && d.date ? clone(d) : null;
    else if (n === "planning") state.planning = clone(d || {});
    else if (n === "equipe") { state.equipe = clone(d || {}); if (!Array.isArray(state.equipe.tickets)) state.equipe.tickets = []; }
  }

  // ---------- persistence : store.js garde tout sur l'appareil et synchronise avec le dépôt ----------
  let loaded = false;
  function save(n) { Store.set(n, bodyOf(n)); render(); }
  const SYNC_CLS = { ok: "ok", wait: "wait", err: "err", off: "" };
  function setSync(st) {
    const cls = "dot " + (SYNC_CLS[st.level] || "");
    ["sync-dot", "sync-dot2"].forEach((id) => ($(id).className = cls));
    $("sync-t").textContent = st.text; $("sync-t2").textContent = st.text;
    { const g = Store.getSettings(); $("setup-banner").hidden = g.hasToken && g.configured; }
    if (view === "reglages") renderSettings();
  }
  // un changement venu du dépôt redessine l'écran : on garde ce qui est en train d'être tapé
  function renderKeep() {
    const act = document.activeElement, keep = {};
    document.querySelectorAll("main input[id], main textarea[id]").forEach((el) => { if (el.type !== "checkbox" && el.type !== "radio" && el.value) keep[el.id] = el.value; });
    const focusId = act && act.id, sel = act && typeof act.selectionStart === "number" ? [act.selectionStart, act.selectionEnd] : null;
    render();
    for (const id in keep) { const el = $(id); if (el && !el.value) el.value = keep[id]; }
    if (focusId && document.activeElement !== $(focusId) && $(focusId)) { const el = $(focusId); el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* champ sans sélection */ } }
  }
  // ---------- derived ----------
  const PRIO = { haute: 0, moyenne: 1, basse: 2 }, PRIOS = ["haute", "moyenne", "basse"], QUAND = ["inbox", "today", "evening", "anytime", "someday"];
  const isDone = (hid, k) => (state.habitLog[k] || []).includes(hid);
  function streak(hid) { let d = today(); if (!isDone(hid, keyOf(d))) d = addDays(d, -1); let n = 0; while (isDone(hid, keyOf(d)) && n < 1000) { n++; d = addDays(d, -1); } return n; }
  function urg(t, tk) { return t.due && t.due < tk ? 0 : t.due === tk ? 1 : 2; }
  function openSorted() {
    const tk = keyOf(today());
    return state.tasks.filter((t) => !t.done).sort((a, b) => (urg(a, tk) - urg(b, tk)) || ((b.doing ? 1 : 0) - (a.doing ? 1 : 0)) || ((PRIO[a.prio] ?? 1) - (PRIO[b.prio] ?? 1)) || ((a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : 0));
  }
  const skipped = new Set();
  function focusTask() { const o = openSorted(), d = todayPlan(), planned = new Set((d.plan || []).filter((r) => r.startsWith("t:")).map((r) => r.slice(2))); return o.find((t) => planned.has(t.id) && !skipped.has(t.id)) || o.find((t) => t.doing && !skipped.has(t.id)) || o.find((t) => isTodayish(t) && whenOf(t) === "today" && !skipped.has(t.id)) || o.find((t) => isTodayish(t) && !skipped.has(t.id)) || o.find((t) => !skipped.has(t.id) && whenOf(t) !== "someday" && whenOf(t) !== "upcoming") || o[0] || null; }
  const stepPct = (st) => Math.round((st.filter((x) => x.done).length / st.length) * 100);
  function weekCounts(n) {
    const m0 = monday(today()), out = [];
    for (let i = n - 1; i >= 0; i--) { const st = addDays(m0, -7 * i), a = keyOf(st), b = keyOf(addDays(st, 7)); out.push({ start: st, count: state.tasks.filter((t) => t.done && t.doneAt && t.doneAt >= a && t.doneAt < b).length }); }
    return out;
  }
  function toggleHabit(hid, k) {
    const arr = state.habitLog[k] || [], on = arr.includes(hid);
    state.habitLog[k] = on ? arr.filter((x) => x !== hid) : arr.concat(hid);
    if (!state.habitLog[k].length) delete state.habitLog[k];
    save("habits");
  }
  function setMood(field, v) {
    const k = keyOf(today()), cur = { ...(state.mood[k] || {}) };
    if (cur[field] === v) delete cur[field]; else cur[field] = v;
    if (!cur.m && !cur.e) delete state.mood[k]; else state.mood[k] = cur;
    save("mood");
  }
  function completeTask(t, on) { t.done = on; t.doneAt = on ? keyOf(today()) : null; if (on) delete t.doing; save("tasks"); }
  // État « en cours » : doing: true sur une tâche ou une étape de projet ; champ supprimé quand ce n'est plus en cours.
  function setDoing(o, on, coll) { if (on) o.doing = true; else delete o.doing; save(coll || "tasks"); }
  function doingBtn(o, label, coll) { const on = !!o.doing; return h("button", { class: "x go", type: "button", "aria-pressed": on ? "true" : "false", "aria-label": "En cours : " + label, title: on ? "En cours (toucher pour arrêter)" : "Passer en cours", text: "▶", onclick: () => setDoing(o, !on, coll) }); }
  function toggleStep(g, st) { st.done = !st.done; st.doneAt = st.done ? keyOf(today()) : null; if (st.done) delete st.doing; g.progress = stepPct(g.steps || []); save("goals"); }
  // Méthode « quand je la fais » : inbox, today, evening, anytime (défaut), someday ; start = date où elle remonte dans Aujourd'hui.
  const WHEN = [["inbox", "Boîte de réception"], ["today", "Aujourd'hui"], ["evening", "Ce soir"], ["upcoming", "Bientôt"], ["anytime", "À tout moment"], ["someday", "Un jour"]];
  const WHEN_L = Object.fromEntries(WHEN);
  function whenOf(t) {
    if (t.done) return "done";
    const tk = keyOf(today()), later = t.start && t.start > tk;
    if (t.due && t.due <= tk) return t.when === "evening" ? "evening" : "today";
    if (later) return "upcoming";
    if (t.when === "today" || t.when === "evening") return t.when;
    if (t.start && t.when !== "someday") return "today";
    return t.when === "someday" ? "someday" : t.when === "inbox" ? "inbox" : "anytime";
  }
  const isTodayish = (t) => { const w = whenOf(t); return w === "today" || w === "evening"; };
  function setWhen(t, w, date) {
    if (w === "upcoming") { if (!date) return; t.start = date; t.when = "anytime"; }
    else { t.when = w; t.start = null; }
    save("tasks");
  }
  function parseTags(str) {
    const tags = []; const title = String(str || "").replace(/(^|\s)#([\p{L}\p{N}_-]{1,30})/gu, (m0, sp, tg) => { tags.push(tg.toLowerCase()); return sp; }).replace(/\s+/g, " ").trim();
    return { title, tags };
  }
  const tagList = (str) => String(str || "").split(/[,;]/).map((x) => x.trim().replace(/^#/, "").toLowerCase()).filter((x) => x && x.length <= 30);
  const uniq = (a) => [...new Set(a)];

  // ---------- views ----------
  const VIEWS = ["aujourdhui", "taches", "semaine", "projets", "notes", "equipe", "reglages"];
  let view = "aujourdhui";
  function route() {
    const v = (location.hash || "").replace("#", "");
    view = VIEWS.includes(v) ? v : "aujourdhui";
    document.body.dataset.view = view;
    VIEWS.forEach((n) => ($("v-" + n).hidden = n !== view));
    document.querySelectorAll(".nav a").forEach((a) => { if (a.dataset.v === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    render();
  }

  function render() {
    renderRitual(); renderObjectif(); renderToday(); renderTasks(); renderWeek(); renderEdt(); renderProjects(); renderNotes(); renderEquipe(); renderGoalSelect(); if (view === "reglages") renderSettings();
  }

  // ---------- Aujourd'hui ----------
  function renderToday() {
    const t0 = today(), tk = keyOf(t0);
    $("bigdate").replaceChildren(JOURS_C[t0.getDay()], h("br"), String(t0.getDate()));
    const hr = new Date().getHours();
    const iso = isoWeek(t0);
    $("weekl").textContent = "Semaine " + iso + " · " + MOIS_L[t0.getMonth()];
    const open = openSorted();
    const late = open.filter((t) => t.due && t.due < tk).length;
    $("greet").replaceChildren((hr < 18 ? "Bonjour Evan." : "Bonsoir Evan."), h("br"), !open.length ? "Rien d'urgent. Profite." : late ? "Une seule chose compte." : open.length + " chose" + (open.length > 1 ? "s" : "") + " au programme.");
    renderFocus();
    // habits
    const hb = $("hab-today"); hb.replaceChildren();
    state.habits.forEach((x) => {
      const on = isDone(x.id, tk), st = streak(x.id);
      hb.append(h("button", { class: "hab" + (on ? " on" : ""), type: "button", "aria-pressed": on ? "true" : "false", onclick: () => toggleHabit(x.id, tk) }, h("span", { class: "sq" }), h("span", { class: "n", text: x.name }), h("span", { class: "s", text: st ? st + " j" : "" })));
    });
    if (!state.habits.length) hb.append(h("div", { class: "empty", text: loaded ? "Aucune habitude. Ajoute-en une depuis la vue Semaine." : "Chargement…" }));
    $("hab-n").textContent = state.habits.filter((x) => isDone(x.id, tk)).length + "/" + state.habits.length;
    // mood
    const bars = $("mood-bars"); bars.replaceChildren();
    const ms = [];
    for (let i = 9; i >= 0; i--) { const e = state.mood[keyOf(addDays(t0, -i))]; const v = e && e.m; if (v) ms.push(v); bars.append(h("span", { class: !v ? "none" : v >= 4 ? "hi" : "", style: "height:" + (v ? v * 20 : 0) + "%" })); }
    $("mood-avg").textContent = ms.length ? "moy. " + (ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1).replace(".", ",") : "pas encore noté";
    const e = state.mood[tk] || {};
    const scale = (id, field, label) => { const el = $(id); el.replaceChildren(h("span", { class: "l", text: label })); for (let v = 1; v <= 5; v++) el.append(h("button", { class: "lv" + (e[field] === v ? " on" : ""), type: "button", "aria-pressed": e[field] === v ? "true" : "false", "aria-label": label + " " + v + " sur 5", text: v, onclick: () => setMood(field, v) })); };
    scale("sc-m", "m", "Humeur"); scale("sc-e", "e", "Énergie");
    // next list
    const f = focusTask();
    const planned = new Set((todayPlan().plan || []).filter((r) => r.startsWith("t:")).map((r) => r.slice(2)));
    const rest = open.filter((t) => (!f || t.id !== f.id) && (isTodayish(t) || planned.has(t.id)));
    const day = rest.filter((t) => whenOf(t) !== "evening"), eve = rest.filter((t) => whenOf(t) === "evening");
    const L = $("next-list"); L.replaceChildren(...day.map(taskRow));
    if (eve.length) L.append(h("li", { class: "grp", text: "Ce soir" }), ...eve.map(taskRow));
    if (!rest.length) {
      const nIn = open.filter((t) => whenOf(t) === "inbox").length, nAny = open.filter((t) => whenOf(t) === "anytime").length;
      L.append(h("li", { class: "empty" }, open.length ? "Rien d'autre de prévu aujourd'hui. " : loaded ? "Aucune tâche ouverte. Ajoute-en une ci-dessous." : "Chargement…",
        nAny ? h("a", { href: "#taches", text: "Piocher dans À tout moment (" + nAny + ")", onclick: () => { tkTab = "anytime"; } }) : null,
        nAny && nIn ? " · " : null,
        nIn ? h("a", { href: "#taches", text: "Trier la boîte (" + nIn + ")", onclick: () => { tkTab = "inbox"; } }) : null));
    }
    const wk = weekCounts(1)[0].count;
    $("next-meta").textContent = rest.length + " prévue" + (rest.length > 1 ? "s" : "") + " · " + wk + " faite" + (wk > 1 ? "s" : "") + " cette semaine";
    // projects mini
    const pm = $("prj-mini"); pm.replaceChildren();
    state.goals.slice().sort((a, b) => (b.progress || 0) - (a.progress || 0)).slice(0, 4).forEach((g) => pm.append(h("div", { class: "prj" }, h("div", { class: "top" }, h("span", { text: g.title }), h("span", { class: "mono", text: (g.progress || 0) + "%" })), h("div", { class: "pbar" }, h("i", { style: "width:" + (g.progress || 0) + "%" })))));
    if (!state.goals.length) pm.append(h("div", { class: "empty", text: "Aucun projet." }));

  }
  function isoWeek(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1)); return Math.ceil(((x - y0) / 864e5 + 1) / 7); }

  function renderFocus() {
    const box = $("focus"), t = focusTask(), tk = keyOf(today());
    if (!t) {
      box.replaceChildren(h("div", { class: "fh" }, h("span", { class: "eyebrow", text: "Maintenant" })),
        h("div", { class: "ftitle", id: "f-title", text: loaded ? "Rien d'urgent." : "Chargement…" }),
        h("div", { class: "fmeta", text: loaded ? "Toutes tes tâches sont faites. Ajoute la prochaine, ou capture une idée." : "" }));
      return;
    }
    let pill = null, meta = [];
    if (t.due && t.due < tk) { const n = daysBetween(parseKey(t.due), today()); pill = h("span", { class: "pill", text: n + " jour" + (n > 1 ? "s" : "") + " de retard" }); }
    else if (t.due === tk) pill = h("span", { class: "pill blue", text: "Aujourd'hui" });
    else if (t.due) meta.push("Prévu le " + short(parseKey(t.due)));
    if (t.doing) meta.push("en cours");
    meta.push("Priorité " + (t.prio || "moyenne"));
    const g = t.goal && state.goals.find((x) => x.id === t.goal); if (g) meta.push(g.title);
    const steps = t.steps || [];
    if (steps.length) meta.push(steps.filter((x) => x.done).length + "/" + steps.length + " étapes");
    const nextIdx = steps.findIndex((x) => !x.done);
    const ul = h("ul", { class: "steps" });
    steps.forEach((st, i) => ul.append(h("li", { class: "step" + (st.done ? " done" : "") + (i === nextIdx ? " next" : "") },
      h("button", { class: "box" + (st.done ? " on" : ""), type: "button", "aria-label": (st.done ? "Rouvrir l'étape : " : "Valider l'étape : ") + st.title, onclick: () => { st.done = !st.done; save("tasks"); } }),
      h("span", { class: "t", text: st.title }),
      h("button", { class: "x", type: "button", "aria-label": "Retirer l'étape " + st.title, text: "✕", onclick: () => { t.steps = steps.filter((x) => x !== st); save("tasks"); } }))));
    const inp = h("input", { class: "field", id: "step-in", placeholder: steps.length ? "Ajouter une étape…" : "Découpe-la : première petite étape ?", "aria-label": "Nouvelle étape" });
    const form = h("form", { class: "addline", autocomplete: "off", onsubmit: (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; t.steps = steps.concat({ id: uid(), title: v.slice(0, 160), done: false }); save("tasks"); setTimeout(() => { const el = $("step-in"); if (el) el.focus(); }, 0); } }, inp, h("button", { class: "btn outline sm", type: "submit", text: "Ajouter" }));
    const others = openSorted().length > 1;
    box.replaceChildren(...[
      h("div", { class: "fh" }, h("span", { class: "eyebrow", text: "Maintenant" }), pill),
      h("div", { class: "ftitle", id: "f-title", text: t.title }),
      h("div", { class: "fmeta", text: meta.join(" · ") }),
      steps.length ? ul : null, form,
      h("div", { class: "btns" },
        h("button", { class: "btn outline", type: "button", "aria-pressed": t.doing ? "true" : "false", text: t.doing ? "Arrêter « en cours »" : "Passer en cours", onclick: () => setDoing(t, !t.doing) }),
        h("button", { class: "btn light", type: "button", text: "C'est fait", onclick: () => { completeTask(t, true); toast("Bravo. « " + t.title.slice(0, 50) + " » est faite."); } }),
        h("button", { class: "btn outline", type: "button", text: "Reporter à demain", onclick: () => { postpone(t); toast("Reportée à demain."); } }),
        h("button", { class: "btn outline", type: "button", text: "Demander à Léon", onclick: () => askLeon("Aide-moi sur la tâche « " + t.title + " »" + (t.due ? " (échéance " + short(parseKey(t.due)) + ")" : "") + " : ") }),
        others ? h("button", { class: "btn outline", type: "button", text: "Autre tâche", onclick: () => { skipped.add(t.id); if (!openSorted().some((x) => !skipped.has(x.id))) skipped.clear(); render(); } }) : null,
        null)].filter(Boolean));
  }

  let editId = null;
  let triageId = null, tkTab = "today", tkTag = null, logDays = 14;
  function whenChips(t) {
    const cur = whenOf(t), d = h("input", { type: "date", class: "field", "aria-label": "Je m'y mets le", value: t.start && t.start > keyOf(today()) ? t.start : "", min: keyOf(addDays(today(), 1)) });
    d.addEventListener("change", () => { if (d.value) { setWhen(t, "upcoming", d.value); triageId = null; toast("Remontera le " + short(parseKey(d.value))); } });
    return h("div", { class: "when", role: "group", "aria-label": "Quand faire " + t.title },
      ...WHEN.filter(([k]) => k !== "upcoming").map(([k, l]) => h("button", { class: "kind", type: "button", "aria-pressed": cur === k ? "true" : "false", text: l, onclick: () => { setWhen(t, k); triageId = null; } })),
      h("span", { class: "hint", text: "ou le" }), d);
  }
  function postpone(t) { const tm = keyOf(addDays(today(), 1)); if (t.due && t.due <= keyOf(today())) t.due = tm; else { t.start = tm; if (t.when === "today" || t.when === "evening" || t.when === "inbox") t.when = "anytime"; } save("tasks"); }
  function taskRow(t, opt) {
    opt = opt || {};
    const tk = keyOf(today()), tags = h("span", { class: "tags" });
    const g = t.goal && state.goals.find((x) => x.id === t.goal);
    if (g) tags.append(h("span", { class: "tag goal", text: g.title, title: g.title }));
    (t.tags || []).forEach((tg) => tags.append(h("button", { class: "tag tg", type: "button", text: "#" + tg, title: "Filtrer sur #" + tg, onclick: () => { tkTag = tg; if (view !== "taches") { tkTab = "anytime"; location.hash = "taches"; } else render(); } })));
    if (t.byClaude) tags.append(h("span", { class: "tag claude", text: "#claude" }));
    const w = whenOf(t);
    if (!t.done && t.doing) tags.prepend(h("span", { class: "tag doing", text: "en cours" }));
    if (!t.done && w === "evening") tags.append(h("span", { class: "tag", text: "ce soir" }));
    if (!t.done && w === "upcoming") tags.append(h("span", { class: "tag", text: "dès " + short(parseKey(t.start)) }));
    if (!t.done && w === "someday" && view === "aujourdhui") tags.append(h("span", { class: "tag", text: "un jour" }));
    if (!t.done && t.due) tags.append(h("span", { class: t.due < tk ? "tag late" : t.due === tk ? "tag today" : "tag", text: t.due < tk ? "retard · " + short(parseKey(t.due)) : t.due === tk ? "aujourd'hui" : short(parseKey(t.due)) }));
    else if (!t.done) tags.append(h("span", { class: "tag", text: t.prio || "moyenne" }));
    return h("li", { class: "row" + (t.done ? " done" : "") },
      h("button", { class: "box" + (t.done ? " on" : ""), type: "button", "aria-label": (t.done ? "Rouvrir : " : "Terminer : ") + t.title, onclick: () => completeTask(t, !t.done) }),
      h("span", { class: "t", text: t.title }), tags,
      h("span", { style: "display:flex" },
        !t.done ? doingBtn(t, t.title, "tasks") : null,
        !t.done ? h("button", { class: "x", type: "button", "aria-label": "Quand faire " + t.title, "aria-expanded": triageId === t.id ? "true" : "false", title: "Quand je la fais", text: "◷", onclick: () => { triageId = triageId === t.id ? null : t.id; render(); } }) : null,
        h("button", { class: "x", type: "button", "aria-label": "Modifier " + t.title, text: "✎", onclick: () => startEdit(t) }),
        h("button", { class: "x", type: "button", "aria-label": "Supprimer " + t.title, text: "✕", onclick: (e) => armDelete(e.currentTarget, () => { if (editId === t.id) stopEdit(); state.tasks = state.tasks.filter((x) => x !== t); save("tasks"); }) })),
      !t.done && (opt.triage || triageId === t.id) ? whenChips(t) : null);
  }
  let goalSig = null;
  function renderGoalSelect() {
    const sig = state.goals.map((g) => g.id + ":" + g.title).join("|"); if (sig === goalSig) return; goalSig = sig;
    const sel = $("task-goal"), cur = sel.value;
    sel.replaceChildren(h("option", { value: "", text: "Sans projet" }), ...state.goals.map((g) => h("option", { value: g.id, text: g.title })));
    sel.value = state.goals.some((g) => g.id === cur) ? cur : "";
    const cs = $("cap-goal"), cc = cs.value;
    cs.replaceChildren(h("option", { value: "", text: "Projet : à deviner" }), ...state.goals.map((g) => h("option", { value: g.id, text: "Projet : " + g.title })));
    cs.value = state.goals.some((g) => g.id === cc) ? cc : "";
  }
  function startEdit(t) {
    editId = t.id; goalSig = null; renderGoalSelect();
    $("task-title").value = t.title; $("task-prio").value = t.prio || "moyenne"; $("task-due").value = t.due || ""; $("task-goal").value = t.goal || "";
    $("task-submit").textContent = "Enregistrer"; $("task-cancel").hidden = false;
    if (view !== "aujourdhui") location.hash = "aujourdhui";
    setTimeout(() => { $("task-title").focus(); $("task-form").scrollIntoView({ block: "center" }); }, 30);
  }
  function stopEdit() { editId = null; $("task-title").value = ""; $("task-due").value = ""; $("task-goal").value = ""; $("task-prio").value = "moyenne"; $("task-submit").textContent = "Ajouter"; $("task-cancel").hidden = true; }
  $("task-form").addEventListener("submit", (e) => {
    e.preventDefault(); const title = $("task-title").value.trim(); if (!title) return;
    const pt = parseTags(title);
    const vals = { title: (pt.title || title).slice(0, 200), prio: $("task-prio").value, due: $("task-due").value || null, goal: $("task-goal").value || null };
    const ed = editId && state.tasks.find((x) => x.id === editId);
    if (ed) { Object.assign(ed, vals); if (pt.tags.length) ed.tags = uniq((ed.tags || []).concat(pt.tags)); stopEdit(); save("tasks"); return; }
    state.tasks.push({ id: uid(), ...vals, done: false, doneAt: null, created: keyOf(today()), when: "today", tags: pt.tags });
    $("task-title").value = ""; $("task-due").value = ""; save("tasks"); $("task-title").focus();
  });
  $("task-cancel").addEventListener("click", stopEdit);

  // ---------- Tâches : listes « quand », logbook, tags ----------
  const TK_TABS = [["inbox", "Boîte de réception"], ["today", "Aujourd'hui"], ["upcoming", "Bientôt"], ["anytime", "À tout moment"], ["someday", "Un jour"], ["logbook", "Logbook"]];
  const TK_HINT = { inbox: "Tout ce que tu as capturé sans décider. Choisis quand tu la fais : elle quitte la boîte.", today: "Ce que tu as décidé de faire aujourd'hui, plus les échéances du jour et les tâches dont la date est arrivée.", upcoming: "Les tâches qui remonteront seules dans Aujourd'hui à leur date, et les échéances à venir.", anytime: "Tout ce que tu peux faire dès que tu as un moment. Pioche ici pour remplir ta journée.", someday: "Les envies sans date. Rien ne presse : relis-les de temps en temps.", logbook: "Tout ce que tu as fini : tâches et étapes de projet." };
  function dayLabel(k) {
    const tk = keyOf(today()); if (k === tk) return "Aujourd'hui"; if (k === keyOf(addDays(today(), 1))) return "Demain"; if (k === keyOf(addDays(today(), -1))) return "Hier";
    const d = parseKey(k); return JOURS_LONG[d.getDay()] + " " + d.getDate() + " " + MOIS_L[d.getMonth()];
  }
  const grpLi = (label, n) => h("li", { class: "grp" }, label, n != null ? h("span", { class: "c", text: n }) : null);
  function logbookItems() {
    const out = [];
    state.tasks.forEach((t) => { if (t.done && t.doneAt) out.push({ k: t.doneAt, t }); });
    state.goals.forEach((g) => (g.steps || []).forEach((st) => { if (st.done && st.doneAt) out.push({ k: st.doneAt, g, st }); }));
    return out.sort((a, b) => (a.k < b.k ? 1 : a.k > b.k ? -1 : 0));
  }
  function renderTasks() {
    const tk = keyOf(today()), all = openSorted(), match = (t) => !tkTag || (t.tags || []).includes(tkTag);
    const open = all.filter(match), by = { inbox: [], today: [], evening: [], upcoming: [], anytime: [], someday: [] };
    open.forEach((t) => by[whenOf(t)].push(t));
    const upc = open.filter((t) => { const w = whenOf(t); return w === "upcoming" || (t.due && t.due > tk && (w === "anytime" || w === "inbox")); });
    const logs = logbookItems().filter((x) => !tkTag || (x.t && (x.t.tags || []).includes(tkTag)));
    const wk = keyOf(addDays(today(), -6));
    const counts = { inbox: by.inbox.length, today: new Set(by.today.concat(by.evening, open.filter((t) => t.doing)).map((t) => t.id)).size, upcoming: upc.length, anytime: by.anytime.length, someday: by.someday.length, logbook: logs.filter((x) => x.k >= wk).length };
    $("tk-tabs").replaceChildren(...TK_TABS.map(([k, l]) => h("button", { class: "kind", type: "button", "aria-pressed": tkTab === k ? "true" : "false", onclick: () => { tkTab = k; triageId = null; renderTasks(); } }, l, counts[k] ? h("span", { class: "n", text: counts[k] }) : null)));
    $("tk-h").textContent = (TK_TABS.find((x) => x[0] === tkTab) || TK_TABS[1])[1];
    $("tk-meta").textContent = tkTab === "logbook" ? counts.logbook + " fait" + (counts.logbook > 1 ? "s" : "") + " sur 7 jours" : all.length + " tâche" + (all.length > 1 ? "s" : "") + " ouverte" + (all.length > 1 ? "s" : "") + (by.inbox.length ? " · " + by.inbox.length + " à trier" : "");
    const tags = uniq(state.tasks.flatMap((t) => t.tags || [])).sort();
    const tb = $("tk-tagbar"); tb.hidden = !tags.length && !tkTag;
    tb.replaceChildren(h("span", { class: "eyebrow", text: "Tags" }), h("button", { class: "kind k-tag", type: "button", "aria-pressed": !tkTag ? "true" : "false", text: "tous", onclick: () => { tkTag = null; renderTasks(); } }), ...tags.map((tg) => h("button", { class: "kind k-tag", type: "button", "aria-pressed": tkTag === tg ? "true" : "false", text: "#" + tg, onclick: () => { tkTag = tkTag === tg ? null : tg; renderTasks(); } })));
    const body = $("tk-body"), ul = h("ul", { class: "rows" });
    body.replaceChildren(h("span", { class: "hint", text: TK_HINT[tkTab] }), ul);
    const empty = (txt) => ul.append(h("li", { class: "empty", text: loaded ? txt : "Chargement…" }));
    if (tkTab === "inbox") { by.inbox.forEach((t) => ul.append(taskRow(t, { triage: true }))); if (!by.inbox.length) empty("Boîte vide. Tout est trié."); }
    else if (tkTab === "today") {
      const dn = open.filter((t) => t.doing), nd = (t) => !t.doing, tdy = by.today.filter(nd), evn = by.evening.filter(nd);
      if (dn.length) ul.append(grpLi("En cours", dn.length), ...dn.map((t) => taskRow(t)));
      if (dn.length && tdy.length) ul.append(grpLi("Aujourd'hui", tdy.length));
      tdy.forEach((t) => ul.append(taskRow(t)));
      if (evn.length) ul.append(grpLi("Ce soir", evn.length), ...evn.map((t) => taskRow(t)));
      if (!counts.today) empty("Rien de prévu aujourd'hui. Pioche dans À tout moment avec ◷.");
    } else if (tkTab === "upcoming") {
      const key = (t) => (whenOf(t) === "upcoming" ? t.start : t.due), groups = {};
      upc.forEach((t) => (groups[key(t)] = groups[key(t)] || []).push(t));
      Object.keys(groups).sort().forEach((k) => ul.append(grpLi(dayLabel(k), groups[k].length), ...groups[k].map((t) => taskRow(t))));
      if (!upc.length) empty("Rien de prévu. Avec ◷, choisis une date : la tâche remontera ce jour-là.");
    } else if (tkTab === "anytime" || tkTab === "someday") {
      const list = by[tkTab], groups = new Map([["", []]]);
      state.goals.forEach((g) => groups.set(g.id, []));
      list.forEach((t) => (groups.get(t.goal && groups.has(t.goal) ? t.goal : "") || groups.get("")).push(t));
      groups.forEach((arr, gid) => { if (!arr.length) return; const g = state.goals.find((x) => x.id === gid); if (g || groups.size > 1) ul.append(grpLi(g ? (g.area ? g.area + " · " : "") + g.title : "Sans projet", arr.length)); arr.forEach((t) => ul.append(taskRow(t))); });
      if (!list.length) empty(tkTab === "anytime" ? "Rien ici pour l'instant." : "Aucune envie mise de côté.");
    } else {
      const since = keyOf(addDays(today(), -logDays)), shown = logs.filter((x) => x.k >= since);
      let cur = null;
      shown.forEach((x) => {
        if (x.k !== cur) { cur = x.k; ul.append(grpLi(dayLabel(x.k), shown.filter((y) => y.k === x.k).length)); }
        if (x.t) ul.append(taskRow(x.t));
        else ul.append(h("li", { class: "row done" }, h("button", { class: "box on", type: "button", "aria-label": "Rouvrir l'étape : " + x.st.title, onclick: () => toggleStep(x.g, x.st) }), h("span", { class: "t", text: x.st.title }), h("span", { class: "tags" }, h("span", { class: "tag goal", text: "étape · " + x.g.title, title: x.g.title }))));
      });
      if (!shown.length) empty("Rien de fini sur cette période.");
      if (logs.length > shown.length) body.append(h("div", { class: "btns" }, h("button", { class: "btn sm", type: "button", text: "Voir plus loin", onclick: () => { logDays += 30; renderTasks(); } })));
    }
  }

  // ---------- Saisie express ----------
  let qaWhen = null;
  function renderQaWhen() {
    $("qa-when").replaceChildren(...WHEN.map(([k, l]) => h("button", { class: "kind", type: "button", "aria-pressed": qaWhen === k ? "true" : "false", text: l, onclick: () => { qaWhen = qaWhen === k ? null : k; renderQaWhen(); } })));
    $("qa-start").hidden = qaWhen !== "upcoming";
    $("qa-hint").textContent = !qaWhen || qaWhen === "inbox" ? "Sans choix, elle va dans la boîte de réception : tu la tries plus tard." : qaWhen === "upcoming" ? "Choisis le jour où tu t'y mets : elle remontera dans Aujourd'hui ce jour-là." : "Elle ira dans « " + WHEN_L[qaWhen] + " ».";
  }
  function openQa(preset) {
    qaWhen = preset && WHEN_L[preset] && preset !== "inbox" ? preset : null;
    const sel = $("qa-goal"); sel.replaceChildren(h("option", { value: "", text: "Sans projet" }), ...state.goals.map((g) => h("option", { value: g.id, text: g.title })));
    ["qa-title", "qa-tags", "qa-start", "qa-due"].forEach((id) => ($(id).value = "")); $("qa-prio").value = "moyenne";
    $("qa-start").min = keyOf(addDays(today(), 1));
    if (tkTag) $("qa-tags").value = tkTag;
    renderQaWhen(); $("qa").hidden = false; setTimeout(() => $("qa-title").focus(), 20);
  }
  function closeQa() { $("qa").hidden = true; }
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-qa]"); if (b) { e.preventDefault(); openQa(view === "taches" ? tkTab : null); } });
  $("qa").addEventListener("click", (e) => { if (e.target === $("qa")) closeQa(); });
  $("qa-close").addEventListener("click", closeQa);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("qa").hidden) { closeQa(); return; }
    const tg = e.target && e.target.tagName;
    if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(tg || "") && !(e.target && e.target.isContentEditable) && $("qa").hidden) { e.preventDefault(); openQa(view === "taches" ? tkTab : null); }
  });
  $("qa-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pt = parseTags($("qa-title").value); if (!pt.title) return;
    const start = $("qa-start").value;
    if (qaWhen === "upcoming" && !start) { toast("Choisis la date où tu t'y mets."); $("qa-start").focus(); return; }
    const task = { id: uid(), title: pt.title.slice(0, 200), prio: $("qa-prio").value, due: $("qa-due").value || null, goal: $("qa-goal").value || null, done: false, doneAt: null, created: keyOf(today()),
      when: qaWhen === "upcoming" ? "anytime" : qaWhen || "inbox", start: qaWhen === "upcoming" ? start : null, tags: uniq(pt.tags.concat(tagList($("qa-tags").value))) };
    state.tasks.push(task); save("tasks"); closeQa();
    toast("Ajoutée · " + (qaWhen === "upcoming" ? "remonte le " + short(parseKey(start)) : WHEN_L[task.when]));
  });

  // ---------- Rituels : ouvrir et fermer la journée ----------
  // The page drives them (works even if a routine missed); routines only prepare the brief text and the evening question.
  function todayPlan() { const tk = keyOf(today()); return state.day && state.day.date === tk ? state.day : { date: tk, plan: [] }; }
  function resolveRef(r) {
    if (r.startsWith("t:")) { const t = state.tasks.find((x) => x.id === r.slice(2)); return t ? { ref: r, kind: "tâche", title: t.title, done: !!t.done, sub: t.due ? (t.due < keyOf(today()) ? "en retard" : short(parseKey(t.due))) : "", toggle: () => completeTask(t, !t.done), tomorrow: () => postpone(t) } : null; }
    const [, gid, sid] = r.split(":"); const g = state.goals.find((x) => x.id === gid); const st = g && (g.steps || []).find((x) => x.id === sid);
    return st ? { ref: r, kind: "étape", title: st.title, done: !!st.done, sub: g.title + (st.envie ? " · envie " + st.envie + "/5" : ""), toggle: () => toggleStep(g, st) } : null;
  }
  function candidates() {
    const tk = keyOf(today()), out = [];
    openSorted().filter((t) => whenOf(t) !== "someday" && whenOf(t) !== "upcoming").forEach((t) => out.push({ ref: "t:" + t.id, title: t.title, sub: t.due && t.due < tk ? "tâche en retard" : t.due === tk ? "tâche du jour" : isTodayish(t) ? "prévue aujourd'hui" : "tâche · " + (t.prio || "moyenne"), score: (t.due && t.due <= tk ? 100 : 0) + (isTodayish(t) ? 50 : 0) + (t.prio === "haute" ? 20 : t.prio === "moyenne" ? 10 : 0) }));
    state.goals.forEach((g) => (g.steps || []).filter((s2) => !s2.done).forEach((s2) => out.push({ ref: "s:" + g.id + ":" + s2.id, title: s2.title, sub: g.title + (s2.envie ? " · envie " + s2.envie + "/5" : ""), score: (s2.envie || 0) * 12 })));
    return out.sort((a, b) => b.score - a.score).slice(0, 8);
  }
  const QUESTIONS = ["Qu'est-ce qui t'a donné de l'énergie aujourd'hui ?", "De quoi es-tu content aujourd'hui, même petit ?", "Qu'est-ce qui t'a freiné aujourd'hui, et comment l'éviter demain ?", "Qu'as-tu appris aujourd'hui ?", "Si tu refaisais la journée, que changerais-tu ?", "Pour quoi es-tu reconnaissant ce soir ?", "Quelle petite victoire veux-tu retenir ?"];
  // Pas d'agenda Google dans l'app (pas de connecteur) : on montre le programme du jour et les échéances.
  const agendaCache = {};
  function agendaBox(dayOffset, label) {
    const d = addDays(today(), dayOffset), k = keyOf(d), box = h("div", { class: "col" }, h("span", { class: "eyebrow", text: label }));
    const rows = [];
    (planBlocks(d) || []).filter((b) => b.type !== "projet" || (state.planning.projets || {})[k] === "oui").forEach((b) => rows.push([b.time ? b.time.replace(":", " h ") : b.type === "repos" ? "journée" : "libre", b.label + (b.sub && !/photo du programme/.test(b.sub) ? " · " + b.sub : "") + (b.log && b.log.done ? " ✓" : "")]));
    state.tasks.filter((t) => !t.done && t.due === k).forEach((t) => rows.push(["échéance", t.title]));
    if (!rows.length) box.append(h("span", { class: "hint", text: "Rien au programme." }));
    rows.forEach(([tm, txt]) => box.append(h("div", { class: "ev-row" }, h("span", { class: "tm", text: tm }), h("span", { text: txt }))));
    box.append(h("span", { class: "hint", text: "Tes rendez-vous : dans Google Agenda." }));
    return box;
  }
  function moodRow(label, field) {
    const k = keyOf(today()), e = state.mood[k] || {};
    const row = h("div", { class: "scale" }, h("span", { class: "l", text: label }));
    for (let v = 1; v <= 5; v++) row.append(h("button", { class: "lv" + (e[field] === v ? " on" : ""), type: "button", "aria-pressed": e[field] === v ? "true" : "false", "aria-label": label + " " + v + " sur 5", text: v, onclick: () => setMood(field, v) }));
    return row;
  }
  // ---------- Objectif du jour : repos (lundi), sport, philo ou projet ----------
  const OBJ = {
    repos: { word: "Repos", sub: "Lundi, jour off : pas de sport, pas de philo. Tu récupères, tu traites seulement l'urgent.", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>' },
    sport: { word: "Sport", sub: "Muscu et course : la séance du jour passe avant le reste.", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"/></svg>' },
    philo: { word: "Philo", sub: "Lecture et fiche : un chapitre, la grille T/A/C/O, puis la fiche.", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1z"/><path d="M12 6v14"/></svg>' },
    projet: { word: "Projet", sub: "Avance un projet : commence par l'étape qui te donne le plus envie.", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>' },
  };
  const SPORT_RE = /muscu|course|run|footing|fractionn|séance|sport|salle|5 ?km|10 ?km/i;
  const PHILO_RE = /philo|phylo|fiche de lecture|dissert/i;
  function todayEvents() { return []; } // pas d'agenda dans l'app : l'objectif se déduit du programme et des tâches
  const isPhiloTask = (t) => PHILO_RE.test(t.title || "") || (state.goals.find((g) => g.id === t.goal && PHILO_RE.test(g.title || "")));
  function objectifAuto() {
    const t0 = today(), tk = keyOf(t0), evs = todayEvents();
    if (t0.getDay() === 1) return { type: "repos", why: "lundi" };
    const pb = planBlocks(t0); if (pb && pb.some((b) => b.type === "sport")) return { type: "sport", why: "planning" };
    const sp = evs.filter((e) => SPORT_RE.test(e.summary || "") && !/récup/i.test(e.summary || ""));
    if (sp.length) return { type: "sport", why: "agenda" };
    if (evs.some((e) => PHILO_RE.test(e.summary || "")) || state.tasks.some((t) => !t.done && t.due && t.due <= tk && isPhiloTask(t))) return { type: "philo", why: evs.some((e) => PHILO_RE.test(e.summary || "")) ? "agenda" : "tâche du jour" };
    return { type: "projet", why: "par défaut" };
  }
  function evTime(e) { const s = (e.start && (e.start.dateTime || e.start.date)) || ""; return s.length > 10 ? s.slice(11, 16).replace(":", " h ") : "journée"; }
  function renderObjectif() {
    const el = $("obj"); if (!loaded) { el.hidden = true; return; }
    const tk = keyOf(today()), d = todayPlan(), auto = objectifAuto(), type = OBJ[d.objectif] ? d.objectif : auto.type, o = OBJ[type];
    el.hidden = false; el.className = "tile s4 obj t-" + type;
    const ghost = h("span", { class: "ghost", "aria-hidden": "true" }); ghost.innerHTML = o.icon;
    const list = h("ul", { class: "olist" }), evs = (agendaCache[tk] || []);
    let sub = o.sub;
    const pbT = (planBlocks(today()) || []).filter((b) => b.type === type);
    pbT.forEach((b) => list.append(h("li", {}, h("span", { class: "tm", text: b.time ? b.time.replace(":", " h ") : "journée" }), h("span", { text: b.label + (b.sub ? " · " + b.sub : "") }))));
    if (type === "sport") {
      evs.filter((e) => SPORT_RE.test(e.summary || "")).forEach((e) => list.append(h("li", {}, h("span", { class: "tm", text: evTime(e) }), h("span", { text: e.summary }))));
      if (!list.children.length) sub += " Rien dans l'agenda : cale ta séance.";
    } else if (type === "philo") {
      evs.filter((e) => PHILO_RE.test(e.summary || "")).forEach((e) => list.append(h("li", {}, h("span", { class: "tm", text: evTime(e) }), h("span", { text: e.summary }))));
      state.tasks.filter((t) => !t.done && isPhiloTask(t)).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1).slice(0, 2).forEach((t) => list.append(h("li", {}, h("button", { class: "box", type: "button", "aria-label": "Terminer : " + t.title, onclick: () => { completeTask(t, true); toast("Philo : « " + t.title.slice(0, 40) + " » faite."); } }), h("span", { text: t.title + (t.due && t.due !== tk ? " · " + short(parseKey(t.due)) : "") }))));
    } else if (type === "projet") {
      const steps = []; state.goals.filter((g) => !PHILO_RE.test(g.title || "")).forEach((g) => (g.steps || []).forEach((st) => { if (!st.done) steps.push({ g, st }); }));
      steps.sort((a, b) => (b.st.envie || 0) - (a.st.envie || 0));
      const top = steps[0];
      if (top) { sub = "Aujourd'hui : « " + top.g.title + " ». Commence par l'étape qui te donne le plus envie.";
        steps.filter((x) => x.g === top.g).slice(0, 3).forEach(({ g, st }) => list.append(h("li", {}, h("button", { class: "box", type: "button", "aria-label": "Valider : " + st.title, onclick: () => { toggleStep(g, st); toast("Étape validée."); } }), h("span", { text: st.title + (st.envie ? " · envie " + st.envie + "/5" : "") })))); }
    } else {
      const urgent = state.tasks.filter((t) => !t.done && t.due && t.due <= tk).length;
      if (urgent) sub += " " + urgent + " tâche" + (urgent > 1 ? "s" : "") + " en retard ou du jour : juste l'urgent.";
    }
    const setType = (k) => { const cur = todayPlan(); state.day = { ...cur, date: tk, objectif: k === auto.type ? null : k }; if (!state.day.objectif) delete state.day.objectif; save("day"); };
    el.replaceChildren(...[ghost,
      h("div", { class: "oh" }, h("span", { class: "eyebrow", text: "Objectif du jour" }), h("span", { class: "why", text: d.objectif && OBJ[d.objectif] ? "choisi par toi" : "auto · " + auto.why })),
      h("div", { class: "big" }, o.word, h("span", { class: "pt", text: "." })),
      h("div", { class: "sub", text: sub }),
      list.children.length ? list : null,
      h("div", { class: "types", role: "group", "aria-label": "Changer l'objectif du jour" }, ...Object.keys(OBJ).map((k) => h("button", { type: "button", "aria-pressed": k === type ? "true" : "false", text: OBJ[k].word, onclick: () => setType(k) })))].filter(Boolean));
  }

  let morningOpen = false;
  function renderRitual() {
    const el = $("ritual"); if (!loaded) { el.hidden = true; return; }
    el.hidden = false; el.replaceChildren();
    const tk = keyOf(today()), hr = new Date().getHours(), d = todayPlan(), items = (d.plan || []).map(resolveRef).filter(Boolean);
    const closed = d.evening && d.evening.done;
    if (hr >= 18 && !closed) return renderEvening(el, d, items);
    if ((!d.morningDone && hr < 15) || morningOpen) return renderMorning(el, d);
    el.className = "tile s4 ritual strip" + (closed ? " sage" : "");
    if (closed) { el.append(h("strong", { text: "Journée bouclée." }), h("span", { class: "hint", text: items.length ? items.filter((x) => x.done).length + "/" + items.length + " du plan faits. À demain." : "À demain." })); return; }
    el.append(h("span", { class: "eyebrow", style: "color: var(--ink)", text: "Plan du jour" }));
    if (!items.length) el.append(h("span", { class: "hint", text: "Pas encore de plan." }));
    items.forEach((it) => el.append(h("span", { class: "si" + (it.done ? " done" : "") }, h("button", { class: "box" + (it.done ? " on" : ""), type: "button", "aria-label": (it.done ? "Rouvrir : " : "Fait : ") + it.title, onclick: () => it.toggle() }), h("span", { text: it.title }))));
    el.append(h("button", { class: "btn sm", type: "button", text: items.length ? "Modifier le plan" : "Planifier ma journée", onclick: () => { morningOpen = true; renderRitual(); } }));
  }
  function renderMorning(el, d) {
    el.className = "tile s4 ritual";
    const tk = keyOf(today()), b = state.brief && state.brief.date === tk ? state.brief : null;
    el.append(h("div", { class: "rh" }, h("h2", { text: "Ouvrir ta journée" }), h("span", { class: "mono", style: "font-size:12px;color:var(--muted)", text: "2 minutes · choisis, puis lance-toi" })));
    const cols = h("div", { class: "cols" });
    const left = h("div", { class: "col" });
    if (b && b.matin) { const br = h("div", { class: "brief" }); renderRich(br, b.matin); left.append(h("span", { class: "eyebrow", text: "Préparé ce matin" }), br); }
    else left.append(h("span", { class: "eyebrow", text: "Brief" }), h("span", { class: "hint", text: "Le brief de Léon arrive vers 7 h. Pas encore là : commence par tes priorités." }));
    left.append(agendaBox(0, "Agenda du jour"));
    const mid = h("div", { class: "col" }, h("span", { class: "eyebrow", text: "Tes 3 priorités" }));
    const cands = candidates(), chosen = new Set((d.plan || []).length ? d.plan : cands.slice(0, 3).map((c) => c.ref));
    const count = h("span", { class: "hint" });
    const upd = () => (count.textContent = chosen.size + " choisie" + (chosen.size > 1 ? "s" : "") + (chosen.size > 3 ? " : 3 suffisent pour une journée réussie" : ""));
    cands.forEach((c) => { const cb = h("input", { type: "checkbox", "aria-label": c.title }); cb.checked = chosen.has(c.ref); cb.addEventListener("change", () => { if (cb.checked) chosen.add(c.ref); else chosen.delete(c.ref); upd(); }); mid.append(h("label", { class: "pick" }, cb, h("span", null, c.title, h("small", { text: c.sub })))); });
    if (!cands.length) mid.append(h("span", { class: "hint", text: "Aucune tâche ni étape ouverte. Ajoute-en une plus bas." }));
    upd(); mid.append(count);
    const right = h("div", { class: "col" }, h("span", { class: "eyebrow", text: "Comment tu te sens ?" }), moodRow("Humeur", "m"), moodRow("Énergie", "e"));
    const go = h("button", { class: "btn primary", type: "button", text: "C'est parti", onclick: () => { state.day = Object.assign({}, todayPlan(), { date: tk, plan: Array.from(chosen).slice(0, 5), morningDone: true }); morningOpen = false; save("day"); toast("Plan du jour enregistré. Une chose à la fois."); } });
    const later = h("button", { class: "btn", type: "button", text: "Plus tard", onclick: () => { state.day = Object.assign({}, todayPlan(), { date: tk, morningDone: true }); morningOpen = false; save("day"); } });
    right.append(h("div", { class: "btns" }, go, later));
    cols.append(left, mid, right); el.append(cols);
  }
  function renderEvening(el, d, items) {
    el.className = "tile ink s4 ritual";
    const tk = keyOf(today()), b = state.brief && state.brief.date === tk ? state.brief : null;
    const q = (b && b.question) || QUESTIONS[today().getDate() % QUESTIONS.length];
    el.append(h("div", { class: "rh" }, h("h2", { text: "Fermer ta journée" }), h("span", { class: "mono", style: "font-size:12px;color:#B8BCC6", text: "3 minutes · bilan, puis repos" })));
    const cols = h("div", { class: "cols" });
    const left = h("div", { class: "col" }, h("span", { class: "eyebrow", text: items.length ? "Ton plan du jour" : "Fait aujourd'hui" }));
    if (items.length) items.forEach((it) => left.append(h("div", { class: "pick", style: "cursor:default" }, h("button", { class: "box" + (it.done ? " on" : ""), type: "button", style: "color: var(--blue-soft)", "aria-label": (it.done ? "Rouvrir : " : "Fait : ") + it.title, onclick: () => it.toggle() }), h("span", { style: "flex:1" }, it.title, h("small", { text: it.done ? "fait" : it.sub })), !it.done && it.tomorrow ? h("button", { class: "btn outline sm", type: "button", text: "Demain", onclick: () => { it.tomorrow(); toast("Reportée à demain."); } }) : null)));
    else { const dn = state.tasks.filter((t) => t.done && t.doneAt === tk); left.append(h("span", { text: dn.length ? dn.map((t) => t.title).join(" · ") : "Rien de coché aujourd'hui, et c'est OK." })); }
    if (b && b.soir) { const br = h("div", { class: "brief" }); renderRich(br, b.soir); left.append(h("span", { class: "eyebrow", text: "Préparé ce soir" }), br); }
    const mid = h("div", { class: "col" }, h("span", { class: "eyebrow", text: "Habitudes et humeur" }));
    state.habits.forEach((x) => { const on = isDone(x.id, tk); mid.append(h("button", { class: "hab" + (on ? " on" : ""), type: "button", "aria-pressed": on ? "true" : "false", onclick: () => toggleHabit(x.id, tk) }, h("span", { class: "sq" }), h("span", { class: "n", text: x.name }))); });
    mid.append(moodRow("Humeur", "m"), moodRow("Énergie", "e"));
    const right = h("div", { class: "col" }, h("span", { class: "eyebrow", text: "Question du soir" }), h("strong", { text: q }));
    const ta = h("textarea", { class: "field", id: "rit-answer", rows: 3, placeholder: "Une ou deux phrases suffisent. Elles iront dans ton journal." });
    right.append(ta, agendaBox(1, "Demain"));
    right.append(h("div", { class: "btns" }, h("button", { class: "btn light", type: "button", text: "Fermer la journée", onclick: () => { const a = ta.value.trim(); if (a) capture(q + "\n" + a, "journal"); state.day = Object.assign({}, todayPlan(), { date: tk, evening: { done: true, question: q, answer: a } }); save("day"); toast("Journée bouclée. Bonne soirée."); } })));
    cols.append(left, mid, right); el.append(cols);
  }

  // ---------- Semaine ----------
  // ---------- Emploi du temps : programme 10 semaines (course + muscu), philo, repos, projet proposé ----------
  const PLAN_START = "2026-11-30", PLAN_WEEKS = 10;
  const PHILO_CYCLE = ["résumé en 3 phrases", "séance avec le Copilote", "entraînement dissertation"];
  // jours : 0 = dimanche … 6 = samedi (réponses du questionnaire du 24/11)
  const TPL = {
    1: [{ k: "repos", type: "repos", label: "Repos", sub: "Jour off : rien de lourd." }, { k: "philo", type: "philo", label: "Philo", sub: "lecture libre", time: "20:30", dur: 30 }],
    2: [{ k: "muscu", type: "sport", label: "Muscu", time: "18:45", dur: 75, edit: true }, { k: "projet", type: "projet" }],
    3: [{ k: "course", type: "sport", label: "Course", dur: 45 }, { k: "projet", type: "projet" }],
    4: [{ k: "muscu", type: "sport", label: "Muscu", time: "18:45", dur: 75, edit: true }, { k: "philo", type: "philo", label: "Philo", sub: "fiche de lecture", time: "20:30", dur: 30 }],
    5: [{ k: "course", type: "sport", label: "Course", dur: 45 }, { k: "projet", type: "projet" }],
    6: [{ k: "muscu", type: "sport", label: "Muscu", time: "18:45", dur: 75, edit: true }, { k: "philo", type: "philo", label: "Philo", sub: "cycle", time: "20:30", dur: 30 }],
    0: [{ k: "course", type: "sport", label: "Course", dur: 45 }, { k: "projet", type: "projet" }],
  };
  const PROJ_OK = /emm|garde|second|brain|ia\b|sport/i;
  function planWeekOf(d) { const n = Math.floor(daysBetween(parseKey(PLAN_START), d) / 7) + 1; return n >= 1 && n <= PLAN_WEEKS ? n : 0; }
  function planBlocks(d) {
    const w = planWeekOf(d); if (!w) return null;
    const k = keyOf(d), P = state.planning || {}, dow = d.getDay(), J = JOURS[dow];
    return (TPL[dow] || []).map((b) => {
      const key = k + ":" + b.k, o = { ...b, key, week: w, date: k };
      if (b.k === "philo" && b.sub === "cycle") o.sub = PHILO_CYCLE[(w - 1) % PHILO_CYCLE.length];
      const c = P.contenu && P.contenu["S" + w] && P.contenu["S" + w][J + "_" + b.k];
      if (c) o.sub = c; else if (b.type === "sport") o.sub = "contenu : photo du programme à venir";
      if (P.heures && P.heures[key]) o.time = P.heures[key];
      if (b.type === "projet") {
        const steps = []; state.goals.filter((g) => PROJ_OK.test(g.title || "") && !PHILO_RE.test(g.title || "")).forEach((g) => (g.steps || []).forEach((st) => { if (!st.done) steps.push({ g, st }); }));
        steps.sort((a, b2) => (b2.st.envie || 0) - (a.st.envie || 0));
        const top = steps[0];
        o.label = "Projet ?"; o.sub = top ? top.g.title + " · " + top.st.title : "Aucune étape ouverte"; o.ref = top ? { g: top.g, st: top.st } : null;
        const pr = P.projets && P.projets[k]; if (pr === "non") return null; if (pr === "oui") o.label = "Projet";
      }
      o.log = P.log && P.log[key];
      return o;
    }).filter(Boolean);
  }
  let edtWeek = 0, crKey = null;
  function savePlan(mut) { const P = clone(state.planning || {}); mut(P); state.planning = P; save("planning"); }
  function crForm(b) {
    const cur = { r: 0 }, f = h("form", { class: "cr", autocomplete: "off" });
    const lv = h("div", { class: "lvls", role: "group", "aria-label": "Ressenti de 1 à 5" });
    const drawLv = () => lv.replaceChildren(...[1, 2, 3, 4, 5].map((v) => h("button", { type: "button", "aria-pressed": cur.r === v ? "true" : "false", text: v, onclick: () => { cur.r = v; drawLv(); } })));
    drawLv();
    const a = h("input", { id: "cr-a-" + b.key, placeholder: b.k === "course" ? "Distance (km)" : b.k === "muscu" ? "Durée (min)" : "Durée (min)", inputmode: "decimal" });
    const c = h("input", { id: "cr-c-" + b.key, placeholder: b.k === "course" ? "Temps (ex. 28:40)" : b.k === "muscu" ? "Groupes travaillés" : "Pages / chapitre" });
    const n = h("textarea", { id: "cr-n-" + b.key, placeholder: b.k === "muscu" ? "Exercices et charges, ex. développé couché 4×8 à 50 kg" : "Ce qui s'est bien passé, ce qui a coincé" });
    f.append(h("span", { class: "eyebrow", text: "Compte rendu · ressenti" }), lv, h("div", { class: "row2" }, a, c), n,
      h("div", { class: "ba" }, h("button", { type: "submit", text: "Enregistrer" }), h("button", { type: "button", text: "Annuler", onclick: () => { crKey = null; renderEdt(); } })));
    f.addEventListener("submit", (e) => { e.preventDefault(); savePlan((P) => { P.log = P.log || {}; P.log[b.key] = { done: true, r: cur.r || null, a: a.value.trim().slice(0, 40), b: c.value.trim().slice(0, 80), note: n.value.trim().slice(0, 1000), type: b.k, at: new Date().toISOString() }; }); crKey = null; toast("Compte rendu enregistré."); });
    setTimeout(() => { const el = document.getElementById("cr-a-" + b.key); if (el) el.focus(); }, 30);
    return f;
  }
  function blkEl(b, isPast) {
    const done = b.log && b.log.done;
    const el = h("div", { class: "blk " + b.type + (done ? " done" : "") });
    const tm = b.edit && !done ? (() => { const i = h("input", { type: "time", value: b.time || "", "aria-label": "Heure de la séance du " + b.date }); i.addEventListener("change", () => savePlan((P) => { P.heures = P.heures || {}; if (i.value) P.heures[b.key] = i.value; else delete P.heures[b.key]; })); return h("span", { class: "tm" }, i); })() : h("span", { class: "tm", text: b.time ? b.time.replace(":", " h ") + (b.dur ? " · " + b.dur + " min" : "") : (b.type === "sport" ? "heure libre" : "") });
    el.append(...[h("div", { class: "bt" }, h("span", { text: b.label })), (b.edit && !done) || b.time || b.type === "sport" ? tm : null, b.sub ? h("div", { class: "sub", text: b.sub }) : null].filter(Boolean));
    if (done) el.append(h("span", { class: "ok", text: "✓ fait" + (b.log.r ? " · ressenti " + b.log.r + "/5" : "") + (b.log.a ? " · " + b.log.a : "") }));
    const ba = h("div", { class: "ba" });
    if (b.type === "projet") {
      const P = state.planning || {}, pr = P.projets && P.projets[b.date];
      if (pr !== "oui") ba.append(h("button", { type: "button", text: "Je le fais", onclick: () => savePlan((Q) => { Q.projets = Q.projets || {}; Q.projets[b.date] = "oui"; }) }), h("button", { type: "button", text: "Pas aujourd'hui", onclick: () => savePlan((Q) => { Q.projets = Q.projets || {}; Q.projets[b.date] = "non"; }) }));
      else if (b.ref && !done) ba.append(h("button", { type: "button", text: "Étape faite", onclick: () => { toggleStep(b.ref.g, b.ref.st); savePlan((Q) => { Q.log = Q.log || {}; Q.log[b.key] = { done: true, type: "projet", note: b.sub, at: new Date().toISOString() }; }); } }));
    } else if (b.type !== "repos") {
      if (!done && crKey !== b.key) ba.append(h("button", { type: "button", text: "Compte rendu", onclick: () => { crKey = b.key; renderEdt(); } }));
      if (done) ba.append(h("button", { type: "button", text: "Annuler", onclick: () => savePlan((P) => { if (P.log) delete P.log[b.key]; }) }));
    }
    if (ba.childNodes.length) el.append(ba);
    if (crKey === b.key) el.append(crForm(b));
    return el;
  }
  function weekStats(w) {
    let n = 0, d = 0; const m0 = addDays(parseKey(PLAN_START), 7 * (w - 1));
    for (let i = 0; i < 7; i++) (planBlocks(addDays(m0, i)) || []).forEach((b) => { if (b.type === "sport" || b.type === "philo") { n++; if (b.log && b.log.done) d++; } });
    return n ? d / n : 0;
  }
  function renderEdt() {
    const el = $("edt"), t0 = today(), tk = keyOf(t0), curW = planWeekOf(t0);
    if (!edtWeek) edtWeek = curW || 1;
    const m0 = addDays(parseKey(PLAN_START), 7 * (edtWeek - 1));
    const prog = h("div", { class: "prog", role: "group", "aria-label": "Semaines du programme" });
    for (let w = 1; w <= PLAN_WEEKS; w++) { const pc = Math.round(weekStats(w) * 100); prog.append(h("button", { class: "wk" + (w === curW ? " cur" : "") + (w === edtWeek ? " sel" : ""), type: "button", "aria-pressed": w === edtWeek ? "true" : "false", "aria-label": "Semaine " + w + ", " + pc + " % fait", onclick: () => { edtWeek = w; renderEdt(); } }, "S" + w, h("i", { style: "width:" + pc + "%" }))); }
    const grid = h("div", { class: "grid" });
    for (let i = 0; i < 7; i++) {
      const d = addDays(m0, i), k = keyOf(d), col = h("div", { class: "col" + (k === tk ? " today" : "") });
      col.append(h("div", { class: "ch" }, h("span", { text: JOURS_C[d.getDay()] + " " + d.getDate() }), h("span", { class: "mono", text: k === tk ? "auj." : short(d) })));
      if (d.getDay() >= 1 && d.getDay() <= 5) col.append(h("div", { class: "work", text: "Travail / école · 8 h – 17 h 30" }));
      (planBlocks(d) || []).sort((a, b) => ((a.type === "repos" ? 0 : a.type === "projet" ? 2 : 1) - (b.type === "repos" ? 0 : b.type === "projet" ? 2 : 1)) || ((a.time || "99") < (b.time || "99") ? -1 : 1)).forEach((b) => col.append(blkEl(b, k < tk)));
      grid.append(col);
    }
    const before = !curW && tk < PLAN_START;
    const stats = Math.round(weekStats(edtWeek) * 100);
    el.replaceChildren(...[
      h("div", { class: "th" }, h("h2", { id: "h-edt", text: "Emploi du temps · semaine " + edtWeek + " / " + PLAN_WEEKS }), h("span", { class: "mono", text: short(m0) + " → " + short(addDays(m0, 6)) + " · " + stats + " % fait" })),
      before ? h("div", { class: "hint", text: "Le programme démarre le lundi 30 novembre. Cette semaine : fin du programme course (5 km mercredi)." }) : null,
      prog,
      h("div", { class: "legend2" }, h("span", {}, h("i", { style: "background:var(--blue)" }), "Sport"), h("span", {}, h("i", { style: "background:var(--lilac)" }), "Philo"), h("span", {}, h("i", { style: "background:var(--sage)" }), "Repos"), h("span", {}, h("i", { style: "background:var(--peach)" }), "Projet proposé"),
        h("button", { class: "btn sm", type: "button", text: "Demander à Léon de caler la semaine dans l'agenda", onclick: () => agendaWeek(m0) })),
      grid].filter(Boolean));
  }
  function agendaWeek(m0) {
    const lines = [];
    for (let i = 0; i < 7; i++) { const d = addDays(m0, i); (planBlocks(d) || []).filter((b) => b.type === "sport" || b.type === "philo").forEach((b) => lines.push("- " + keyOf(d) + " " + (b.time ? b.time + " (" + (b.dur || 60) + " min)" : "heure libre") + " : " + b.label + (b.sub && !/photo/.test(b.sub) ? " · " + b.sub : ""))); }
    askLeon("Cale dans mon Google Agenda les séances de la semaine du " + short(m0) + " (rappel 30 min avant), si elles n'y sont pas déjà :\n" + lines.join("\n"));
  }
  let wkOffset = 0;
  $("wk-prev").addEventListener("click", () => { wkOffset--; renderWeek(); });
  $("wk-next").addEventListener("click", () => { wkOffset++; renderWeek(); });
  $("wk-now").addEventListener("click", () => { wkOffset = 0; renderWeek(); });
  function renderWeek() {
    const t0 = today(), tk = keyOf(t0), m0 = addDays(monday(t0), 7 * wkOffset), days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(m0, i));
    $("wk-range").textContent = short(days[0]) + " → " + short(days[6]);
    $("wk-title").textContent = "Semaine " + isoWeek(m0);
    $("wk-now").hidden = wkOffset === 0;
    const D = $("days"); D.replaceChildren();
    days.forEach((d) => {
      const k = keyOf(d), isT = k === tk, fut = k > tk;
      const done = state.tasks.filter((t) => t.done && t.doneAt === k);
      const due = state.tasks.filter((t) => !t.done && t.due === k);
      const lateHere = isT ? state.tasks.filter((t) => !t.done && t.due && t.due < tk) : [];
      const m = state.mood[k];
      const cls = "day" + (isT ? " today" : fut ? " future" : done.length ? " done" : "");
      const el = h("div", { class: cls }, h("div", { class: "dh" }, h("span", { class: "dn", text: d.getDate() }), h("span", { class: "mono", style: "font-size:11px", text: isT ? "AUJ." : JOURS[d.getDay()].toUpperCase() })));
      due.concat(lateHere).slice(0, 6).forEach((t) => el.append(h("span", { class: "it", style: isT ? "font-weight:600" : "", text: t.title })));
      done.slice(0, 6).forEach((t) => el.append(h("span", { class: "it d", text: t.title })));
      if (done.length + due.length + lateHere.length > 12) el.append(h("span", { class: "it", text: "…" }));
      if (!done.length && !due.length && !lateHere.length) el.append(h("span", { class: "it", style: "opacity:.7", text: fut ? "Libre" : "Rien de noté" }));
      const foot = h("div", { class: "foot" });
      if (done.length) foot.append(h("span", { class: "mono", style: "font-size:11.5px", text: done.length + " faite" + (done.length > 1 ? "s" : "") }));
      if (m && m.m) foot.append(h("span", { class: "chip", text: "humeur " + m.m }));
      if (foot.childNodes.length) el.append(foot);
      D.append(el);
    });
    // habits grid
    const G = $("hgrid"); G.replaceChildren(h("span"));
    days.forEach((d) => G.append(h("span", { class: "h" + (keyOf(d) === tk ? " now" : ""), text: JOURS[d.getDay()].slice(0, 1).toUpperCase() })));
    state.habits.forEach((x) => {
      G.append(h("span", { class: "n", text: x.name }));
      days.forEach((d) => { const k = keyOf(d), fut = k > tk, on = isDone(x.id, k); G.append(h("button", { class: "c" + (on ? " on" : "") + (fut ? " fut" : ""), type: "button", disabled: fut ? "" : false, "aria-pressed": on ? "true" : "false", "aria-label": x.name + " · " + short(d), onclick: () => toggleHabit(x.id, k) })); });
    });
    const habForm = h("form", { class: "form", style: "grid-column: 1 / -1; margin-top: 8px;", autocomplete: "off", onsubmit: (e) => { e.preventDefault(); const v = hin.value.trim(); if (!v) return; state.habits.push({ id: uid(), name: v.slice(0, 80) }); save("habits"); } });
    const hin = h("input", { class: "field grow", id: "hab-new", placeholder: "Nouvelle habitude…", "aria-label": "Nouvelle habitude" });
    habForm.append(hin, h("button", { class: "btn sm", type: "submit", text: "Ajouter" }));
    G.append(habForm);
    // left
    const open = openSorted(), late = open.filter((t) => t.due && t.due < tk);
    $("left-n").textContent = open.length;
    $("left-t").textContent = !open.length ? "Tout est fait." : late.length ? "dont " + late.length + " en retard : " + late.slice(0, 3).map((t) => t.title.split(/[(:]/)[0].trim()).join(", ") + "." : "Rien en retard.";
    // productivity chart
    const data = weekCounts(8), W = 240, H = 130, L = 18, R = 4, T = 10, B = 20;
    const top = Math.ceil(Math.max(4, ...data.map((x) => x.count)) / 2) * 2, y = (v) => T + (H - T - B) * (1 - v / top), bw = (W - L - R) / data.length;
    const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Tâches faites par semaine, 8 semaines" });
    [0, top].forEach((v) => { svg.append(s("line", { class: "gl", x1: L, x2: W - R, y1: y(v), y2: y(v) })); svg.append(s("text", { class: "ax", x: L - 5, y: y(v) + 3, "text-anchor": "end" }, v)); });
    data.forEach((d, i) => { const x = L + i * bw + bw * 0.2, w = bw * 0.6, cur = i === data.length - 1; svg.append(s("rect", { x, y: y(d.count), width: w, height: Math.max(0, y(0) - y(d.count)), rx: 3, fill: cur ? "var(--blue)" : "var(--ink)" })); if (d.count) svg.append(s("text", { class: "ax", x: x + w / 2, y: y(d.count) - 3, "text-anchor": "middle" }, d.count)); if (i % 2 === 1 || cur) svg.append(s("text", { class: "ax", x: x + w / 2, y: H - 6, "text-anchor": "middle" }, short(d.start))); });
    $("prod").replaceChildren(svg);
    // mood 30
    const W2 = 900, H2 = 170, L2 = 24, R2 = 10, T2 = 10, B2 = 22, N = 30;
    const x2 = (i) => L2 + (W2 - L2 - R2) * (i / (N - 1)), y2 = (v) => T2 + (H2 - T2 - B2) * (1 - (v - 1) / 4);
    const sv = s("svg", { class: "chart", viewBox: `0 0 ${W2} ${H2}`, role: "img", "aria-label": "Humeur et énergie, 30 jours" });
    for (let v = 1; v <= 5; v++) { sv.append(s("line", { class: "gl", x1: L2, x2: W2 - R2, y1: y2(v), y2: y2(v) })); sv.append(s("text", { class: "ax", x: L2 - 7, y: y2(v) + 3, "text-anchor": "end" }, v)); }
    const ds = []; for (let i = N - 1; i >= 0; i--) ds.push(addDays(t0, -i));
    ds.forEach((d, i) => { if (i % 7 === 1 || i === N - 1) sv.append(s("text", { class: "ax", x: x2(i), y: H2 - 6, "text-anchor": i === N - 1 ? "end" : "middle" }, i === N - 1 ? "auj." : short(d))); });
    const series = (f, color, dash) => {
      let p = "", prev = false, last = null;
      ds.forEach((d, i) => { const v = (state.mood[keyOf(d)] || {})[f]; if (v) { p += (prev ? "L" : "M") + x2(i).toFixed(1) + "," + y2(v).toFixed(1); prev = true; last = [x2(i), y2(v)]; } else prev = false; });
      if (p) sv.append(s("path", { d: p, fill: "none", stroke: color, "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round", "stroke-dasharray": dash || "none" }));
      ds.forEach((d, i) => { const v = (state.mood[keyOf(d)] || {})[f]; if (v) sv.append(s("circle", { cx: x2(i), cy: y2(v), r: 3, fill: color })); });
      if (last) sv.append(s("circle", { cx: last[0], cy: last[1], r: 5.5, fill: color, stroke: "var(--white)", "stroke-width": 2 }));
    };
    series("e", "var(--ink)", "5 4"); series("m", "var(--blue)");
    if (!ds.some((d) => state.mood[keyOf(d)])) sv.append(s("text", { class: "ax", x: W2 / 2, y: H2 / 2, "text-anchor": "middle", style: "font-size:12px" }, "Note ton humeur chaque jour pour voir ta tendance."));
    $("m30").replaceChildren(sv);
  }

  // ---------- Projets ----------
  const PCOL = ["peach", "sage", "lilac", ""];
  const KLAB = { achat: "à acheter", ref: "référence" };
  // Les photos sont des fichiers de l'artifact claude.ai : l'app ne peut pas les lire (v1). On indique seulement qu'il y en a.
  function photoThumbs(ids) {
    const n = (ids || []).length;
    return n ? h("span", { class: "phchip", title: "Visible dans le Cockpit en ligne", text: n + " photo" + (n > 1 ? "s" : "") + " · visible dans le Cockpit en ligne" }) : null;
  }

  function listSection(g) {
    const lst = g.list || [];
    const wrap = h("div", { style: "display:flex;flex-direction:column;gap:8px" }, h("span", { class: "eyebrow", style: "color: var(--ink)", text: "Achats et références" + (lst.length ? " · " + lst.filter((x) => !x.done).length + " en cours" : "") }));
    if (lst.length) {
      const ul = h("ul", { class: "plist" });
      lst.forEach((it) => ul.append(h("li", { class: it.done ? "done" : "" },
        h("button", { class: "box" + (it.done ? " on" : ""), type: "button", "aria-label": (it.done ? "Rouvrir : " : (it.kind === "achat" ? "Acheté : " : "Fait : ")) + it.title, onclick: () => { it.done = !it.done; save("goals"); } }),
        h("span", { class: "t" }, h("span", { class: "kchip " + (it.kind === "achat" ? "achat" : "ref"), text: KLAB[it.kind] || "référence" }), " ", it.title, it.note ? h("span", { class: "sub", text: it.note }) : null, it.photos && it.photos.length ? photoThumbs(it.photos.slice(0, 3)) : null),
        h("button", { class: "x", type: "button", "aria-label": "Retirer " + it.title, text: "✕", onclick: () => { g.list = lst.filter((x) => x !== it); save("goals"); } }))));
      wrap.append(ul);
    }
    const inp = h("input", { class: "field grow", id: "gl-" + g.id, placeholder: "Un livre, une référence, un achat…", "aria-label": "Ajouter à la liste de " + g.title });
    const sel = h("select", { class: "field", "aria-label": "Type" }, h("option", { value: "achat", text: "À acheter" }), h("option", { value: "ref", text: "Référence" }));
    wrap.append(h("form", { class: "form", autocomplete: "off", onsubmit: (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; g.list = lst.concat({ id: uid(), title: v.slice(0, 200), kind: sel.value, done: false }); save("goals"); setTimeout(() => { const el = $("gl-" + g.id); if (el) el.focus(); }, 0); } }, inp, sel, h("button", { class: "btn sm", type: "submit", text: "+" })));
    return wrap;
  }
  function shopItems() { const out = []; state.goals.forEach((g) => (g.list || []).forEach((it) => { if (it.kind === "achat" && !it.done) out.push({ g, it }); })); return out; }
  function renderShop() {
    const items = shopItems(); $("shop").hidden = !items.length;
    $("shop-list").replaceChildren(...items.map(({ g, it }) => h("li", null,
      h("button", { class: "box", type: "button", "aria-label": "Acheté : " + it.title, onclick: () => { it.done = true; save("goals"); toast("Coché : " + it.title.slice(0, 40)); } }),
      h("span", { class: "t" }, it.title, it.note ? h("span", { class: "sub", text: it.note }) : null),
      h("span", { class: "from", text: g.title, title: g.title }))));
  }
  $("shop-copy").addEventListener("click", () => {
    const txt = "Liste d'achats\n" + shopItems().map(({ g, it }) => "- " + it.title + (it.note ? " (" + it.note + ")" : "") + " · " + g.title).join("\n");
    try { navigator.clipboard.writeText(txt).then(() => toast("Liste copiée."), () => toast("Copie impossible ici : sélectionne la liste à la main.")); } catch (e) { toast("Copie impossible ici : sélectionne la liste à la main."); }
  });
  // ---------- envie 0-5 : 0 = pas noté ; plus c'est haut, plus la couleur est chaude ----------
  const ENVIE_COL = ["", "#9FB0FF", "#B7A9E8", "#8FC79E", "#F2B48A", "#E8695E"];
  const ENVIE_LAB = ["envie ?", "pas du tout", "bof", "ça va", "envie", "très envie"];
  function envieCtl(st) {
    const v = st.envie || 0, wrap = h("span", { class: "envie", role: "group", "aria-label": "Envie pour " + st.title });
    for (let i = 1; i <= 5; i++) wrap.append(h("button", { class: "ev", type: "button", style: i <= v ? "background:" + ENVIE_COL[v] : "", "aria-label": "Envie " + i + " sur 5 : " + ENVIE_LAB[i], "aria-pressed": i === v ? "true" : "false", title: ENVIE_LAB[i], onclick: () => { st.envie = v === i ? 0 : i; save("goals"); } }));
    wrap.append(h("span", { class: "evl", text: ENVIE_LAB[v] }));
    return wrap;
  }

  const AREAS = ["Études", "Administratif", "Argent", "Santé et sport", "Bien-être", "Lecture et philo", "Voyages", "Garde-robe et achats", "Projets perso et IA"];
  const lastSec = {};
  function ensureAreaList() {
    let dl = $("area-list"); if (!dl) { dl = h("datalist", { id: "area-list" }); document.body.append(dl); }
    dl.replaceChildren(...uniq(AREAS.concat(state.goals.map((g) => g.area).filter(Boolean))).map((a) => h("option", { value: a })));
  }
  function renderProjects() {
    renderShop();
    const C = $("pcards"); C.replaceChildren();
    const done = state.goals.filter((g) => (g.progress || 0) >= 100).length;
    $("prj-meta").textContent = state.goals.length ? state.goals.length + " projets · " + done + " terminé" + (done > 1 ? "s" : "") : "aucun projet";
    ensureAreaList();
    const anyArea = state.goals.some((g) => g.area), areaOrder = (a) => { const i = AREAS.indexOf(a); return a ? (i < 0 ? 50 : i) : 99; };
    const ordered = state.goals.map((g, gi) => ({ g, gi })).sort((a, b) => anyArea ? (areaOrder(a.g.area) - areaOrder(b.g.area)) || String(a.g.area || "").localeCompare(String(b.g.area || ""), "fr") || a.gi - b.gi : a.gi - b.gi);
    let curArea;
    ordered.forEach(({ g, gi }) => {
      if (anyArea && (g.area || "") !== curArea) { curArea = g.area || ""; const n = state.goals.filter((x) => (x.area || "") === curArea).length; C.append(h("h2", { class: "area-h" }, curArea || "Sans domaine", h("span", { class: "mono", text: n + " projet" + (n > 1 ? "s" : "") }))); }
      const steps = g.steps || [], linked = state.tasks.filter((t) => t.goal === g.id && !t.done);
      const pct = h("span", { class: "pct", text: (g.progress || 0) + "%" }), bar = h("div", { class: "pbar" }, h("i", { style: "width:" + (g.progress || 0) + "%" }));
      const card = h("section", { class: "tile pcard " + PCOL[gi % PCOL.length], "aria-label": g.title },
        h("div", { class: "th" }, h("h3", { text: g.title }), pct), bar);
      const ar = h("input", { class: "field area", list: "area-list", value: g.area || "", placeholder: "Domaine…", "aria-label": "Domaine de " + g.title, maxlength: 40 });
      ar.addEventListener("change", () => { const v = ar.value.trim(); if (v) g.area = v; else delete g.area; save("goals"); });
      card.append(ar);
      if (!steps.length) {
        const r = h("input", { type: "range", min: 0, max: 100, step: 5, value: g.progress || 0, id: "rg-" + g.id, "aria-label": "Avancement de " + g.title });
        r.addEventListener("input", () => { pct.textContent = r.value + "%"; bar.firstChild.style.width = r.value + "%"; });
        r.addEventListener("change", () => { g.progress = +r.value; save("goals"); });
        card.append(r, h("span", { class: "hint", text: "Avancement manuel. Ajoute des étapes pour qu'il se calcule tout seul." }));
      } else {
        const ul = h("ul", { class: "plist" }), secs = uniq([""].concat(steps.map((x) => x.section || "")));
        secs.forEach((sec) => { const grp = steps.filter((x) => (x.section || "") === sec); if (!grp.length) return; if (sec) ul.append(h("li", { class: "sec-h", text: sec + " · " + grp.filter((x) => x.done).length + "/" + grp.length }));
        grp.slice().sort((a, b) => (a.done - b.done) || ((b.doing ? 1 : 0) - (a.doing ? 1 : 0)) || ((b.envie || 0) - (a.envie || 0))).forEach((st) => ul.append(h("li", { class: st.done ? "done" : "" },
          h("button", { class: "box" + (st.done ? " on" : ""), type: "button", "aria-label": (st.done ? "Rouvrir : " : "Valider : ") + st.title, onclick: () => toggleStep(g, st) }),
          h("span", { class: "t" }, st.title, !st.done && st.doing ? h("span", { class: "tag doing", text: "en cours" }) : null, envieCtl(st)),
          h("span", { style: "display:flex" }, !st.done ? doingBtn(st, st.title, "goals") : null,
          h("button", { class: "x", type: "button", "aria-label": "Retirer l'étape " + st.title, text: "✕", onclick: () => { g.steps = steps.filter((x) => x !== st); if (g.steps.length) g.progress = stepPct(g.steps); save("goals"); } }))))); });
        card.append(ul);
      }
      const inp = h("input", { class: "field grow", id: "gs-" + g.id, placeholder: "Ajouter une étape…", "aria-label": "Nouvelle étape pour " + g.title });
      const secIn = h("input", { class: "field", style: "flex: 0 1 140px; min-width: 0", list: "sec-" + g.id, value: lastSec[g.id] || "", placeholder: "Section", "aria-label": "Section de la nouvelle étape (optionnel)", maxlength: 40 });
      card.append(h("datalist", { id: "sec-" + g.id }, ...uniq(steps.map((x) => x.section).filter(Boolean)).map((x) => h("option", { value: x }))));
      card.append(h("form", { class: "form", autocomplete: "off", onsubmit: (e) => { e.preventDefault(); const v = inp.value.trim(); if (!v) return; const sec = secIn.value.trim().slice(0, 40); lastSec[g.id] = sec; const st = { id: uid(), title: v.slice(0, 160), done: false }; if (sec) st.section = sec; g.steps = steps.concat(st); g.progress = stepPct(g.steps); save("goals"); setTimeout(() => { const el = $("gs-" + g.id); if (el) el.focus(); }, 0); } }, inp, secIn, h("button", { class: "btn sm", type: "submit", text: "+" })));
      card.append(listSection(g));

      if (linked.length) { const ul2 = h("ul", { class: "rows" }); linked.forEach((t) => ul2.append(taskRow(t))); card.append(h("span", { class: "eyebrow", style: "color: var(--ink)", text: linked.length + (linked.length > 1 ? " tâches liées" : " tâche liée") }), ul2); }
      card.append(h("div", { class: "btns" },
        h("button", { class: "btn sm", type: "button", text: "Demander à Léon", onclick: () => { const open = (g.steps || []).filter((x) => !x.done).map((x) => x.title); askLeon("Projet « " + g.title + " »" + (open.length ? " (étapes ouvertes : " + open.slice(0, 6).join(" ; ") + ")" : "") + " : aide-moi à "); } }),

        h("button", { class: "x", type: "button", text: "Supprimer le projet", onclick: (e) => armDelete(e.currentTarget, () => { state.goals = state.goals.filter((x) => x !== g); if (state.tasks.some((t) => t.goal === g.id)) { state.tasks.forEach((t) => { if (t.goal === g.id) t.goal = null; }); save("tasks"); } save("goals"); }) })));
      C.append(card);
    });
    if (!state.goals.length) C.append(h("div", { class: "empty", text: loaded ? "Aucun projet. Crée le premier ci-dessus." : "Chargement…" }));
  }
  $("goal-form").addEventListener("submit", (e) => { e.preventDefault(); const v = $("goal-title").value.trim(); if (!v) return; state.goals.push({ id: uid(), title: v.slice(0, 120), progress: 0 }); $("goal-title").value = ""; save("goals"); });

  // ---------- Notes ----------
  const KINDS = [["idee", "Idée"], ["tache", "Tâche"], ["journal", "Journal"], ["autre", "À ranger"]];
  let kind = "idee";
  function renderKinds() { $("kinds").replaceChildren(...KINDS.map(([k, l]) => h("button", { class: "kind k-" + k, type: "button", "aria-pressed": k === kind ? "true" : "false", text: l, onclick: () => { kind = k; renderKinds(); $("cap-hint").textContent = k === "tache" ? "Devient tout de suite une tâche du Cockpit." : "Sera rangé dans ton coffre à la revue du soir."; } }))); }
  function capture(text, k, opts) {
    opts = opts || {}; text = String(text || "").trim();
    const photos = (opts.photos || []).slice(0, 8), goal = opts.goal && state.goals.some((g) => g.id === opts.goal) ? opts.goal : null;
    if (!text && !photos.length) return null;
    if (k === "tache" && !photos.length) { const t = { id: uid(), title: text.slice(0, 200), prio: "moyenne", due: null, goal, done: false, doneAt: null, created: keyOf(today()) }; state.tasks.push(t); save("tasks"); return "tâche"; }
    const it = { id: uid(), text: text.slice(0, 4000), kind: k || "autre", created: new Date().toISOString() };
    if (goal) it.goal = goal; if (photos.length) it.photos = photos;
    state.inbox.push(it); save("inbox"); return "note";
  }
  const CAP_HINT = "Photos : pas encore dans l'app. Décris la photo en texte, ou envoie-la dans le Cockpit en ligne ou au bureau de Léon.";
  $("cap-save").addEventListener("click", () => {
    const text = $("cap-text").value, goal = $("cap-goal").value || null;
    if (!text.trim()) { $("cap-text").focus(); return; }
    const r = capture(text, kind, { goal });
    $("cap-text").value = ""; $("cap-hint").textContent = CAP_HINT;
    toast(r === "tâche" ? "Tâche ajoutée." : "Capturé.");
  });
  function renderNotes() {
    const L = $("inbox"); L.replaceChildren();
    const items = state.inbox.slice().reverse();
    $("inbox-n").textContent = items.length ? items.length + " en attente" : "";
    $("inbox-hint").hidden = !items.length;
    const lab = { idee: "Idée", journal: "Journal", autre: "À ranger", tache: "Tâche" };
    items.forEach((n) => {
      const g = n.goal && state.goals.find((x) => x.id === n.goal);
      L.append(h("div", { class: "note" },
        h("span", { class: "chip", style: n.kind === "journal" ? "background: var(--sage)" : n.kind === "autre" ? "background: var(--paper); border: 1px solid var(--ink)" : n.kind === "tache" ? "background: var(--peach)" : "", text: lab[n.kind] || "Note" }),
        h("div", null,
          n.text ? h("div", { class: "txt", text: n.text }) : null,
          n.photos && n.photos.length ? photoThumbs(n.photos) : null,
          h("div", { class: "meta", text: [n.created ? new Date(n.created).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "", g ? "projet : " + g.title : ""].filter(Boolean).join(" · ") }),
          null),
        h("button", { class: "x", type: "button", "aria-label": "Supprimer cette note", text: "✕", onclick: (e) => armDelete(e.currentTarget, () => { state.inbox = state.inbox.filter((x) => x !== n); save("inbox"); }) })));
    });
    if (!items.length) L.append(h("div", { class: "empty", text: "Rien en attente. Tout est rangé." }));
  }

  // ---------- Équipe : Léon (manager) délègue à ses services ; les routines traitent les tickets ----------
  const TEAM = [
    { k: "leon", nom: "Léon", role: "Directeur de compte : reçoit, délègue, contrôle, rend compte", modele: "Opus 5.5", lead: true },
    { k: "margaux", nom: "Margaux", role: "Études et alternance · prof particulière", modele: "Sonnet 5.5 par défaut" },
    { k: "bastien", nom: "Bastien", role: "Admin et finances · comptable rigoureux", modele: "Sonnet 5.5 par défaut" },
    { k: "nadia", nom: "Nadia", role: "Santé et sport · coach directe", modele: "Sonnet 5.5 par défaut" },
    { k: "simone", nom: "Simone", role: "Philo et mental · socratique", modele: "Sonnet 5.5 par défaut" },
    { k: "theo", nom: "Théo", role: "Projets et achats · chasseur de bonnes affaires", modele: "Sonnet 5.5 par défaut" },
    { k: "auditeur", nom: "L'Auditeur", role: "Contrôle qualité : relit admin, argent, cours", modele: "Opus 5.5" },
    { k: "archiviste", nom: "L'Archiviste", role: "Tri, classement, copies du coffre", modele: "Haiku 5.5" },
    { k: "hugo", nom: "Hugo", role: "Développeur du Cockpit · améliore, teste, publie", modele: "Sonnet 5.5 · Opus 5.5 pour une refonte" },
  ];
  const GRADES = { stagiaire: ["Stagiaire", "Haiku 5.5"], charge: ["Chargé de mission", "Sonnet 5.5"], expert: ["Expert", "Opus 5.5"], associe: ["Associé", "Fable 5.2"], manager: ["Léon", "Opus 5.5"] };
  const ST_L = { nouveau: "Nouveau", en_cours: "En cours", attente: "Attend ta réponse", fait: "Fait", annule: "Annulé" };
  let eqTab = "ouverts";
  const tickets = () => (state.equipe && Array.isArray(state.equipe.tickets) ? state.equipe.tickets : []);
  const isOpenT = (t) => t.statut !== "fait" && t.statut !== "annule";
  const agentOf = (k) => TEAM.find((a) => a.k === k);
  const nowIso = () => new Date().toISOString();
  const fmtAt = (v) => { if (!v) return ""; const d = new Date(v); return isNaN(d) ? String(v).slice(0, 10) : d.toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  function armConfirm(btn, fn) { if (btn.classList.contains("arm")) { fn(); return; } btn.classList.add("arm"); const was = btn.textContent; btn.textContent = "Confirmer ?"; setTimeout(() => { btn.classList.remove("arm"); btn.textContent = was; }, 3000); }
  function logT(t, txt) { t.maj = nowIso(); (t.journal = Array.isArray(t.journal) ? t.journal : []).push({ at: t.maj, qui: "Evan", txt }); }
  function newTicket(text, due, src) {
    text = String(text || "").trim(); if (!text) return null;
    if (!state.equipe) state.equipe = { tickets: [] }; if (!Array.isArray(state.equipe.tickets)) state.equipe.tickets = [];
    const n = tickets().reduce((m, t) => Math.max(m, Number(t.n) || 0), 0) + 1;
    const t = { id: uid(), n, demande: text.slice(0, 2000), statut: "nouveau", created: nowIso(), due: /^\d{4}-\d{2}-\d{2}$/.test(due || "") ? due : null, source: src || "app" };
    logT(t, "Demande envoyée"); state.equipe.tickets.push(t); save("equipe"); return t;
  }
  // remplace les boutons du copilote : prépare une demande à Léon, qu'Evan complète puis envoie (ticket « nouveau », source « app »)
  function askLeon(prefill) {
    if (location.hash !== "#equipe") location.hash = "equipe";
    setTimeout(() => { const ta = $("eq-text"); ta.value = prefill; ta.focus(); try { ta.setSelectionRange(prefill.length, prefill.length); } catch (e) { /* rien */ } ta.scrollIntoView({ block: "center" }); }, 40);
  }
  function ticketEl(t) {
    const a = agentOf(t.service), g = GRADES[t.grade];
    const meta = h("div", { class: "meta" },
      h("span", { class: "st-chip st-" + (ST_L[t.statut] ? t.statut : "nouveau"), text: ST_L[t.statut] || "Nouveau" }),
      h("span", { text: a ? a.nom : "service à choisir" }),
      g ? h("span", { class: "gr-chip", text: g[0] + " · " + g[1] }) : null,
      t.controle ? h("span", { text: "contrôlé par l'Auditeur" }) : null,
      t.due ? h("span", { text: "pour le " + short(parseKey(t.due)) }) : null,
      h("span", { text: "maj " + fmtAt(t.maj || t.created) }));
    const body = h("div", null, h("div", { class: "dm", text: t.demande || "" }), meta);
    if (t.rapport) { const r = h("div", { class: "rap" }); renderRich(r, t.rapport); body.append(r); }
    if (t.statut === "attente" && t.question) {
      const ta = h("textarea", { class: "field", rows: 2, placeholder: "Ta réponse…", "aria-label": "Réponse au ticket " + t.n });
      body.append(h("div", { class: "ask" }, h("strong", { text: (a ? a.nom : "Léon") + " te demande : " + t.question }), ta,
        h("div", { class: "btns", style: "margin-top:0" }, h("button", { class: "btn primary sm", type: "button", text: "Répondre", onclick: () => { const v = ta.value.trim(); if (!v) { ta.focus(); return; } t.reponse = v.slice(0, 2000); t.statut = "en_cours"; logT(t, "Réponse : " + (v.length > 200 ? v.slice(0, 200) + "…" : v)); save("equipe"); toast("Réponse transmise à " + (a ? a.nom : "Léon") + "."); } }))));
    }
    const acts = h("span", { style: "display:flex" });
    if (isOpenT(t)) acts.append(h("button", { class: "x", type: "button", "aria-label": "Annuler le ticket " + t.n, text: "Annuler", onclick: (e) => armConfirm(e.currentTarget, () => { t.statut = "annule"; logT(t, "Ticket annulé"); save("equipe"); }) }));
    return h("div", { class: "tkt" }, h("span", { class: "num", text: "#" + (t.n || "?") }), body, acts);
  }
  function renderEquipe() {
    const all = tickets(), open = all.filter(isOpenT), wait = open.filter((t) => t.statut === "attente");
    const b = $("eq-badge"); b.hidden = !wait.length; b.textContent = wait.length ? String(wait.length) : "";
    if (view !== "equipe") return;
    $("eq-meta").textContent = open.length + " ticket" + (open.length > 1 ? "s" : "") + " ouvert" + (open.length > 1 ? "s" : "") + (wait.length ? " · " + wait.length + " attend" + (wait.length > 1 ? "ent" : "") + " ta réponse" : "");
    const done = all.filter((t) => t.statut === "fait");
    const tabs = [["ouverts", "Ouverts", open.length], ["attente", "Attendent ta réponse", wait.length], ["faits", "Faits", done.length], ["tous", "Tous", all.length]];
    $("eq-tabs").replaceChildren(...tabs.map(([k, l, n]) => h("button", { class: "kind", type: "button", "aria-pressed": eqTab === k ? "true" : "false", onclick: () => { eqTab = k; renderEquipe(); } }, l, n ? h("span", { class: "n", text: n }) : null)));
    const order = { attente: 0, nouveau: 1, en_cours: 2, fait: 3, annule: 4 };
    const shown = (eqTab === "ouverts" ? open : eqTab === "attente" ? wait : eqTab === "faits" ? done : all).slice().sort((x, y) => ((order[x.statut] ?? 1) - (order[y.statut] ?? 1)) || String(y.maj || y.created || "").localeCompare(String(x.maj || x.created || "")));
    $("eq-n").textContent = all.length ? all.length + " au total" : "";
    const L = $("eq-list"); L.replaceChildren(...shown.slice(0, 60).map(ticketEl));
    if (!shown.length) L.append(h("div", { class: "empty", text: !loaded ? "Chargement…" : eqTab === "attente" ? "Personne n'attend de réponse de ta part." : all.length ? "Rien dans cette liste." : "Aucun ticket. Écris ta première demande à Léon ci-dessus." }));
    const com = state.equipe && state.equipe.comite;
    $("eq-com-d").textContent = com && com.date ? "du " + short(parseKey(com.date)) : "dimanche soir";
    if (com && com.texte) renderRich($("eq-com"), com.texte); else $("eq-com").replaceChildren(h("span", { class: "hint", text: "Le premier comité aura lieu dimanche soir : bilan de chaque service, tickets ouverts, décisions à prendre, budget IA." }));
    const since = new Date(Date.now() - 7 * 864e5).toISOString(), cnt = {};
    all.filter((t) => t.grade && t.statut !== "nouveau" && (t.maj || t.created || "") >= since).forEach((t) => (cnt[t.grade] = (cnt[t.grade] || 0) + 1));
    const max = Math.max(1, ...Object.values(cnt)), bud = h("div", { class: "budget" });
    ["stagiaire", "charge", "expert", "associe"].forEach((k) => bud.append(h("span", { text: GRADES[k][0] + " · " + GRADES[k][1] }), h("span", { class: "bar" }, h("i", { style: "width:" + Math.round(((cnt[k] || 0) / max) * 100) + "%" })), h("span", { class: "mono", text: cnt[k] || 0 })));
    const note = state.equipe && state.equipe.budget && state.equipe.budget.note;
    $("eq-bud").replaceChildren(bud, h("span", { class: "hint", text: note || "Règle : le grade le plus bas qui peut réussir. Associé (Fable 5.2) : 2 fois par semaine au plus, avec une raison." }));
    $("eq-team").replaceChildren(...TEAM.map((a) => { const n = open.filter((t) => t.service === a.k).length; return h("div", { class: "agent" + (a.lead ? " lead" : "") }, h("div", { class: "an" }, h("span", { text: a.nom }), h("span", { class: "mono", text: n ? n + " en cours" : "" })), h("div", { class: "ar", text: a.role }), h("div", { class: "am", text: a.modele })); }));
    const j = []; all.forEach((t) => (Array.isArray(t.journal) ? t.journal : []).forEach((e) => j.push({ t, e })));
    j.sort((x, y) => String(y.e.at || "").localeCompare(String(x.e.at || "")));
    const J = $("eq-jrn"); J.replaceChildren(...j.slice(0, 15).map(({ t, e }) => h("li", null, h("span", { class: "tm", text: fmtAt(e.at) }), h("span", { text: "#" + t.n + " · " + (e.qui ? e.qui + " : " : "") + String(e.txt || "") }))));
    if (!j.length) J.append(h("li", { class: "hint", style: "display:block", text: "Rien pour l'instant." }));
  }
  $("eq-send").addEventListener("click", () => { const t = newTicket($("eq-text").value, $("eq-due").value); if (!t) { $("eq-text").focus(); return; } $("eq-text").value = ""; $("eq-due").value = ""; toast("Ticket #" + t.n + " envoyé à Léon."); });
  function inline(el, str) {
    const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s)<>\]]+)/g; let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) el.append(str.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith("**")) el.append(h("strong", { text: tok.slice(2, -2) }));
      else { let host = ""; try { host = new URL(tok).hostname; } catch (e) { host = ""; }
        const okHost = (d) => host === d || host.endsWith("." + d);
        if (tok.startsWith("https://") && ["google.com", "notion.so", "notion.com", "lastminute.com"].some(okHost)) el.append(h("a", { href: tok, target: "_blank", rel: "noopener noreferrer", text: host === "mail.google.com" ? "ouvrir dans Gmail" : host === "calendar.google.com" ? "ouvrir dans l'agenda" : okHost("lastminute.com") ? "voir sur lastminute.com" : okHost("notion.so") || okHost("notion.com") ? "ouvrir dans Notion" : host }));
        else el.append(tok); }
      last = m.index + tok.length;
    }
    if (last < str.length) el.append(str.slice(last));
  }
  function renderRich(el, text) {
    el.replaceChildren(); let ul = null;
    String(text || "").split("\n").forEach((line) => {
      const m = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (m) { if (!ul) { ul = h("ul"); el.append(ul); } const li = h("li"); inline(li, m[1]); ul.append(li); }
      else { ul = null; if (line.trim()) { const p = h("p"); inline(p, line.replace(/^\s*#+\s*/, "")); el.append(p); } }
    });
  }

  // ---------- Réglages : jeton GitHub et état de la synchro ----------
  const APP_VERSION = "1.0.6";
  const fmtFull = (v) => { if (!v) return "jamais"; const d = new Date(v); return isNaN(d) ? v : d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
  function renderSettings() {
    const st = Store.status(), cfg = Store.getSettings();
    $("set-st").textContent = st.text;
    $("tok-st").textContent = cfg.hasToken ? "jeton enregistré" : "aucun jeton";
    $("set-kv").replaceChildren(
      h("dt", { text: "État" }), h("dd", { text: st.text }),
      h("dt", { text: "Dernière synchro" }), h("dd", { text: fmtFull(st.lastSync) }),
      h("dt", { text: "En attente" }), h("dd", { text: st.pending ? st.pending + " document" + (st.pending > 1 ? "s" : "") + " à envoyer" : "rien" }),
      h("dt", { text: "Réseau" }), h("dd", { text: navigator.onLine ? "en ligne" : "hors ligne" }),
      h("dt", { text: "Dépôt" }), h("dd", { text: cfg.configured ? cfg.owner + "/" + cfg.repo + " · " + cfg.branch + " · " + cfg.dir : "à configurer" }));
    ["owner", "repo", "branch", "dir"].forEach((k) => { const el = $("set-" + k); if (document.activeElement !== el) el.value = cfg[k]; });
    $("set-token").placeholder = cfg.hasToken ? "•••••••• (jeton enregistré, laisse vide pour le garder)" : "github_pat_…";
    $("app-ver").textContent = "version " + APP_VERSION;
  }
  const formSettings = () => { const o = { owner: $("set-owner").value, repo: $("set-repo").value, branch: $("set-branch").value, dir: $("set-dir").value }; const t = $("set-token").value.trim(); if (t) o.token = t; return o; };
  const showRes = (ok, text) => $("set-res").replaceChildren(h("div", { class: "res " + (ok ? "ok" : "ko"), text }));
  $("set-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const s = formSettings(); if (!s.token && !Store.getSettings().hasToken) { showRes(false, "Colle d'abord ton jeton."); $("set-token").focus(); return; }
    if (!String(s.owner || "").trim() || !String(s.repo || "").trim()) { showRes(false, "Indique le propriétaire et le nom de ton dépôt de données privé."); return; }
    showRes(true, "Enregistré. Synchronisation…");
    const r = await Store.saveSettings(s);
    if (r && r.ok === false) { showRes(false, r.text); return; }
    $("set-token").value = ""; const st = Store.status();
    showRes(st.level === "ok", st.level === "ok" ? "Enregistré. Données à jour." : st.text);
  });
  $("set-test").addEventListener("click", async () => { showRes(true, "Test en cours…"); const r = await Store.testToken(formSettings()); showRes(r.ok, r.text); });
  $("set-sync").addEventListener("click", () => { Store.sync().then(() => toast(Store.status().text)); });
  $("set-forget").addEventListener("click", (e) => armConfirm(e.currentTarget, async () => { const r = await Store.forgetDevice(); if (r && r.ok === false) { showRes(false, r.text); return; } $("set-res").replaceChildren(); toast("Jeton et copie locale effacés (copie archivée sur l'appareil)."); render(); }));

  // ---------- boot ----------
  renderKinds();
  Store.on("status", setSync);
  Store.on("change", (n, data) => { applyDoc(n, data); renderKeep(); });
  window.addEventListener("hashchange", route);
  Store.init().then((docs) => {
    DOCS.forEach((n) => applyDoc(n, docs[n]));
    loaded = true; route(); setSync(Store.status());
    Store.sync();
  }).catch((e) => { console.error(e); setSync({ level: "err", text: "Stockage local indisponible" }); loaded = true; route(); });
  let dayKey = keyOf(today());
  setInterval(() => { if (keyOf(today()) !== dayKey) { dayKey = keyOf(today()); skipped.clear(); render(); } }, 60000);

  // ---------- installation et mises à jour (service worker) ----------
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("Service worker", e));
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) $("update").hidden = false; });
  }
  $("update-go").addEventListener("click", () => { Store.flushNow(); setTimeout(() => location.reload(), 300); });
})();
