/* Académie · service worker (portée : academie/). Met l'app en cache pour l'ouvrir sans réseau.
 * L'API GitHub ne passe jamais par le cache. Nouvelle version : changer VERSION. */
const VERSION = "academie-0.6.0";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "../merge.js", "../store.js", "../fonts/bricolage.woff2", "../fonts/dmsans.woff2", "../icons/icon-192.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("academie-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match("index.html") : null);
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok && res.type === "basic") cache.put(req, res.clone()); return res; }
    catch (err) { return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
  })());
});
