/**
 * '오늘' 탭 — 플래너의 첫 페이지
 *
 * 앱을 열면 가장 먼저 보이는 화면입니다.
 * 어떤 요약 카드를 어떤 순서로 놓을지는 설정 탭에서 고릅니다. (lib/prefs.js 의 widgets)
 * 카드는 전부 버튼이고, 누르면 그 기능의 탭으로 넘어갑니다.
 *
 * 자동으로 움직이는 화면은 읽으려는 순간 지나가버리므로,
 * 손을 올리거나 포커스가 들어오면 멈추고 일시정지 버튼도 따로 둡니다. (WCAG 2.2.2)
 * OS 의 '동작 줄이기' 설정이 켜져 있으면 자동 순환을 아예 하지 않습니다.
 */
import { $, el } from '../lib/dom.js';
import { t, getLang, onLangChange } from '../lib/i18n.js';
import { isCurrent, SCOPES } from '../lib/period.js';
import { load } from '../lib/store.js';
import { getPrefs, onPrefsChange } from '../lib/prefs.js';
import { getItems, onTodoChange, revealItem } from './todo.js';
import { getWeather, onWeatherChange, describe } from './weather.js';
import { getTimerState } from './time.js';
import { goToTab, onTabChange } from '../lib/nav.js';

const ROTATE_MS = 3500;
const VISIBLE_ROWS = 3; // 상자 안에 한 번에 보이는 할 일 개수
const TICK_MS = 1000;   // 시계·타이머 위젯 갱신 주기

// 다른 모듈이 localStorage 에 쓰는 키입니다.
// 모듈마다 구독 훅을 새로 만드는 대신, 요약만 필요하므로 저장된 값을 직접 읽습니다.
const QUOTE_KEY = 'quote.items';
const MEMO_KEY = 'memo.items';
const CALC_HISTORY_KEY = 'calc.history';

let rotateTimer = null;
let clockTimer = null;
let rotateIndex = 0;
let paused = false;      // 사용자가 버튼으로 멈춘 상태
let hovering = false;    // 손/포인터가 올라가 있는 동안
let tabActive = false;   // '오늘' 탭이 보이는 동안만 타이머를 돌립니다
let rows = [];           // 현재 보여주는 미완료 항목

/** OS 의 '동작 줄이기' 설정. 켜져 있으면 자동 순환을 하지 않습니다. */
function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * 오늘 해야 할 미완료 항목.
 * 일간은 오늘, 주간은 이번 주, 월간은 이번 달, 연간은 올해 것까지 포함합니다.
 * (주간 계획만 쓰는 사용자에게 빈 화면을 보여주지 않기 위해서입니다)
 * 짧은 주기가 먼저 오도록 정렬합니다.
 */
const SCOPE_ORDER = { day: 0, week: 1, month: 2, year: 3 };

/**
 * localStorage 가 손상되면 scope 가 없거나 이상한 값인 항목이 섞여 들어옵니다.
 * isCurrent() 는 모르는 단위에 예외를 던지므로, 여기서 먼저 걸러야
 * 항목 하나 때문에 '오늘' 탭 전체가 죽지 않습니다.
 */
const usable = (item) => (
  item != null
  && !item.done
  && typeof item.text === 'string'
  && SCOPES.includes(item.scope)
  && typeof item.period === 'string'
);

export function todayRows(items = getItems()) {
  return items
    .filter((item) => usable(item) && isCurrent(item.scope, item.period))
    .sort((a, b) => (SCOPE_ORDER[a.scope] ?? 9) - (SCOPE_ORDER[b.scope] ?? 9));
}

/** 순환 위치의 최댓값. 보이는 개수만큼은 끝에 남겨 둬야 빈 칸이 생기지 않습니다. */
export function maxRotateIndex(count, visible = VISIBLE_ROWS) {
  return Math.max(0, count - visible);
}

/** 저장된 배열을 읽습니다. 값이 망가져 있으면 빈 배열로 취급합니다. */
function listOf(key) {
  const raw = load(key, []);
  return Array.isArray(raw) ? raw : [];
}

function formatDate(lang) {
  const locale = lang === 'en' ? 'en-US' : 'ko-KR';
  try {
    return new Date().toLocaleDateString(locale, {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
  } catch {
    // 로케일 데이터가 없는 환경(축소 빌드 등)에서도 날짜는 보여야 합니다.
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
}

const numOr = (value, digits = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'
);

const pad2 = (n) => String(n).padStart(2, '0');

/** 초를 mm:ss 로. 한 시간이 넘으면 h:mm:ss 로 늘립니다. */
function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${pad2(m)}:${pad2(s % 60)}`;
}

/* =========================================================
   위젯
   각 위젯은 { title, tab, body } 를 돌려줍니다.
   body 는 카드 안에 들어갈 요소이고, tab 은 눌렀을 때 이동할 탭입니다.
   ========================================================= */

function weatherBody() {
  const wx = getWeather();
  const lang = getLang();

  if (wx.status === 'loading') {
    return el('div', { class: 'today-wx', id: 'today-weather' },
      el('div', { class: 'today-wx-icon' }, el('span', { class: 'spinner' })),
      el('div', { class: 'today-wx-body' },
        el('div', { class: 'today-wx-desc' }, t('today.weather.loading'))));
  }
  if (wx.status === 'error') {
    return el('div', { class: 'today-wx', id: 'today-weather' },
      el('div', { class: 'today-wx-icon' }, '🌡️'),
      el('div', { class: 'today-wx-body' },
        el('div', { class: 'today-wx-desc' }, t('today.weather.error')),
        el('div', { class: 'today-wx-sub' }, t('today.weather.hint'))));
  }

  const [desc, icon] = describe(wx.code, lang);
  return el('div', { class: 'today-wx', id: 'today-weather' },
    el('div', { class: 'today-wx-icon', 'aria-hidden': 'true' }, icon),
    el('div', { class: 'today-wx-body' },
      el('div', { class: 'today-wx-temp' }, `${numOr(wx.temperature, 1)}°`),
      el('div', { class: 'today-wx-desc' }, desc),
      el('div', { class: 'today-wx-sub' },
        `${wx.place?.name || ''} · ${numOr(wx.low)}° / ${numOr(wx.high)}°`)),
    el('div', { class: 'today-wx-go', 'aria-hidden': 'true' }, '›'));
}

function todoBody() {
  rows = todayRows();
  const track = el('div', {
    class: 'today-rot', id: 'today-rot', tabindex: '0',
    'aria-label': t('today.aria.rotation'),
  });

  if (!rows.length) {
    const items = getItems();
    // 항목 자체가 없는 것과 '전부 끝낸 것'은 다른 상황이라 문구를 나눕니다.
    const finishedToday = items.some((item) => (
      item?.done && SCOPES.includes(item.scope) && typeof item.period === 'string'
      && isCurrent(item.scope, item.period)
    ));
    track.append(el('div', { class: 'today-rot-empty' },
      t(finishedToday ? 'today.todo.allDone' : 'today.todo.empty')));
    return track;
  }

  rows.forEach((item, i) => track.append(el('button', {
    class: 'today-rot-item',
    type: 'button',
    dataset: { id: item.id },
    'aria-label': `${item.text}. ${t('today.aria.position', i + 1, rows.length)}. ${t('today.todo.hint')}`,
  },
  el('span', { class: `today-rot-dot scope-${item.scope}`, 'aria-hidden': 'true' }),
  el('span', { class: 'today-rot-text' }, item.text))));

  if (rotateIndex > maxRotateIndex(rows.length)) rotateIndex = 0;
  return track;
}

function clockBody() {
  const now = new Date();
  return el('div', { class: 'today-line' },
    el('div', { class: 'today-big', id: 'today-clock' },
      `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`));
}

function timerBody() {
  const state = getTimerState();
  if (!state.running && state.remain === state.total) {
    return el('div', { class: 'today-line' },
      el('div', { class: 'today-sub', id: 'today-timer' }, t('today.timer.idle')));
  }
  return el('div', { class: 'today-line' },
    el('div', { class: 'today-big', id: 'today-timer' }, clock(state.remain)),
    el('div', { class: 'today-sub' },
      state.running ? t('today.timer.running') : t('today.rotate.pause')));
}

function quoteBody() {
  const items = listOf(QUOTE_KEY);
  const first = items.find((q) => q && typeof q.text === 'string' && q.text.trim());
  if (!first) return el('div', { class: 'today-sub' }, t('today.quote.empty'));
  return el('div', { class: 'today-quote' },
    el('div', { class: 'today-quote-text' }, first.text),
    first.author ? el('div', { class: 'today-sub' }, `— ${first.author}`) : '');
}

function memoBody() {
  const items = listOf(MEMO_KEY);
  const first = items.find((m) => m && typeof m.text === 'string' && m.text.trim());
  if (!first) return el('div', { class: 'today-sub' }, t('today.memo.empty'));
  return el('div', {},
    el('div', { class: 'today-clip' }, first.text),
    items.length > 1 ? el('div', { class: 'today-sub' }, t('today.memo.more', items.length - 1)) : '');
}

function calcBody() {
  const items = listOf(CALC_HISTORY_KEY);
  const first = items.find((h) => h && typeof h.expr === 'string');
  if (!first) return el('div', { class: 'today-sub' }, t('today.calc.empty'));
  return el('div', {},
    el('div', { class: 'today-sub today-clip' }, first.expr),
    el('div', { class: 'today-big today-big-sm' }, String(first.value ?? '')),
    first.note ? el('div', { class: 'today-sub today-clip' }, `📝 ${first.note}`) : '');
}

const WIDGETS = {
  weather: { tab: 'weather', title: 'today.weather.title', hint: 'today.weather.hint', body: weatherBody },
  todo: { tab: 'todo', title: 'today.todo.title', hint: 'today.todo.hint', body: todoBody },
  clock: { tab: 'time', title: 'today.clock.title', hint: 'today.widget.hint', body: clockBody },
  timer: { tab: 'time', title: 'today.timer.title', hint: 'today.widget.hint', body: timerBody },
  quote: { tab: 'quote', title: 'today.quote.title', hint: 'today.widget.hint', body: quoteBody },
  memo: { tab: 'memo', title: 'today.memo.title', hint: 'today.widget.hint', body: memoBody },
  calc: { tab: 'calc', title: 'today.calc.title', hint: 'today.widget.hint', body: calcBody },
};

/**
 * 카드 하나를 만듭니다.
 * 할 일 위젯만 버튼이 아니라 div 입니다. 안에 항목 버튼과 일시정지 버튼이 들어가는데,
 * 버튼 안에 버튼을 넣으면 HTML 규칙 위반이고 클릭이 엉킵니다.
 */
function widgetCard(name) {
  const spec = WIDGETS[name];
  if (!spec) return null;
  const interactive = name !== 'todo';

  const head = el('div', { class: 'today-card-head' },
    el('span', { class: 'card-title' }, t(spec.title)),
    el('span', { class: 'card-sub', ...(name === 'todo' ? { id: 'today-todo-count' } : {}) },
      name === 'todo' ? '' : t(spec.hint)));

  if (name === 'todo') {
    const toggle = el('button', {
      class: 'icon-btn today-rot-toggle', id: 'today-rot-toggle', type: 'button',
      'aria-pressed': String(paused),
    }, paused ? '▶' : '⏸');
    head.append(toggle);
  }

  const card = el(interactive ? 'button' : 'div', {
    class: `card today-card${interactive ? '' : '-static'}`,
    dataset: { widget: name, goto: spec.tab },
    ...(interactive ? { type: 'button', id: `today-${name}-card` } : {}),
  }, head, spec.body());

  return card;
}

function renderWidgets() {
  const host = $('#today-widgets');
  if (!host) return;
  const { widgets } = getPrefs();
  if (!widgets.length) {
    host.replaceChildren(el('div', { class: 'today-rot-empty' }, t('today.empty')));
    rows = [];
    return;
  }
  host.replaceChildren(...widgets.map(widgetCard).filter(Boolean));

  if (widgets.includes('todo')) {
    updateTodoCount();
    scrollToIndex(false);
    updateRotateControl();
  }
}

function updateTodoCount() {
  const countEl = $('#today-todo-count');
  if (countEl) countEl.textContent = rows.length ? t('today.todo.remaining', rows.length) : '';
}

/** 현재 순환 위치로 스크롤합니다. 항목 높이가 제각각이어도 되도록 실제 위치를 씁니다. */
function scrollToIndex(smooth = true) {
  const track = $('#today-rot');
  const target = track?.children?.[rotateIndex];
  if (!track || !target || !track.children[0]) return;
  track.scrollTo({
    top: target.offsetTop - track.children[0].offsetTop,
    behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
  });
}

function updateRotateControl() {
  const btn = $('#today-rot-toggle');
  if (!btn) return;
  // 순환할 것이 없으면 버튼을 숨깁니다. 눌러도 아무 일이 없는 버튼은 혼란만 줍니다.
  const needed = !prefersReducedMotion() && maxRotateIndex(rows.length) > 0;
  btn.hidden = !needed;
  btn.textContent = paused ? '▶' : '⏸';
  btn.setAttribute('aria-label', t(paused ? 'today.rotate.play' : 'today.rotate.pause'));
  btn.setAttribute('title', t(paused ? 'today.rotate.play' : 'today.rotate.pause'));
  btn.setAttribute('aria-pressed', String(paused));
}

function tick() {
  const limit = maxRotateIndex(rows.length);
  if (limit <= 0) return;
  rotateIndex = rotateIndex >= limit ? 0 : rotateIndex + 1;
  scrollToIndex(true);
}

function shouldRun() {
  return tabActive && !paused && !hovering
    && !prefersReducedMotion()
    && maxRotateIndex(rows.length) > 0
    && document.visibilityState !== 'hidden';
}

function syncTimer() {
  if (shouldRun()) {
    if (!rotateTimer) rotateTimer = setInterval(tick, ROTATE_MS);
  } else if (rotateTimer) {
    clearInterval(rotateTimer);
    rotateTimer = null;
  }
}

/**
 * 시계·타이머 위젯은 1초마다 숫자만 갈아 끼웁니다.
 * 카드를 통째로 다시 그리면 매 초 포커스가 날아갑니다.
 */
function tickClock() {
  const clockEl = $('#today-clock');
  if (clockEl) {
    const now = new Date();
    clockEl.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  }
  const timerEl = $('#today-timer');
  if (timerEl) {
    const state = getTimerState();
    const idle = !state.running && state.remain === state.total;
    timerEl.textContent = idle ? t('today.timer.idle') : clock(state.remain);
  }
}

function syncClock() {
  const needed = tabActive && document.visibilityState !== 'hidden'
    && ($('#today-clock') || $('#today-timer'));
  if (needed) {
    if (!clockTimer) clockTimer = setInterval(tickClock, TICK_MS);
  } else if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function renderAll() {
  const lang = getLang();
  $('#panel-today')?.setAttribute('lang', lang);
  const dateEl = $('#today-date');
  if (dateEl) dateEl.textContent = formatDate(lang);
  renderWidgets();
  syncTimer();
  syncClock();
}

export function initToday() {
  const host = $('#today-widgets');
  if (!host) return;

  // 위젯이 다시 그려져도 살아 있도록 컨테이너에 한 번만 위임합니다.
  host.addEventListener('click', (e) => {
    const item = e.target.closest('.today-rot-item');
    if (item) {
      goToTab('todo');
      revealItem(item.dataset.id);
      return;
    }
    if (e.target.closest('#today-rot-toggle')) {
      paused = !paused;
      updateRotateControl();
      syncTimer();
      return;
    }
    const card = e.target.closest('.today-card[data-goto]');
    if (!card) return;
    const tab = card.dataset.goto;
    goToTab(tab);
    // 탭을 바꾼 직후에는 아직 배치가 끝나지 않아 스크롤이 먹지 않습니다. 한 프레임 뒤에 옮깁니다.
    if (tab === 'weather') {
      requestAnimationFrame(() => {
        $('#wx-week')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  });

  /*
   * 순환 목록 위에 손이나 포커스가 있는 동안만 멈춥니다.
   * 위젯은 다시 그려질 때마다 새 요소가 되므로 컨테이너에 위임하는데,
   * pointerenter/leave 는 버블링하지 않아 위임이 되지 않습니다. over/out 을 씁니다.
   * 카드 전체가 아니라 #today-rot 안일 때만 멈춰야 합니다.
   * (일시정지 버튼은 카드 머리에 있어서, 카드 전체를 기준으로 잡으면
   *  버튼을 한 번 누른 뒤 마우스가 그 자리에 남아 순환이 영영 멈춥니다)
   */
  const inRot = (node) => !!(node && node.closest && node.closest('#today-rot'));
  const setHover = (on) => { if (hovering !== on) { hovering = on; syncTimer(); } };
  host.addEventListener('pointerover', (e) => { if (inRot(e.target)) setHover(true); });
  host.addEventListener('pointerout', (e) => { if (!inRot(e.relatedTarget)) setHover(false); });
  host.addEventListener('pointerdown', (e) => { if (inRot(e.target)) setHover(true); });
  host.addEventListener('focusin', (e) => { if (inRot(e.target)) setHover(true); });
  host.addEventListener('focusout', (e) => { if (!inRot(e.relatedTarget)) setHover(false); });

  // 탭을 떠나거나 앱이 백그라운드로 가면 타이머를 멈춥니다.
  onTabChange((name) => {
    tabActive = name === 'today';
    if (tabActive) renderAll(); else { syncTimer(); syncClock(); }
  });
  document.addEventListener('visibilitychange', () => { syncTimer(); syncClock(); });

  onTodoChange(() => { renderAll(); });
  onWeatherChange(() => { renderAll(); });
  onLangChange(renderAll);
  onPrefsChange(renderAll);

  renderAll();
}
