// Offline support: app shell precached, Scripture and pages cached as they are read.
const VERSION = 'adapt2us-bible-v2-1';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './assets/icon.svg',
  './src/styles.css', './src/app.js', './src/books.js', './src/reference.js',
  './src/store.js', './src/corpus.js', './data/corpus/index.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const {request} = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  // Scripture and static assets: cache first, so reading works with no signal.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, {ignoreSearch: false});
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      const fallback = await cache.match('./index.html');
      if (request.mode === 'navigate' && fallback) return fallback;
      throw err;
    }
  })());
});
