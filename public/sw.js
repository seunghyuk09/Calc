/**
 * sw.js — 앱 셸 캐싱 서비스 워커
 * 정적 파일: 캐시 우선(cache-first). 외부 API: 항상 네트워크(캐시하지 않음).
 *
 * 캐시를 비우는 방법
 *   CACHE_VERSION 은 배포할 때 scripts/stamp-build.mjs 가 커밋 SHA 로 바꿉니다.
 *   손으로 올리게 두면 반드시 잊습니다. 실제로 최초 구현 이후 한 번도 올리지 않아,
 *   이 파일이 안 바뀐 배포 네 번이 통째로 사용자에게 가지 않았습니다.
 *   (캐시 우선이라, 이 파일이 안 바뀌면 워커가 갱신되지 않고 옛 파일을 계속 내놓습니다)
 *
 * 저장소 사본은 늘 'dev' 입니다. 테스트마다 이 파일이 바뀌면
 * '빌드 결과물이 소스와 어긋나는지' 검사가 항상 실패합니다. (version.js 와 같은 이유)
 */
const CACHE_VERSION = 'daily-kit-dev';

/*
 * 앱(Capacitor) 안에서 도는지.
 *
 * 앱에서는 서비스 워커를 쓰지 않습니다. 웹 자산이 APK 안에 들어 있어 캐시할 이유가 없고,
 * 캐시가 남으면 APK 를 새로 깔아도 옛 화면이 계속 나옵니다. 실제로 그렇게 됐고,
 * 지우고 다시 까는 것 말고는 빠져나올 방법이 없었습니다.
 *
 * 예전 버전(업데이트 기능이 생기기 전)이 등록해 둔 워커가 아직 남아 있는 기기가 있습니다.
 * 그런 기기에서는 이 파일이 바뀌면서 워커가 한 번 갱신되는데, 그때 스스로를 지웁니다.
 *
 * 안드로이드 Capacitor 는 https://localhost (포트 없음) 에서 돕니다.
 * 개발용 서버(localhost:8099 등)와 구분하려고 포트가 없는 경우만 봅니다.
 */
const IS_NATIVE_APP = self.location.hostname === 'localhost' && !self.location.port;

/** 앱에 남아 있는 워커와 캐시를 지우고, 열려 있는 화면을 새 파일로 다시 불러옵니다. */
async function removeSelfFromApp() {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.registration.unregister();
  /*
   * 지금 열려 있는 화면은 아직 옛 파일로 떠 있습니다.
   * 다시 불러오지 않으면 이번 실행 동안은 옛 화면 그대로입니다.
   * navigate 가 막힌 환경이면 다음 실행 때 어차피 새 파일이 뜨므로 조용히 넘어갑니다.
   */
  try {
    const windows = await self.clients.matchAll({ type: 'window' });
    await Promise.all(windows.map((c) => c.navigate(c.url).catch(() => null)));
  } catch { /* 다음 실행에서 정상화됩니다 */ }
}

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
  './js/lib/categories.js',
  './js/lib/i18n.js',
  './js/lib/nav.js',
  './js/lib/prefs.js',
  './js/lib/version.js',
  './js/modules/today.js',
  './js/modules/calculator.js',
  './js/modules/weather.js',
  './js/modules/todo.js',
  './js/modules/calendar.js',
  './js/modules/time.js',
  './js/modules/memo.js',
  './js/modules/quote.js',
  './js/modules/ai.js',
  './js/modules/banner.js',
  './js/modules/settings.js',
  './js/modules/appearance.js',
  './js/modules/arrange.js',
  './js/modules/update.js',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  // 앱에서는 캐시를 채우지 않습니다. 바로 넘겨받아 activate 에서 스스로를 지웁니다.
  if (IS_NATIVE_APP) { event.waitUntil(self.skipWaiting()); return; }
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // 파일 하나가 실패해도 설치 전체가 실패하지 않도록 개별 처리합니다.
    await Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  if (IS_NATIVE_APP) { event.waitUntil(removeSelfFromApp()); return; }
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/*
 * 대기 중인 워커를 즉시 활성화합니다.
 * install 에서도 skipWaiting 을 부르지만, 그 사이 페이지가 살아 있으면 대기 상태가 남을 수 있어
 * 설정 화면의 '지금 적용' 버튼이 이 메시지로 확실히 밀어 줍니다.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // 앱에서는 아무것도 가로채지 않습니다. APK 안의 파일이 그대로 쓰여야 합니다.
  if (IS_NATIVE_APP) return;
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
