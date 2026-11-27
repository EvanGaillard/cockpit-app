/* Cockpit app · service worker : met l'app en cache pour qu'elle s'ouvre sans réseau.
 * Les appels à l'API GitHub ne passent jamais par le cache (les données sont gérées par store.js et IndexedDB).
 * Pour publier une nouvelle version : changer VERSION, l'app propose alors « Recharger ».
 * Un changement de store.js ou merge.js oblige AUSSI à changer VERSION dans academie/sw.js (qui les met en cache). */
const VERSION = "cockpit-app-1.0.2";
const SHELL = [
  "./", "index.html", "styles.css", "merge.js", "store.js", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "fonts/bricolage.woff2", "fonts/dmsans.woff2", "fonts/jbmono.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("cockpit-app-") && k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API GitHub et autres : réseau direct
  if (url.pathname.startsWith(new URL("academie/", self.registration.scope).pathname)) return; // l'Académie a son propre service worker
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await cache.match("index.html") : null);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") cache.put(req, res.clone());
      return res;
    } catch (err) {
      return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  })());
});
