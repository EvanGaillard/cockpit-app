// Tests de Samuel (« comment veux-tu travailler ? ») dans l'Académie, sur iPad et téléphone, données FICTIVES.
// Vérifie : le choix change le premier pas ; ce que le prof reçoit (texte copié pour le bureau de Margaux) ;
// passage direct sans consigne ; rien n'est enregistré (dépôt, localStorage, sessionStorage) ; choix oublié après la séance.
// Usage : node tests/samuel-tests.js [dossier-des-captures]
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "samuel-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
function serve() { return new Promise((resolve) => { const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const file = path.join(APP, p); if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); }).listen(0, "127.0.0.1", () => resolve(srv)); }); }
let failed = 0; const out = [];
function check(n, c, d) { console.error((c ? "ok " : "KO ") + n); out.push((c ? "ok    · " : "ÉCHEC · ") + n + (d ? " · " + d : "")); if (!c) failed++; }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 8000)) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; }
(async () => {
  const srv = await serve(), BASE = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(); const errors = [];
  for (const [label, opts] of [["iPad 820 px", { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true }], ["téléphone 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const slug = label.split(" ")[0];
    const mock = new MockGitHub(DATA);
    const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris", permissions: ["clipboard-read", "clipboard-write"] }, opts));
    await ctx.route("https://api.github.com/**", (r) => mock.handle(r));
    await ctx.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    // Cockpit réglé, puis Académie
    await page.goto(BASE + "#reglages");
    await page.fill("#set-owner", DEFAULT_REPO.owner); await page.fill("#set-repo", DEFAULT_REPO.repo); await page.fill("#set-dir", DEFAULT_REPO.dir);
    await page.fill("#set-token", TOKEN); await page.click("#set-form button[type=submit]");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.goto(BASE + "iut/");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await until(async () => /Compte rendu de TP/.test(await page.textContent("#reco")));
    const commits0 = mock.commits.length;
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    const noH = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

    // 0. Discret : rien n'est choisi par défaut, aucune proposition affichée
    check(label + " : facultatif, aucun choix par défaut", (await page.locator("#reco .samuel .pill.on").count()) === 0 && (await page.locator("#reco .sam-plan").count()) === 0);

    // 1. Passage direct : on lance la séance sans rien choisir → aucune consigne de Samuel
    await page.click('#reco [data-start="oral"]');
    const direct = await clip();
    check(label + " · direct : la demande part sans consigne de Samuel", /Margaux, lance une séance/.test(direct) && !/Samuel/.test(direct), direct.slice(0, 80));
    check(label + " · direct : le bureau de Margaux s'ouvre", (await page.evaluate(() => window.__opened.length)) === 1);

    // 2. Démarrage difficile : premier pas court et précis, adapté à la séance (le devoir proposé)
    await page.click('#reco [data-sam-st="demarrer"]');
    const plan1 = await page.textContent("#reco .sam-plan");
    check(label + " · mal à démarrer : premier pas de 3 min lié au devoir", /Premier pas, 3 min/.test(plan1) && /Compte rendu de TP/.test(plan1), plan1.replace(/\s+/g, " ").slice(0, 120));
    check(label + " · mal à démarrer : pas de message d'encouragement creux", !/courage|tu peux le faire|bravo|motivation/i.test(plan1));
    await page.click("[data-sam-timer]");
    check(label + " · mal à démarrer : minuteur de 3 min lancé", await until(async () => /^[23]:\d\d$/.test((await page.textContent(".sam-time")).trim())));
    check(label + " · pas de défilement horizontal avec la proposition", await noH());
    await page.screenshot({ path: path.join(SHOTS, slug + "-1-demarrer.png"), fullPage: true });
    await page.click('#reco [data-start="oral"]');
    const p1 = await clip();
    check(label + " · mal à démarrer : le prof reçoit la consigne et le premier pas", /Consigne de Samuel \(pour cette séance seulement\)/.test(p1) && /J'ai du mal à démarrer/.test(p1) && /sans introduction ni encouragement/.test(p1) && p1.includes("Compte rendu de TP"), p1.split("\n\n")[1] ? p1.split("\n\n")[1].slice(0, 140) : "");
    check(label + " · le choix est oublié une fois la séance lancée", (await page.locator("#reco .samuel .pill.on").count()) === 0 && (await page.locator("#reco .sam-plan").count()) === 0);

    // 3. En douceur
    await page.click('#reco [data-sam-st="doux"]');
    check(label + " · en douceur : proposition affichée", /Pour commencer en douceur/.test(await page.textContent("#reco .sam-plan")));
    await page.click('#reco [data-start="ecrit"]');
    const p2 = await clip();
    check(label + " · en douceur : le prof reçoit « rythme lent, 15 min, pas d'évaluation »", /Je veux y aller doucement/.test(p2) && /rythme lent/.test(p2) && /15 min au plus/.test(p2) && /pas d'évaluation/.test(p2) && /à l'écrit, 15 minutes/.test(p2));

    // 4. Défi, depuis la fiche d'un devoir (le même parcours de séance)
    await page.evaluate(() => (location.hash = "devoir/dvsim506"));
    await page.waitForSelector("#dv-detail [data-sam-st]");
    await page.click('#dv-detail [data-sam-st="defi"]');
    const plan3 = await page.textContent("#dv-detail .sam-plan");
    check(label + " · défi : entrée ambitieuse liée au devoir", /Pour entrer/.test(plan3) && /en 5 minutes chrono, ferme-le, puis écris de mémoire le plan/.test(plan3) && /Margaux le confronte/.test(plan3), plan3.replace(/\s+/g, " ").slice(0, 120));
    check(label + " · défi : bouton « Lancer le défi »", (await page.textContent("#dv-detail [data-work]")).trim() === "Lancer le défi");
    check(label + " · pas de défilement horizontal · fiche avec défi", await noH());
    await page.screenshot({ path: path.join(SHOTS, slug + "-2-defi.png"), fullPage: true });
    await page.click("#dv-detail [data-bureau]"); // parcours de secours : copie + bureau de Margaux
    const p3 = await clip();
    check(label + " · défi : le prof reçoit l'entrée ambitieuse et la correction exigeante", /J'ai envie d'un défi/.test(p3) && /Ouvre par ce défi/.test(p3) && /correction exigeante/.test(p3) && /Projet tutoré VBA \(simulation\)/.test(p3) && /avec toi, à l'écrit, 20 minutes/.test(p3));

    // 5. Démarrage difficile sur la fiche : premier pas = ouvrir le vrai fichier du sujet
    await page.click('#dv-detail [data-sam-st="demarrer"]');
    check(label + " · mal à démarrer (fiche) : ouvrir le sujet par son nom", /Ouvre « Projet_Simulation_Nom_De_Fichier_Tres_Long_Sans_Espaces_2026_2027\.pdf » sur le PC/.test(await page.textContent("#dv-detail .sam-plan")));
    // un second appui désélectionne
    await page.click('#dv-detail [data-sam-st="demarrer"]');
    check(label + " · un second appui retire le choix", (await page.locator("#dv-detail .sam-plan").count()) === 0);

    // 6. Rien n'est enregistré : ni dans le dépôt, ni dans le navigateur ; rien après rechargement
    check(label + " · aucun choix écrit dans le dépôt", mock.commits.length === commits0 && !/Samuel|demarrer|defi|doux/.test(mock.files.get("academie.json").text.replace(/Samuel \(mentor\)/g, "")));
    const store = await page.evaluate(() => JSON.stringify([Object.keys(localStorage), Object.keys(sessionStorage)]));
    check(label + " · rien dans localStorage ni sessionStorage", store === "[[],[]]", store);
    await page.click('#dv-detail [data-sam-st="doux"]'); await page.reload();
    await page.waitForSelector("#dv-detail [data-sam-st]");
    check(label + " · après rechargement, plus aucun choix", (await page.locator("#dv-detail .samuel .pill.on").count()) === 0);
    await ctx.close();
  }
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
