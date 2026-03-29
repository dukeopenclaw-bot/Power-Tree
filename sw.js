const CACHE_NAME = 'power-tree-v20';
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
  // GAS API는 네트워크 우선, 실패 시 캐시 없음 (실시간 데이터)
  if (event.request.url.includes('script.google.com')) {
    event.respondWith(fetch(event.request, { redirect: 'follow' }).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' }})));
    return;
  }
  // 정적 파일: 캐시 우선
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
