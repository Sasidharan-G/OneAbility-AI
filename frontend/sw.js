// Service worker (F15): caches the app shell so the UI opens offline.
// API calls are never cached. Payment simulation and local parsing keep working offline.
const VERSION = 'oneability-v1.0.0';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/css/style.css', '/vendor/jsQR.js',
  '/shared/lexicon.json',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/js/app.js', '/js/a11y.js', '/js/api.js', '/js/auth.js', '/js/dex.js', '/js/dom.js', '/js/guards.js', '/js/i18n.js', '/js/icons.js', '/js/insights.js',
  '/js/nlp.js', '/js/payment.js', '/js/qr.js', '/js/store.js', '/js/ui.js', '/js/voice.js',
  '/js/screens/banks.js', '/js/screens/bills.js', '/js/screens/flow.js', '/js/screens/history.js', '/js/screens/home.js', '/js/screens/insights.js',
  '/js/screens/pay.js', '/js/screens/people.js', '/js/screens/scan.js', '/js/screens/settings.js', '/js/screens/voice.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const offlineApi = () => new Response(
  JSON.stringify({ error: { code: 'OFFLINE', message: 'You are offline. This feature needs the internet.' } }),
  { status: 503, headers: { 'content-type': 'application/json' } },
);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/') || url.pathname === '/health') {
    event.respondWith(fetch(req).catch(offlineApi));
    return;
  }

  // Navigations: network first, fall back to the cached shell.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put('/index.html', copy));
      return res;
    }).catch(() => caches.match('/index.html')));
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(caches.match(req).then((cached) => {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
