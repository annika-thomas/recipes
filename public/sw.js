/**
 * Offline shell.
 *
 * The app itself is cached so it opens instantly and works on a bad signal.
 * Recipe *data* deliberately isn't: two people editing one shared library is
 * exactly the situation where a stale cached answer is worse than a spinner.
 * The one exception is photos, which are immutable once written.
 */

const SHELL = 'kitchen-shell-v2';
const PHOTOS = 'kitchen-photos-v1';

// Relative to the worker's own scope, so this works at a domain root and
// under a project path like /recipes/ alike.
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './config.js',
  './js/main.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/fonts/figtree-latin.woff2',
];

const SHELL_URL = new URL('./index.html', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // One bad URL shouldn't fail the whole install.
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL && k !== PHOTOS).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API — see the note at the top.
  if (url.pathname.startsWith('/api/')) return;

  // Photos: cache-first, they never change under a key.
  if (url.pathname.startsWith('/img/')) {
    event.respondWith(
      caches.open(PHOTOS).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Navigations: network first so a deploy lands, cache as the offline floor.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL)),
    );
    return;
  }

  // Everything else (JS, CSS, fonts): cache first, refresh in the background.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      const hit = await cache.match(request);
      const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      }).catch(() => hit);
      return hit || network;
    }),
  );
});
