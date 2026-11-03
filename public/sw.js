// Service worker de COC Tracker : cache du site pour un démarrage rapide, et notifications push.
// L'API (/api/) n'est jamais mise en cache : les données viennent toujours du serveur.
const CACHE = "coc-tracker-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages : réseau d'abord (nouvelle version tout de suite), cache si hors ligne.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Fichiers à empreinte, sprites, icônes, polices : cache d'abord.
  if (/^\/(assets|sprites|icons)\//.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "COC Tracker", body: "", tag: undefined, url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // Message sans contenu lisible : notification générique.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // App déjà ouverte : on l'amène sur la bonne page (ex. « /#ticket=12 »), sinon on l'ouvre.
      const open = list.find((c) => c.url.startsWith(self.location.origin));
      if (!open) return self.clients.openWindow(target);
      return open.focus().then((c) => (c.url === target || !("navigate" in c) ? c : c.navigate(target)));
    }),
  );
});
