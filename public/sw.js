/**
 * sw.js — 앱 셸 캐싱 서비스 워커
 * 정적 파일: 캐시 우선(cache-first). 외부 API: 항상 네트워크(캐시하지 않음).
 * 앱 파일을 수정하면 CACHE_VERSION 을 올려야 사용자에게 새 버전이 반영됩니다.
 */
const CACHE_VERSION = 'daily-kit-v3';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/lib/dom.js',
  './js/lib/store.js',
  './js/lib/calc-engine.js',
  './js/lib/period.js',
  './js/lib/i18n.js',
  './js/modules/calculator.js',
  './js/modules/weather.js',
  './js/modules/todo.js',
  './js/modules/time.js',
  './js/modules/memo.js',
  './js/modules/quote.js',
  './js/modules/music.js',
  './js/modules/ai.js',
  './js/modules/banner.js',
  './js/modules/settings.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // 파일 하나가 실패해도 설치 전체가 실패하지 않도록 개별 처리합니다.
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 같은 출처의 정적 파일만 캐싱합니다. 날씨/AI API 응답은 캐싱하지 않습니다.
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      // 오프라인에서 문서를 요청하면 캐시된 첫 화면을 돌려줍니다.
      if (request.mode === 'navigate') {
        const fallback = await caches.match('./index.html');
        if (fallback) return fallback;
      }
      return new Response('오프라인 상태입니다.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
