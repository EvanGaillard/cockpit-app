/* Académie · écrans (lot 1 : socle).
 * Données : document « academie » du dépôt privé (synchro par ../store.js, fusion par ../merge.js).
 * Devoir (ajouts du lot « devoir IUT », aucun champ renommé) : code, type, consigne, consigneSource, moodle, suivi,
 *  documents:[{id,nom,type: sujet|consigne|exemple|annale|cours|td|autre, ou: pc|drive|moodle, chemin, lien, note}],
 *  echeances:[{id,libelle,date,heure,pour: tous|alternants|initiaux,statut: confirmee|a_verifier|passee,source,maj}],
 *  questions:[{id,texte,pour: margaux|sami|evan,statut: ouverte|repondue,reponse,maj}], agenda:{statut: aucun|cree,raison,maj}.
 *  travail (ticket #6, « Travailler dessus » automatique) : {id, statut: demande|en_cours|pret|annule|erreur, style: demarrer|doux|defi|null,
 *  consigne (toujours null : jamais écrite par l'appli, la routine la reconstruit à partir du style), demande (texte neutre), prof, at, maj, resume, rendu, erreur}.
 *  L'appli écrit seulement « demande » et « annule » ; la routine de Margaux écrit « en_cours », « pret » (resume, rendu) ou « erreur »
 *  et remet style à null quand le travail est fini. Un « en_cours » sans nouvelle depuis 3 h est considéré comme bloqué (on peut relancer).
 *  Règle : due = date CONFIRMÉE de la prochaine échéance, sinon null ; l'agenda n'est rempli que pour une date confirmée.
 * {maj, bureau, matieres:[{id,nom,prof,couleur,maison,ordre}], devoirs:[{id,titre,matiere,prof,due,source,docs,statut,manque,rendu,tache,created,maj}],
 *  seances:[{id,date,matiere,prof,mode,duree,bilan,suite,note,maj}], idees:[{id,texte,created,statut,reponse,maj}], prochaine:{matiere,raison,date}}
 * Format de référence : tableau des documents du CLAUDE.md du coffre (dépôt privé).
 * L'IA n'est pas dans l'app : les profs travaillent dans le bureau de Margaux et écrivent ce document avec ldata. */
(function () {
  "use strict";
  const APP_VERSION = "0.4.0";
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
  let view = "accueil", filter = "ouverts", current = null;

  // ---------- échéances ----------
  const ECH = { confirmee: "confirmée", a_verifier: "à vérifier", passee: "passée" };
  const POUR = { tous: "tout le monde", alternants: "alternants", initiaux: "étudiants en formation initiale" };
  function echeances(d) {
    const list = Array.isArray(d.echeances) ? d.echeances.slice() : [];
    if (!list.length && d.due) list.push({ id: "due", libelle: "Rendu", date: d.due, statut: "confirmee", pour: "tous" });
    return list;
  }
  // prochaine échéance utile : la plus proche date confirmée à venir, sinon une échéance « à vérifier »
  function prochaine(d) {
    const t = today(), list = echeances(d).filter((e) => e.statut !== "passee").map((e) => (e.statut === "confirmee" && e.date ? e : Object.assign({}, e, { statut: "a_verifier" })));
    const conf = list.filter((e) => e.statut === "confirmee" && e.date && e.date >= t).sort((a, b) => a.date.localeCompare(b.date));
    const conf0 = list.filter((e) => e.statut === "confirmee" && e.date).sort((a, b) => a.date.localeCompare(b.date));
    return conf[0] || list.find((e) => e.statut === "a_verifier") || conf0[conf0.length - 1] || null;
  }
  const aVerifier = (d) => { const e = prochaine(d); return !!(e && e.statut === "a_verifier"); };
  function echLabel(e) {
    if (!e) return "sans date";
    if (e.statut === "a_verifier") return "date à vérifier";
    const n = days(today(), e.date);
    return n < 0 ? "en retard de " + -n + " j" : n === 0 ? "aujourd'hui" : n === 1 ? "demain" : fdate(e.date) + (e.heure ? " · " + e.heure : "");
  }
  // tri : en retard d'abord, puis à vérifier, puis par date ; sans date en dernier
  const sortKey = (d) => { const e = prochaine(d); if (!e) return "9999"; if (e.statut === "a_verifier") return "0001"; return e.date < today() ? "0000" + e.date : e.date; };
  const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : null);

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
    const dated = (A.devoirs || []).filter(OPEN).map((d) => ({ d, e: prochaine(d) })).filter((x) => x.e && x.e.statut === "confirmee").sort((a, b) => a.e.date.localeCompare(b.e.date));
    const hit = dated.find((x) => days(t, x.e.date) <= 7), urgent = hit && hit.d;
    if (urgent) {
      const n = days(t, hit.e.date);
      return { kind: "devoir", matiere: urgent.matiere, titre: urgent.titre, raison: n < 0 ? "Échéance dépassée de " + -n + " j : on fait le point, sans paniquer." : n === 0 ? "C'est pour aujourd'hui." : "À rendre dans " + n + " j.", devoir: urgent };
    }
    const flou = (A.devoirs || []).filter(OPEN).find(aVerifier);
    if (flou) return { kind: "verifier", matiere: flou.matiere, titre: "Date à vérifier : " + flou.titre, raison: "On ne connaît pas encore ta date de rendu. Margaux la cherche ; rien n'est mis dans ton agenda tant qu'elle n'est pas confirmée.", devoir: flou };
    const p = A.prochaine;
    if (p && p.matiere && p.date && days(p.date, t) <= 2) return { kind: "margaux", matiere: p.matiere, titre: "Séance proposée par Margaux", raison: p.raison || "" };
    // matière délaissée : la plus longtemps sans séance, la philo d'abord à égalité (priorité n°1)
    const list = mats().filter((m) => m.id !== "sport" && actif(m)).map((m) => ({ m, last: lastSeance(m.id) }));
    list.sort((a, b) => (a.last || "0000") .localeCompare(b.last || "0000") || (a.m.ordre - b.m.ordre));
    const pick = list[0];
    return { kind: "delaissee", matiere: pick.m.id, titre: "Une séance de " + pick.m.nom.split(" · ")[0].toLowerCase(), raison: pick.last ? "Dernière séance il y a " + days(pick.last, t) + " j." : "Pas encore de séance : on commence en douceur, 20 minutes." };
  }
  // ---------- Samuel : « comment veux-tu travailler ? » ----------
  // Facultatif, en un geste, valable pour UNE séance : le choix vit en mémoire et est oublié dès que la séance est lancée
  // ou que la page est rechargée. Seule exception : « Travailler dessus » (file d'attente, ticket #6) dépose le style
  // (une valeur parmi trois) dans le document le temps du travail ; la routine l'efface ensuite (il reste dans l'historique privé).
  // Il change le premier pas proposé et ajoute une consigne pédagogique au message que le prof reçoit via Margaux.
  const STYLES = { demarrer: "J'ai du mal à démarrer", doux: "Je veux y aller doucement", defi: "J'ai envie d'un défi" };
  let sam = { key: null, st: null }, samTimer = null;
  const samKey = (r) => (r.devoir ? "d:" + r.devoir.id : "m:" + r.matiere);
  const samStyle = (r) => (sam.key === samKey(r) ? sam.st : null);
  // premiers pas par matière (quand la séance ne porte pas sur un devoir)
  const PAS = {
    philo: { demarrer: "Ouvre ton livre à la page où tu t'es arrêté et lis une seule page. Note la phrase qui t'arrête.", defi: "Écris en 3 phrases la thèse inverse de ta dernière lecture : Nour la défendra contre toi." },
    darija: { demarrer: "Dis à voix haute trois salutations que tu connais déjà : le matin, en arrivant, en partant.", defi: "Deux minutes de conversation sans un mot de français : Yasmine lance le sujet." },
    anglais: { demarrer: "Lis à voix haute un paragraphe en anglais (article, cours ou mail) et relève un seul mot inconnu.", defi: "Défends une opinion en anglais pendant 2 minutes : Ingrid prend le contre-pied." },
    iut: { demarrer: "Écris en une ligne la formule ou la définition dont tu te souviens le mieux dans ce module.", defi: "Refais de tête le dernier calcul vu en cours, puis vérifie-le ligne par ligne." },
    "": { demarrer: "Écris en une ligne ce que tu sais déjà sur le sujet du jour.", defi: "Explique la notion clé sans notes en 2 minutes : le prof cherche la faille." },
  };
  function samuelPlan(r, st) {
    const m = mat(r.matiere), d = r.devoir, prof = d ? String(d.prof || profDe(m)) : profDe(m);
    const docs = d && Array.isArray(d.documents) ? d.documents : [];
    const sujet = docs.find((x) => x.type === "consigne") || docs.find((x) => x.type === "sujet");
    const last = (A.seances || []).filter((x) => x.matiere === r.matiere && x.suite).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    const P = PAS[r.matiere] || PAS[""];
    let pas, min;
    if (st === "demarrer") {
      min = 3;
      pas = d ? (d.consigne ? "Relis la consigne et écris en une phrase ce que tu dois rendre, rien d'autre." : sujet ? "Ouvre « " + sujet.nom + " »" + (sujet.ou === "pc" ? " sur le PC" : "") + " et recopie en une phrase ce que tu dois rendre, rien d'autre." : "Écris en une phrase ce que tu dois rendre pour « " + d.titre + " », même approximativement.") : P.demarrer;
    } else if (st === "doux") {
      min = 15;
      pas = last ? "Reprends l'étape notée la dernière fois : « " + last.suite + " »." : d ? prof + " te lit et t'explique la consigne pas à pas ; tu poses tes questions, tu ne produis rien de noté aujourd'hui." : "Une lecture ou une écoute courte guidée par " + prof + ", puis une seule question pour vérifier.";
    } else {
      min = 10;
      pas = !d ? P.defi : !d.consigne && sujet ? "Lis « " + sujet.nom + " » en 5 minutes chrono, ferme-le, puis écris de mémoire le plan de ton rendu en 5 lignes : " + prof + " le confronte au sujet." : "Sans rouvrir la consigne, écris le plan de ton rendu en 5 lignes, puis confronte-le à la consigne avec " + prof + ".";
    }
    const tete = "Consigne de Samuel (pour cette séance seulement) : Evan a choisi « " + STYLES[st] + " ». ";
    const prof_ = st === "demarrer" ? "Ouvre la séance directement par ce premier pas, sans introduction ni encouragement : « " + pas + " » (" + min + " min). Attends qu'il l'ait fait avant d'expliquer quoi que ce soit, puis enchaîne par une étape de la même taille. Une seule question à la fois."
      : st === "doux" ? "Séance de " + min + " min au plus, rythme lent. Commence par : « " + pas + " ». Pas de nouvelle notion difficile, pas d'évaluation ; termine par une seule prochaine étape facile."
      : "Ouvre par ce défi : « " + pas + " ». Niveau au-dessus de l'habituel, correction exigeante et précise ; termine par une question d'approfondissement.";
    return { pas, min, consigne: tete + prof_ + " N'enregistre rien sur l'état d'Evan et ne commente ni sa motivation ni sa santé." };
  }
  function samuelHtml(r) {
    const st = samStyle(r), plan = st ? samuelPlan(r, st) : null;
    return '<div class="samuel" data-sam>' +
      '<p class="sam-q">Avant de commencer <span class="meta">facultatif, pour cette séance</span></p>' +
      '<div class="sam-chips" role="group" aria-label="Comment veux-tu travailler ?">' + Object.keys(STYLES).map((k) => '<button type="button" class="pill' + (st === k ? " on" : "") + '" aria-pressed="' + (st === k) + '" data-sam-st="' + k + '">' + esc(STYLES[k]) + "</button>").join("") + "</div>" +
      (plan ? '<div class="sam-plan"><span class="sam-who">Samuel</span><p><b>' + (st === "defi" ? "Pour entrer :" : st === "doux" ? "Pour commencer en douceur :" : "Premier pas, " + plan.min + " min :") + "</b> " + esc(plan.pas) + "</p>" +
        (st === "demarrer" ? '<button class="btn sm" type="button" data-sam-timer>Lancer ' + plan.min + ' min</button> <span class="sam-time" aria-live="polite"></span>' : "") + "</div>" : "") +
      "</div>";
  }
  function bindSamuel(root, r, rerender) {
    $$("[data-sam-st]", root).forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.samSt; sam = sam.key === samKey(r) && sam.st === k ? { key: null, st: null } : { key: samKey(r), st: k };
      clearInterval(samTimer); rerender();
    }));
    const tb = $("[data-sam-timer]", root);
    if (tb) tb.addEventListener("click", () => {
      const plan = samuelPlan(r, samStyle(r)); let left = plan.min * 60; const out = $(".sam-time", root);
      clearInterval(samTimer); tb.disabled = true;
      const tick = () => { out.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0"); if (left-- <= 0) { clearInterval(samTimer); out.textContent = "C'est fait."; tb.disabled = false; } };
      tick(); samTimer = setInterval(tick, 1000);
    });
  }
  const startLabel = (r, mode) => { const st = samStyle(r); return st === "defi" ? (mode === "oral" ? "Commencer le défi à l'oral" : "Défi à l'écrit") : st ? (mode === "oral" ? "Commencer à l'oral" : "À l'écrit") : (mode === "oral" ? "Commencer à l'oral" : "À l'écrit"); };
  function withSamuel(r, txt) { const st = samStyle(r); return st ? txt + "\n\n" + samuelPlan(r, st).consigne : txt; }
  function forgetSamuel() { sam = { key: null, st: null }; clearInterval(samTimer); }

  function seancePrompt(r, mode) {
    const m = mat(r.matiere);
    return "Margaux, lance une séance de " + m.nom + " avec " + profDe(m) + ", à l'" + (mode === "oral" ? "oral" : "écrit") + ", " + (samStyle(r) === "doux" ? 15 : 20) + " minutes. " + (r.devoir ? "Sujet : le devoir « " + r.devoir.titre + " ». " : "") + "Commence par un petit résumé de là où j'en suis, puis termine par un bilan, la prochaine étape et la note de suivi dans Obsidian.";
  }

  // ---------- rendu ----------
  function render() {
    $$(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.v === (view === "devoir" ? "devoirs" : view)));
    $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
    const open = (A.devoirs || []).filter(OPEN);
    const b = $("#dv-badge"); b.hidden = !open.length; b.textContent = open.length;
    ({ accueil: rAccueil, devoirs: rDevoirs, devoir: rDevoir, matieres: rMatieres, seances: rSeances, idees: rIdees, reglages: rReglages })[view]();
  }

  function rAccueil() {
    const h = new Date().getHours();
    $("#greet").textContent = (h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir") + " Evan · Margaux et l'équipe";
    const r = recommend(), m = mat(r.matiere);
    $("#reco").innerHTML = '<div class="card reco" style="--c:' + esc(col(m.couleur)) + '">' +
      '<div class="reco-top"><span class="chip" style="background:' + esc(col(m.couleur)) + '">' + esc(m.nom.split(" · ")[0]) + '</span><span class="who">avec ' + esc(r.devoir && r.devoir.prof ? r.devoir.prof : profDe(m)) + '</span></div>' +
      '<h1>' + esc(r.titre) + '</h1><p class="why">' + esc(r.raison) + '</p>' +
      samuelHtml(r) +
      (r.devoir ? '<div class="row"><a class="btn" href="#devoir/' + esc(encodeURIComponent(r.devoir.id)) + '">Voir le devoir</a></div>' : "") +
      '<div class="row"><button class="btn primary" type="button" data-start="oral">' + esc(startLabel(r, "oral")) + '</button><button class="btn" type="button" data-start="ecrit">' + esc(startLabel(r, "ecrit")) + '</button><button class="btn ghost" type="button" data-done>J\'ai fait une séance</button></div>' +
      '<p class="hint">« Commencer » copie la demande pour Margaux et ouvre son bureau : colle-la, ou dis-la au micro.</p></div>';
    $$("#reco [data-start]").forEach((btn) => btn.addEventListener("click", async () => {
      const txt = withSamuel(r, seancePrompt(r, btn.dataset.start)); forgetSamuel(); rAccueil();
      try { await navigator.clipboard.writeText(txt); toast("Demande copiée : colle-la dans le bureau de Margaux"); } catch (e) { toast("Copie impossible : écris « " + m.prof + ", séance de " + m.nom.split(" · ")[0] + " »"); }
      window.open(bureau(), "_blank", "noopener");
    }));
    bindSamuel($("#reco"), r, rAccueil);
    $("#reco [data-done]").addEventListener("click", () => { go("seances"); openSeance(r.matiere); });
    const nx = (A.devoirs || []).filter(OPEN).sort((a, b) => sortKey(a).localeCompare(sortKey(b))).slice(0, 4);
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
    const m = mat(d.matiere), e = prochaine(d), flou = e && e.statut === "a_verifier";
    return '<a class="dv" href="#devoir/' + esc(encodeURIComponent(d.id)) + '" style="--c:' + esc(col(m.couleur)) + '"><div><b>' + (d.code ? '<span class="code">' + esc(d.code) + "</span> " : "") + esc(d.titre) + '</b><span class="meta">' + esc(m.nom.split(" · ")[0]) + " · " + esc(d.prof || profDe(m)) + " · " + (flou ? '<span class="verif">date à vérifier</span>' : esc(echLabel(e))) + "</span>" + travailBadge(d) + "</div><span class=\"st st-" + esc(d.statut || "nouveau") + '">' + esc(STATUTS[d.statut] || "Repéré") + "</span></a>";
  }

  // ---------- travail automatique (ticket #6) ----------
  const TRAV = { demande: "Demandé", en_cours: "En cours", pret: "Rendu prêt", erreur: "À reprendre" };
  const BLOQUE_MS = 3 * 3600 * 1000;
  const travBloque = (t) => !!(t && t.statut === "en_cours" && t.maj && Date.now() - new Date(t.maj).getTime() > BLOQUE_MS);
  const travActif = (d) => !!(d.travail && (d.travail.statut === "demande" || (d.travail.statut === "en_cours" && !travBloque(d.travail))));
  function travailBadge(d) { const t = d.travail; return t && TRAV[t.statut] ? '<span class="trav trav-' + esc(t.statut) + '">' + esc(TRAV[t.statut]) + "</span>" : ""; }
  function travailHtml(d) {
    const t = d.travail; if (!t || !TRAV[t.statut]) return "";
    const fmt = (iso, o) => { try { return new Date(iso).toLocaleString("fr-FR", o); } catch (e) { return ""; } };
    const quand = t.at ? fmt(t.at, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
    let body = "";
    if (t.statut === "demande") body = "<p><b>Demandé à " + esc(t.prof || "Margaux") + "</b>" + (quand ? ' <span class="meta">' + esc(quand) + "</span>" : "") + "</p><p class=\"hint\">Margaux le confie au prof à son prochain passage (une fois par heure). Tu peux fermer l'appli.</p>" + '<button class="btn sm" type="button" data-trav-annule>Annuler la demande</button>';
    else if (t.statut === "en_cours" && travBloque(t)) body = "<p><b>Pas de nouvelles depuis plus de 3 h.</b></p><p class=\"hint\">Le travail semble bloqué : tu peux le relancer avec « Travailler dessus », ou passer par le bureau de Margaux.</p>";
    else if (t.statut === "en_cours") body = "<p><b>" + esc(t.prof || "Le prof") + " y travaille.</b></p><p class=\"hint\">Le rendu arrivera ici.</p>";
    else if (t.statut === "pret") body = "<p><b>Rendu prêt</b>" + (t.maj ? ' <span class="meta">' + esc(fmt(t.maj, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</span>" : "") + "</p>" + (t.resume ? '<p class="pre">' + esc(t.resume) + "</p>" : "") + (t.rendu ? '<p class="hint">Dans le coffre : <code>' + esc(t.rendu) + "</code></p>" : "") + '<p class="hint">Pour un travail noté, c\'est une base que tu retravailles toi-même.</p>';
    else if (t.statut === "erreur") body = "<p><b>Le travail n'a pas pu être fait.</b></p>" + (t.erreur ? '<p class="hint">' + esc(t.erreur) + "</p>" : "") + '<p class="hint">Relance avec « Travailler dessus », ou passe par le bureau de Margaux.</p>';
    return '<div class="card travail trav-' + esc(t.statut) + '" id="dv-travail"><h2>Travail demandé</h2>' + body + "</div>";
  }

  // ---------- fiche d'un devoir ----------
  const DOC_T = { sujet: "Sujet", consigne: "Consigne", exemple: "Exemples", annale: "Annales", cours: "Cours", td: "TD", autre: "Autres" };
  const OU = { pc: "sur le PC", drive: "Google Drive", moodle: "Moodle" };
  function rDevoir() {
    const d = (A.devoirs || []).find((x) => x.id === current);
    const el = $("#dv-detail");
    if (!d) { el.innerHTML = '<p class="empty">Devoir introuvable. <a href="#devoirs">Retour aux devoirs</a></p>'; return; }
    const m = mat(d.matiere), e = prochaine(d), flou = e && e.statut === "a_verifier";
    const titulaire = String(m.prof || ""), attribue = String(d.prof || profDe(m));
    const opts = Object.keys(STATUTS).map((k) => '<option value="' + k + '"' + ((d.statut || "nouveau") === k ? " selected" : "") + ">" + STATUTS[k] + "</option>").join("");
    const docs = Array.isArray(d.documents) ? d.documents : [];
    const groups = {}; docs.forEach((x) => { (groups[x.type] = groups[x.type] || []).push(x); });
    const docHtml = docs.length ? Object.keys(DOC_T).filter((k) => groups[k]).map((k) => '<h3>' + DOC_T[k] + "</h3>" + groups[k].map((x) => {
      const url = safeUrl(x.lien);
      return '<div class="docl"><div><b>' + esc(x.nom) + '</b><span class="meta">' + esc(OU[x.ou] || "à localiser") + (x.note ? " · " + esc(x.note) : "") + "</span>" + (x.chemin ? '<code class="path">' + esc(x.chemin) + "</code>" : "") + "</div>" +
        (url ? '<a class="btn sm" href="' + esc(url) + '" target="_blank" rel="noopener">Ouvrir</a>' : x.chemin ? '<button class="btn sm" type="button" data-copy="' + esc(x.chemin) + '">Copier le chemin</button>' : "") + "</div>";
    }).join("")).join("") : '<p class="empty">Aucun document rattaché pour l\'instant. Agnès les range dès que Sami les a récupérés.</p>';
    const ech = echeances(d);
    const echHtml = ech.length ? ech.map((x) => '<div class="ech ech-' + esc(x.statut || "a_verifier") + '"><span class="pill-s">' + esc(ECH[x.statut] || "à vérifier") + "</span><div><b>" + esc(x.libelle || "Échéance") + '</b><span class="meta">' + (x.date ? esc(fdate(x.date)) + (x.heure ? " · " + esc(x.heure) : "") : "date inconnue") + " · pour " + esc(POUR[x.pour] || "tout le monde") + (x.source ? " · source : " + esc(x.source) : "") + "</span></div></div>").join("") : '<p class="empty">Aucune échéance connue.</p>';
    const qs = (Array.isArray(d.questions) ? d.questions : []).filter((q) => q.statut !== "repondue");
    const qa = (Array.isArray(d.questions) ? d.questions : []).filter((q) => q.statut === "repondue");
    const WHO = { margaux: "Margaux", sami: "Sami (PC)", evan: "toi" };
    const ag = d.agenda || {};
    const agTxt = ag.statut === "cree" ? "Un créneau est dans ton agenda." : flou ? "Rien dans ton agenda : la date n'est pas confirmée. Odile l'ajoutera quand elle le sera." : e && e.statut === "confirmee" ? "Pas encore de créneau dans l'agenda." : "Rien dans ton agenda.";
    el.innerHTML =
      '<a class="back-l" href="#devoirs">← Devoirs</a>' +
      '<div class="card reco" style="--c:' + esc(col(m.couleur)) + '"><div class="reco-top"><span class="chip" style="background:' + esc(col(m.couleur)) + '">' + esc(m.nom.split(" · ")[0]) + "</span>" + (d.code ? '<span class="who">' + esc(d.code) + "</span>" : "") + (d.type ? '<span class="who">· ' + esc(d.type) + "</span>" : "") + "</div>" +
      "<h1>" + esc(d.titre) + "</h1>" +
      '<div class="kv"><div class="k">Prochaine échéance</div><div class="v big' + (flou ? " verif" : "") + '" id="dv-next">' + (flou ? "À vérifier" : esc(echLabel(e))) + "</div>" +
      (flou && e.libelle ? '<div class="k"></div><div class="v meta">' + esc(e.libelle) + "</div>" : "") +
      '<div class="k">Attribué à</div><div class="v" id="dv-prof"><span class="avatar" aria-hidden="true">' + esc(attribue.slice(0, 1)) + "</span>" + esc(attribue) + (attribue !== titulaire ? ' <span class="meta">en attendant ' + esc(titulaire) + ", prof de la matière</span>" : "") + "</div>" +
      '<div class="k">Statut</div><div class="v"><select data-st="' + esc(d.id) + '" aria-label="Statut du devoir">' + opts + "</select></div>" +
      '<div class="k">Agenda</div><div class="v" id="dv-agenda">' + esc(agTxt) + "</div></div>" +
      samuelHtml({ devoir: d, matiere: d.matiere }) +
      '<div class="row"><button class="btn primary" type="button" data-work' + (travActif(d) ? " disabled" : "") + ">" + (travActif(d) ? "Déjà demandé" : samStyle({ devoir: d, matiere: d.matiere }) === "defi" ? "Lancer le défi" : "Travailler dessus") + '</button><button class="btn" type="button" data-ask>Demander à Margaux</button><button class="btn ghost" type="button" data-bureau>Ouvrir le bureau (secours)</button></div>' +
      '<p class="hint">« Travailler dessus » confie le devoir au prof sans que tu aies à rester : le rendu arrive ici.</p></div>' +
      travailHtml(d) +
      '<div class="grid2"><div class="card"><h2>Consigne</h2>' + (d.consigne ? "<p class=\"pre\">" + esc(d.consigne) + "</p>" : '<p class="empty">Pas encore résumée.</p>') + (docs.filter((x) => x.type === "sujet" || x.type === "consigne").length ? '<div id="dv-sujet"><p class="hint">' + (d.consigne ? "Le texte complet est dans :" : "En attendant, le texte de la consigne est dans :") + "</p>" + docs.filter((x) => x.type === "sujet" || x.type === "consigne").map((x) => '<p class="sujet"><b>' + esc(x.nom) + "</b> <span class=\"meta\">" + esc(OU[x.ou] || "à localiser") + "</span></p>").join("") + "</div>" : "") + (d.consigneSource ? '<p class="hint">Source : ' + esc(d.consigneSource) + "</p>" : "") +
      (safeUrl(d.moodle) ? '<p><a href="' + esc(safeUrl(d.moodle)) + '" target="_blank" rel="noopener">Page du cours sur Moodle</a></p>' : "") + "</div>" +
      '<div class="card"><h2>Échéances</h2><div id="dv-ech">' + echHtml + "</div></div></div>" +
      '<div class="card"><h2>Documents</h2><div id="dv-docs">' + docHtml + "</div>" + (d.docs ? '<p class="hint">' + esc(d.docs) + "</p>" : "") + "</div>" +
      '<div class="card"><h2>À vérifier</h2><div id="dv-q">' + (qs.length ? qs.map((q) => '<div class="q"><b>' + esc(q.texte) + '</b><span class="meta">demandé à ' + esc(WHO[q.pour] || q.pour || "Margaux") + "</span></div>").join("") : '<p class="empty">Rien à vérifier.</p>') +
      (qa.length ? qa.map((q) => '<div class="q done"><b>' + esc(q.texte) + '</b><span class="meta">Réponse : ' + esc(q.reponse || "") + "</span></div>").join("") : "") + "</div>" +
      (d.manque ? '<p class="manque"><b>Il manque :</b> ' + esc(d.manque) + "</p>" : "") + "</div>" +
      '<div class="card"><h2>Suivi</h2>' + (d.rendu ? '<p>Premier rendu : <code>' + esc(d.rendu) + "</code></p>" : '<p class="empty">Pas encore de premier rendu.</p>') + (d.suivi ? '<p class="hint">Note du module dans le coffre : <code>' + esc(d.suivi) + "</code></p>" : "") + "</div>";
    $$("#dv-detail [data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Chemin copié : colle-le dans l'Explorateur du PC"); } catch (er) { toast("Copie impossible"); } }));
    $("#dv-detail [data-st]").addEventListener("change", (ev) => save((doc) => { const x = doc.devoirs.find((y) => y.id === d.id); if (x) { x.statut = ev.target.value; x.maj = now(); } }));
    const ask = async (txt) => { try { await navigator.clipboard.writeText(txt); toast("Demande copiée : colle-la dans le bureau de Margaux"); } catch (er) { toast("Copie impossible"); } window.open(bureau(), "_blank", "noopener"); };
    $("#dv-detail [data-ask]").addEventListener("click", () => ask("Margaux, où en est le devoir « " + d.titre + " »" + (d.code ? " (" + d.code + ")" : "") + " ? " + (flou ? "La date de rendu pour moi (alternant) est à vérifier. " : "") + "Dis-moi ce qui manque et la prochaine étape."));
    const rd = { devoir: d, matiere: d.matiere };
    bindSamuel($("#dv-detail"), rd, rDevoir);
    const demandeTxt = (st) => "Margaux, je veux avancer sur le devoir « " + d.titre + " »" + (d.code ? " (" + d.code + ")" : "") + (attribue === "Margaux" ? " avec toi" : " avec " + attribue) + ", à l'écrit, " + (st === "doux" ? 15 : 20) + " minutes. " + (st ? "" : "Commence par un résumé de la consigne et de ce qui est déjà fait, puis propose le premier pas de 20 minutes.");
    const demandeNeutre = () => "Avancer sur le devoir « " + d.titre + " »" + (d.code ? " (" + d.code + ")" : "") + " : premier rendu à partir de la consigne et des documents.";
    // Travailler dessus : la demande est déposée dans le document (file d'attente) ; la routine de Margaux la traite
    $("#dv-detail [data-work]").addEventListener("click", () => {
      if (travActif(d)) return;
      const st = samStyle(rd), prof = attribue; let deja = false;
      save((doc) => {
        const x = doc.devoirs.find((y) => y.id === d.id); if (!x) return;
        if (travActif(x)) { deja = true; return; } // déjà demandé depuis un autre appareil : on ne remplace rien
        x.travail = { id: uid(), statut: "demande", style: st || null, consigne: null, demande: demandeNeutre(), prof, at: now(), maj: now() }; x.maj = now();
      });
      forgetSamuel(); rDevoir(); toast(deja ? "Déjà demandé depuis un autre appareil" : "Demandé à " + prof + " : le rendu arrivera dans la fiche");
    });
    const an = $("#dv-detail [data-trav-annule]");
    if (an) an.addEventListener("click", () => save((doc) => { const x = doc.devoirs.find((y) => y.id === d.id); if (x && x.travail && x.travail.statut === "demande") { x.travail.statut = "annule"; x.travail.style = null; x.travail.maj = now(); x.maj = now(); } }));
    // secours : l'ancien parcours (copie de la demande + ouverture du bureau de Margaux)
    $("#dv-detail [data-bureau]").addEventListener("click", () => { const st = samStyle(rd); const txt = withSamuel(rd, demandeTxt(st)); forgetSamuel(); rDevoir(); ask(txt); });
  }

  function rDevoirs() {
    const F = { ouverts: "En cours", rendus: "Rendus", tous: "Tous" };
    $("#dv-filters").innerHTML = Object.keys(F).map((k) => '<button type="button" class="pill' + (filter === k ? " on" : "") + '" data-f="' + k + '">' + F[k] + "</button>").join("");
    $$("#dv-filters [data-f]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.f; rDevoirs(); }));
    let list = (A.devoirs || []).slice();
    if (filter === "ouverts") list = list.filter(OPEN); else if (filter === "rendus") list = list.filter((d) => !OPEN(d));
    list.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
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
  function route() { let v = (location.hash || "#accueil").slice(1); try { v = decodeURIComponent(v); } catch (er) { v = "accueil"; } current = null; if (v.startsWith("devoir/")) { current = v.slice(7); v = "devoir"; } view = $('.view[data-view="' + v + '"]') ? v : "accueil"; render(); $("#main").focus({ preventScroll: true }); window.scrollTo(0, 0); }

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
