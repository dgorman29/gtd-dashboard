// Service worker: makes the dashboard installable and lets it open offline.
//
// Network-first for everything it caches, so a deploy shows up on the next
// launch whenever the phone is online; the cache is only the offline fallback.
// Supabase API calls are never cached — sync.js handles being offline.
var CACHE = 'gtd-shell-v1';
var SHELL = [
  './', 'index.html', 'config.js', 'sync.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && url.hostname !== 'cdn.jsdelivr.net') return;

  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('./') : Response.error());
    });
  }));
});
