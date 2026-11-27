// Tests de l'Académie (academie/) dans Chromium, avec le faux GitHub et des données FICTIVES.
// Usage : node tests/academie-tests.js [dossier-des-captures]
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "academie-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
function serve() { return new Promise((resolve) => { const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const file = path.join(APP, p); if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); }).listen(0, "127.0.0.1", () => resolve(srv)); }); }
let failed = 0; const out = [];
function check(n, c, d) { console.error((c ? "ok " : "KO ") + n); out.push((c ? "ok    · " : "ÉCHEC · ") + n + (d ? " · " + d : "")); if (!c) failed++; }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; }
const VIEWS = ["accueil", "devoirs", "matieres", "seances", "idees", "reglages"];
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
    await page.click(".acadlink");
    check(label + " : bouton « Académie » du Cockpit ouvre l'Académie", await until(async () => (await page.title()) === "Académie"));
    await page.goto(BASE + "academie/");
    check(label + " : réglages du Cockpit repris tout seuls, synchro « À jour »", await until(async () => (await page.textContent("#sync-t")) === "À jour"));
    check(label + " : recommandation = devoir urgent", await until(async () => /Compte rendu de TP/.test(await page.textContent("#reco"))));
    const slug = label.split(" ")[0];
    for (const v of VIEWS) { await page.evaluate((h) => (location.hash = h), v); await page.waitForTimeout(150); check(label + " : pas de défilement horizontal · " + v, await noH(page)); await page.screenshot({ path: path.join(SHOTS, slug + "-" + v + ".png"), fullPage: true }); }
    check(label + " : lien « ← Cockpit » présent", (await page.getAttribute(".back", "href")) === "../");
    await page.evaluate(() => (location.hash = "matieres"));
    check(label + " : 13 matières, 12 en attente (seule la philo est active)", (await page.locator(".mat").count()) === 13 && (await page.locator(".mat.off").count()) === 12);
    await ctx.close();
  }
  { // écritures (ordinateur)
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup({ viewport: { width: 1280, height: 800 } }, mock);
    await cockpitConnect(page); await page.goto(BASE + "academie/#idees");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.fill("#id-text", "Idée de test"); await page.click("#id-form button[type=submit]");
    check("idée écrite dans le dépôt (academie.json)", await until(() => mock.json("academie.json").idees.some((i) => i.texte === "Idée de test" && i.statut === "nouveau" && /^[a-z0-9]{8}$/.test(i.id))));
    check("commit « app : academie »", mock.commits.some((c) => c.message === "app : academie"));
    await page.evaluate(() => (location.hash = "seances")); await page.click("#se-add-open");
    await page.selectOption("#se-mat", "darija"); await page.fill("#se-bilan", "Cinq mots (test)"); await page.click("#se-form button[type=submit]");
    check("séance écrite dans le dépôt", await until(() => mock.json("academie.json").seances.some((s) => s.matiere === "darija" && s.prof === "Margaux" && s.bilan === "Cinq mots (test)")));
    await page.evaluate(() => (location.hash = "devoirs")); await page.click("#dv-add-open");
    await page.fill("#dv-titre", "Devoir de test"); await page.selectOption("#dv-mat", "energie"); await page.click("#dv-form button[type=submit]");
    check("devoir d'une matière en attente : confié à Margaux", await until(() => mock.json("academie.json").devoirs.some((d) => d.titre === "Devoir de test" && d.prof === "Margaux" && d.statut === "nouveau")));
    // statut changé + écriture concurrente d'une routine (Margaux) : rien n'est perdu
    mock.beforePut = () => mock.external("academie.json", (d) => d.devoirs.push({ id: "dvroutin", titre: "Ajouté par Odile", matiere: "iut", prof: "Victor", statut: "attribue", created: "2026-11-27T10:00:00Z", maj: "2026-11-27T10:00:00Z" }));
    await page.selectOption('[data-st="dv000002"]', "premier_rendu");
    check("conflit : statut gardé ET devoir de la routine gardé", await until(() => { const d = mock.json("academie.json").devoirs; return d.some((x) => x.id === "dvroutin") && (d.find((x) => x.id === "dv000002") || {}).statut === "premier_rendu"; }));
    check("l'app affiche le devoir ajouté par la routine", await until(async () => /Ajouté par Odile/.test(await page.textContent("#dv-list"))));
    // le Cockpit n'est pas touché par l'Académie
    check("aucun autre document modifié par l'Académie", mock.commits.filter((c) => /^app : /.test(c.message)).every((c) => c.message === "app : academie"));
    // le jeton n'est jamais recopié dans la base de l'Académie
    const tokInAcad = await page.evaluate(() => new Promise((res) => { const rq = indexedDB.open("academie-app"); rq.onsuccess = () => { const d = rq.result; const r = d.transaction("kv", "readonly").objectStore("kv").get("token"); r.onsuccess = () => res(r.result || null); r.onerror = () => res("err"); }; }));
    check("jeton absent de la base de l'Académie (relu dans le Cockpit)", tokInAcad === null);
    // hors ligne puis retour
    await ctx.setOffline(true); await page.evaluate(() => (location.hash = "idees"));
    await page.fill("#id-text", "Idée hors ligne"); await page.click("#id-form button[type=submit]");
    check("hors ligne : état « Hors ligne »", await until(async () => /Hors ligne/.test(await page.textContent("#sync-t"))));
    await ctx.setOffline(false);
    check("retour du réseau : idée envoyée", await until(() => mock.json("academie.json").idees.some((i) => i.texte === "Idée hors ligne"), 15000));
    await ctx.close();
  }
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
