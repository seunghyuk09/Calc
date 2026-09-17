/**
 * main.js — 앱 부트스트랩
 * 탭 전환, 각 모듈 초기화, 서비스 워커 등록을 담당합니다.
 */
import { $, $$, toast, initToastRegion } from './lib/dom.js';
import { load, save, hasAnyData } from './lib/store.js';
import { initToday } from './modules/today.js';
import { initCalculator } from './modules/calculator.js';
import { initWeather } from './modules/weather.js';
import { initTodo } from './modules/todo.js';
import { initCalendar } from './modules/calendar.js';
import { initTime } from './modules/time.js';
import { initMemo } from './modules/memo.js';
import { initQuote } from './modules/quote.js';
import { initAi } from './modules/ai.js';
import { initBanner } from './modules/banner.js';
import { initTheme, initSettings } from './modules/settings.js';
import { initAppearance, refreshAppearance, applyTabLayout } from './modules/appearance.js';
import { initArrange, startArrange, arrangeFollowTab } from './modules/arrange.js';
import { initUpdate, registerServiceWorker } from './modules/update.js';
import { initIntro } from './modules/intro.js';
import { initLang, t, onLangChange, applyStatic } from './lib/i18n.js';
import { setNavigator, notifyTabChange } from './lib/nav.js';
import { awayTooLong } from './lib/session.js';
import { ALL_TABS, onPrefsChange } from './lib/prefs.js';

const DEFAULT_TAB = 'today';

/* 자리를 비운 시간에 따라 시작 화면을 정합니다. 규칙은 lib/session.js 에 있습니다. */
const SEEN_KEY = 'ui.lastSeen';

/** 지금이 '앱을 떠나는 순간' 임을 적어 둡니다. */
function markSeen() {
  save(SEEN_KEY, Date.now());
}

function lastSeen() {
  return Number(load(SEEN_KEY, 0));
}

/** 지금 화면 구성에서 쓸 수 있는 처음 화면. ('오늘'을 숨겨 둘 수도 있습니다) */
function homeTab(tabs) {
  return tabs.includes(DEFAULT_TAB) ? DEFAULT_TAB : (tabs[0] || DEFAULT_TAB);
}

/*
 * 시작 화면을 최소 이만큼은 보여 줍니다.
 *
 * 부팅이 끝나는 즉시 걷었더니, 빠른 기기에서는 0.2초 만에 끝나 깜빡이고 말았습니다.
 * 켜지는 느낌을 주려면 글자를 읽을 시간은 있어야 합니다.
 * 얼마가 알맞은지는 취향이라, 1.2초는 제 판단입니다.
 */
const MIN_SPLASH_MS = 1200;

/**
 * 시작 화면을 걷습니다. 너무 빨리 끝났으면 남은 시간만큼 기다립니다.
 *
 * performance.now() 는 페이지를 읽기 시작한 뒤 흐른 시간입니다.
 * 부팅 함수가 시작한 시점이 아니라 '화면이 떠 있던 시간' 이라 여기에 맞습니다.
 *
 * 화면을 가리는 일과 손가락을 막는 일은 나눠 뒀습니다.
 * 입력을 막는 것은 data-ready 까지입니다. 그때부터 앱은 실제로 쓸 수 있고,
 * 남은 시간 동안 가림막이 탭을 삼키면 그게 더 나쁩니다. (css 의 pointer-events)
 */
function dismissSplash() {
  const done = () => { document.body.dataset.splash = 'done'; };
  const left = MIN_SPLASH_MS - performance.now();
  if (!(left > 0)) { done(); return; }
  setTimeout(done, left);
}

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
  // '오늘로 돌아가기' 버튼은 CSS 가 이 값으로 숨깁니다. (오늘 탭에서는 띄울 이유가 없습니다)
  document.body.dataset.tab = tab;
  $$('.tab').forEach((btn) => btn.setAttribute('aria-selected', String(btn.dataset.tab === tab)));

  // 화면 밖 패널은 키보드 탭 이동과 스크린리더에서 빼 둡니다.
  // inert 를 모르는 브라우저(iOS 15 등)에서는 그냥 건너뜁니다. 화면 동작에는 영향이 없습니다.
  if ('inert' in HTMLElement.prototype) {
    TABS.forEach((id) => { const panel = panelOf(id); if (panel) panel.inert = id !== tab; });
  }

  // 딴 화면으로 넘어가면 편집을 끝냅니다. 도구줄이 남아 있으면 무엇을 편집 중인지 헷갈립니다.
  arrangeFollowTab(tab);
  runLazyInit(tab);
  showHeaderTab(tab);
  announceTab(tab);

  // 서랍이 열려 있을 때만, 선택한 탭 버튼이 목록 밖에 있으면 보이게 합니다.
  if (!$('#sidebar')?.hidden) {
    document.querySelector(`.tab[data-tab="${tab}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  notifyTabChange(tab);
}

/** 해당 패널이 화면에 오도록 가로로 스크롤합니다. */
function scrollToPanel(tab, smooth = true) {
  const main = $('#main');
  if (!main) return;
  const index = TABS.indexOf(tab);
  if (index < 0) return;
  // 패널 폭이 정확히 100% 라서 인덱스 x 폭이 곧 목표 위치입니다.
  const left = index * main.clientWidth;
  /*
   * 부드럽게 옮기는 동안에는 중간 탭들을 전부 지나갑니다.
   * 그대로 두면 '오늘 -> 계산기 -> 날씨 -> ...' 로 이름이 촤르륵 깜빡이므로 목적지를 붙들어 둡니다.
   * 이미 그 자리면 스크롤 이벤트가 오지 않아 풀 기회가 없으니, 움직일 때만 겁니다.
   */
  if (smooth && Math.abs(main.scrollLeft - left) > 1) lockPager(tab);
  main.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  // 즉시 이동은 scroll 이벤트가 오지 않을 수 있습니다. 여기서 직접 한 번 그립니다.
  if (!smooth) { unlockPager(); paintPager(); }
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
  let painting = 0;
  /*
   * 손을 대는 순간, 버튼으로 옮기던 일은 끝난 것으로 봅니다.
   * 이제부터는 손가락이 기준이어야 헤더 이름이 손을 따라옵니다.
   */
  ['pointerdown', 'touchstart', 'wheel'].forEach((type) => {
    main.addEventListener(type, unlockPager, { passive: true });
  });

  main.addEventListener('scroll', () => {
    /*
     * 헤더 표시는 멈추기를 기다리지 않고 바로 따라갑니다.
     * 예전에는 settle 에서만 바꿔서, 넘기는 내내 어느 화면으로 가는지 알 수 없었습니다.
     * 관성 중에는 이벤트가 초당 수십 번 들어오므로 한 프레임에 한 번만 그립니다.
     */
    if (!painting) painting = requestAnimationFrame(() => { painting = 0; paintPager(); });
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settlePager, 120);
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
  const next = applyTabLayout(prefs);
  // 숨겼다 다시 켠 탭은 DOM 에서 빠져 있는 동안의 언어 전환을 놓칩니다. 여기서 다시 맞춥니다.
  applyStatic($('#tabs'));

  /*
   * 탭 배치가 그대로면 여기서 끝냅니다.
   *
   * 색이나 카드 크기만 바꿔도 이 함수가 불립니다. 그때마다 setActiveTab 까지 가면
   * '탭을 옮겼다'는 신호가 돌고, 그 신호를 듣는 쪽이 실제로 일을 합니다.
   * update.js 는 설정 탭이 열릴 때마다 업데이트를 확인하러 나가고, today.js 는 화면을 다시 그립니다.
   * 색 한 번 고를 때마다 이게 도는 것은 낭비라, 배치가 안 바뀌었으면 여기서 끊습니다.
   */
  const changed = next.length !== TABS.length || next.some((name, i) => name !== TABS[i]);
  TABS = next;
  if (!changed) return;

  const tab = TABS.includes(currentTab) ? currentTab : (TABS[0] || DEFAULT_TAB);
  setActiveTab(tab);
  // DOM 을 옮긴 직후에는 패널 폭이 아직 확정되지 않아 스크롤 위치가 어긋납니다.
  requestAnimationFrame(() => scrollToPanel(tab, false));
}

/* ---------- 메뉴 사이드바 ----------
 * 탭 막대를 없앴으므로 메뉴는 이 서랍에만 있습니다.
 * 열려 있는 동안 본문은 inert 로 막아, 화면 밖 메뉴 뒤쪽으로 포커스가 새지 않게 합니다.
 */
let lastMenuTrigger = null;

function menuOpen() {
  const bar = $('#sidebar');
  const scrim = $('#sidebar-scrim');
  // 이미 열려 있으면 아무것도 하지 않습니다.
  if (!bar || !scrim || !bar.hidden) return;
  lastMenuTrigger = document.activeElement;
  bar.hidden = false;
  scrim.hidden = false;
  $('#menu-open')?.setAttribute('aria-expanded', 'true');
  document.body.dataset.menu = 'open';
  // 지금 보고 있는 탭에 포커스를 둬야 키보드로 바로 옆 항목으로 갈 수 있습니다.
  (bar.querySelector('.tab[aria-selected="true"]') || bar.querySelector('.tab'))?.focus();
}

function menuClose() {
  const bar = $('#sidebar');
  const scrim = $('#sidebar-scrim');
  if (!bar || bar.hidden) return;
  bar.hidden = true;
  if (scrim) scrim.hidden = true;
  $('#menu-open')?.setAttribute('aria-expanded', 'false');
  delete document.body.dataset.menu;
  // 열 때 누른 버튼으로 포커스를 돌려줍니다. 안 그러면 포커스가 문서 맨 앞으로 튑니다.
  const back = lastMenuTrigger && document.contains(lastMenuTrigger) ? lastMenuTrigger : $('#menu-open');
  back?.focus();
  lastMenuTrigger = null;
}

/** 서랍 안에서 Tab 키가 밖으로 나가지 않게 가둡니다. */
function trapFocus(e) {
  const bar = $('#sidebar');
  if (!bar || bar.hidden || e.key !== 'Tab') return;
  const items = [...bar.querySelectorAll('button:not([disabled])')];
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function initMenu() {
  /*
   * 서랍의 탭 이름도 같이 번역합니다.
   * 헤더는 t() 로 쓰는데 버튼만 한국어로 남아 있어서, 영어로 바꾸면
   * 헤더는 'Calculator', 메뉴는 '계산기' 로 서로 어긋나 있었습니다.
   */
  applyStatic($('#tabs'));
  onLangChange(() => {
    applyStatic($('#tabs'));
    shownTab = null;   // 탭은 그대로여도 글자가 달라집니다
    showHeaderTab(currentTab);
    announceTab(currentTab);
  });
  $('#menu-open')?.addEventListener('click', menuOpen);
  /*
   * 서랍을 먼저 닫고 편집을 켭니다.
   * 서랍이 덮고 있으면 카드를 잡을 수가 없고, menuClose 가 초점을 돌려주므로
   * 그 뒤에 켜야 편집 막대로 초점이 제대로 갑니다.
   */
  $('#arr-start')?.addEventListener('click', () => {
    menuClose();
    startArrange(currentTab);
  });
  $('#menu-close')?.addEventListener('click', menuClose);
  $('#sidebar-scrim')?.addEventListener('click', menuClose);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menuClose();
    trapFocus(e);
  });
}

/* ---------- 헤더의 '지금 이 화면' 표시 ----------
 * 탭 막대가 없어서 이 표시가 유일한 표지입니다.
 * 넘기기가 끝난 뒤에 바꾸면 넘기는 동안에는 아무 정보가 없으므로,
 * 상태(currentTab) 갱신과 화면 표시를 따로 떼어 표시만 스크롤을 따라가게 했습니다.
 */

/** 버튼으로 옮기는 중의 목적지. 스크롤이 멈추면 풉니다. */
let pagerIntent = null;
let pagerIntentTimer = null;

function lockPager(tab) {
  pagerIntent = tab;
  clearTimeout(pagerIntentTimer);
  // 목적지에 닿지 못한 채 멈춘 경우(스크롤이 끊기는 등)에도 상태가 굳지 않게 풀고 다시 맞춥니다.
  pagerIntentTimer = setTimeout(() => { pagerIntent = null; settlePager(); }, 1200);
}

function unlockPager() {
  clearTimeout(pagerIntentTimer);
  pagerIntent = null;
}

/** 탭 버튼 앞의 이모지. 목록이 HTML 한 군데에만 있도록 여기서 읽어 씁니다. */
function iconOf(tab) {
  const btn = document.querySelector(`.tab[data-tab="${tab}"] span`);
  return btn ? btn.textContent.trim() : '';
}

/*
 * 지금 헤더에 쓰여 있는 탭. 스크롤 중에는 한 프레임에 한 번씩 부르는데,
 * 같은 글자를 다시 써도 그때마다 헤더(블러가 걸린 sticky 요소)가 다시 그려져 넘기기가 무거워집니다.
 */
let shownTab = null;

/** 헤더 표시만 바꿉니다. 탭 상태는 건드리지 않습니다. */
function showHeaderTab(tab) {
  if (tab === shownTab) return;
  shownTab = tab;
  const name = $('#header-now-name');
  const icon = $('#header-now-icon');
  if (name) name.textContent = t(`tab.${tab}`);
  if (icon) icon.textContent = iconOf(tab);
}

/**
 * 넘기기가 끝났을 때만 한 번 읽어 줍니다.
 * 보이는 글자에 aria-live 를 걸면 넘기는 내내 읽어 대서 오히려 방해가 됩니다.
 */
function announceTab(tab) {
  const el = $('#tab-announce');
  if (el) el.textContent = t(`tab.${tab}`);
}

/** 위치 막대. at 은 0(첫 화면) ~ TABS.length-1(마지막) 사이의 실수입니다. */
function showPagerRail(at) {
  const thumb = $('#pager-thumb');
  if (!thumb) return;
  const count = Math.max(TABS.length, 1);
  const width = `${100 / count}%`;
  // 폭은 탭 개수가 바뀔 때만 씁니다. 스크롤마다 건드리면 배치 계산이 매번 다시 돕니다.
  if (thumb.style.width !== width) thumb.style.width = width;
  const clamped = Math.min(Math.max(at, 0), count - 1);
  // 칸 하나의 폭이 곧 한 화면이라, 자기 폭의 배수로 밀면 위치가 그대로 맞습니다.
  const shift = `translateX(${clamped * 100}%)`;
  if (thumb.style.transform !== shift) thumb.style.transform = shift;
}

/**
 * 넘기기가 멈췄을 때 탭 상태를 화면에 맞춥니다.
 *
 * 버튼으로 옮기는 중이라면 중간 탭에서는 아무것도 하지 않습니다.
 * 예전에는 지나가던 탭을 활성 탭으로 잡아서, 느린 환경에서 '눌러 놓고 엉뚱한 탭이 켜지는'
 * 일이 생겼습니다. (이 증상으로 e2e 검사가 반복해서 깨졌습니다)
 */
function settlePager() {
  const main = $('#main');
  if (!main) return;
  const width = main.clientWidth;
  if (!width) return;
  const index = Math.min(Math.max(Math.round(main.scrollLeft / width), 0), TABS.length - 1);
  const tab = TABS[index];
  if (pagerIntent && tab !== pagerIntent) return;   // 아직 가는 중입니다
  unlockPager();
  paintPager();
  if (tab && tab !== currentTab) setActiveTab(tab);
}

/** 지금 스크롤 위치를 그대로 헤더에 옮겨 그립니다. */
function paintPager() {
  const main = $('#main');
  if (!main) return;
  const width = main.clientWidth;
  if (!width) return;   // 화면에 붙기 전에는 0 이 나옵니다
  const at = main.scrollLeft / width;
  showPagerRail(at);
  const index = Math.min(Math.max(Math.round(at), 0), TABS.length - 1);
  showHeaderTab(pagerIntent || TABS[index] || DEFAULT_TAB);
}

function initTabs() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activate(btn.dataset.tab);
    // 고르면 바로 닫힙니다. 서랍을 손으로 또 닫게 하면 두 번 일하는 셈입니다.
    menuClose();
  });
  setNavigator(activate);
  watchPagerScroll();

  /*
   * 어느 탭에 있든 한 번에 '오늘' 로.
   * 탭이 아홉 개라 서너 장 쓸어 넘기면 처음 화면이 멀어집니다.
   * 서랍을 열어 고르는 건 두 번 누르는 일입니다.
   */
  $('#home-fab')?.addEventListener('click', () => activate(homeTab(TABS)));

  TABS = applyTabLayout();

  /*
   * 앱을 새로 켜면 언제나 '오늘'로 엽니다.
   *
   * 처음에는 '10분 넘게 떠나 있었을 때만' 되돌렸습니다. 그런데 앱을 껐다가
   * 곧바로 켜면 10분이 안 지났으니 보던 탭이 그대로 열렸습니다.
   * '앱을 열면 오늘 탭이어야 한다' 는 요청과 어긋납니다.
   *
   * 이 줄은 페이지를 새로 읽을 때만 돕니다. 안드로이드 WebView 는 앱이
   * 완전히 꺼졌다 켜질 때만 다시 읽으므로, 여기가 곧 '앱을 새로 켠 순간' 입니다.
   * 잠깐 홈 버튼을 눌렀다 돌아오는 경우는 아래 10분 규칙이 맡습니다.
   */
  setActiveTab(homeTab(TABS));
  markSeen();
  // 레이아웃이 잡히기 전에 스크롤하면 위치가 0 으로 계산됩니다. 한 프레임 뒤에 옮깁니다.
  requestAnimationFrame(() => scrollToPanel(currentTab, false));

  /*
   * 앱이 살아 있는 채로 뒤로 갔다가 돌아오는 경우.
   * 안드로이드 WebView 는 홈 버튼을 눌러도 페이지를 다시 읽지 않으므로,
   * 위의 부팅 경로만으로는 며칠이 지나도 보던 탭 그대로 열립니다.
   *
   * 떠날 때 시각을 찍고, 돌아왔을 때 10분이 넘었으면 '오늘'로 돌립니다.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { markSeen(); return; }
    if (awayTooLong(lastSeen())) activate(homeTab(TABS));
    markSeen();
  });
  // iOS 사파리는 탭을 버릴 때 visibilitychange 대신 pagehide 만 줄 때가 있습니다.
  window.addEventListener('pagehide', markSeen);

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


function boot() {
  /*
   * '첫 접속인가' 는 아무것도 초기화하기 전에 재야 합니다.
   * 부팅이 시작되면 모듈들이 저장을 시작해서, 그 뒤에 재면 언제나 '쓰던 사람' 이 됩니다.
   */
  const firstRun = !hasAnyData();

  safeInit('알림영역', initToastRegion);
  safeInit('언어', initLang);
  safeInit('테마', initTheme);
  safeInit('배너', initBanner);
  safeInit('계산기', initCalculator);
  safeInit('할 일', initTodo);
  // 달력은 할 일 데이터를 구독하므로 그 뒤에 초기화합니다.
  safeInit('달력', initCalendar);
  safeInit('시계·타이머', initTime);
  safeInit('메모', initMemo);
  safeInit('글귀', initQuote);
  safeInit('AI', initAi);
  safeInit('설정', initSettings);
  // 커스터마이즈는 카드 목록을 훑어야 하므로 모든 패널이 준비된 뒤에 돕니다.
  safeInit('커스터마이즈', initAppearance);
  safeInit('메뉴', initMenu);
  safeInit('화면 편집', initArrange);
  safeInit('업데이트', initUpdate);
  // '오늘'은 할 일/날씨 데이터를 구독하므로 두 모듈 뒤에 초기화합니다.
  safeInit('오늘', initToday);
  safeInit('탭', initTabs);
  // 안내는 맨 마지막입니다. 뒤에 있는 화면이 다 준비된 뒤에 덮어야 합니다.
  safeInit('사용 안내', () => initIntro({ firstRun }));
  registerServiceWorker();
  document.body.dataset.ready = 'true'; // 자동화 테스트용 준비 완료 신호
  dismissSplash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
