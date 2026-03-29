const CACHE_NAME = 'power-tree-v21';
const STATIC_ASSETS = [
  './index.html',
  './style.css',
  './api.js',
  './tree-viz.js',
  './manifest.json',
  'https://d3js.org/d3.v7.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // GAS API: 네트워크 우선
  if (event.request.url.includes('script.google.com')) {
    event.respondWith(fetch(event.request, { redirect: 'follow' }).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' }})));
    return;
  }
  // index.html: 항상 네트워크 우선 → 버전 표시 즉시 반영
  if (event.request.mode === 'navigate' || event.request.url.endsWith('index.html')) {
    event.respondWith(
      fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  // 나머지 정적 파일: 캐시 우선
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
