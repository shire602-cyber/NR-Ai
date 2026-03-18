// Muhasib.ai Service Worker
// Provides offline support, caching strategies, and background sync

const CACHE_NAME = 'muhasib-v1';
const STATIC_CACHE = 'muhasib-static-v1';
const API_CACHE = 'muhasib-api-v1';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
  '/offline.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/favicon.png',
];

// Patterns for static assets (cache-first)
const STATIC_PATTERNS = [
  /\.js$/,
  /\.css$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.webp$/,
  /\.ico$/,
];

// API paths that should never be cached
const NO_CACHE_API_PATHS = [
  '/api/auth/',
  '/api/notifications',
  '/api/ai-',
  '/api/chat',
];

// API paths safe to cache briefly (network-first with fallback)
const CACHEABLE_API_PATHS = [
  '/api/accounts',
  '/api/chart-of-accounts',
  '/api/company',
  '/api/contacts',
  '/api/inventory',
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // Activate immediately without waiting for existing clients to close
  self.skipWaiting();
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => {
            // Remove old caches that don't match current version
            return (
              name.startsWith('muhasib-') &&
              name !== CACHE_NAME &&
              name !== STATIC_CACHE &&
              name !== API_CACHE
            );
          })
          .map((name) => caches.delete(name))
      );
    })
  );
  // Take control of all clients immediately
  self.clients.claim();
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip non-GET requests (let them pass through, handle with background sync)
  if (request.method !== 'GET') {
    return;
  }

  // API requests: network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request, url));
    return;
  }

  // Static assets: cache-first strategy
  if (isStaticAsset(url.pathname)) {
    event.respondWith(handleStaticRequest(request));
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // Default: network-first
  event.respondWith(networkFirst(request, CACHE_NAME));
});

// ─── Strategies ─────────────────────────────────────────────────────────────

/**
 * Cache-first strategy for static assets.
 * Serves from cache if available, fetches from network otherwise.
 * Updates cache in the background after serving.
 */
async function handleStaticRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    // Revalidate in background (stale-while-revalidate)
    const fetchPromise = fetch(request)
      .then((response) => {
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {});
    // Don't await - serve cached version immediately
    return cachedResponse;
  }

  // Not in cache, fetch from network
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, responseClone);
    }
    return response;
  } catch (error) {
    // Return a basic 404 for missing static assets
    return new Response('Not found', { status: 404 });
  }
}

/**
 * Network-first strategy for API requests.
 * Tries network, falls back to cache for safe endpoints.
 * Never caches auth or AI endpoints.
 */
async function handleApiRequest(request, url) {
  const shouldNeverCache = NO_CACHE_API_PATHS.some((path) =>
    url.pathname.includes(path)
  );

  const isCacheable = CACHEABLE_API_PATHS.some((path) =>
    url.pathname.startsWith(path)
  );

  try {
    const response = await fetch(request);

    // Cache successful GET responses for cacheable API paths
    if (response.ok && isCacheable && !shouldNeverCache) {
      const responseClone = response.clone();
      const cache = await caches.open(API_CACHE);
      cache.put(request, responseClone);
    }

    return response;
  } catch (error) {
    // Network failed - try cache for cacheable endpoints
    if (isCacheable && !shouldNeverCache) {
      const cachedResponse = await caches.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    // Return a proper error response
    return new Response(
      JSON.stringify({ error: 'You are offline. Please check your connection.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/**
 * Navigation requests: try network, fall back to offline page.
 */
async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch (error) {
    const offlinePage = await caches.match('/offline.html');
    if (offlinePage) {
      return offlinePage;
    }
    return new Response('Offline', { status: 503 });
  }
}

/**
 * Generic network-first strategy with cache fallback.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const responseClone = response.clone();
      const cache = await caches.open(cacheName);
      cache.put(request, responseClone);
    }
    return response;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return new Response('Offline', { status: 503 });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isStaticAsset(pathname) {
  return STATIC_PATTERNS.some((pattern) => pattern.test(pathname));
}

// ─── Background Sync ────────────────────────────────────────────────────────
// Queue failed POST/PUT/DELETE requests for retry when back online

self.addEventListener('sync', (event) => {
  if (event.tag === 'muhasib-sync') {
    event.waitUntil(replayFailedRequests());
  }
});

async function replayFailedRequests() {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('requests', 'readonly');
    const store = tx.objectStore('requests');
    const requests = await getAllFromStore(store);

    for (const entry of requests) {
      try {
        const response = await fetch(entry.url, {
          method: entry.method,
          headers: entry.headers,
          body: entry.body,
        });

        if (response.ok) {
          // Remove successful request from queue
          const deleteTx = db.transaction('requests', 'readwrite');
          deleteTx.objectStore('requests').delete(entry.id);
        }
      } catch (error) {
        // Still offline, will retry on next sync
        console.warn('[SW] Background sync retry failed for:', entry.url);
      }
    }
  } catch (error) {
    console.error('[SW] Background sync error:', error);
  }
}

// ─── IndexedDB helpers for background sync queue ────────────────────────────

function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('muhasib-sync', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('requests')) {
        db.createObjectStore('requests', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllFromStore(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Message handling ───────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'QUEUE_REQUEST':
      // Queue a failed request for background sync
      queueFailedRequest(event.data.request);
      break;

    case 'CLEAR_CACHE':
      caches.keys().then((names) => {
        names.forEach((name) => {
          if (name.startsWith('muhasib-')) {
            caches.delete(name);
          }
        });
      });
      break;
  }
});

async function queueFailedRequest(requestData) {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('requests', 'readwrite');
    tx.objectStore('requests').add({
      url: requestData.url,
      method: requestData.method,
      headers: requestData.headers,
      body: requestData.body,
      timestamp: Date.now(),
    });

    // Register for background sync
    if (self.registration.sync) {
      await self.registration.sync.register('muhasib-sync');
    }
  } catch (error) {
    console.error('[SW] Failed to queue request:', error);
  }
}
