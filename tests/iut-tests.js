// Tests de l'appli IUT (iut/, code partagé avec academie/app.js) dans Chromium, avec le faux GitHub et des données FICTIVES.
// Devoirs, fiche devoir, emploi du temps (.ics simulé) et contacts.
// Usage : node tests/iut-tests.js [dossier-des-captures]
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "iut-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
function serve() { return new Promise((resolve) => { const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const file = path.join(APP, p); if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); }).listen(0, "127.0.0.1", () => resolve(srv)); }); }
let failed = 0; const out = [];
function check(n, c, d) { console.error((c ? "ok " : "KO ") + n); out.push((c ? "ok    · " : "ÉCHEC · ") + n + (d ? " · " + d : "")); if (!c) failed++; }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; }
const VIEWS = ["accueil", "edt", "devoirs", "contacts", "profs", "seances", "idees", "reglages"];
(async () => {
  const srv = await serve(), BASE = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(); const errors = [];
  async function setup(opts, mock) {
    const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris" }, opts));
    await ctx.route("https://api.github.com/**", (r) => mock.handle(r));
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::/.test(m.text())) errors.push("console : " + m.text()); });
    return { ctx, page };
  }
  async function cockpitConnect(page) { // règle le Cockpit (même site), comme sur l'appareil d'Evan
    await page.goto(BASE + "#reglages");
    await page.fill("#set-owner", DEFAULT_REPO.owner); await page.fill("#set-repo", DEFAULT_REPO.repo); await page.fill("#set-dir", DEFAULT_REPO.dir);
    await page.fill("#set-token", TOKEN); await page.click("#set-form button[type=submit]");
    return until(async () => (await page.textContent("#sync-t")) === "À jour");
  }
  const noH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  for (const [label, opts] of [["téléphone 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["iPad 820 px", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["ordinateur 1280 px", { viewport: { width: 1280, height: 800 } }]]) {
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup(opts, mock);
    check(label + " : Cockpit réglé", await cockpitConnect(page));
    await page.goto(BASE + "#aujourdhui");
    await page.click(".iutlink");
    check(label + " : bouton « IUT » du Cockpit ouvre l'appli IUT", await until(async () => (await page.title()) === "IUT"));
    await page.goto(BASE + "iut/");
    check(label + " : réglages du Cockpit repris tout seuls, synchro « À jour »", await until(async () => (await page.textContent("#sync-t")) === "À jour"));
    check(label + " : recommandation = devoir urgent", await until(async () => /Compte rendu de TP/.test(await page.textContent("#reco"))));
    const slug = label.split(" ")[0];
    for (const v of VIEWS) { await page.evaluate((h) => (location.hash = h), v); await page.waitForTimeout(150); check(label + " : pas de défilement horizontal · " + v, await noH(page)); await page.screenshot({ path: path.join(SHOTS, slug + "-" + v + ".png"), fullPage: true }); }
    // ---- parcours d'un devoir IUT (données simulées) ----
    const before = mock.commits.length;
    await page.evaluate(() => (location.hash = "devoirs"));
    check(label + " : liste : le projet simulé affiche « date à vérifier »", await until(async () => /Projet tutoré VBA \(simulation\)[\s\S]*date à vérifier/.test(await page.textContent("#dv-list"))));
    await page.click('#dv-list a[href="#devoir/dvsim506"]');
    check(label + " : fiche ouverte", await until(async () => /Projet tutoré VBA/.test(await page.textContent("#dv-detail"))));
    check(label + " : consigne non résumée : les sujets sont désignés", (await page.locator("#dv-sujet .sujet").count()) === 2);
    check(label + " : prochaine échéance = « À vérifier »", (await page.textContent("#dv-next")).trim() === "À vérifier");
    const prof = await page.textContent("#dv-prof");
    check(label + " : attribué à Margaux, en attendant Victor", /Margaux/.test(prof) && /Victor/.test(prof), prof.trim());
    check(label + " : agenda laissé intact (date non confirmée)", /Rien dans ton agenda : la date n'est pas confirmée/.test(await page.textContent("#dv-agenda")));
    check(label + " : 5 documents listés, chemins PC copiables", (await page.locator("#dv-docs .docl").count()) === 5 && (await page.locator("#dv-docs [data-copy]").count()) === 3);
    check(label + " : lien javascript: neutralisé", (await page.locator('#dv-docs a[href^="javascript"]').count()) === 0 && (await page.locator('#dv-docs a[href^="https://moodle.example.invalid"]').count()) === 1);
    check(label + " : échéance passée et échéance à vérifier affichées", (await page.locator("#dv-ech .ech-passee").count()) === 1 && (await page.locator("#dv-ech .ech-a_verifier").count()) === 1);
    check(label + " : questions ouvertes (Margaux, Sami)", /Margaux/.test(await page.textContent("#dv-q")) && /Sami/.test(await page.textContent("#dv-q")));
    check(label + " : pas de défilement horizontal · fiche devoir", await noH(page));
    await page.screenshot({ path: path.join(SHOTS, slug + "-devoir.png"), fullPage: true });
    check(label + " : consulter ne modifie rien dans le dépôt", mock.commits.length === before);
    await page.evaluate(() => (location.hash = "devoir/dvxss001"));
    await page.evaluate(() => (location.hash = "devoir/%E0%A4%A"));
    check(label + " : adresse mal formée : pas de plantage, retour à l'accueil", await until(async () => /Bonjour|Bon après-midi|Bonsoir/.test(await page.textContent("#greet"))));
    check(label + " : titre piégé affiché comme du texte", await until(async () => (await page.textContent("#dv-detail")).includes("<img src=x onerror=alert(1)>")) && (await page.locator("#dv-detail img").count()) === 0);
    await page.evaluate(() => (location.hash = "accueil"));
    check(label + " : lien « ← Cockpit » présent", (await page.getAttribute(".back", "href")) === "../");
    check(label + " : pas d'onglet Matières ni de montagnes (style sobre)", (await page.locator('.tabs a[href="#matieres"]').count()) === 0 && (await page.locator(".peaks").count()) === 0);
    await ctx.close();
  }
  { // écritures (ordinateur)
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup({ viewport: { width: 1280, height: 800 } }, mock);
    await cockpitConnect(page); await page.goto(BASE + "iut/#idees");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.fill("#id-text", "Idée de test"); await page.click("#id-form button[type=submit]");
    check("idée écrite dans le dépôt (academie.json), marquée app: iut", await until(() => mock.json("academie.json").idees.some((i) => i.texte === "Idée de test" && i.statut === "nouveau" && i.app === "iut" && /^[a-z0-9]{8}$/.test(i.id))));
    check("idées de l'Académie (sans app) absentes de l'appli IUT", (await page.locator("#id-list .idea").count()) === 1);
    check("commit « app : academie »", mock.commits.some((c) => c.message === "app : academie"));
    await page.evaluate(() => (location.hash = "seances")); await page.click("#se-add-open");
    check("séances : seule la matière IUT est proposée", (await page.locator("#se-mat option").count()) === 1);
    await page.selectOption("#se-mat", "iut"); await page.fill("#se-bilan", "Révision VBA (test)"); await page.click("#se-form button[type=submit]");
    check("séance écrite dans le dépôt", await until(() => mock.json("academie.json").seances.some((s) => s.matiere === "iut" && s.prof === "Victor" && s.bilan === "Révision VBA (test)")));
    await page.evaluate(() => (location.hash = "devoirs")); await page.click("#dv-add-open");
    await page.fill("#dv-titre", "Devoir de test"); await page.selectOption("#dv-mat", "iut"); await page.click("#dv-form button[type=submit]");
    check("devoir confié au prof de l'IUT (Victor)", await until(() => mock.json("academie.json").devoirs.some((d) => d.titre === "Devoir de test" && d.prof === "Victor" && d.matiere === "iut" && d.statut === "nouveau")));
    // statut changé + écriture concurrente d'une routine (Margaux) : rien n'est perdu
    mock.beforePut = () => mock.external("academie.json", (d) => d.devoirs.push({ id: "dvroutin", titre: "Ajouté par Odile", matiere: "iut", prof: "Victor", statut: "attribue", created: "2026-11-27T10:00:00Z", maj: "2026-11-27T10:00:00Z" }));
    await page.selectOption('[data-st="dv000002"]', "premier_rendu");
    check("conflit : statut gardé ET devoir de la routine gardé", await until(() => { const d = mock.json("academie.json").devoirs; return d.some((x) => x.id === "dvroutin") && (d.find((x) => x.id === "dv000002") || {}).statut === "premier_rendu"; }));
    check("l'app affiche le devoir ajouté par la routine", await until(async () => /Ajouté par Odile/.test(await page.textContent("#dv-list"))));
    // le Cockpit n'est pas touché par l'appli IUT
    check("aucun autre document modifié par l'appli IUT", mock.commits.filter((c) => /^app : /.test(c.message)).every((c) => c.message === "app : academie"));
    await page.evaluate(() => (location.hash = "devoir/dvsim506"));
    await page.waitForSelector("#dv-detail [data-st]");
    await page.selectOption("#dv-detail [data-st]", "premier_rendu");
    check("fiche : changer le statut l'écrit dans le dépôt, échéances et documents intacts", await until(() => { const x = mock.json("academie.json").devoirs.find((y) => y.id === "dvsim506"); return x && x.statut === "premier_rendu" && x.echeances.length === 2 && x.documents.length === 5 && x.due === null; }));
    mock.external("academie.json", (d) => d.devoirs.push({ id: "dvretard", titre: "Devoir en retard (test)", matiere: "philo", prof: "Nour", statut: "attribue", due: null, echeances: [{ id: "e1", libelle: "Rendu", date: "2026-01-05", statut: "confirmee" }], created: "2026-11-27T10:00:00Z", maj: "2026-11-27T10:00:00Z" }));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.evaluate(() => (location.hash = "accueil"));
    check("accueil : un devoir confirmé (échéance seule, sans due) en retard est proposé en premier", await until(async () => /Devoir en retard \(test\)/.test(await page.textContent("#reco")), 12000));
    check("accueil : le devoir en retard est en tête de liste, avant les dates à vérifier", await until(async () => /^Devoir en retard/.test((await page.textContent("#next-dv .dv b")).trim()), 5000));
    // le jeton n'est jamais recopié dans la base de l'Académie
    const tokInAcad = await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open("iut-app"); rq.onsuccess = () => { const d = rq.result; const r = d.transaction("kv", "readonly").objectStore("kv").get("token"); r.onsuccess = () => res(r.result || null); r.onerror = () => res("err"); }; }));
    check("jeton absent de la base de l'appli IUT (relu dans le Cockpit)", tokInAcad === null);
    // hors ligne puis retour
    await ctx.setOffline(true); await page.evaluate(() => (location.hash = "idees"));
    await page.fill("#id-text", "Idée hors ligne"); await page.click("#id-form button[type=submit]");
    check("hors ligne : état « Hors ligne »", await until(async () => /Hors ligne/.test(await page.textContent("#sync-t"))));
    await ctx.setOffline(false);
    check("retour du réseau : idée envoyée", await until(() => mock.json("academie.json").idees.some((i) => i.texte === "Idée hors ligne"), 15000));
    await ctx.close();
  }

  // ---------- emploi du temps : un .ics simulé, servi par une fausse adresse de l'IUT ----------
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (off) => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
  function ics(variant) {
    const T = dayKey(0), D = dayKey(1);
    const ev = (uid, start, end, sum, loc, extra) => ["BEGIN:VEVENT", "UID:" + uid, "DTSTART;TZID=Europe/Paris:" + start, "DTEND;TZID=Europe/Paris:" + end, "SUMMARY:" + sum, "LOCATION:" + loc].concat(extra || []).concat(["END:VEVENT"]).join("\r\n");
    const evs = [
      ev("c1@iut", T + "T080000", T + "T100000", "R5.06 VBA (simulation)", "Salle B101"),
      ev("c2@iut", T + "T133000", T + "T153000", variant === 2 ? "Métrologie (simulation)" : "Métrologie (simulation)", variant === 2 ? "Salle C204" : "Salle C203"),
      ["BEGIN:VEVENT", "UID:c3@iut", "DTSTART:" + D + "T070000Z", "DTEND:" + D + "T090000Z", "SUMMARY:Anglais <b>pro</b> \\, groupe 2", "LOCATION:Amphi", "DESCRIPTION:Ligne 1\\nLigne très longue qui est pliée", "  sur deux lignes", "END:VEVENT"].join("\r\n"),
    ];
    if (variant === 2) evs.push(ev("c4@iut", D + "T160000", D + "T170000", "Réunion alternance (simulation)", "Salle A1"));
    else evs.push(ev("c5@iut", D + "T140000", D + "T160000", "TP supprimé ensuite (simulation)", "Salle T1"));
    return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//FR\r\n" + evs.join("\r\n") + "\r\nEND:VCALENDAR\r\n";
  }
  for (const [label, opts] of [["téléphone 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["ordinateur 1280 px", { viewport: { width: 1280, height: 800 } }]]) {
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup(opts, mock);
    let variant = 1, cors = true, hits = 0;
    await ctx.route("https://edt.example.invalid/**", (r) => { hits++; if (!cors) return r.abort("failed"); return r.fulfill({ status: 200, headers: { "content-type": "text/calendar; charset=utf-8", "access-control-allow-origin": "*" }, body: ics(variant) }); });
    await ctx.route("https://pas-un-calendrier.example.invalid/**", (r) => r.fulfill({ status: 200, headers: { "content-type": "text/html", "access-control-allow-origin": "*" }, body: "<html>connexion</html>" }));
    await cockpitConnect(page); await page.goto(BASE + "iut/#accueil");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    check(label + " · sans lien : l'accueil invite à le régler", /Ajoute le lien de ton emploi du temps/.test(await page.textContent("#edt-jour")));
    await page.evaluate(() => (location.hash = "reglages"));
    await page.fill("#set-edt", "http://edt.example.invalid/x.ics"); await page.click("#set-edt-form button[type=submit]");
    check(label + " · lien en http:// refusé", await until(async () => /https:\/\/ ou webcal/.test(await page.textContent("#toast"))) && !(mock.json("iut.json").edt || {}).url);
    await page.fill("#set-edt", "webcal://edt.example.invalid/evan.ics"); await page.click("#set-edt-form button[type=submit]");
    check(label + " · lien webcal:// enregistré en https:// dans le dépôt privé", await until(() => (mock.json("iut.json").edt || {}).url === "https://edt.example.invalid/evan.ics"));
    check(label + " · cours copiés dans le document iut (lecture directe)", await until(() => ((mock.json("iut.json").edt || {}).events || []).length === 4));
    await page.waitForTimeout(1500); const nIut = mock.commits.filter((c) => c.message === "app : iut").length;
    await page.evaluate(() => (location.hash = "edt")); await page.click("#edt-maj"); await page.waitForTimeout(2500);
    check(label + " · relire un emploi du temps inchangé n'écrit rien dans le dépôt", mock.commits.filter((c) => c.message === "app : iut").length === nIut);
    await page.evaluate(() => (location.hash = "reglages"));
    const evs = mock.json("iut.json").edt.events, c3 = evs.find((e) => e.id === "c3@iut");
    check(label + " · heure UTC convertie en heure de Paris (07:00Z → 08:00)", c3 && c3.debut.endsWith("T08:00"), c3 && c3.debut);
    check(label + " · texte .ics décodé (virgule, retour à la ligne, ligne pliée)", c3 && c3.titre === "Anglais <b>pro</b> , groupe 2" && /Ligne 1\nLigne très longue qui est pliée sur deux lignes/.test(c3.desc || ""), c3 && JSON.stringify(c3.desc));
    await page.evaluate(() => (location.hash = "accueil"));
    check(label + " · accueil : cours d'aujourd'hui et de demain", await until(async () => { const t = await page.textContent("#edt-jour"); return /R5\.06 VBA/.test(t) && /08 h 00/.test(t) && /Salle B101/.test(t) && /Anglais/.test(t); }));
    check(label + " · titre piégé affiché comme du texte", (await page.locator("#edt-jour b b").count()) === 0 && /<b>pro<\/b>/.test(await page.textContent("#edt-jour")));
    await page.evaluate(() => (location.hash = "edt"));
    check(label + " · onglet Emploi du temps : jours listés", await until(async () => (await page.locator("#edt-list .cours").count()) === 4));
    check(label + " · pas de défilement horizontal · emploi du temps", await noH(page));
    await page.screenshot({ path: path.join(SHOTS, label.split(" ")[0] + "-edt.png"), fullPage: true });
    // l'IUT change l'emploi du temps du jour pour le lendemain
    variant = 2;
    await page.click("#edt-maj");
    check(label + " · actualiser : nouvelle version lue et copiée", await until(() => { const e = mock.json("iut.json").edt.events; return e.some((x) => x.id === "c4@iut") && !e.some((x) => x.id === "c5@iut"); }));
    await page.evaluate(() => (location.hash = "accueil"));
    check(label + " · accueil : changements signalés", await until(async () => /changement/.test(await page.textContent("#edt-jour"))));
    check(label + " · cours déplacé marqué « modifié », nouveau marqué « nouveau »", await until(async () => (await page.locator("#edt-jour .ch-modifie").count()) === 1 && (await page.locator("#edt-jour .ch-nouveau").count()) === 1));
    await page.evaluate(() => (location.hash = "edt"));
    check(label + " · onglet ouvert : cours retiré listé à part, cours déplacé marqué", await until(async () => /Retirés[\s\S]*TP supprimé ensuite/.test(await page.textContent("#edt-list")) && (await page.locator("#edt-list .ch-modifie").count()) === 1));
    await page.evaluate(() => (location.hash = "accueil")); await page.evaluate(() => (location.hash = "edt"));
    check(label + " · une fois l'emploi du temps vu, plus de marque « modifié »", await until(async () => (await page.locator("#edt-list .ch-modifie").count()) === 0 && !/Retirés/.test(await page.textContent("#edt-list"))));
    // lecture directe impossible (CORS) : on garde la copie de Margaux
    cors = false;
    mock.external("iut.json", (d) => { d.edt.events.push({ id: "c9@iut", debut: d.edt.events[0].debut.slice(0, 10) + "T17:00", fin: d.edt.events[0].debut.slice(0, 10) + "T18:00", titre: "Copié par la routine (simulation)", lieu: "Salle Z" }); d.edt.lu = new Date().toISOString(); d.edt.source = "routine"; d.maj = new Date().toISOString(); });
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.click("#edt-maj");
    check(label + " · lecture directe bloquée : message clair et copie de la routine affichée", await until(async () => { const t = await page.textContent("#edt-list"); return /n'a pas pu lire le lien directement/.test(t) && /Copié par la routine/.test(t); }, 15000));
    // un lien qui n'est pas un calendrier
    cors = true;
    await page.evaluate(() => (location.hash = "reglages"));
    await page.fill("#set-edt", "https://pas-un-calendrier.example.invalid/login"); await page.click("#set-edt-form button[type=submit]");
    await page.evaluate(() => (location.hash = "edt"));
    check(label + " · page de connexion au lieu d'un .ics : erreur affichée, rien d'écrasé", await until(async () => /pas un calendrier/.test(await page.textContent("#edt-list"))) && mock.json("iut.json").edt.events.length > 0);
    // ---------- contacts ----------
    await page.evaluate(() => (location.hash = "contacts"));
    check(label + " · contacts groupés par catégorie", await until(async () => /Santé et handicap/.test(await page.textContent("#ct-list")) && /Enseignants/.test(await page.textContent("#ct-list"))));
    check(label + " · liens Appeler / Écrire valides", (await page.locator('#ct-list a[href="tel:0400000000"]').count()) === 1 && (await page.locator('#ct-list a[href="mailto:infirmerie@example.invalid"]').count()) === 1);
    check(label + " · contact piégé : pas de lien javascript:, nom en texte", (await page.locator('#ct-list a[href^="javascript"]').count()) === 0 && (await page.locator("#ct-list img").count()) === 0);
    check(label + " · coordonnées manquantes signalées", /Coordonnées à compléter/.test(await page.textContent("#ct-list")));
    await page.fill("#ct-q", "r5.06");
    check(label + " · recherche", (await page.locator("#ct-list .ct").count()) === 1);
    await page.fill("#ct-q", "");
    await page.click("#ct-add"); await page.fill("#ct-nom", "Scolarité (simulation)"); await page.selectOption("#ct-cat", "scolarite"); await page.fill("#ct-email", "pas-une-adresse"); await page.click("#ct-form button[type=submit]");
    check(label + " · mail invalide refusé", await until(async () => /Adresse mail invalide/.test(await page.textContent("#toast"))));
    await page.fill("#ct-email", "scolarite@example.invalid"); await page.fill("#ct-tel", "+33 4 00 00 00 01"); await page.click("#ct-form button[type=submit]");
    check(label + " · contact ajouté dans le dépôt", await until(() => mock.json("iut.json").contacts.some((c) => c.nom === "Scolarité (simulation)" && c.categorie === "scolarite" && /^[a-z0-9]{8}$/.test(c.id))));
    await page.click('[data-ct-edit="ct000002"]'); await page.fill("#ct-email", "test@example.invalid"); await page.click("#ct-form button[type=submit]");
    check(label + " · contact modifié par id, les autres intacts", await until(() => { const c = mock.json("iut.json").contacts; return c.find((x) => x.id === "ct000002").email === "test@example.invalid" && c.length === 4 && c.find((x) => x.id === "ct000001").tel === "04 00 00 00 00"; }));
    check(label + " · pas de défilement horizontal · contacts", await noH(page));
    await page.screenshot({ path: path.join(SHOTS, label.split(" ")[0] + "-contacts.png"), fullPage: true });
    check(label + " · seuls academie et iut sont écrits", mock.commits.filter((c) => /^app : /.test(c.message)).every((c) => c.message === "app : academie" || c.message === "app : iut"));
    await ctx.close();
  }
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
