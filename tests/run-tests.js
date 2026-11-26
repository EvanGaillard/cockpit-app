// Tests de l'app dans Chromium (Playwright), avec un faux GitHub.
// Usage, depuis la racine du coffre :  node Systeme/Cockpit/app/tests/run-tests.js [dossier-des-captures]
// Les captures d'écran vont dans le dossier donné (par défaut : le dossier temporaire du système), jamais dans le dépôt.
"use strict";
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN } = require("./mock-github");

const APP = path.join(__dirname, "..");
const DATA = path.join(APP, "..", "data");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-app-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.join(APP, p);
      if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
      fs.createReadStream(file).pipe(res);
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

const results = [];
let failed = 0;
function check(name, cond, detail) { console.error((cond ? "ok " : "KO ") + name); results.push((cond ? "ok    · " : "ÉCHEC · ") + name + (detail ? " · " + detail : "")); if (!cond) failed++; }
async function until(fn, ms, label) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { try { if (await fn()) return true; } catch (e) { /* on réessaie */ } await new Promise((r) => setTimeout(r, 100)); } if (label) console.warn("délai dépassé :", label); return false; }

const VIEWS = ["aujourdhui", "taches", "projets", "notes", "semaine", "equipe", "reglages"];

(async () => {
  const srv = await serve();
  const BASE = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch();
  const errors = [];

  async function setup(ctxOpts, mock, sw) {
    const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 1, serviceWorkers: sw ? "allow" : "block", locale: "fr-FR", timezoneId: "Europe/Paris" }, ctxOpts));
    await ctx.route("https://api.github.com/**", (route) => mock.handle(route));
    const page = await ctx.newPage();
    page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::/.test(m.text())) errors.push("console : " + m.text()); });
    return { ctx, page };
  }
  async function connectToken(page) {
    await page.goto(BASE + "#reglages");
    await page.fill("#set-token", TOKEN);
    await page.click("#set-form button[type=submit]");
    return until(async () => (await page.textContent("#sync-t")) === "À jour", 10000, "synchro initiale");
  }
  async function noHScroll(page) { return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1); }

  // ---------- 1. Affichage téléphone (390 px) et ordinateur (1280 px) ----------
  for (const [label, opts] of [["téléphone 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["ordinateur 1280 px", { viewport: { width: 1280, height: 800 } }]]) {
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup(opts, mock);
    await page.goto(BASE);
    check(label + " : bannière « jeton à saisir » au premier lancement", await page.isVisible("#setup-banner"));
    check(label + " : synchro initiale avec le dépôt", await connectToken(page));
    const nHab = mock.json("habits.json").items.length;
    await page.goto(BASE + "#aujourdhui");
    check(label + " : données chargées (habitudes)", await until(async () => (await page.locator("#hab-today .hab").count()) === nHab), nHab + " habitudes");
    const slug = label.startsWith("t") ? "tel" : "pc";
    for (const v of VIEWS) {
      await page.evaluate((h) => (location.hash = h), v);
      await page.waitForTimeout(150);
      check(label + " : pas de défilement horizontal · " + v, await noHScroll(page));
      await page.screenshot({ path: path.join(SHOTS, slug + "-" + v + ".png"), fullPage: v === "aujourdhui" });
    }
    await page.evaluate(() => (location.hash = "projets"));
    const nGoals = mock.json("goals.json").items.length;
    check(label + " : projets affichés", (await page.locator("#pcards .pcard").count()) === nGoals, nGoals + " projets");
    await ctx.close();
  }

  // ---------- 2. Cocher, ajouter, hors ligne, conflit, ticket (ordinateur) ----------
  {
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup({ viewport: { width: 1280, height: 800 } }, mock);
    await page.goto(BASE);
    await connectToken(page);
    await page.goto(BASE + "#aujourdhui");
    await page.waitForSelector("#f-title");

    // cocher une tâche (« C'est fait » sur la tâche du moment)
    const t1 = (await page.textContent("#f-title")).trim();
    await page.click("#focus button:has-text(\"C'est fait\")");
    const done1 = await until(() => { const t = mock.json("tasks.json").items.find((x) => x.title === t1); return t && t.done === true && /^\d{4}-\d{2}-\d{2}$/.test(t.doneAt || ""); }, 8000, "cocher");
    check("cocher une tâche : écrite dans le dépôt (done + doneAt)", done1, t1);
    check("message de commit « app : tasks »", mock.commits.some((c) => c.message === "app : tasks"));

    // ajouter une tâche (saisie express)
    await page.click(".qa-open");
    await page.fill("#qa-title", "Tâche de test #essai");
    await page.click("#qa-when button:has-text(\"Aujourd'hui\")");
    await page.click("#qa-form button[type=submit]");
    const added = await until(() => mock.json("tasks.json").items.some((x) => x.title === "Tâche de test" && x.when === "today" && (x.tags || []).includes("essai") && x.done === false), 8000, "ajout");
    check("ajouter une tâche : écrite dans le dépôt (when, tags)", added);
    check("ajouter une tâche : visible dans Aujourd'hui", await page.isVisible("#next-list .row .t:text-is('Tâche de test'), #f-title:text-is('Tâche de test')"));

    // hors ligne : on continue à travailler, rien n'est perdu
    const putsBefore = mock.requests.filter((r) => r.method === "PUT").length;
    await ctx.setOffline(true);
    await page.waitForTimeout(200);
    check("hors ligne : état affiché", /Hors ligne/.test(await page.textContent("#sync-t")), await page.textContent("#sync-t"));
    await page.click(".qa-open");
    await page.fill("#qa-title", "Tâche hors ligne");
    await page.click("#qa-form button[type=submit]");
    const hab = mock.json("habits.json").items[0];
    await page.click("#hab-today .hab >> nth=0");
    await page.click("#sc-m .lv >> nth=3"); // humeur 4
    await page.waitForTimeout(1800);
    check("hors ligne : aucune écriture tentée", mock.requests.filter((r) => r.method === "PUT").length === putsBefore);
    check("hors ligne : modifications en attente signalées", /à envoyer/.test(await page.textContent("#sync-t")), await page.textContent("#sync-t"));
    await ctx.setOffline(false);
    const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
    const resync = await until(() => mock.json("tasks.json").items.some((x) => x.title === "Tâche hors ligne" && x.when === "inbox") && ((mock.json("habits.json").log || {})[today] || []).length > 0 && (mock.json("mood.json").log[today] || {}).m === 4, 10000, "resynchro");
    check("retour du réseau : tâche, habitude et humeur envoyées", resync);
    check("retour du réseau : état « À jour »", await until(async () => (await page.textContent("#sync-t")) === "À jour", 5000));
    void hab;

    // conflit : Léon écrit dans le dépôt pendant que l'appareil modifie le même document
    const t2 = (await page.textContent("#f-title")).trim();
    mock.external("tasks.json", (d) => {
      d.items.push({ id: "leon0001", title: "Ajoutée par Léon", prio: "moyenne", due: null, done: false, doneAt: null, created: today, byClaude: true, when: "inbox" });
      const x = d.items.find((y) => y.title === t2); if (x) x.prio = "basse"; // autre champ de la même tâche
    });
    mock.external("equipe.json", (d) => { d.tickets.push({ id: "leon0002", n: 99, demande: "Ticket créé par Léon pendant ce temps", statut: "nouveau", created: new Date().toISOString(), source: "bureau", journal: [] }); });
    await page.click("#focus button:has-text(\"C'est fait\")");                  // modifie la tâche t2 (done)
    await page.click(".qa-open"); await page.fill("#qa-title", "Ajoutée sur l'appareil"); await page.click("#qa-form button[type=submit]");
    const merged = await until(() => { const it = mock.json("tasks.json").items; const x = it.find((y) => y.title === t2); return it.some((y) => y.id === "leon0001") && it.some((y) => y.title === "Ajoutée sur l'appareil") && x && x.done === true && x.prio === "basse"; }, 10000, "conflit");
    check("conflit (dépôt modifié avant l'envoi) : tâche de Léon + tâche de l'appareil + les deux champs de la tâche modifiée gardés", merged);
    // course : Léon écrit entre la lecture et l'écriture de l'appareil → le PUT reçoit 409, l'app relit, fusionne, réécrit
    await until(async () => (await page.textContent("#sync-t")) === "À jour", 5000);
    const conflictsBefore = mock.requests.filter((r) => r.status === 409).length;
    mock.beforePut = (name) => { if (name === "tasks.json") mock.external("tasks.json", (d) => d.items.push({ id: "leon0003", title: "Ajoutée par Léon pendant l'envoi", prio: "haute", due: null, done: false, doneAt: null, created: today, byClaude: true, when: "today" })); };
    await page.click(".qa-open"); await page.fill("#qa-title", "Envoyée pendant la course"); await page.click("#qa-form button[type=submit]");
    const raced = await until(() => { const it = mock.json("tasks.json").items; return it.some((y) => y.id === "leon0003") && it.some((y) => y.title === "Envoyée pendant la course") && it.some((y) => y.id === "leon0001"); }, 10000, "course");
    check("conflit de version (409) : relu, fusionné, réécrit sans perte", raced && mock.requests.filter((r) => r.status === 409).length > conflictsBefore);
    check("conflit : la tâche de Léon apparaît dans l'app", await until(async () => (await page.evaluate(() => (location.hash = "taches"), null), await page.click("#tk-tabs button:has-text('Boîte de réception')"), await page.locator("text=Ajoutée par Léon").count()) > 0, 5000));

    // ticket pour Léon (remplace le copilote)
    await page.evaluate(() => (location.hash = "aujourdhui"));
    await page.click("#focus button:has-text('Demander à Léon')");
    await page.waitForTimeout(150);
    check("« Demander à Léon » prépare une demande dans l'onglet Équipe", (await page.inputValue("#eq-text")).startsWith("Aide-moi sur la tâche"));
    await page.fill("#eq-text", "Test : compare deux mutuelles");
    await page.click("#eq-send");
    const tk = await until(() => mock.json("equipe.json").tickets.some((t) => t.demande === "Test : compare deux mutuelles" && t.statut === "nouveau" && t.source === "app" && t.n === 100), 8000, "ticket");
    check("ticket créé dans equipe (nouveau, source app, numéro suivant) sans perdre celui de Léon", tk && mock.json("equipe.json").tickets.some((t) => t.id === "leon0002"));
    // les champs que l'app ne connaît pas sont conservés
    check("champs inconnus des documents conservés (equipe.budget, equipe.maj)", !!mock.json("equipe.json").budget && !!mock.json("equipe.json").maj);
    await page.screenshot({ path: path.join(SHOTS, "pc-equipe-ticket.png") });
    await ctx.close();
  }

  // ---------- 3. App hors ligne grâce au service worker (téléphone) ----------
  {
    const mock = new MockGitHub(DATA);
    const { ctx, page } = await setup({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, mock, true);
    await page.goto(BASE);
    await connectToken(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto(BASE + "#aujourdhui"); await page.waitForSelector("#hab-today .hab");
    check("service worker actif", await page.evaluate(() => !!navigator.serviceWorker.controller));
    await ctx.setOffline(true);
    await page.reload();
    const shown = await until(async () => (await page.locator("#hab-today .hab").count()) > 0, 5000, "ouverture hors ligne");
    check("hors ligne : l'app s'ouvre et affiche les données locales", shown);
    check("hors ligne : polices chargées depuis le cache", await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("700 18px 'Bricolage Grotesque'"); }));
    await page.click("#hab-today .hab >> nth=1");
    await page.screenshot({ path: path.join(SHOTS, "tel-hors-ligne.png") });
    await ctx.setOffline(false);
    const today = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
    const id2 = mock.json("habits.json").items[1].id;
    check("après le retour du réseau (page sous service worker) : envoyé", await until(() => ((mock.json("habits.json").log || {})[today] || []).includes(id2), 10000, "resynchro sw"));
    await ctx.close();
  }

  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 5).join(" | "));
  await browser.close(); srv.close();
  results.filter((r) => r.startsWith("ÉCHEC")).forEach((r) => console.log(r));
  console.log("\n" + (results.length - failed) + "/" + results.length + " vérifications réussies · captures : " + SHOTS);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
