/* Cockpit app · stockage local (IndexedDB) et synchronisation avec le dépôt GitHub.
 *
 * Chaque document (tasks, goals…) est un fichier Systeme/Cockpit/data/<doc>.json du dépôt privé.
 * L'appareil garde pour chaque document :
 *   data  : la version affichée (avec les changements pas encore envoyés),
 *   base  : la dernière version lue ou écrite dans le dépôt,
 *   sha   : l'identifiant GitHub de cette version (obligatoire pour écrire),
 *   dirty : vrai tant qu'un changement local n'est pas dans le dépôt.
 * Lecture : GET du dossier (une requête donne le sha de tous les fichiers), puis GET des fichiers qui ont changé.
 * Écriture : PUT avec le sha. Si le dépôt a changé entre-temps (409 ou 422) : relire, fusionner (merge.js), réécrire.
 * Le jeton GitHub reste sur l'appareil (IndexedDB), jamais dans le code ni dans le dépôt.
 */
(function (root) {
  "use strict";
  const M = root.CockpitMerge;
  // Une autre app du même site (ex. academie/) peut définir self.STORE_CONFIG avant de charger ce fichier :
  // {dbName, docs, readonly, empty, importFrom}. Sans STORE_CONFIG, c'est le Cockpit (comportement inchangé).
  const CFG = root.STORE_CONFIG || {};
  const DOCS = CFG.docs || ["tasks", "habits", "goals", "mood", "inbox", "brief", "day", "planning", "equipe"];
  const READONLY = new Set(CFG.readonly || ["brief"]); // brief : écrit seulement par les routines de Léon
  const EMPTY = Object.assign({ tasks: { items: [] }, habits: { items: [], log: {} }, goals: { items: [] }, mood: { log: {} }, inbox: { items: [] }, brief: {}, day: {}, planning: {}, equipe: { tickets: [] } }, CFG.empty || {});
  const DB_NAME = CFG.dbName || "cockpit-app";
  const DEFAULTS = { owner: "", repo: "", branch: "main", dir: "data" }; // aucun compte pré-rempli : l'utilisateur saisit son dépôt privé (ex. leon-data) dans Réglages
  const API = "https://api.github.com";
  const PUSH_DELAY = 3000, POLL_MS = 60000; // 3 s : plusieurs gestes rapprochés = un seul commit

  // ---------- IndexedDB ----------
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains("docs")) d.createObjectStore("docs", { keyPath: "name" }); if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error);
    });
    return dbp;
  }
  async function idb(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, mode), st = tx.objectStore(store);
      let out; const r = fn(st); if (r) r.onsuccess = () => { out = r.result; };
      tx.oncomplete = () => resolve(out); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  }
  const kvGet = (k) => idb("kv", "readonly", (s) => s.get(k));
  const kvSet = (k, v) => idb("kv", "readwrite", (s) => s.put(v, k));
  const kvDel = (k) => idb("kv", "readwrite", (s) => s.delete(k));

  // ---------- état ----------
  const recs = {}; // name -> {name, data, base, sha, dirty, editedAt}
  let settings = Object.assign({}, DEFAULTS, { token: "" });
  const listeners = { change: [], status: [] };
  let status = { level: "wait", text: "Démarrage…", pending: 0 };
  let pushTimer = null, pollTimer = null, syncing = null, lastSync = null, fatal = null;

  const emit = (ev, ...a) => listeners[ev].forEach((f) => { try { f(...a); } catch (e) { console.error(e); } });
  function setStatus(level, text) { status = { level, text, pending: pendingCount(), lastSync }; emit("status", status); }
  const pendingCount = () => DOCS.filter((n) => recs[n] && recs[n].dirty).length;
  const persist = (n) => idb("docs", "readwrite", (s) => s.put(recs[n])).catch((e) => console.error("IndexedDB", e));
  const hasToken = () => !!settings.token;
  const isConfigured = () => !!(settings.owner && settings.repo);
  const repoKey = (s) => s.owner + "/" + s.repo + "@" + s.branch + ":" + s.dir;

  // Réglages d'une autre app du même site (ex. le Cockpit) : on les lit seulement si sa base existe déjà,
  // pour ne jamais la créer vide (elle ne serait plus initialisée correctement ensuite).
  async function importSettings(name) {
    try {
      if (!indexedDB.databases) return null;
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === name)) return null;
      const d = await new Promise((res, rej) => { const rq = indexedDB.open(name); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
      if (!d.objectStoreNames.contains("kv")) { d.close(); return null; }
      const read = (k) => new Promise((res) => { const r = d.transaction("kv", "readonly").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); });
      const out = { settings: await read("settings"), token: await read("token") }; d.close();
      return out.settings && out.settings.owner ? out : null;
    } catch (e) { return null; }
  }
  async function useSettingsFrom(name) {
    const got = await importSettings(name || CFG.importFrom);
    if (!got) return { ok: false, text: "Aucun réglage trouvé dans le Cockpit de cet appareil." };
    return saveSettings(Object.assign({}, got.settings, { token: got.token || "" }));
  }

  async function init() {
    let saved = (await kvGet("settings").catch(() => null)) || {};
    let token = (await kvGet("token").catch(() => "")) || "";
    if (CFG.importFrom) {
      // réglages partagés : relus dans l'app d'origine à chaque lancement ; le jeton n'est JAMAIS recopié ici,
      // donc « Oublier cet appareil » ou un nouveau jeton dans le Cockpit s'appliquent aussi à cette app
      const got = await importSettings(CFG.importFrom);
      if (got) { saved = got.settings; await kvSet("settings", saved); }
      token = got ? got.token || "" : "";
    }
    settings = Object.assign({}, DEFAULTS, saved, { token });
    const all = (await idb("docs", "readonly", (s) => s.getAll()).catch(() => [])) || [];
    all.forEach((r) => { if (DOCS.includes(r.name)) recs[r.name] = r; });
    DOCS.forEach((n) => { if (!recs[n]) recs[n] = { name: n, data: M.clone(EMPTY[n]), base: undefined, sha: null, dirty: false, editedAt: null }; });
    lastSync = (await kvGet("lastSync").catch(() => null)) || null;
    root.addEventListener("online", () => syncSoon(0));
    root.addEventListener("offline", () => refreshStatus());
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncSoon(0); else flushNow(); });
    pollTimer = setInterval(() => { if (document.visibilityState === "visible") sync(); }, POLL_MS);
    refreshStatus();
    return snapshot();
  }
  function snapshot() { const o = {}; DOCS.forEach((n) => (o[n] = M.clone(recs[n].data))); return o; }

  function refreshStatus() {
    const p = pendingCount();
    if (!isConfigured()) return setStatus("off", p ? "Sur cet appareil · dépôt à configurer" : "Dépôt à configurer (Réglages)");
    if (!hasToken()) return setStatus("off", p ? "Sur cet appareil · jeton à saisir" : "Jeton à saisir (Réglages)");
    if (fatal) return setStatus("err", fatal);
    if (!navigator.onLine) return setStatus("wait", p ? "Hors ligne · " + p + " doc. à envoyer" : "Hors ligne");
    if (p) return setStatus("wait", "Envoi…");
    setStatus("ok", "À jour");
  }

  // ---------- écriture locale ----------
  function set(n, data) {
    if (!recs[n] || READONLY.has(n)) return;
    if (M.equal(recs[n].data, data)) return;
    recs[n].data = M.clone(data); recs[n].dirty = true; recs[n].editedAt = new Date().toISOString();
    persist(n); refreshStatus(); syncSoon(PUSH_DELAY);
  }
  function get(n) { return recs[n] ? M.clone(recs[n].data) : null; }
  function syncSoon(ms) { clearTimeout(pushTimer); pushTimer = setTimeout(() => sync(), ms); }
  function flushNow() { if (pendingCount()) { clearTimeout(pushTimer); sync(); } }

  // ---------- GitHub ----------
  const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
  const fileUrl = (n) => API + "/repos/" + enc(settings.owner) + "/" + enc(settings.repo) + "/contents/" + enc(settings.dir + "/" + n + ".json");
  const dirUrl = () => API + "/repos/" + enc(settings.owner) + "/" + enc(settings.repo) + "/contents/" + enc(settings.dir) + "?ref=" + encodeURIComponent(settings.branch);
  function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
  function b64decode(b64) { const bin = atob(String(b64 || "").replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

  class GhError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
  async function gh(method, url, body, token) {
    let res;
    try {
      res = await fetch(url, { method, cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + (token || settings.token), "X-GitHub-Api-Version": "2022-11-28" }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new GhError(0, "réseau"); }
    let json = null; try { json = await res.json(); } catch (e) { json = null; }
    if (!res.ok) {
      const limited = res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0";
      throw new GhError(limited ? 429 : res.status, (json && json.message) || res.statusText || "erreur");
    }
    return json;
  }
  function explain(e) {
    if (e.status === 401) return "Jeton refusé : vérifie-le dans Réglages";
    if (e.status === 403) return "Accès refusé : le jeton doit avoir Contents en lecture et écriture";
    if (e.status === 404) return "Dépôt introuvable : vérifie le jeton et le dépôt";
    if (e.status === 429) return "Trop de requêtes : nouvel essai dans une minute";
    return null;
  }

  async function pullDoc(n) {
    let file = null;
    try { file = await gh("GET", fileUrl(n) + "?ref=" + encodeURIComponent(settings.branch)); }
    catch (e) { if (e.status !== 404) throw e; }
    const r = recs[n];
    const remote = file ? JSON.parse(b64decode(file.content)) : M.clone(EMPTY[n]);
    const sha = file ? file.sha : null;
    if (!r.dirty) {
      const changed = !M.equal(r.data, remote);
      Object.assign(r, { data: remote, base: M.clone(remote), sha });
      await persist(n); if (changed) emit("change", n, M.clone(remote), "remote");
      return;
    }
    // changements des deux côtés : fusion
    const remoteAt = sha && sha !== r.sha ? await lastCommitDate(n).catch(() => null) : null;
    const preferLocal = !remoteAt || !r.editedAt || r.editedAt >= remoteAt;
    const merged = M.mergeDoc(n, r.base, r.data, remote, { preferLocal });
    const changed = !M.equal(r.data, merged);
    Object.assign(r, { data: merged, base: M.clone(remote), sha, dirty: !M.equal(merged, remote) });
    await persist(n); if (changed) emit("change", n, M.clone(merged), "merge");
  }
  async function lastCommitDate(n) {
    const url = API + "/repos/" + enc(settings.owner) + "/" + enc(settings.repo) + "/commits?path=" + encodeURIComponent(settings.dir + "/" + n + ".json") + "&sha=" + encodeURIComponent(settings.branch) + "&per_page=1";
    const list = await gh("GET", url);
    const c = list && list[0] && list[0].commit; return c && c.committer && c.committer.date ? new Date(c.committer.date).toISOString() : null;
  }
  async function pushDoc(n) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = recs[n]; if (!r.dirty) return;
      const sent = M.clone(r.data);
      const body = { message: "app : " + n, content: b64encode(M.stableStringify(sent)), branch: settings.branch };
      if (r.sha) body.sha = r.sha;
      try {
        const res = await gh("PUT", fileUrl(n), body);
        r.sha = res && res.content ? res.content.sha : r.sha; r.base = sent;
        if (M.equal(r.data, sent)) r.dirty = false; // sinon : modifié pendant l'envoi, on renverra
        await persist(n);
        if (!r.dirty) return;
      } catch (e) {
        if (e.status === 409 || e.status === 422) { await pullDoc(n); continue; } // le dépôt a bougé : relire, fusionner, réécrire
        throw e;
      }
    }
  }

  function sync() {
    if (syncing) return syncing.then(() => (pendingCount() ? sync() : undefined));
    if (!hasToken() || !isConfigured()) { refreshStatus(); return Promise.resolve(); }
    if (!navigator.onLine) { refreshStatus(); return Promise.resolve(); }
    syncing = (async () => {
      setStatus("wait", "Synchronisation…");
      try {
        const list = await gh("GET", dirUrl());
        const shas = {}; (Array.isArray(list) ? list : []).forEach((f) => { if (f && f.type === "file" && /\.json$/.test(f.name)) shas[f.name.slice(0, -5)] = f.sha; });
        for (const n of DOCS) if ((shas[n] || null) !== recs[n].sha || recs[n].base === undefined) await pullDoc(n);
        for (const n of DOCS) if (recs[n].dirty && !READONLY.has(n)) await pushDoc(n);
        fatal = null; lastSync = new Date().toISOString(); kvSet("lastSync", lastSync).catch(() => {});
      } catch (e) {
        const msg = explain(e);
        if (msg && e.status !== 429) fatal = msg;
        if (e.status === 0) { /* réseau coupé : on réessaiera */ }
        else if (!msg) console.warn("Synchro", e);
        if (e.status === 429 || e.status === 0 || e.status >= 500) syncSoon(30000);
        if (msg && e.status === 429) { setStatus("wait", msg); return; }
      } finally { syncing = null; }
      refreshStatus();
    })();
    return syncing;
  }

  // ---------- réglages ----------
  // Changement de dépôt sûr : on refuse tant que des écritures ne sont pas envoyées ; sinon on ARCHIVE la copie
  // locale de l'ancien dépôt (IndexedDB, clé « archive:… ») puis on repart de zéro : les données du nouveau dépôt
  // sont relues, aucune donnée de l'ancien dépôt n'y est poussée.
  async function archiveLocal(reason) {
    const key = "archive:" + repoKey(settings) + ":" + new Date().toISOString();
    const docs = {}; DOCS.forEach((n) => (docs[n] = M.clone(recs[n])));
    await kvSet(key, { reason, at: new Date().toISOString(), settings: { owner: settings.owner, repo: settings.repo, branch: settings.branch, dir: settings.dir }, docs });
    const idx = (await kvGet("archives").catch(() => null)) || [];
    idx.push(key); await kvSet("archives", idx);
    return key;
  }
  function resetLocal() {
    DOCS.forEach((n) => { recs[n] = { name: n, data: M.clone(EMPTY[n]), base: undefined, sha: null, dirty: false, editedAt: null }; persist(n); emit("change", n, M.clone(EMPTY[n]), "reset"); });
  }
  async function saveSettings(s, opts) {
    if (syncing) await syncing.catch(() => {}); // ne jamais changer de dépôt au milieu d'un envoi
    const next = Object.assign({}, settings, s);
    ["owner", "repo", "branch", "dir"].forEach((k) => { next[k] = String(next[k] == null ? DEFAULTS[k] : next[k]).trim() || DEFAULTS[k]; });
    next.token = String(next.token || "").trim();
    const repoChanged = ["owner", "repo", "branch", "dir"].some((k) => next[k] !== settings[k]);
    if (repoChanged && isConfigured()) {
      // force : l'ancien dépôt est inaccessible (nom faux, supprimé) ; les documents non envoyés restent dans l'archive locale
      if (pendingCount() && !(opts && opts.force)) return { ok: false, pending: pendingCount(), text: "Changement de dépôt refusé : " + pendingCount() + " document(s) pas encore envoyé(s) vers " + settings.owner + "/" + settings.repo + ". Reconnecte-toi au réseau et attends « À jour », puis recommence." };
      await archiveLocal("changement de dépôt");
      resetLocal();
    }
    settings = next;
    await kvSet("settings", { owner: next.owner, repo: next.repo, branch: next.branch, dir: next.dir });
    if (CFG.importFrom) await kvDel("token"); // jeton partagé : jamais stocké dans cette base
    else if (next.token) await kvSet("token", next.token); else await kvDel("token");
    if (repoChanged) DOCS.forEach((n) => { recs[n].sha = null; recs[n].base = undefined; persist(n); });
    fatal = null; refreshStatus();
    await sync();
    return { ok: true };
  }
  async function testToken(s) {
    const t = Object.assign({}, settings, s);
    try {
      const repo = await gh("GET", API + "/repos/" + enc(t.owner) + "/" + enc(t.repo), null, t.token);
      const p = repo && repo.permissions;
      if (p && p.push === false) return { ok: false, text: "Le jeton lit le dépôt mais ne peut pas écrire : donne-lui Contents en lecture et écriture." };
      return { ok: true, text: "Jeton valide : accès au dépôt " + (repo && repo.full_name ? repo.full_name : t.repo) + "." };
    } catch (e) { return { ok: false, text: explain(e) || (e.status === 0 ? "Pas de réseau." : "Erreur GitHub : " + e.message) }; }
  }
  async function forgetDevice(opts) {
    if (syncing) await syncing.catch(() => {});
    if (pendingCount() && !(opts && opts.force)) return { ok: false, text: "Rien n'est effacé : " + pendingCount() + " document(s) pas encore envoyé(s). Attends « À jour » d'abord." };
    if (isConfigured()) await archiveLocal("oubli de l'appareil");
    await kvDel("token"); settings.token = "";
    await idb("docs", "readwrite", (s) => s.clear());
    DOCS.forEach((n) => { recs[n] = { name: n, data: M.clone(EMPTY[n]), base: undefined, sha: null, dirty: false, editedAt: null }; emit("change", n, M.clone(EMPTY[n]), "reset"); });
    refreshStatus();
    return { ok: true };
  }
  const archives = async () => (await kvGet("archives").catch(() => null)) || [];
  const getSettings = () => ({ owner: settings.owner, repo: settings.repo, branch: settings.branch, dir: settings.dir, hasToken: hasToken(), configured: isConfigured() });

  root.CockpitStore = {
    DOCS, init, get, set, sync, useSettingsFrom, flushNow, saveSettings, getSettings, testToken, forgetDevice, archives,
    status: () => status, pending: pendingCount,
    on: (ev, fn) => { listeners[ev].push(fn); },
  };
})(self);
