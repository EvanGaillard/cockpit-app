// Faux GitHub pour les tests : l'API Contents en mémoire, branchée sur Playwright (context.route).
// Il part d'une COPIE de données FICTIVES (tests/fixtures/*.json) : aucune donnée personnelle dans ce dépôt public.
// Plusieurs instances (un dépôt chacune) permettent de tester le changement de dépôt.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const TOKEN = "test-token";
const DEFAULT_REPO = { owner: "demo-owner", repo: "leon-data-demo", dir: "data" };

class MockGitHub {
  constructor(dataDir, opts) {
    const o = Object.assign({}, DEFAULT_REPO, opts || {});
    this.owner = o.owner; this.repo = o.repo; this.dir = o.dir;
    this.files = new Map(); // nom -> { text, sha, date }
    this.commits = [];      // { message, path, date }
    this.requests = [];     // { method, path, status }
    this.failNext = 0;      // pour simuler une panne réseau côté serveur
    this.beforePut = null;  // (nom) => void : écriture extérieure juste avant le prochain PUT (course entre deux machines)
    for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith(".json"))) this.put(f, fs.readFileSync(path.join(dataDir, f), "utf8"), null);
  }
  sha(text) { return crypto.createHash("sha1").update(text).digest("hex"); }
  put(name, text, message) {
    const date = new Date().toISOString();
    this.files.set(name, { text, sha: this.sha(text + name), date });
    if (message) this.commits.push({ message, path: this.dir + "/" + name, date });
  }
  json(name) { return JSON.parse(this.files.get(name).text); }
  // écriture « extérieure » (routine de Léon, autre appareil)
  external(name, mutate) { const d = this.json(name); mutate(d); this.put(name, JSON.stringify(d, null, 1), "leon : " + name); }

  matches(route) { return decodeURIComponent(new URL(route.request().url()).pathname).startsWith("/repos/" + this.owner + "/" + this.repo); }
  async handle(route) {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept, x-github-api-version", "access-control-allow-methods": "GET, PUT, OPTIONS", "access-control-expose-headers": "x-ratelimit-remaining" };
    const reply = (status, body) => { this.requests.push({ method, path: url.pathname, status }); return route.fulfill({ status, headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, cors), body: JSON.stringify(body) }); };
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (this.failNext > 0) { this.failNext--; return reply(502, { message: "Bad gateway" }); }
    if ((req.headers()["authorization"] || "") !== "Bearer " + TOKEN) return reply(401, { message: "Bad credentials" });
    const p = decodeURIComponent(url.pathname);
    const repoP = "/repos/" + this.owner + "/" + this.repo;
    if (p === repoP && method === "GET") return reply(200, { full_name: this.owner + "/" + this.repo, private: true, permissions: { pull: true, push: true } });
    if (p === repoP + "/commits" && method === "GET") {
      const wanted = url.searchParams.get("path"); const c = this.commits.filter((x) => x.path === wanted).slice(-1);
      return reply(200, c.map((x) => ({ sha: "c", commit: { message: x.message, committer: { date: x.date } } })));
    }
    if (p === repoP + "/contents/" + this.dir && method === "GET") return reply(200, [...this.files].map(([name, f]) => ({ name, path: this.dir + "/" + name, sha: f.sha, type: "file" })));
    const m = p.startsWith(repoP + "/contents/" + this.dir + "/") ? p.slice((repoP + "/contents/" + this.dir + "/").length) : null;
    if (m && method === "GET") {
      const f = this.files.get(m); if (!f) return reply(404, { message: "Not Found" });
      return reply(200, { name: m, sha: f.sha, encoding: "base64", content: Buffer.from(f.text, "utf8").toString("base64").replace(/(.{60})/g, "$1\n") });
    }
    if (m && method === "PUT") {
      if (this.beforePut) { const f0 = this.beforePut; this.beforePut = null; f0(m); }
      const body = JSON.parse(req.postData() || "{}"), f = this.files.get(m);
      if (f && !body.sha) return reply(422, { message: "Invalid request.\n\n\"sha\" wasn't supplied." });
      if (f && body.sha !== f.sha) return reply(409, { message: m + " does not match " + body.sha });
      const text = Buffer.from(body.content, "base64").toString("utf8");
      JSON.parse(text); // doit être du JSON valide
      this.put(m, text, body.message);
      return reply(f ? 200 : 201, { content: { name: m, sha: this.files.get(m).sha }, commit: { message: body.message } });
    }
    return reply(404, { message: "Not Found (mock) " + method + " " + p });
  }
}
module.exports = { MockGitHub, TOKEN, DEFAULT_REPO };
