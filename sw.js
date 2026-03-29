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
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' })))
  );
});

self.addEventListener('fetch', (event) => {
  // GAS API: 네트워크 우선
  if (event.request.url.includes('script.google.com')) {
    event.respondWith(fetch(event.request, { redirect: 'follow' }).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' }})));
    return;
  }
  // D3 라이브러리: 캐시 우선 (외부 CDN, 자주 바뀌지 않음)
  if (event.request.url.includes('d3js.org')) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      }))
    );
    return;
  }
  // 앱 파일(index.html, api.js, tree-viz.js, style.css 등): 항상 네트워크 우선
  event.respondWith(
    fetch(event.request).then(response => {
      if (response.status === 200) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});
