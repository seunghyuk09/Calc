/**
 * main.js — 앱 부트스트랩
 * 탭 전환, 각 모듈 초기화, 서비스 워커 등록을 담당합니다.
 */
import { $, $$, toast } from './lib/dom.js';
import { load, save } from './lib/store.js';
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

const TAB_KEY = 'ui.activeTab';
const TABS = ['calc', 'weather', 'todo', 'time', 'memo', 'quote', 'music', 'ai', 'settings'];

// 날씨는 네트워크 호출이 있으므로 탭을 처음 열 때 초기화합니다.
const lazyInit = { weather: initWeather };
const lazyDone = new Set();

function activate(name) {
  const tab = TABS.includes(name) ? name : 'calc';
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
}

function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) activate(btn.dataset.tab);
  });
  activate(load(TAB_KEY, 'calc'));
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
  safeInit('탭', initTabs);
  registerServiceWorker();
  document.body.dataset.ready = 'true'; // 자동화 테스트용 준비 완료 신호
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
