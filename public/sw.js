/* Gym Tracker service worker.
   - App shell: precached, served cache-first. Bump VERSION on every deploy that changes a file,
     so phones download the new shell; the app then offers "Update".
   - Exercise images: cache-first in their own cache, saved the first time they're viewed
     (or all at once from Settings). That cache is kept across versions. */
const VERSION = 'v1.1.0';
const SHELL = `gym-shell-${VERSION}`;
const IMAGES = 'gym-img-v1'; // also used by app.js; bump only if the image files change

const SHELL_FILES = [
  './',
  './app.js',
  './styles.css',
  './manifest.json',
  './data/exercises.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('gym-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
  if (event.data?.type === 'version') event.ports[0]?.postMessage(VERSION);
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // account + sync calls always go to the network

  if (req.mode === 'navigate') {
    // Single-page app: every navigation gets the cached shell (works offline, ignores ?query).
    event.respondWith(caches.match('./', { cacheName: SHELL }).then(hit => hit || fetch(req)));
    return;
  }
  if (url.pathname.includes('/img/exercises/')) {
    event.respondWith(imageFirst(req, event));
    return;
  }
  event.respondWith(
    caches.match(req, { cacheName: SHELL, ignoreSearch: true }).then(hit => hit || fetch(req)),
  );
});

async function imageFirst(req, event) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) event.waitUntil(cache.put(req, res.clone()));
    return res;
  } catch {
    return new Response('', { status: 504, statusText: 'Offline and not cached' });
  }
}
