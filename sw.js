// 캐시 이름 설정 (버전 관리용)
const CACHE_NAME = 'power-tree-v1';

// 캐시할 파일 목록 (설치 시 미리 로드)
const URLS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './api.js',
  './tree-viz.js',
  './manifest.json',
  'https://d3js.org/d3.v7.min.js' // 외부 라이브러리도 캐시 가능
];

// 1. 서비스 워커 설치 (파일 캐싱)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(URLS_TO_CACHE);
      })
  );
});

// 2. 오래된 캐시 삭제 (버전 업데이트 시)
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            // 화이트리스트에 없는 옛날 캐시는 삭제
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// 3. 네트워크 요청 가로채기 (네트워크 우선, 실패 시 캐시 사용 전략)
// 구글 앱스크립트 데이터는 실시간성이 중요하므로 네트워크를 먼저 시도합니다.
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 네트워크 요청 성공 시, 결과물 복사본을 캐시에 저장 (선택 사항)
        if(event.request.url.includes('script.google.com')) {
            // 데이터는 캐싱하지 않거나 별도 전략 사용
            return response;
        }
        
        // 정적 파일들은 캐시에 업데이트
        if (response.status === 200) {
            let responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
            });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 (오프라인) 캐시에서 찾아 반환
        return caches.match(event.request);
      })
  );
});