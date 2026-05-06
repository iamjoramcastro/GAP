const CACHE_VERSION = 'gap-v5';
const STATIC_CACHE = 'gap-static-' + CACHE_VERSION;
const HTML_CACHE   = 'gap-html-' + CACHE_VERSION;

const STATIC_ASSETS = [
  './manifest.json',
  './favicon-64.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache =>

      Promise.all(STATIC_ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('SW pre-cache miss:', url, err.message))
      ))
    )
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k.startsWith('gap-') && k !== STATIC_CACHE && k !== HTML_CACHE)
                       .map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

const PASS_THROUGH = [
  'firebaseio.com',          // Realtime Database
  'firebasedatabase.app',
  'googleapis.com',          // Firebase Auth, Google Sign-In, etc.
  'firebaseapp.com',
  'gstatic.com',             // Firebase SDK loader, fonts (we DO want fonts cached but they have their own headers)
  'identitytoolkit',         // Firebase Auth
  'open-meteo.com',          // Weather API
  'cloudflare.com',          // CDN scripts (jsPDF etc.)
  'fontawesome.com',
  'cdnjs.cloudflare.com'
];

function isPassThrough(url) {
  return PASS_THROUGH.some(domain => url.hostname.includes(domain));
}

self.addEventListener('fetch', event => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Skip cross-origin (Firebase, APIs, CDNs)
  if (url.origin !== self.location.origin) return;
  if (isPassThrough(url)) return;

  // HTML pages → network-first with offline fallback
  if (req.mode === 'navigate' || req.destination === 'document' ||
      url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // Everything else (icons, manifest, etc.) → cache-first
  event.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200) {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    // Last-resort offline fallback: try to return the hub
    const hub = await cache.match('./index.html') || await cache.match('index.html');
    if (hub) return hub;
    return new Response(
      '<h1>Offline</h1><p>You are offline and this page is not cached. Please reconnect to the internet and try again.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200 && fresh.type === 'basic') {
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    return cached || new Response('Not available offline.', { status: 503 });
  }
}

// Allow page to ask the SW to skip waiting and activate immediately
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
