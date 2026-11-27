/* Sport · appli séparée (lot 1 : muscu et course).
 * Données : document « planning » du dépôt privé (le même que le Cockpit), clé de séance "AAAA-MM-JJ:muscu|course".
 * Une séance = une seule entrée planning.log[clé] (un seul historique, lu par le Cockpit et recopié par la revue du soir).
 * Champs historiques gardés et remplis : {done, r, a, b, note, type, at}. Ajouts (facultatifs) de l'appli Sport :
 *   sid (identifiant de séance, évite les doublons), source: "sport"|"sante", hors (séance hors planning), douleur,
 *   muscu  : debut, fin, duree (min), exos:[{id, nom, series:[{id, reps, kg}]}]
 *   course : duree_s, distance (km), allure ("m:ss" par km), fc (bpm)
 * Séance hors planning : clé du jour si elle est libre, avec hors: true. Deuxième séance du même type le même jour : clé "AAAA-MM-JJ:course:2"
 * (le Cockpit l'ignore, l'historique la montre). Limite connue : deux appareils hors ligne qui enregistrent la même clé le même jour
 * seraient fusionnés en une seule séance à la synchronisation (cas rare, documenté).
 * Séance en cours (muscu) : brouillon sur l'appareil (localStorage), écrit dans le dépôt seulement à « Terminer ». */
(function () {
  "use strict";
  const APP_VERSION = "0.1.0";
  const S = self.CockpitStore;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; for (const x of crypto.getRandomValues(new Uint8Array(8))) s += a[x % 36]; return s; };
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const today = () => keyOf(new Date());
  const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const fdate = (k) => parseKey(k).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const fshort = (k) => parseKey(k).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ":" + pad(m) : m) + ":" + pad(s); };
  const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) ? n : null; };
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* pas de stockage : rien */ } }, del(k) { try { localStorage.removeItem(k); } catch (e) { /* idem */ } } };

  // ---------- planning (mêmes règles que le Cockpit) ----------
  const PLAN_START = "2026-11-30", PLAN_WEEKS = 10;
  const PREVU = { 1: "repos", 2: "muscu", 3: "course", 4: "muscu", 5: "course", 6: "muscu", 0: "course" };
  function prevu(k) { const n = Math.floor((parseKey(k) - parseKey(PLAN_START)) / 864e5); if (n < 0 || n >= PLAN_WEEKS * 7) return null; return PREVU[parseKey(k).getDay()]; }
  let P = { log: {} };
  const log = () => (P && P.log) || {};
  const typeOf = (k, e) => (e && e.type) || k.split(":")[1];
  const isSport = (k, e) => { const t = typeOf(k, e); return t === "muscu" || t === "course"; };
  function findSid(sid) { return Object.keys(log()).find((k) => log()[k] && log()[k].sid === sid) || null; }
  // clé libre pour une nouvelle séance : la clé du jour si elle est libre, sinon :2, :3…
  function freeKey(date, type) { let k = date + ":" + type, n = 2; while (log()[k] && log()[k].done) k = date + ":" + type + ":" + n++; return k; }
  function saveSession(entry) {
    // idempotent : une séance déjà écrite (même sid) n'est jamais écrite deux fois
    const exist = findSid(entry.sid); if (exist) return exist;
    const date = entry.date, key = freeKey(date, entry.type);
    const doc = S.get("planning") || {}; doc.log = doc.log || {};
    const again = Object.keys(doc.log).find((k) => doc.log[k] && doc.log[k].sid === entry.sid); if (again) return again;
    delete entry.date; if (prevu(date) !== entry.type || key !== date + ":" + entry.type) entry.hors = true;
    doc.log[key] = entry; P = doc; S.set("planning", doc);
    return key;
  }

  // ---------- Henri (garde-fou sécurité, médecin du sport fictif) : jamais d'avis médical ----------
  function henriMuscu(exos, douleur) {
    const out = [];
    if (douleur) out.push("Douleur signalée : on ne monte pas les charges à la prochaine séance. Si elle persiste ou t'inquiète, consulte un médecin.");
    exos.forEach((x) => {
      const max = Math.max(0, ...x.series.map((s) => num(s.kg) || 0)); if (!max) return;
      const prev = lastMax(x.nom); if (prev && max > prev * 1.1) out.push(x.nom + " : +" + Math.round((max / prev - 1) * 100) + " % de charge depuis la dernière fois. Henri conseille des paliers de 2,5 kg (5 à 10 % au plus).");
    });
    return out;
  }
  function lastMax(nom) {
    const n = nom.trim().toLowerCase(); let best = null, bestAt = "";
    Object.entries(log()).forEach(([k, e]) => { if (!e || !Array.isArray(e.exos)) return; const x = e.exos.find((y) => (y.nom || "").trim().toLowerCase() === n); if (x && k > bestAt) { bestAt = k; best = Math.max(0, ...x.series.map((s) => num(s.kg) || 0)); } });
    return best;
  }
  function henriCourse(date, dist, douleur) {
    const out = [];
    if (douleur) out.push("Douleur signalée : prochaine sortie plus courte et plus lente. Si elle persiste ou t'inquiète, consulte un médecin.");
    const lim = parseKey(date) - 28 * 864e5; let max = 0;
    Object.entries(log()).forEach(([k, e]) => { if (typeOf(k, e) !== "course" || !e) return; const d = parseKey(k.slice(0, 10)); const km = num(e.distance != null ? e.distance : e.a); if (d >= lim && d < parseKey(date) && km) max = Math.max(max, km); });
    if (dist && max && dist > max * 1.3) out.push("Sortie de " + dist + " km, contre " + max + " km au plus ces 4 dernières semaines : Henri conseille d'augmenter d'environ 10 % par semaine.");
    return out;
  }

  // ---------- muscu en cours : brouillon sur l'appareil ----------
  const DRAFT = "sport-muscu";
  let draft = null, timer = null;
  const reposDef = () => store.get("sport-repos", 90);
  function saveDraft() { if (draft) store.set(DRAFT, draft); }
  function startMuscu(date) {
    const d0 = store.get(DRAFT, null);
    if (d0 && d0.sid) { draft = d0; go("muscu"); return; }
    draft = { sid: uid(), date: date || today(), debut: new Date().toISOString(), exos: [], repos: null };
    saveDraft(); go("muscu");
  }
  let audio = null;
  function unlockAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (e) { audio = null; } }
  function bip() { try { if (!audio || document.visibilityState !== "visible") return; [0, 0.25, 0.5].forEach((t) => { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.15); }); } catch (e) { /* pas de son */ } }
  function restLeft() { return draft && draft.repos ? Math.max(0, (draft.repos.fin - Date.now()) / 1000) : 0; }
  function startRest(sec) { draft.repos = { fin: Date.now() + sec * 1000, dur: sec, vibre: false }; saveDraft(); tick(); }

  // ---------- rendu ----------
  let view = "jour", current = null;
  function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600); }
  function render() {
    $$(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.v === (view === "seance" ? "historique" : view === "muscu" || view === "course" ? "jour" : view)));
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    ({ jour: rJour, muscu: rMuscu, course: rCourse, historique: rHisto, seance: rSeance, reglages: rReglages })[view]();
  }

  function rJour() {
    const t = today(), pv = prevu(t), d0 = store.get(DRAFT, null);
    const fait = Object.keys(log()).filter((k) => k.startsWith(t + ":") && isSport(k, log()[k]) && log()[k].done);
    let h = '<h1 class="cap">' + esc(fdate(t)) + "</h1>";
    if (d0 && d0.sid) h += '<div class="card hero"><p class="eyebrow">Séance en cours' + (d0.date !== t ? " · commencée " + esc(fshort(d0.date)) : "") + '</p><h2>Muscu · ' + d0.exos.length + " exercice" + (d0.exos.length > 1 ? "s" : "") + '</h2><a class="btn big primary" href="#muscu" id="j-reprendre">Reprendre la séance</a>' + (d0.date !== t ? '<button class="btn" type="button" id="j-jeter">Jeter cette ancienne séance</button>' : "") + "</div>";
    else if (pv === "muscu") h += '<div class="card hero"><p class="eyebrow">Séance prévue</p><h2>Muscu</h2>' + (fait.some((k) => typeOf(k) === "muscu") ? '<p class="ok">✓ Faite aujourd\'hui</p>' : '<button class="btn big primary" type="button" data-go="muscu">Commencer la muscu</button>') + "</div>";
    else if (pv === "course") h += '<div class="card hero"><p class="eyebrow">Séance prévue</p><h2>Course</h2>' + (fait.some((k) => typeOf(k) === "course") ? '<p class="ok">✓ Faite aujourd\'hui</p>' : '<button class="btn big primary" type="button" data-go="course">Enregistrer la course</button>') + "</div>";
    else h += '<div class="card hero"><p class="eyebrow">' + (pv === "repos" ? "Lundi : repos" : t < PLAN_START ? "Le programme commence le 30 novembre" : "Pas de séance prévue") + "</p><h2>" + (pv === "repos" ? "Récupération" : "Séance libre") + "</h2></div>";
    h += '<div class="card"><p class="eyebrow">Hors planning</p><div class="row"><button class="btn big" type="button" data-go="muscu-hors">Muscu</button><button class="btn big" type="button" data-go="course-hors">Course</button></div></div>';
    if (fait.length) h += '<div class="card"><p class="eyebrow">Aujourd\'hui</p>' + fait.map(lineHtml).join("") + "</div>";
    $("#jour").innerHTML = h;
    const jt = $("#j-jeter"); if (jt) jt.addEventListener("click", () => { if (!confirm("Jeter la séance commencée " + fshort(d0.date) + " ?")) return; store.del(DRAFT); draft = null; rJour(); });
    $$("#jour [data-go]").forEach((b) => b.addEventListener("click", () => { const g = b.dataset.go; if (g.startsWith("muscu")) startMuscu(today()); else { courseSid = null; go("course"); } }));
  }

  function rMuscu() {
    if (!draft) draft = store.get(DRAFT, null);
    if (!draft) { $("#muscu").innerHTML = '<p class="empty">Pas de séance en cours. <a href="#jour">Retour</a></p>'; return; }
    const noms = Array.from(new Set(Object.values(log()).flatMap((e) => (e && Array.isArray(e.exos) ? e.exos.map((x) => x.nom) : [])))).slice(0, 40);
    let h = '<div class="mhead"><h1>Muscu</h1><span class="chrono" id="m-chrono"></span></div>';
    h += draft.exos.map((x, i) => {
      const last = x.series[x.series.length - 1] || { reps: 10, kg: 20 };
      return '<div class="card exo" data-i="' + i + '"><div class="exo-top"><h2>' + esc(x.nom) + '</h2><button class="lnk" type="button" data-delexo="' + i + '" aria-label="Retirer ' + esc(x.nom) + '">Retirer</button></div>' +
        (x.series.length ? '<ol class="series">' + x.series.map((s, j) => '<li><span class="sn">' + (j + 1) + '</span><b>' + esc(s.reps) + " × " + esc(s.kg) + ' kg</b><button class="lnk" type="button" data-delser="' + i + ":" + j + '" aria-label="Supprimer la série ' + (j + 1) + '">✕</button></li>').join("") + "</ol>" : '<p class="hint">Pas encore de série.</p>') +
        '<div class="saisie"><div class="step"><span>Répétitions</span><div class="ctl"><button type="button" class="pm" data-step="reps:-1:' + i + '" aria-label="Moins une répétition">−</button><input inputmode="numeric" id="reps-' + i + '" value="' + esc(last.reps) + '" aria-label="Répétitions"><button type="button" class="pm" data-step="reps:1:' + i + '" aria-label="Plus une répétition">+</button></div></div>' +
        '<div class="step"><span>Charge (kg)</span><div class="ctl"><button type="button" class="pm" data-step="kg:-2.5:' + i + '" aria-label="Moins 2,5 kg">−</button><input inputmode="decimal" id="kg-' + i + '" value="' + esc(last.kg) + '" aria-label="Charge en kg"><button type="button" class="pm" data-step="kg:2.5:' + i + '" aria-label="Plus 2,5 kg">+</button></div></div></div>' +
        '<button class="btn big primary" type="button" data-addser="' + i + '">+ Série ' + (x.series.length + 1) + "</button></div>";
    }).join("");
    h += '<form class="card" id="m-exo"><label for="m-nom">Nouvel exercice</label><input id="m-nom" list="m-noms" maxlength="60" placeholder="Ex. développé couché" autocomplete="off"><datalist id="m-noms">' + noms.map((n) => '<option value="' + esc(n) + '">').join("") + '</datalist><button class="btn big" type="submit">Ajouter l\'exercice</button></form>';
    h += '<div class="card" id="m-fin"><button class="btn big" type="button" id="m-terminer">Terminer la séance</button><button class="lnk" type="button" id="m-abandon">Abandonner la séance (rien n\'est enregistré)</button></div>';
    h += '<div class="rest" id="m-rest" hidden><div><span class="eyebrow">Repos</span><span class="rest-t" id="m-rest-t" aria-live="polite">0:00</span></div><div class="row"><button class="btn" type="button" data-rest="-15">−15 s</button><button class="btn" type="button" data-rest="15">+15 s</button><button class="btn" type="button" data-rest="stop">Passer</button></div></div>';
    $("#muscu").innerHTML = h;
    $$("#muscu [data-step]").forEach((b) => b.addEventListener("click", () => { const [f, dv, i] = b.dataset.step.split(":"); const inp = $("#" + f + "-" + i); const v = (num(inp.value) || 0) + Number(dv); inp.value = Math.max(0, f === "reps" ? Math.round(v) : Math.round(v * 10) / 10); }));
    $$("#muscu [data-addser]").forEach((b) => b.addEventListener("click", () => {
      const i = Number(b.dataset.addser), reps = Math.round(num($("#reps-" + i).value) || 0), kg = num($("#kg-" + i).value) || 0;
      if (!reps) { toast("Indique le nombre de répétitions"); return; }
      unlockAudio();
      draft.exos[i].series.push({ id: uid(), reps, kg }); saveDraft(); startRest(reposDef()); rMuscu(); toast("Série enregistrée · repos " + mmss(reposDef()));
    }));
    $$("#muscu [data-delser]").forEach((b) => b.addEventListener("click", () => { const [i, j] = b.dataset.delser.split(":").map(Number); draft.exos[i].series.splice(j, 1); saveDraft(); rMuscu(); }));
    $$("#muscu [data-delexo]").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.delexo); if (draft.exos[i].series.length && !confirm("Retirer " + draft.exos[i].nom + " et ses séries ?")) return; draft.exos.splice(i, 1); saveDraft(); rMuscu(); }));
    $("#m-exo").addEventListener("submit", (e) => { e.preventDefault(); const nom = $("#m-nom").value.trim(); if (!nom) return; draft.exos.push({ id: uid(), nom, series: [] }); saveDraft(); rMuscu(); });
    $$("#muscu [data-rest]").forEach((b) => b.addEventListener("click", () => { if (!draft.repos) return; const v = b.dataset.rest; if (v === "stop") draft.repos = null; else draft.repos.fin += Number(v) * 1000; saveDraft(); tick(); }));
    $("#m-terminer").addEventListener("click", () => { if (!draft.exos.some((x) => x.series.length)) { toast("Aucune série : ajoute une série, ou abandonne la séance"); return; } finishForm("muscu"); });
    $("#m-abandon").addEventListener("click", () => { if (!confirm("Abandonner la séance ? Les séries saisies ne seront pas enregistrées.")) return; store.del(DRAFT); draft = null; $("#muscu").innerHTML = ""; toast("Séance abandonnée"); go("jour"); });
    tick();
  }

  // panneau de fin (muscu et course) : ressenti facultatif, douleur (Henri), note
  function finishForm(kind) {
    const box = kind === "muscu" ? $("#m-fin") : $("#c-fin");
    box.innerHTML = '<p class="eyebrow">Ressenti (facultatif)</p><div class="seg" id="f-r" role="group" aria-label="Ressenti de 1 à 5">' + [1, 2, 3, 4, 5].map((v) => '<button type="button" data-r="' + v + '" aria-pressed="false">' + v + "</button>").join("") + "</div>" +
      '<label class="chk"><input type="checkbox" id="f-douleur"> J\'ai eu une douleur</label><label for="f-note">Note (facultatif)</label><textarea id="f-note" rows="2" maxlength="600"></textarea>' +
      '<button class="btn big primary" type="button" id="f-ok">' + (kind === "muscu" ? "Enregistrer la séance" : "Enregistrer la sortie") + "</button>";
    let r = null;
    $$("#f-r [data-r]", box).forEach((b) => b.addEventListener("click", () => { r = r === Number(b.dataset.r) ? null : Number(b.dataset.r); $$("#f-r [data-r]", box).forEach((x) => x.setAttribute("aria-pressed", String(Number(x.dataset.r) === r))); }));
    $("#f-ok").addEventListener("click", (e) => {
      const btn = e.currentTarget; if (btn.disabled) return; btn.disabled = true; // un double appui ne crée rien de plus
      const douleur = $("#f-douleur").checked, note = $("#f-note").value.trim();
      if (kind === "muscu") finishMuscu(r, douleur, note); else finishCourse(r, douleur, note);
    });
    box.scrollIntoView({ block: "center" });
  }
  function finishMuscu(r, douleur, note) {
    const d = draft, fin = new Date(), duree = Math.min(300, Math.max(1, Math.round((fin - new Date(d.debut)) / 60000)));
    const exos = d.exos.filter((x) => x.series.length);
    const conseils = henriMuscu(exos, douleur);
    const entry = { done: true, type: "muscu", sid: d.sid, source: "sport", date: d.date, r: r || null, a: String(duree), b: exos.map((x) => x.nom).join(", ").slice(0, 80), note: note.slice(0, 600), at: fin.toISOString(), debut: d.debut, fin: fin.toISOString(), duree, exos };
    if (douleur) entry.douleur = true;
    const key = saveSession(entry);
    store.del(DRAFT); draft = null; $("#muscu").innerHTML = "";
    henriPending = conseils; go("seance/" + key);
  }

  // ---------- course ----------
  let courseSid = null, henriPending = null;
  function parseImport(txt) {
    const t = String(txt || "").trim(); if (!t) return null;
    const out = {};
    const dur = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return v; const p = String(v).split(":").map(Number); if (p.some(isNaN)) return num(v); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; };
    try {
      const j = JSON.parse(t);
      out.date = (j.date || j.start || j.debut || "").slice(0, 10) || null;
      out.duree_s = j.duree_s != null ? num(j.duree_s) : j.duration_s != null ? num(j.duration_s) : j.duree_min != null ? num(j.duree_min) * 60 : j.duration_min != null ? num(j.duration_min) * 60 : dur(j.duree || j.duration);
      let km = j.distance_km != null ? num(j.distance_km) : num(j.distance); if (km && km > 100) km = km / 1000; out.distance = km;
      out.fc = num(j.fc != null ? j.fc : j.hr != null ? j.hr : j.heart_rate);
    } catch (e) {
      const p = t.split(/[;\t\n]/).map((x) => x.trim());
      if (p.length < 3) return null;
      out.date = /^\d{4}-\d{2}-\d{2}/.test(p[0]) ? p[0].slice(0, 10) : null; out.duree_s = dur(p[1]); let km = num(p[2]); if (km && km > 100) km = km / 1000; out.distance = km; out.fc = num(p[3]);
    }
    return out.duree_s || out.distance ? out : null;
  }
  function rCourse() {
    if (!courseSid) courseSid = uid();
    $("#course").innerHTML = '<h1>Course</h1>' +
      '<form class="card" id="c-form" autocomplete="off">' +
      '<label for="c-date">Date</label><input type="date" id="c-date" value="' + today() + '">' +
      '<p class="lab">Durée</p><div class="dur"><label><input inputmode="numeric" id="c-h" placeholder="0" aria-label="Heures"><span>h</span></label><label><input inputmode="numeric" id="c-m" placeholder="30" aria-label="Minutes"><span>min</span></label><label><input inputmode="numeric" id="c-s" placeholder="00" aria-label="Secondes"><span>s</span></label></div>' +
      '<label for="c-km">Distance (km)</label><input inputmode="decimal" id="c-km" placeholder="5,0">' +
      '<label for="c-fc">Fréquence cardiaque moyenne (facultatif)</label><input inputmode="numeric" id="c-fc" placeholder="bpm">' +
      '<div class="allure"><span class="eyebrow">Allure moyenne</span><b id="c-allure">–</b></div>' +
      '<p class="hint" id="c-hors"></p></form>' +
      '<details class="card" id="c-import"><summary>Importer depuis Apple Santé (Raccourci)</summary><p class="hint">Le raccourci iPhone « Course vers Sport » copie ta dernière sortie. Touche « Coller », ou colle le texte ici.</p><textarea id="c-paste" rows="2" placeholder=\'{"date":"2026-12-02","duree_s":1935,"distance_km":5.2,"fc":148}\'></textarea><div class="row"><button class="btn" type="button" id="c-coller">Coller</button><button class="btn" type="button" id="c-lire">Remplir</button></div></details>' +
      '<div class="card" id="c-fin"><button class="btn big primary" type="button" id="c-suivant">Terminer la sortie</button></div>';
    const upd = () => {
      const s = (num($("#c-h").value) || 0) * 3600 + (num($("#c-m").value) || 0) * 60 + (num($("#c-s").value) || 0), km = num($("#c-km").value);
      $("#c-allure").textContent = s && km ? mmss(s / km) + " /km" : "–";
      const d = $("#c-date").value, pv = d && prevu(d);
      $("#c-hors").textContent = d && pv !== "course" ? "Sortie hors planning (" + (pv === "repos" ? "jour de repos" : pv === "muscu" ? "jour de muscu" : "hors programme") + ") : elle sera rangée dans ton historique." : "";
    };
    $$("#c-form input").forEach((i) => i.addEventListener("input", upd)); upd();
    const fill = (o) => { if (!o) { toast("Texte non reconnu"); return; } if (o.date) $("#c-date").value = o.date; if (o.duree_s) { const s = Math.round(o.duree_s); $("#c-h").value = Math.floor(s / 3600) || ""; $("#c-m").value = Math.floor((s % 3600) / 60); $("#c-s").value = pad(s % 60); } if (o.distance) $("#c-km").value = String(Math.round(o.distance * 100) / 100).replace(".", ","); if (o.fc) $("#c-fc").value = Math.round(o.fc); importSrc = "sante"; upd(); toast("Sortie importée : vérifie puis enregistre"); };
    $("#c-lire").addEventListener("click", () => fill(parseImport($("#c-paste").value)));
    $("#c-coller").addEventListener("click", async () => { try { const t = await navigator.clipboard.readText(); $("#c-paste").value = t; fill(parseImport(t)); } catch (e) { toast("Colle le texte dans la case, puis « Remplir »"); } });
    $("#c-suivant").addEventListener("click", () => {
      const s = (num($("#c-h").value) || 0) * 3600 + (num($("#c-m").value) || 0) * 60 + (num($("#c-s").value) || 0), km = num($("#c-km").value);
      if (!$("#c-date").value || !s || !km) { toast("Il faut la date, la durée et la distance"); return; }
      finishForm("course");
    });
  }
  let importSrc = "sport";
  function finishCourse(r, douleur, note) {
    const s0 = (num($("#c-h").value) || 0) * 3600 + (num($("#c-m").value) || 0) * 60 + (num($("#c-s").value) || 0), km0 = num($("#c-km").value);
    if (!$("#c-date").value || !s0 || !km0) { toast("Il faut la date, la durée et la distance"); const b = $("#f-ok"); if (b) b.disabled = false; return; }
    const date = $("#c-date").value, s = Math.round((num($("#c-h").value) || 0) * 3600 + (num($("#c-m").value) || 0) * 60 + (num($("#c-s").value) || 0)), km = Math.round(num($("#c-km").value) * 100) / 100, fc = num($("#c-fc").value);
    const conseils = henriCourse(date, km, douleur);
    const entry = { done: true, type: "course", sid: courseSid, source: importSrc, date, r: r || null, a: String(km), b: mmss(s), note: note.slice(0, 600), at: new Date().toISOString(), duree_s: s, distance: km, allure: mmss(s / km) };
    if (fc) entry.fc = Math.round(fc);
    if (douleur) entry.douleur = true;
    const key = saveSession(entry); courseSid = null; importSrc = "sport"; $("#course").innerHTML = "";
    henriPending = conseils; go("seance/" + key);
  }

  // ---------- historique et détail ----------
  function resume(k, e) {
    const t = typeOf(k, e);
    if (t === "muscu") { if (Array.isArray(e.exos)) { const n = e.exos.reduce((a, x) => a + x.series.length, 0); return e.exos.length + " exercice" + (e.exos.length > 1 ? "s" : "") + " · " + n + " série" + (n > 1 ? "s" : "") + (e.duree ? " · " + e.duree + " min" : ""); } return [e.a ? e.a + " min" : "", e.b].filter(Boolean).join(" · "); }
    const km = e.distance != null ? e.distance : num(e.a); return [km ? String(km).replace(".", ",") + " km" : "", e.b || "", e.allure ? e.allure + " /km" : ""].filter(Boolean).join(" · ");
  }
  function lineHtml(k) { const e = log()[k]; return '<a class="ligne" href="#seance/' + esc(encodeURIComponent(k)) + '"><span class="tag tag-' + esc(typeOf(k, e)) + '">' + (typeOf(k, e) === "muscu" ? "Muscu" : "Course") + "</span><span><b>" + esc(fshort(k.slice(0, 10))) + "</b><span class=\"meta\">" + esc(resume(k, e)) + (e.hors ? " · hors planning" : "") + "</span></span></a>"; }
  function rHisto() {
    const ks = Object.keys(log()).filter((k) => log()[k] && log()[k].done && isSport(k, log()[k])).sort().reverse();
    $("#histo").innerHTML = ks.length ? '<div class="card">' + ks.map(lineHtml).join("") + "</div>" : '<p class="empty">Pas encore de séance enregistrée.</p>';
  }
  function rSeance() {
    const k = current, e = log()[k];
    if (!e) { $("#seance").innerHTML = '<p class="empty">Séance introuvable. <a href="#historique">Historique</a></p>'; return; }
    const t = typeOf(k, e);
    let h = '<a class="back-l" href="#historique">← Historique</a><h1>' + (t === "muscu" ? "Muscu" : "Course") + '</h1><p class="meta">' + esc(fdate(k.slice(0, 10))) + (e.hors ? " · hors planning" : "") + (e.source === "sante" ? " · importée d'Apple Santé" : "") + "</p>";
    if (henriPending && henriPending.length) h += '<div class="card henri"><p class="eyebrow">Henri · sécurité</p>' + henriPending.map((x) => "<p>" + esc(x) + "</p>").join("") + "</div>";
    henriPending = null;
    if (t === "muscu") {
      h += '<div class="card"><div class="kpis"><div><span class="eyebrow">Durée</span><b>' + esc(e.duree ? e.duree + " min" : e.a ? e.a + " min" : "–") + '</b></div><div><span class="eyebrow">Ressenti</span><b>' + esc(e.r ? e.r + "/5" : "–") + "</b></div></div></div>";
      if (Array.isArray(e.exos)) h += e.exos.map((x) => '<div class="card"><h2>' + esc(x.nom) + '</h2><ol class="series">' + x.series.map((s, j) => '<li><span class="sn">' + (j + 1) + "</span><b>" + esc(s.reps) + " × " + esc(s.kg) + " kg</b></li>").join("") + "</ol></div>").join("");
      else if (e.b) h += '<div class="card"><p>' + esc(e.b) + "</p></div>";
    } else {
      const km = e.distance != null ? e.distance : num(e.a);
      h += '<div class="card"><div class="kpis"><div><span class="eyebrow">Distance</span><b>' + esc(km ? String(km).replace(".", ",") + " km" : "–") + '</b></div><div><span class="eyebrow">Durée</span><b>' + esc(e.b || (e.duree_s ? mmss(e.duree_s) : "–")) + '</b></div><div><span class="eyebrow">Allure</span><b id="s-allure">' + esc(e.allure ? e.allure + " /km" : "–") + "</b></div>" + (e.fc ? '<div><span class="eyebrow">FC moy.</span><b>' + esc(e.fc) + " bpm</b></div>" : "") + '<div><span class="eyebrow">Ressenti</span><b>' + esc(e.r ? e.r + "/5" : "–") + "</b></div></div></div>";
    }
    if (e.douleur) h += '<div class="card henri"><p>Douleur signalée pendant cette séance.</p></div>';
    if (e.note) h += '<div class="card"><p class="eyebrow">Note</p><p class="pre">' + esc(e.note) + "</p></div>";
    h += '<p class="hint">Copiée dans Obsidian (Notes/Seances.md) par la revue du soir.</p>';
    $("#seance").innerHTML = h;
  }

  function rReglages() {
    const st = S.status(), s = S.getSettings();
    $("#set-dot").className = "dot " + st.level; $("#set-status").textContent = st.text;
    $("#set-repo").textContent = s.configured ? "Dépôt : " + s.owner + "/" + s.repo + " · branche " + s.branch + " · dossier " + s.dir + (s.hasToken ? " · jeton présent" : " · jeton manquant") : "Aucun dépôt réglé.";
    $("#set-repos").innerHTML = [60, 90, 120, 180].map((v) => '<button type="button" data-rd="' + v + '" aria-pressed="' + (reposDef() === v) + '">' + mmss(v) + "</button>").join("");
    $$("#set-repos [data-rd]").forEach((b) => b.addEventListener("click", () => { store.set("sport-repos", Number(b.dataset.rd)); rReglages(); }));
    $("#ver").textContent = "Sport " + APP_VERSION + " · lot 1 (muscu et course)";
  }

  // ---------- minuteur : calculé depuis l'heure de fin, donc juste après un changement d'appli ou un écran verrouillé ----------
  function tick() {
    const rest = $("#m-rest"), ch = $("#m-chrono");
    if (draft && ch) ch.textContent = mmss((Date.now() - new Date(draft.debut)) / 1000);
    if (!rest) return;
    if (!draft || !draft.repos) { rest.hidden = true; return; }
    const left = restLeft(); rest.hidden = false; $("#m-rest-t").textContent = left > 0 ? mmss(left) : "C'est reparti";
    rest.classList.toggle("fini", left <= 0);
    if (left <= 0 && !draft.repos.vibre) { draft.repos.vibre = true; saveDraft(); bip(); try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* rien */ } }
  }

  function go(v) { if (location.hash !== "#" + v) location.hash = v; else route(); }
  function route() {
    let v = (location.hash || "#jour").slice(1); try { v = decodeURIComponent(v); } catch (e) { v = "jour"; }
    current = null; if (v.startsWith("seance/")) { current = v.slice(7); v = "seance"; }
    view = $('.view[data-view="' + v + '"]') ? v : "jour"; render(); window.scrollTo(0, 0);
  }

  (async function start() {
    window.addEventListener("hashchange", route);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
    setInterval(tick, 250);
    $("#set-import").addEventListener("click", async () => { $("#set-msg").textContent = "…"; const r = await S.useSettingsFrom("cockpit-app"); $("#set-msg").textContent = r.ok ? "Réglages repris du Cockpit." : r.text; rReglages(); });
    $("#set-sync").addEventListener("click", async () => { await S.sync(); rReglages(); });
    S.on("change", (n, data) => { if (n === "planning") { P = data || { log: {} }; if (view !== "muscu" && view !== "course") render(); } });
    S.on("status", (st) => { $("#sync-dot").className = "dot " + st.level; $("#sync-t").textContent = st.text; if (view === "reglages") rReglages(); });
    const snap = await S.init(); P = snap.planning || { log: {} }; draft = store.get(DRAFT, null);
    route(); S.sync();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
