// Tests de « Parler aux profs » dans l'Académie (iPad et téléphone), données FICTIVES.
// L'appli dépose le message d'Evan ; la routine (simulée par mock.external) dépose la réponse du prof.
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "profs-"));
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
    await page.goto(BASE + "academie/#profs");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    const noH = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    const resync = () => page.evaluate(() => window.dispatchEvent(new Event("online")));
    const M = () => mock.json("academie.json").messages || [];

    check(label + " · 13 personnes (Margaux, 11 profs, Samuel, sans Victor), toutes joignables", (await page.locator("#pf-list .pf").count()) === 13 && !/Victor/.test(await page.textContent("#pf-list")) && (await page.locator("#pf-list .pf.off").count()) === 0);
    check(label + " · pas de défilement horizontal · liste", await noH());
    await page.screenshot({ path: path.join(SHOTS, slug + "-1-profs.png"), fullPage: true });
    await page.click('#pf-list a[href="#prof/ingrid"]');
    check(label + " · conversation d'Ingrid ouverte (anglais)", await until(async () => /Ingrid/.test(await page.textContent("#pf-conv")) && /Anglais/.test(await page.textContent("#pf-conv"))));
    const n0 = mock.commits.length;
    check(label + " · ouvrir une conversation n'écrit rien", mock.commits.length === n0);
    // envoyer
    await page.fill("#pf-text", "How do I say « métrologie » in English? <b>test</b>");
    await page.click("#pf-form button[type=submit]");
    check(label + " · message déposé dans le dépôt (prof, de, statut)", await until(() => M().some((m) => m.prof === "ingrid" && m.de === "evan" && m.statut === "envoye" && /métrologie/.test(m.texte) && /^[a-z0-9]{8}$/.test(m.id))));
    check(label + " · la conversation l'affiche, avec le délai annoncé", await until(async () => /How do I say/.test(await page.textContent("#pf-thread")) && /une fois par heure/.test(await page.textContent("#pf-attente"))));
    check(label + " · texte piégé affiché comme du texte", (await page.locator("#pf-thread b").count()) === 0 && (await page.textContent("#pf-thread")).includes("<b>test</b>"));
    // réponse de la routine (simulée)
    const qid = M().find((m) => m.prof === "ingrid").id;
    mock.external("academie.json", (d) => { const q = d.messages.find((m) => m.id === qid); q.statut = "repondu"; q.maj = new Date().toISOString(); d.messages.push({ id: "rep00001", prof: "ingrid", de: "prof", texte: "« Metrology ». Note the stress on -TRO- (simulation).", at: new Date(Date.now() + 1000).toISOString(), reponseA: qid, maj: new Date().toISOString() }); });
    await page.evaluate(() => (location.hash = "profs")); await resync();
    check(label + " · pastille « 1 » sur l'onglet Profs et sur Ingrid", await until(async () => (await page.textContent("#pf-badge")).trim() === "1" && /1/.test(await page.textContent('#pf-list a[href="#prof/ingrid"] b')), 12000));
    await page.click('#pf-list a[href="#prof/ingrid"]');
    check(label + " · la réponse d'Ingrid s'affiche", await until(async () => /Metrology/.test(await page.textContent("#pf-thread"))));
    check(label + " · plus d'attente annoncée après la réponse", (await page.locator("#pf-attente").count()) === 0);
    check(label + " · la pastille disparaît une fois lue (vu stocké sur l'appareil seulement)", await until(async () => await page.isHidden("#pf-badge")) && !mock.files.get("academie.json").text.includes("acad-vu"));
    check(label + " · pas de défilement horizontal · conversation", await noH());
    await page.screenshot({ path: path.join(SHOTS, slug + "-2-conversation.png"), fullPage: true });
    // tout de suite (secours)
    const n1 = mock.commits.length;
    await page.fill("#pf-text", "Peux-tu me corriger cette phrase ?");
    await page.click("#pf-form [data-now]");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(label + " · « Tout de suite » : copié pour Margaux, bureau ouvert, rien écrit", /^Margaux, transmets à Ingrid \(Anglais\) : « Peux-tu me corriger cette phrase \? »/.test(clip) && (await page.evaluate(() => window.__opened.length)) === 1 && mock.commits.length === n1);
    // message en erreur : bouton « Renvoyer »
    mock.external("academie.json", (d) => d.messages.push({ id: "err00001", prof: "ingrid", de: "evan", texte: "Message en erreur (test)", at: new Date().toISOString(), statut: "erreur", maj: new Date().toISOString() }));
    await resync();
    check(label + " · message non transmis : bouton « Renvoyer »", await until(async () => (await page.locator('#pf-thread [data-renvoi="err00001"]').count()) === 1, 12000));
    await page.click('#pf-thread [data-renvoi="err00001"]');
    check(label + " · renvoyer : le message repasse à « envoye »", await until(() => M().find((m) => m.id === "err00001").statut === "envoye"));
    // Samuel : repères d'urgence toujours visibles
    await page.evaluate(() => (location.hash = "prof/samuel"));
    check(label + " · Samuel : 15, 112 et 3114 affichés en permanence", await until(async () => { const x = await page.textContent("#pf-urgence"); return /15/.test(x) && /112/.test(x) && /3114/.test(x); }));
    await page.evaluate(() => (location.hash = "prof/ingrid"));
    check(label + " · les autres profs n'affichent pas ce bloc, mais la mention des données privées", await until(async () => (await page.locator("#pf-urgence").count()) === 0 && /données privées/.test(await page.textContent("#pf-conv"))));
    // une personne inconnue
    await page.evaluate(() => (location.hash = "prof/inconnu"));
    check(label + " · adresse d'une personne inconnue : message clair", await until(async () => /Personne introuvable/.test(await page.textContent("#pf-conv"))));
    await ctx.close();
  }
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
