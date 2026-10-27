/**
 * Offline shell.
 *
 * The app is cached so it opens on a bad signal or none. It is fetched from the
 * network first, though, whenever there is one: serving the cached copy first
 * and refreshing behind it meant a deploy never reached a phone — the refresh
 * went through the browser's HTTP cache, which handed back the old file, and
 * iOS stops a service worker before an unawaited refresh can save anything.
 *
 * Recipe *data* deliberately isn't cached: two people editing one shared
 * library is exactly the situation where a stale cached answer is worse than a
 * spinner. The one exception is photos, which are immutable once written.
 */

const SHELL = 'kitchen-shell-v4';
const PHOTOS = 'kitchen-photos-v1';

/** How long to wait on a slow network before opening from the cache instead. */
const NETWORK_WAIT_MS = 4000;

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
      .then((cache) => Promise.allSettled(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))))
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

  // Everything else, pages included: the network when it answers, the cache
  // when it doesn't. 'no-cache' makes the browser check with the server
  // rather than trust its own copy, so a deploy lands on the next launch.
  const key = request.mode === 'navigate' ? SHELL_URL : request;
  const fresh = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((response) => {
      if (!response.ok) return response;
      const copy = response.clone();
      // Held open with waitUntil so the save finishes even after the page
      // has its answer.
      event.waitUntil(caches.open(SHELL).then((cache) => cache.put(key, copy)));
      return response;
    });
  event.waitUntil(fresh.catch(() => {}));

  event.respondWith((async () => {
    const cached = () => caches.match(key);
    try {
      return await Promise.race([
        fresh,
        new Promise((resolve, reject) => setTimeout(async () => {
          const hit = await cached();
          if (hit) resolve(hit); else reject(new Error('slow'));
        }, NETWORK_WAIT_MS)),
      ]);
    } catch {
      return (await cached()) || fresh;
    }
  })());
});
