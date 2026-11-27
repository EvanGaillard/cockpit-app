/* Académie · écrans (lot 1 : socle).
 * Données : document « academie » du dépôt privé (synchro par ../store.js, fusion par ../merge.js).
 * {maj, bureau, matieres:[{id,nom,prof,couleur,maison,ordre}], devoirs:[{id,titre,matiere,prof,due,source,docs,statut,manque,rendu,tache,created,maj}],
 *  seances:[{id,date,matiere,prof,mode,duree,bilan,suite,note,maj}], idees:[{id,texte,created,statut,reponse,maj}], prochaine:{matiere,raison,date}}
 * Format de référence : tableau des documents du CLAUDE.md du coffre (dépôt privé).
 * L'IA n'est pas dans l'app : les profs travaillent dans le bureau de Margaux et écrivent ce document avec ldata. */
(function () {
  "use strict";
  const APP_VERSION = "0.1.1";
  const S = self.CockpitStore;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => { const a = "abcdefghijklmnopqrstuvwxyz0123456789"; let s = ""; const r = crypto.getRandomValues(new Uint8Array(8)); for (const x of r) s += a[x % 36]; return s; };
  const now = () => new Date().toISOString();
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const days = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
  const fdate = (d) => { if (!d) return ""; const x = new Date(d.slice(0, 10) + "T12:00:00"); return x.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }); };
  const bureau = () => (A.bureau && /^https:\/\/claude\.ai\//.test(A.bureau) ? A.bureau : "https://claude.ai/code"); // lien du bureau de Margaux : dans le document privé, jamais dans ce code public
  const col = (c) => (/^#[0-9a-fA-F]{3,8}$/.test(c || "") ? c : "#CBD2D9"); // couleur validée avant d'aller dans un style

  // Matières par défaut (cadrage du 27/11/2026). Le document peut les compléter ou les modifier (même id).
  const BASE_MATS = [
    { id: "philo", nom: "Philosophie", prof: "Nour", couleur: "#F2A7C3", maison: "Chalet-bibliothèque", ordre: 1, actif: true },
    { id: "iut", nom: "IUT · maths, physique, métrologie", prof: "Victor", couleur: "#8FB8E8", maison: "Observatoire", ordre: 2 },
    { id: "anglais", nom: "Anglais", prof: "Ingrid", couleur: "#F2C66D", maison: "Maison anglaise", ordre: 3 },
    { id: "darija", nom: "Darija", prof: "Yasmine", couleur: "#E89A6B", maison: "Riad", ordre: 4 },
    { id: "energie", nom: "Énergie et nucléaire", prof: "Étienne", couleur: "#F6A04D", maison: "Éolienne et petite centrale", ordre: 5 },
    { id: "environnement", nom: "Environnement et climat", prof: "Leïla", couleur: "#7CC6A4", maison: "Cabane de chercheuse", ordre: 6 },
    { id: "ia", nom: "IA et code", prof: "Nils", couleur: "#9B8CE8", maison: "Atelier high-tech", ordre: 7 },
    { id: "eloquence", nom: "Éloquence et écriture", prof: "Lucien", couleur: "#D96C7F", maison: "Petit théâtre", ordre: 8 },
    { id: "economie", nom: "Économie et finance", prof: "Bernard", couleur: "#C9A46C", maison: "Banque ancienne", ordre: 9 },
    { id: "geopolitique", nom: "Géopolitique", prof: "Patrick", couleur: "#6FB7C9", maison: "Maison au globe", ordre: 10 },
    { id: "methode", nom: "Méthode", prof: "Jules", couleur: "#A3ABBA", maison: "Dojo", ordre: 11 },
    { id: "musique", nom: "Musique", prof: "Julien", couleur: "#C58FD6", maison: "Maison du musicien", ordre: 12 },
    { id: "sport", nom: "Sport", prof: "Karim et Sofia", couleur: "#8FD07A", maison: "Terrain", ordre: 13 },
  ];
  const STATUTS = { nouveau: "Repéré", attribue: "Attribué", premier_rendu: "Premier rendu prêt", retravail: "À retravailler", rendu: "Rendu", annule: "Annulé" };
  const OPEN = (d) => d.statut !== "rendu" && d.statut !== "annule";

  let A = { matieres: [], devoirs: [], seances: [], idees: [] };
  let view = "accueil", filter = "ouverts";

  function mats() {
    const byId = {}; BASE_MATS.forEach((m) => (byId[m.id] = Object.assign({}, m)));
    (A.matieres || []).forEach((m) => { if (m && m.id) byId[m.id] = Object.assign({}, byId[m.id] || {}, m); });
    return Object.values(byId).sort((a, b) => (a.ordre || 99) - (b.ordre || 99));
  }
  // Équipe active (décision d'Evan du 27/11) : Nour seulement. Un document peut activer une matière (actif: true).
  const actif = (m) => m.actif === true;
  const profDe = (m) => (actif(m) ? m.prof : "Margaux"); // prof pas encore arrivé : Margaux s'en charge
  const mat = (id) => mats().find((m) => m.id === id) || { id, nom: id || "Sans matière", prof: "Margaux", couleur: "#CBD2D9" };

  function save(mut) {
    const d = S.get("academie") || {}; ["matieres", "devoirs", "seances", "idees"].forEach((k) => { if (!Array.isArray(d[k])) d[k] = []; });
    mut(d); d.maj = now(); A = d; S.set("academie", d); render();
  }
  function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2600); }

  // ---------- la recommandation de l'accueil ----------
  function lastSeance(mid) { return (A.seances || []).filter((s) => s.matiere === mid).map((s) => s.date).sort().pop() || null; }
  function recommend() {
    const t = today();
    const open = (A.devoirs || []).filter(OPEN).filter((d) => d.due).sort((a, b) => a.due.localeCompare(b.due));
    const urgent = open.find((d) => days(t, d.due) <= 7);
    if (urgent) {
      const n = days(t, urgent.due);
      return { kind: "devoir", matiere: urgent.matiere, titre: urgent.titre, raison: n < 0 ? "Échéance dépassée de " + -n + " j : on fait le point, sans paniquer." : n === 0 ? "C'est pour aujourd'hui." : "À rendre dans " + n + " j.", devoir: urgent };
    }
    const p = A.prochaine;
    if (p && p.matiere && p.date && days(p.date, t) <= 2) return { kind: "margaux", matiere: p.matiere, titre: "Séance proposée par Margaux", raison: p.raison || "" };
    // matière délaissée : la plus longtemps sans séance, la philo d'abord à égalité (priorité n°1)
    const list = mats().filter((m) => m.id !== "sport" && actif(m)).map((m) => ({ m, last: lastSeance(m.id) }));
    list.sort((a, b) => (a.last || "0000") .localeCompare(b.last || "0000") || (a.m.ordre - b.m.ordre));
    const pick = list[0];
    return { kind: "delaissee", matiere: pick.m.id, titre: "Une séance de " + pick.m.nom.split(" · ")[0].toLowerCase(), raison: pick.last ? "Dernière séance il y a " + days(pick.last, t) + " j." : "Pas encore de séance : on commence en douceur, 20 minutes." };
  }
  function seancePrompt(r, mode) {
    const m = mat(r.matiere);
    return "Margaux, lance une séance de " + m.nom + " avec " + profDe(m) + ", à l'" + (mode === "oral" ? "oral" : "écrit") + ", 20 minutes. " + (r.kind === "devoir" ? "Sujet : le devoir « " + r.titre + " ». " : "") + "Commence par un petit résumé de là où j'en suis, puis termine par un bilan, la prochaine étape et la note de suivi dans Obsidian.";
  }

  // ---------- rendu ----------
  function render() {
    $$(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.v === view));
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    const open = (A.devoirs || []).filter(OPEN);
    const b = $("#dv-badge"); b.hidden = !open.length; b.textContent = open.length;
    ({ accueil: rAccueil, devoirs: rDevoirs, matieres: rMatieres, seances: rSeances, idees: rIdees, reglages: rReglages })[view]();
  }

  function rAccueil() {
    const h = new Date().getHours();
    $("#greet").textContent = (h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir") + " Evan · Margaux et l'équipe";
    const r = recommend(), m = mat(r.matiere);
    $("#reco").innerHTML = '<div class="card reco" style="--c:' + esc(col(m.couleur)) + '">' +
      '<div class="reco-top"><span class="chip" style="background:' + esc(col(m.couleur)) + '">' + esc(m.nom.split(" · ")[0]) + '</span><span class="who">avec ' + esc(r.kind === "devoir" && r.devoir.prof ? r.devoir.prof : profDe(m)) + '</span></div>' +
      '<h1>' + esc(r.titre) + '</h1><p class="why">' + esc(r.raison) + '</p>' +
      '<div class="row"><button class="btn primary" type="button" data-start="oral">Commencer à l\'oral</button><button class="btn" type="button" data-start="ecrit">À l\'écrit</button><button class="btn ghost" type="button" data-done>J\'ai fait une séance</button></div>' +
      '<p class="hint">« Commencer » copie la demande pour Margaux et ouvre son bureau : colle-la, ou dis-la au micro.</p></div>';
    $$("#reco [data-start]").forEach((btn) => btn.addEventListener("click", async () => {
      const txt = seancePrompt(r, btn.dataset.start);
      try { await navigator.clipboard.writeText(txt); toast("Demande copiée : colle-la dans le bureau de Margaux"); } catch (e) { toast("Copie impossible : écris « " + m.prof + ", séance de " + m.nom.split(" · ")[0] + " »"); }
      window.open(bureau(), "_blank", "noopener");
    }));
    $("#reco [data-done]").addEventListener("click", () => { go("seances"); openSeance(r.matiere); });
    const nx = (A.devoirs || []).filter(OPEN).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999")).slice(0, 4);
    $("#next-dv").innerHTML = nx.length ? nx.map(dvLine).join("") : '<p class="empty">Rien à rendre pour l\'instant. Odile surveille tes mails et Moodle.</p>';
    // équilibre : minutes par matière sur 14 jours
    const t = today(), mins = {};
    (A.seances || []).forEach((s) => { if (s.date && days(s.date.slice(0, 10), t) <= 14) mins[s.matiere] = (mins[s.matiere] || 0) + (Number(s.duree) || 0); });
    const max = Math.max(30, ...Object.values(mins));
    $("#balance").innerHTML = '<div class="bars">' + mats().map((x) => '<div class="bar" title="' + esc(x.nom + " : " + (mins[x.id] || 0) + " min") + '"><span style="height:' + Math.max(6, Math.round(((mins[x.id] || 0) / max) * 100)) + '%;background:' + esc(col(x.couleur)) + '"></span><i>' + esc(x.nom.slice(0, 3)) + '</i></div>').join("") + '</div>';
    const mots = ["« Ce n'est pas une note, c'est une boussole. » · Clément", "« Commence par ce qui te donne envie. » · Jules", "« Une séance ratée ne se rattrape pas : on reprend demain. » · Samuel", "« La pensée a une histoire : on la suit pas à pas. » · Nour"];
    $("#mot").innerHTML = '<p class="quote">' + esc(mots[new Date().getDate() % mots.length]) + "</p>";
  }

  function dvLine(d) {
    const m = mat(d.matiere), t = today(), n = d.due ? days(t, d.due) : null;
    const when = d.due ? (n < 0 ? "en retard de " + -n + " j" : n === 0 ? "aujourd'hui" : n === 1 ? "demain" : fdate(d.due)) : "sans date";
    return '<div class="dv" style="--c:' + esc(col(m.couleur)) + '"><div><b>' + esc(d.titre) + '</b><span class="meta">' + esc(m.nom.split(" · ")[0]) + " · " + esc(d.prof || m.prof) + " · " + esc(when) + "</span></div><span class=\"st st-" + esc(d.statut || "nouveau") + '">' + esc(STATUTS[d.statut] || "Repéré") + "</span></div>";
  }

  function rDevoirs() {
    const F = { ouverts: "En cours", rendus: "Rendus", tous: "Tous" };
    $("#dv-filters").innerHTML = Object.keys(F).map((k) => '<button type="button" class="pill' + (filter === k ? " on" : "") + '" data-f="' + k + '">' + F[k] + "</button>").join("");
    $$("#dv-filters [data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; rDevoirs(); }));
    let list = (A.devoirs || []).slice();
    if (filter === "ouverts") list = list.filter(OPEN); else if (filter === "rendus") list = list.filter((d) => !OPEN(d));
    list.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    $("#dv-list").innerHTML = list.length ? list.map((d) => {
      const opts = Object.keys(STATUTS).map((k) => '<option value="' + k + '"' + ((d.statut || "nouveau") === k ? " selected" : "") + ">" + STATUTS[k] + "</option>").join("");
      return '<div class="card dvc">' + dvLine(d) +
        (d.manque ? '<p class="manque"><b>Il manque :</b> ' + esc(d.manque) + "</p>" : "") +
        (d.docs ? '<p class="hint">' + esc(d.docs) + "</p>" : "") +
        (d.rendu ? '<p class="hint">Premier rendu : <code>' + esc(d.rendu) + "</code> (coffre Obsidian)</p>" : "") +
        '<label class="inline">Statut <select data-st="' + esc(d.id) + '">' + opts + "</select></label></div>";
    }).join("") : '<p class="empty">' + (filter === "ouverts" ? "Aucun devoir en cours." : "Rien ici.") + "</p>";
    $$("#dv-list [data-st]").forEach((s) => s.addEventListener("change", () => save((doc) => { const d = doc.devoirs.find((x) => x.id === s.dataset.st); if (d) { d.statut = s.value; d.maj = now(); } })));
  }

  function rMatieres() {
    const t = today();
    $("#mats").innerHTML = mats().map((m) => {
      const ss = (A.seances || []).filter((s) => s.matiere === m.id), last = ss.map((s) => s.date).sort().pop();
      const open = (A.devoirs || []).filter((d) => d.matiere === m.id && OPEN(d)).length;
      return '<div class="mat' + (actif(m) ? "" : " off") + '" style="--c:' + esc(col(m.couleur)) + '"><span class="sw"></span><div><b>' + esc(m.nom) + '</b><span class="meta">' + (actif(m) ? esc(m.prof) + " · " + esc(m.maison || "") : esc(m.prof) + " arrive bientôt · en attendant, Margaux") + '</span><span class="meta">' + (ss.length ? ss.length + " séance" + (ss.length > 1 ? "s" : "") + " · dernière il y a " + days(last.slice(0, 10), t) + " j" : "pas encore de séance") + (open ? " · " + open + " devoir" + (open > 1 ? "s" : "") : "") + "</span></div></div>";
    }).join("");
  }

  function fillMatSelect(sel, value) { sel.innerHTML = mats().map((m) => '<option value="' + esc(m.id) + '"' + (m.id === value ? " selected" : "") + ">" + esc(m.nom) + "</option>").join(""); }
  function openSeance(mid) { const f = $("#se-form"); f.hidden = false; fillMatSelect($("#se-mat"), mid || "philo"); $("#se-bilan").focus(); }

  function rSeances() {
    const list = (A.seances || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    $("#se-list").innerHTML = list.length ? list.map((s) => { const m = mat(s.matiere); return '<div class="card se" style="--c:' + esc(col(m.couleur)) + '"><div class="se-top"><span class="chip" style="background:' + esc(col(m.couleur)) + '">' + esc(m.nom.split(" · ")[0]) + "</span><span class=\"meta\">" + esc(fdate(s.date)) + " · " + esc(s.prof || m.prof) + " · " + (s.mode === "oral" ? "oral" : "écrit") + (s.duree ? " · " + esc(s.duree) + " min" : "") + "</span></div>" + (s.bilan ? "<p>" + esc(s.bilan) + "</p>" : "") + (s.suite ? '<p class="hint"><b>Ensuite :</b> ' + esc(s.suite) + "</p>" : "") + (s.note ? '<p class="hint">Note : <code>' + esc(s.note) + "</code></p>" : "") + "</div>"; }).join("") : '<p class="empty">Pas encore de séance. La première, c\'est 20 minutes avec Nour ?</p>';
  }

  function rIdees() {
    const list = (A.idees || []).slice().sort((a, b) => (b.created || "").localeCompare(a.created || ""));
    const ST = { nouveau: "Reçue", pris: "Prise en charge", fait: "Faite", refuse: "Écartée" };
    $("#id-list").innerHTML = list.length ? list.map((i) => '<div class="card idea"><p>' + esc(i.texte) + '</p><span class="meta">' + esc(fdate(i.created)) + " · " + esc(ST[i.statut] || "Reçue") + (i.reponse ? " · " + esc(i.reponse) : "") + "</span></div>").join("") : '<p class="empty">Aucune idée pour l\'instant.</p>';
  }

  function rReglages() {
    const st = S.status(), s = S.getSettings();
    $("#set-dot").className = "dot " + st.level; $("#set-status").textContent = st.text;
    $("#set-repo").textContent = s.configured ? "Dépôt : " + s.owner + "/" + s.repo + " · branche " + s.branch + " · dossier " + s.dir + (s.hasToken ? " · jeton présent" : " · jeton manquant") : "Aucun dépôt réglé.";
    $("#ver").textContent = "Académie " + APP_VERSION + " · lot 1 (socle)";
  }

  // ---------- navigation et formulaires ----------
  function go(v) { if (location.hash !== "#" + v) location.hash = v; else { view = v; render(); } }
  function route() { const v = (location.hash || "#accueil").slice(1); view = $('.view[data-view="' + v + '"]') ? v : "accueil"; render(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); }

  function bind() {
    window.addEventListener("hashchange", route);
    $("#dv-add-open").addEventListener("click", () => { $("#dv-form").hidden = false; fillMatSelect($("#dv-mat"), "iut"); $("#dv-titre").focus(); });
    $("#dv-cancel").addEventListener("click", () => ($("#dv-form").hidden = true));
    $("#dv-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const titre = $("#dv-titre").value.trim(); if (!titre) return;
      const m = mat($("#dv-mat").value);
      save((d) => d.devoirs.push({ id: uid(), titre, matiere: m.id, prof: profDe(m), due: $("#dv-due").value || null, source: "app", docs: $("#dv-docs").value.trim(), statut: "nouveau", created: now(), maj: now() }));
      e.target.reset(); $("#dv-form").hidden = true; toast("Devoir ajouté : Odile le confie à " + profDe(m));
    });
    $("#se-add-open").addEventListener("click", () => openSeance());
    $("#se-cancel").addEventListener("click", () => ($("#se-form").hidden = true));
    $("#se-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const m = mat($("#se-mat").value);
      save((d) => d.seances.push({ id: uid(), date: now(), matiere: m.id, prof: profDe(m), mode: $("#se-mode").value, duree: Number($("#se-duree").value) || 20, bilan: $("#se-bilan").value.trim(), suite: $("#se-suite").value.trim(), maj: now() }));
      e.target.reset(); $("#se-form").hidden = true; toast("Séance notée. Bravo.");
    });
    $("#id-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const texte = $("#id-text").value.trim(); if (!texte) return;
      save((d) => d.idees.push({ id: uid(), texte, created: now(), statut: "nouveau", maj: now() }));
      e.target.reset(); toast("Idée envoyée à Margaux");
    });
    $("#set-import").addEventListener("click", async () => { $("#set-msg").textContent = "…"; const r = await S.useSettingsFrom("cockpit-app"); $("#set-msg").textContent = r.ok ? "Réglages repris du Cockpit." : r.text; rReglages(); });
    $("#set-sync").addEventListener("click", async () => { await S.sync(); rReglages(); });
    S.on("change", (n, data) => { if (n === "academie") { A = data || A; render(); } });
    S.on("status", (st) => { $("#sync-dot").className = "dot " + st.level; $("#sync-t").textContent = st.text; if (view === "reglages") rReglages(); });
  }

  (async function start() {
    bind();
    const snap = await S.init();
    A = snap.academie || A;
    route();
    S.sync();
    if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  })();
})();
