// 다이어트 코치 서비스 워커 (루트에 두어야 앱 전체가 scope에 들어간다): 앱 셸을 캐시해 오프라인에서도 전 기능이 동작하게 한다 (모든 데이터는 로컬).
const CACHE = 'diet-v2';
const SHELL = ['./', './index.html', './src/config.js', './src/calc.js', './src/foods.js', './src/foods-data.js', './src/storage.js',
  './src/state.js', './src/chart.js', './src/main.js', './public/manifest.webmanifest', './public/icon-192.png', './public/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
