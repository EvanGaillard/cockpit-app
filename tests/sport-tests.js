// Tests de l'appli Sport (sport/) : muscu et course, sur 390 px et ordinateur, données FICTIVES, faux GitHub, horloge simulée.
"use strict";
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const { chromium } = require("playwright");
const { MockGitHub, TOKEN, DEFAULT_REPO } = require("./mock-github");
const APP = path.join(__dirname, ".."), DATA = path.join(__dirname, "fixtures");
const SHOTS = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "sport-"));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".webmanifest": "application/manifest+json", ".png": "image/png", ".woff2": "font/woff2" };
function serve() { return new Promise((resolve) => { const srv = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p.endsWith("/")) p += "index.html"; const file = path.join(APP, p); if (!file.startsWith(APP) || file.includes(path.sep + "tests" + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("404"); } res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }); fs.createReadStream(file).pipe(res); }).listen(0, "127.0.0.1", () => resolve(srv)); }); }
let failed = 0; const out = [];
function check(n, c, d) { console.error((c ? "ok " : "KO ") + n); out.push((c ? "ok    · " : "ÉCHEC · ") + n + (d ? " · " + d : "")); if (!c) failed++; }
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 10000)) { try { if (await fn()) return true; } catch (e) {} await new Promise((r) => setTimeout(r, 100)); } return false; }
(async () => {
  const srv = await serve(), BASE = "http://127.0.0.1:" + srv.address().port + "/";
  const browser = await chromium.launch(); const errors = [];
  for (const [label, opts] of [["téléphone 390 px", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ["ordinateur 1280 px", { viewport: { width: 1280, height: 800 } }]]) {
    const slug = label.split(" ")[0];
    const mock = new MockGitHub(DATA);
    const ctx = await browser.newContext(Object.assign({ deviceScaleFactor: 1, serviceWorkers: "block", locale: "fr-FR", timezoneId: "Europe/Paris", permissions: ["clipboard-read", "clipboard-write"] }, opts));
    await ctx.route("https://api.github.com/**", (r) => mock.handle(r));
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.clock.install({ time: new Date("2026-12-01T18:30:00+01:00") }); // mardi : muscu prévue
    await page.goto(BASE + "#reglages");
    await page.fill("#set-owner", DEFAULT_REPO.owner); await page.fill("#set-repo", DEFAULT_REPO.repo); await page.fill("#set-dir", DEFAULT_REPO.dir);
    await page.fill("#set-token", TOKEN); await page.click("#set-form button[type=submit]");
    await until(async () => (await page.textContent("#sync-t")) === "À jour");
    await page.goto(BASE + "sport/");
    check(label + " · réglages du Cockpit repris, « À jour »", await until(async () => (await page.textContent("#sync-t")) === "À jour"));
    const L = () => mock.json("planning.json").log;
    const noH = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    const resync = () => page.evaluate(() => window.dispatchEvent(new Event("online")));

    // ----- MUSCU -----
    check(label + " · mardi : « Commencer la muscu » proposé", await until(async () => /Muscu/.test(await page.textContent("#jour")) && (await page.locator('#jour [data-go="muscu"]').count()) === 1));
    await page.screenshot({ path: path.join(SHOTS, slug + "-0-jour.png"), fullPage: true });
    await page.click('#jour [data-go="muscu"]');
    await page.fill("#m-nom", "Développé couché"); await page.click("#m-exo button[type=submit]");
    await page.fill("#reps-0", "8"); await page.fill("#kg-0", "50"); await page.click('[data-addser="0"]');
    check(label + " · série 1 enregistrée (8 × 50 kg)", /8 × 50 kg/.test(await page.textContent("#muscu .series")));
    check(label + " · minuteur de repos lancé (1:30)", /^1:(30|29)$/.test((await page.textContent("#m-rest-t")).trim()), (await page.textContent("#m-rest-t")).trim());
    await page.click('[data-step="kg:2.5:0"]'); check(label + " · bouton +2,5 kg", (await page.inputValue("#kg-0")) === "52.5");
    // l'appli passe en arrière-plan 60 s : le temps restant est juste au retour
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.clock.fastForward(60000);
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    check(label + " · retour après 60 s : il reste 0:30", await until(async () => /^0:(30|29)$/.test((await page.textContent("#m-rest-t")).trim()), 3000), (await page.textContent("#m-rest-t")).trim());
    await page.screenshot({ path: path.join(SHOTS, slug + "-1-muscu.png"), fullPage: true });
    check(label + " · pas de défilement horizontal (muscu)", await noH());
    await page.clock.fastForward(40000);
    check(label + " · fin du repos signalée", await until(async () => /C'est reparti/.test(await page.textContent("#m-rest-t")), 3000));
    await page.click('[data-addser="0"]');
    // fermer puis rouvrir la page : les séries sont là
    const before = Object.keys(L()).length;
    await page.reload(); await page.goto(BASE + "sport/#jour");
    check(label + " · après réouverture : « Reprendre la séance »", await until(async () => (await page.locator("#j-reprendre").count()) === 1));
    await page.click("#j-reprendre");
    check(label + " · les 2 séries sont retrouvées", await until(async () => (await page.locator("#muscu .series li").count()) === 2, 4000), String(await page.locator("#muscu .series li").count()));
    check(label + " · rien n'est écrit dans le dépôt pendant la séance", Object.keys(L()).length === before);
    // terminer : double appui → une seule séance
    await page.click("#m-terminer"); await page.click('#f-r [data-r="4"]');
    await page.locator("#f-ok").dblclick();
    check(label + " · séance enregistrée une seule fois (double appui)", await until(() => Object.values(L()).filter((e) => e.type === "muscu" && e.source === "sport" && e.sid !== "oldsid01").length === 1));
    const m = L()["2026-12-01:muscu"] || {};
    check(label + " · clé du jour, exercices, séries, ressenti, compatibilité Cockpit (a, b)", m.done === true && m.r === 4 && m.exos && m.exos[0].series.length === 2 && m.exos[0].series[0].kg === 50 && /^\d+$/.test(m.a) && m.b === "Développé couché" && !m.hors);
    check(label + " · Henri signale +31 % de charge (40 → 52,5 kg)", await until(async () => /Henri/.test(await page.textContent("#seance")) && /\+31 %/.test(await page.textContent("#seance"))));
    check(label + " · détail de la séance : séries relisibles", /8 × 50 kg/.test(await page.textContent("#seance")));
    await page.screenshot({ path: path.join(SHOTS, slug + "-2-muscu-fin.png"), fullPage: true });

    // ----- COURSE hors planning (mardi) -----
    await page.goto(BASE + "sport/#jour"); await page.click('#jour [data-go="course-hors"]');
    await page.fill("#c-m", "30"); await page.fill("#c-s", "00"); await page.fill("#c-km", "5");
    check(label + " · allure calculée : 6:00 /km", (await page.textContent("#c-allure")).trim() === "6:00 /km");
    check(label + " · sortie hors planning annoncée", /hors planning/.test(await page.textContent("#c-hors")));
    check(label + " · pas de défilement horizontal (course)", await noH());
    await page.screenshot({ path: path.join(SHOTS, slug + "-3-course.png"), fullPage: true });
    // coupure réseau pendant l'enregistrement, puis retour
    await ctx.setOffline(true);
    await page.click("#c-suivant"); await page.fill("#c-fc", ""); await page.locator("#f-ok").dblclick();
    check(label + " · hors ligne : la sortie est affichée tout de suite", await until(async () => /6:00 \/km/.test(await page.textContent("#seance"))));
    await ctx.setOffline(false); await resync();
    check(label + " · retour du réseau : une seule sortie dans le dépôt", await until(() => { const c = L()["2026-12-01:course"]; return c && c.hors === true && c.distance === 5 && c.duree_s === 1800 && c.allure === "6:00" && c.b === "30:00" && c.a === "5"; }, 15000) && Object.keys(L()).filter((k) => k.startsWith("2026-12-01:course")).length === 1);
    // deuxième sortie le même jour + import Apple Santé (texte du raccourci)
    await page.goto(BASE + "sport/#jour"); await page.click('#jour [data-go="course-hors"]');
    await page.click("#c-import summary");
    await page.fill("#c-paste", '{"date":"2026-12-01","duree_s":1935,"distance_km":5.2,"fc":148}'); await page.click("#c-lire");
    check(label + " · import : champs remplis (32:15, 5,2 km, 148 bpm)", (await page.inputValue("#c-m")) === "32" && (await page.inputValue("#c-s")) === "15" && (await page.inputValue("#c-km")) === "5,2" && (await page.inputValue("#c-fc")) === "148");
    check(label + " · import : allure 6:12 /km", (await page.textContent("#c-allure")).trim() === "6:12 /km");
    await page.click("#c-suivant"); await page.click("#f-ok");
    check(label + " · deuxième sortie du jour : clé « :2 », source Santé", await until(() => { const c = L()["2026-12-01:course:2"]; return c && c.source === "sante" && c.fc === 148 && c.allure === "6:12"; }));
    // ----- historique : anciennes et nouvelles séances -----
    await page.goto(BASE + "sport/#historique");
    const hist = await page.textContent("#histo");
    check(label + " · historique : anciennes séances (format Cockpit) et nouvelles", /28:40/.test(hist) && /Dos, triceps/.test(hist) && /2 séries/.test(hist) && /6:12 \/km/.test(hist));
    await page.click('#histo a[href="#seance/2026-11-25%3Acourse"]');
    check(label + " · détail d'une ancienne course : 5 km, 28:40", await until(async () => /5 km/.test(await page.textContent("#seance")) && /28:40/.test(await page.textContent("#seance"))));
    await page.screenshot({ path: path.join(SHOTS, slug + "-4-historique.png"), fullPage: true });
    await ctx.close();
  }
  // ----- texte libre du raccourci (format « date;durée;distance;fc ») et Henri course -----
  check("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close(); srv.close();
  console.log(out.join("\n")); console.log("\n" + (out.length - failed) + " réussi(s), " + failed + " échec(s) · captures : " + SHOTS);
  process.exit(failed ? 1 : 0);
})();
