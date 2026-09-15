/**
 * main.js — 앱 부트스트랩
 * 탭 전환, 각 모듈 초기화, 서비스 워커 등록을 담당합니다.
 */
import { $, $$, toast, initToastRegion } from './lib/dom.js';
import { load, save } from './lib/store.js';
import { initToday } from './modules/today.js';
import { initCalculator } from './modules/calculator.js';
import { initWeather } from './modules/weather.js';
import { initTodo } from './modules/todo.js';
import { initTime } from './modules/time.js';
import { initMemo } from './modules/memo.js';
import { initQuote } from './modules/quote.js';
import { initMusic } from './modules/music.js';
import { initAi } from './modules/ai.js';
import { initBanner } from './modules/banner.js';
import { initTheme, initSettings } from './modules/settings.js';
import { initLang } from './lib/i18n.js';
import { setNavigator, notifyTabChange } from './lib/nav.js';

const TAB_KEY = 'ui.activeTab';
const TABS = ['today', 'calc', 'weather', 'todo', 'time', 'memo', 'quote', 'music', 'ai', 'settings'];
const DEFAULT_TAB = 'today';

// 날씨는 네트워크 호출이 있으므로 탭을 처음 열 때 초기화합니다.
// '오늘' 탭도 현재 날씨를 보여주므로 같은 초기화를 씁니다.
// initWeather 는 폼에 리스너를 다는 함수라 두 번 부르면 중복으로 붙습니다. once 로 한 번만 돌립니다.
function once(fn) {
  let called = false;
  return () => { if (!called) { called = true; fn(); } };
}
const lazyWeather = once(initWeather);
const lazyInit = { weather: lazyWeather, today: lazyWeather };
const lazyDone = new Set();

function activate(name) {
  const tab = TABS.includes(name) ? name : DEFAULT_TAB;
  TABS.forEach((id) => {
    const panel = $(`#panel-${id}`);
    if (panel) panel.hidden = id !== tab;
  });
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));
  save(TAB_KEY, tab);

  if (lazyInit[tab] && !lazyDone.has(tab)) {
    lazyDone.add(tab);
    try { lazyInit[tab](); } catch (err) { console.error(`[${tab}] 초기화 실패`, err); }
  }
  // 선택한 탭 버튼이 가로 스크롤 밖에 있으면 보이게 합니다.
  document.querySelector(`.tab[data-tab="${tab}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

  notifyTabChange(tab);
}

/** 현재 탭에서 delta 칸 떨어진 탭으로 이동합니다. 양 끝에서는 더 가지 않습니다. */
function moveTab(delta) {
  const current = TABS.indexOf(load(TAB_KEY, DEFAULT_TAB));
  const next = current + delta;
  // 순환시키면 '오늘'에서 왼쪽으로 쓸었을 때 설정으로 튀어 방향 감각이 깨집니다.
  if (next < 0 || next >= TABS.length) return;
  activate(TABS[next]);
}

const SWIPE_MIN_PX = 60;     // 이보다 적게 움직이면 그냥 탭(클릭)으로 봅니다
const SWIPE_RATIO = 1.5;     // 가로 이동이 세로보다 이 배 이상이어야 스와이프입니다

/** target 에서 위로 올라가며 가로 스크롤이 가능한 조상이 있는지 봅니다. */
function insideHorizontalScroller(target, root) {
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (!(node instanceof Element)) continue;
    if (node.scrollWidth > node.clientWidth + 2) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
  }
  return false;
}

/**
 * 좌우로 쓸어 탭을 넘깁니다.
 * 세로 스크롤, 글자 선택, 낙서판 그리기, 가로 스크롤 영역은 건드리지 않습니다.
 */
function initSwipe() {
  const main = $('#main');
  if (!main) return;
  let start = null;
  let swiped = false;

  main.addEventListener('pointerdown', (e) => {
    start = null;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 입력·그리기 영역에서 시작한 제스처는 그쪽 것입니다.
    if (e.target.closest?.('input, textarea, select, canvas, [data-no-swipe]')) return;
    if (insideHorizontalScroller(e.target, main)) return;
    start = { x: e.clientX, y: e.clientY };
  });

  main.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;
    // 드래그로 글자를 고르던 중이었다면 탭을 바꾸지 않습니다.
    if (String(window.getSelection?.() ?? '').length > 0) return;

    swiped = true;
    // click 이 오지 않는 경우(패널이 숨겨져 이벤트가 사라짐)를 대비한 안전장치입니다.
    setTimeout(() => { swiped = false; }, 400);
    moveTab(dx < 0 ? 1 : -1);
  });

  main.addEventListener('pointercancel', () => { start = null; });

  // 스와이프로 끝난 제스처의 click 은 삼킵니다.
  // 없으면 계산기 키를 누른 채 쓸었을 때 숫자가 입력되면서 탭까지 바뀝니다.
  main.addEventListener('click', (e) => {
    if (!swiped) return;
    swiped = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) activate(btn.dataset.tab);
  });
  setNavigator(activate);
  initSwipe();
  // 처음 쓰는 사람은 '오늘'로, 그 외에는 마지막에 보던 탭으로 엽니다.
  activate(load(TAB_KEY, DEFAULT_TAB));
}

/** 모듈 하나가 실패해도 나머지 앱은 살아 있도록 개별적으로 감쌉니다. */
function safeInit(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`[${name}] 초기화 실패`, err);
    toast(`${name} 기능을 불러오지 못했습니다`, 'error');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // sw.js 를 함께 배포하지 않는 환경(미리보기 등)에서는 등록을 건너뜁니다.
  if (window.__DK_DISABLE_SW) return;
  // file:// 로 열면 서비스 워커를 쓸 수 없습니다.
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[sw] 등록 실패', err);
    });
  });
}

function boot() {
  safeInit('알림영역', initToastRegion);
  safeInit('언어', initLang);
  safeInit('테마', initTheme);
  safeInit('배너', initBanner);
  safeInit('계산기', initCalculator);
  safeInit('할 일', initTodo);
  safeInit('시계·타이머', initTime);
  safeInit('메모', initMemo);
  safeInit('글귀', initQuote);
  safeInit('음악', initMusic);
  safeInit('AI', initAi);
  safeInit('설정', initSettings);
  // '오늘'은 할 일/날씨 데이터를 구독하므로 두 모듈 뒤에 초기화합니다.
  safeInit('오늘', initToday);
  safeInit('탭', initTabs);
  registerServiceWorker();
  document.body.dataset.ready = 'true'; // 자동화 테스트용 준비 완료 신호
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
