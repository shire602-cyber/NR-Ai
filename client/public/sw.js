// Bump this on any caching-strategy change to force old caches to be purged.
const CACHE_NAME = "muhasib-v2";

// Only precache the offline fallback. We deliberately do NOT cache-first the
// HTML shell — see the navigation handler below.
const OFFLINE_URLS = ["/manifest.json"];

// Install: warm the cache with the offline fallback, then activate immediately.
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS)));
  self.skipWaiting();
});

// Activate: drop every previous cache version so a stale app shell can never
// survive a deploy, then take control of open clients.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isHashedAsset(url) {
  // Vite emits content-hashed, immutable files under /assets/ (e.g.
  // Dashboard--a04q_Gb.js). These are safe to cache-first forever because a new
  // build produces new filenames.
  return url.pathname.startsWith("/assets/");
}

function isNavigationRequest(request) {
  return (
    request.mode === "navigate" ||
    (request.method === "GET" && (request.headers.get("accept") || "").includes("text/html"))
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API traffic or non-GET requests.
  if (url.pathname.startsWith("/api/") || request.method !== "GET") {
    return;
  }

  // Only handle same-origin requests; let the browser fetch cross-origin normally.
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigation / HTML: NETWORK-FIRST. The HTML shell references content-hashed
  // chunk filenames, so it must always be fresh — a cached shell pointing at
  // deleted chunks is exactly what causes "Failed to fetch dynamically imported
  // module" after a deploy. Fall back to a cached shell only when offline.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/", clone));
          }
          return response;
        })
        .catch(() => caches.match("/").then((cached) => cached || caches.match("/manifest.json")))
    );
    return;
  }

  // Immutable hashed build assets: cache-first (fast, safe — new build = new name).
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else (icons, fonts, etc.): stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Push notification handler
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = {
      title: "Muhasib.ai",
      body: event.data.text(),
    };
  }

  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.png",
    badge: payload.badge || "/icons/icon-72.png",
    tag: payload.tag || "muhasib-notification",
    data: payload.data || {},
    vibrate: [100, 50, 100],
    actions: [
      { action: "open", title: "Open" },
      { action: "dismiss", title: "Dismiss" },
    ],
  };

  event.waitUntil(self.registration.showNotification(payload.title || "Muhasib.ai", options));
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "dismiss") return;

  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
