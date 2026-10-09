/*
 * Caches the whole app on first visit so it keeps working with no signal.
 * Bump CACHE whenever the assets change -- the old cache is dropped on
 * activate, which is what makes a redeploy actually reach installed users.
 */

var CACHE = "dota-draft-v3";
var ASSETS = [
  "./",
  "index.html",
  "style.css",
  "data.js",
  "app.js",
  "sw-register.js",
  "manifest.webmanifest",
  "icon-180.png",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  // Cache-first: every asset is versioned with the cache name, and the app
  // has nothing to fetch at runtime, so freshness is a deploy-time concern.
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request);
    })
  );
});
