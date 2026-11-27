// Tests du « Travailler dessus » automatique (ticket #6) : file d'attente dans le document academie, données FICTIVES.
// L'appli dépose la demande ; une routine (simulée ici par mock.external) la prend puis rend le travail.
// Usage : node tests/travail-tests.js [dossier-des-captures]
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "travail-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
function serve() { return new Promise((resolve) => { const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const file = path.join(APP, p); if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); }).listen(0, "127.0.0.1", () => resolve(srv)); }); }
let failed = 0; const out = [];
function check(n, c, d) { console.error((c ? "ok " : "KO ") + n); out.push((c ? "ok    · " : "ÉCHEC · ") + n + (d ? " · " + d : "")); if (!c) failed++; }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; }
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
    await page.goto(BASE + "#reglages");
    await page.fill("#set-owner", DEFAULT_REPO.owner); await page.fill("#set-repo", DEFAULT_REPO.repo); await page.fill("#set-dir", DEFAULT_REPO.dir);
    await page.fill("#set-token", TOKEN); await page.click("#set-form button[type=submit]");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.goto(BASE + "academie/#devoir/dvsim506");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.waitForSelector("#dv-detail [data-work]");
    const dv = () => mock.json("academie.json").devoirs.find((x) => x.id === "dvsim506");
    const resync = () => page.evaluate(() => window.dispatchEvent(new Event("online")));

    // 1. Travailler dessus sans choix : la demande est déposée dans le document, sans style ni consigne
    await page.click("#dv-detail [data-work]");
    check(label + " · demande déposée dans le dépôt (statut demande, prof, texte)", await until(() => { const t = dv().travail; return t && t.statut === "demande" && t.prof === "Margaux" && t.style === null && t.consigne === null && /Projet tutoré VBA/.test(t.demande) && /^[a-z0-9]{8}$/.test(t.id); }));
    check(label + " · commit « app : academie »", mock.commits.some((c) => c.message === "app : academie"));
    check(label + " · aucune ouverture du bureau (plus besoin de coller)", (await page.evaluate(() => window.__opened.length)) === 0);
    check(label + " · la fiche affiche « Demandé à Margaux » et bloque un second envoi", /Demandé à Margaux/.test(await page.textContent("#dv-travail")) && (await page.isDisabled("#dv-detail [data-work]")) && (await page.textContent("#dv-detail [data-work]")).trim() === "Déjà demandé");
    check(label + " · pas de défilement horizontal", await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    await page.screenshot({ path: path.join(SHOTS, slug + "-1-demande.png"), fullPage: true });
    // 2. Annuler
    await page.click("#dv-detail [data-trav-annule]");
    check(label + " · annuler : statut annule dans le dépôt", await until(() => dv().travail.statut === "annule"));
    check(label + " · après annulation, le bouton revient", await until(async () => !(await page.isDisabled("#dv-detail [data-work]"))));
    // 3. Avec un choix de Samuel (défi) : le style et la consigne voyagent avec la demande
    await page.click('#dv-detail [data-sam-st="defi"]');
    await page.click("#dv-detail [data-work]");
    check(label + " · défi : style et consigne de Samuel dans la demande", await until(() => { const t = dv().travail; return t.statut === "demande" && t.style === "defi" && /Consigne de Samuel/.test(t.consigne || ""); }));
    check(label + " · le choix est oublié dans l'appli après l'envoi", (await page.locator("#dv-detail .samuel .pill.on").count()) === 0);
    // 4. La routine (simulée) prend le travail : en_cours, style et consigne effacés
    mock.external("academie.json", (d) => { const x = d.devoirs.find((y) => y.id === "dvsim506"); x.travail.statut = "en_cours"; x.travail.style = null; x.travail.consigne = null; x.travail.maj = new Date().toISOString(); });
    await resync();
    check(label + " · la fiche affiche « Margaux y travaille »", await until(async () => /Margaux y travaille/.test(await page.textContent("#dv-travail")), 12000));
    // 5. Rendu prêt
    mock.external("academie.json", (d) => { const x = d.devoirs.find((y) => y.id === "dvsim506"); Object.assign(x.travail, { statut: "pret", resume: "Plan du rendu en 5 parties (simulation).", rendu: "Apprendre/Devoir - simulation.md", maj: new Date().toISOString() }); });
    await resync();
    check(label + " · « Rendu prêt » avec le résumé et la note", await until(async () => { const t = await page.textContent("#dv-travail"); return /Rendu prêt/.test(t) && /Plan du rendu en 5 parties/.test(t) && /Apprendre\/Devoir - simulation\.md/.test(t); }, 12000));
    check(label + " · on peut redemander un travail", !(await page.isDisabled("#dv-detail [data-work]")));
    await page.screenshot({ path: path.join(SHOTS, slug + "-2-pret.png"), fullPage: true });
    await page.evaluate(() => (location.hash = "devoirs"));
    check(label + " · la liste montre « Rendu prêt »", await until(async () => /Rendu prêt/.test(await page.textContent("#dv-list"))));
    // 6. Secours : l'ancien parcours (copie + bureau) marche toujours et n'écrit rien
    await page.evaluate(() => (location.hash = "devoir/dvsim506")); await page.waitForSelector("#dv-detail [data-bureau]");
    const n0 = mock.commits.length;
    await page.click("#dv-detail [data-bureau]");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(label + " · secours : demande copiée et bureau ouvert, rien écrit", /Margaux, je veux avancer sur le devoir/.test(clip) && (await page.evaluate(() => window.__opened.length)) === 1 && mock.commits.length === n0);
    await ctx.close();
  }
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
