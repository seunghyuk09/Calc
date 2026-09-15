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
import { initAppearance, refreshAppearance, applyTabLayout } from './modules/appearance.js';
import { initLang } from './lib/i18n.js';
import { setNavigator, notifyTabChange } from './lib/nav.js';
import { ALL_TABS, onPrefsChange } from './lib/prefs.js';

const TAB_KEY = 'ui.activeTab';
const DEFAULT_TAB = 'today';

/*
 * 화면에 실제로 놓인 탭. 설정에서 순서를 바꾸거나 숨기면 이 배열이 바뀝니다.
 * 가로 페이저의 인덱스 계산이 전부 이 순서를 기준으로 하므로,
 * DOM 을 옮긴 뒤에는 반드시 이 배열도 같이 갱신해야 합니다.
 */
let TABS = ALL_TABS.slice();

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

let currentTab = DEFAULT_TAB;

const panelOf = (id) => $(`#panel-${id}`);

/** 처음 열릴 때만 돌려야 하는 초기화(네트워크 호출 등)를 실행합니다. */
function runLazyInit(tab) {
  if (!lazyInit[tab] || lazyDone.has(tab)) return;
  lazyDone.add(tab);
  try { lazyInit[tab](); } catch (err) { console.error(`[${tab}] 초기화 실패`, err); }
}

/**
 * 스크롤은 건드리지 않고 '지금 보이는 탭' 상태만 맞춥니다.
 * 손으로 쓸어 넘겼을 때도 이 함수가 뒤따라 불립니다.
 */
function setActiveTab(tab) {
  currentTab = tab;
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));

  // 화면 밖 패널은 키보드 탭 이동과 스크린리더에서 빼 둡니다.
  // inert 를 모르는 브라우저(iOS 15 등)에서는 그냥 건너뜁니다. 화면 동작에는 영향이 없습니다.
  if ('inert' in HTMLElement.prototype) {
    TABS.forEach((id) => { const panel = panelOf(id); if (panel) panel.inert = id !== tab; });
  }

  save(TAB_KEY, tab);
  runLazyInit(tab);

  // 선택한 탭 버튼이 가로 스크롤 밖에 있으면 보이게 합니다.
  document.querySelector(`.tab[data-tab="${tab}"]`)
    ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });

  notifyTabChange(tab);
}

/** 해당 패널이 화면에 오도록 가로로 스크롤합니다. */
function scrollToPanel(tab, smooth = true) {
  const main = $('#main');
  if (!main) return;
  const index = TABS.indexOf(tab);
  if (index < 0) return;
  // 패널 폭이 정확히 100% 라서 인덱스 x 폭이 곧 목표 위치입니다.
  main.scrollTo({ left: index * main.clientWidth, behavior: smooth ? 'smooth' : 'auto' });
}

/** 탭 버튼이나 다른 모듈에서 부르는 진입점. 상태를 바꾸고 화면도 옮깁니다. */
function activate(name, { smooth = true } = {}) {
  const tab = TABS.includes(name) ? name : DEFAULT_TAB;
  // inert 인 패널로는 스크롤이 되지 않으므로 상태를 먼저 풉니다.
  setActiveTab(tab);
  scrollToPanel(tab, smooth);
}

/**
 * 손으로 쓸어 넘긴 결과를 탭 상태에 반영합니다.
 * scroll 이벤트는 관성 중에도 계속 오므로, 멈춘 뒤에 한 번만 처리합니다.
 */
function watchPagerScroll() {
  const main = $('#main');
  if (!main) return;
  let settleTimer = null;
  const settle = () => {
    const width = main.clientWidth;
    if (!width) return;
    const index = Math.round(main.scrollLeft / width);
    const tab = TABS[Math.min(Math.max(index, 0), TABS.length - 1)];
    if (tab && tab !== currentTab) setActiveTab(tab);
  };
  main.addEventListener('scroll', () => {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, 120);
  }, { passive: true });

  // 창 크기가 바뀌면 스냅 위치가 어긋나므로 현재 탭으로 다시 맞춥니다.
  window.addEventListener('resize', () => {
    clearTimeout(settleTimer);
    scrollToPanel(currentTab, false);
  });

  blockEdgeBackGesture(main);
}

/**
 * 첫 장에서 오른쪽으로 더 쓸면 브라우저가 '뒤로가기'로 받아들여 앱을 벗어납니다.
 * (히스토리가 없으면 about:blank 로 나가버립니다)
 * overscroll-behavior 로는 막히지 않아, 양 끝에서 바깥으로 향하는 터치만 직접 취소합니다.
 * passive: false 여야 preventDefault 가 먹습니다.
 */
function blockEdgeBackGesture(main) {
  let startX = 0;
  let startY = 0;

  main.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  main.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    // 세로로 움직이는 제스처는 패널 스크롤이므로 건드리지 않습니다.
    if (Math.abs(dx) <= Math.abs(dy)) return;

    const max = main.scrollWidth - main.clientWidth;
    const atStart = main.scrollLeft <= 0 && dx > 0;
    const atEnd = main.scrollLeft >= max - 1 && dx < 0;
    if (atStart || atEnd) e.preventDefault();
  }, { passive: false });
}

/**
 * 저장된 순서/숨김을 화면에 반영하고 페이저를 다시 맞춥니다.
 * 보고 있던 탭이 숨겨졌다면 첫 탭으로 옮깁니다. 빈 화면이 남는 것보다 낫습니다.
 */
function syncTabLayout(prefs) {
  TABS = applyTabLayout(prefs);
  const tab = TABS.includes(currentTab) ? currentTab : (TABS[0] || DEFAULT_TAB);
  setActiveTab(tab);
  // DOM 을 옮긴 직후에는 패널 폭이 아직 확정되지 않아 스크롤 위치가 어긋납니다.
  requestAnimationFrame(() => scrollToPanel(tab, false));
}

function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) activate(btn.dataset.tab);
  });
  setNavigator(activate);
  watchPagerScroll();

  TABS = applyTabLayout();

  // 처음 쓰는 사람은 '오늘'로, 그 외에는 마지막에 보던 탭으로 엽니다.
  const startTab = load(TAB_KEY, DEFAULT_TAB);
  setActiveTab(TABS.includes(startTab) ? startTab : (TABS[0] || DEFAULT_TAB));
  // 레이아웃이 잡히기 전에 스크롤하면 위치가 0 으로 계산됩니다. 한 프레임 뒤에 옮깁니다.
  requestAnimationFrame(() => scrollToPanel(currentTab, false));

  onPrefsChange((prefs) => {
    refreshAppearance(prefs);
    syncTabLayout(prefs);
  });
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
  // 커스터마이즈는 카드 목록을 훑어야 하므로 모든 패널이 준비된 뒤에 돕니다.
  safeInit('커스터마이즈', initAppearance);
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
