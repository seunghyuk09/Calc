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
import { $, el, toast } from '../lib/dom.js';
import { t, getLang, onLangChange, applyStatic } from '../lib/i18n.js';
import { isCurrent, SCOPES } from '../lib/period.js';
import { load } from '../lib/store.js';
import { getPrefs, onPrefsChange, visibleTabs } from '../lib/prefs.js';
import { getItems, onTodoChange, revealItem, setDone, renameItem, addItem } from './todo.js';
import { emojiOf, labelOf } from '../lib/categories.js';
import { getWeather, onWeatherChange, describe } from './weather.js';
import { arrangeBusy, onArrangeChange } from './arrange.js';
import { getTimerState } from './time.js';
import { goToTab, onTabChange, tabIcon } from '../lib/nav.js';
import { addMemo } from './memo.js';
import { recordCalc } from './calculator.js';
import { evaluate, formatNumber } from '../lib/calc-engine.js';

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
let hovering = false;    // 손/포인터가 올라가 있거나, 글자를 고치는 중

/**
 * 순환을 멈출지 여부. 손이 올라가 있거나 글을 고치는 중이면 멈춥니다.
 * initToday 안에만 두면 글자 고치기에서 부를 수가 없어 모듈 범위로 올렸습니다.
 */
function setHover(on) {
  if (hovering === on) return;
  hovering = on;
  syncTimer();
}
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

/**
 * '오늘 할 일' 한 줄.
 *
 * 예전에는 줄 전체가 버튼이라 누르면 계획표로 건너뛰는 것 말고는 할 수 있는 게 없었습니다.
 * 요약을 보다가 체크하려고 탭을 옮겨야 하면 요약을 보는 의미가 없습니다.
 * 이제 한 줄에 체크칸 · 분류 이모지 · 글 · 고치기가 같이 있습니다.
 *
 * 글을 누르면 예전처럼 계획표로 갑니다. 고치기는 그 자리에서 글자만 바꿉니다.
 */
function todoRow(item, index, total) {
  const check = el('input', {
    type: 'checkbox',
    class: 'today-rot-check',
    checked: item.done === true,
    'aria-label': t('today.todo.check', item.text),
  });
  // 체크하면 목록에서 빠집니다. 순환 위치가 목록 밖을 가리키지 않게 renderAll 이 다시 맞춥니다.
  check.addEventListener('change', () => setDone(item.id, check.checked));

  const text = el('button', {
    class: 'today-rot-text', type: 'button',
    dataset: { id: item.id },
    'aria-label': `${t('today.todo.open', item.text)}. ${t('today.aria.position', index + 1, total)}`,
  }, item.text);

  const edit = el('button', {
    class: 'today-rot-edit icon-btn', type: 'button',
    'aria-label': t('today.todo.edit', item.text),
    title: t('today.todo.edit', item.text),
  }, '✎');

  const row = el('div', {
    class: `today-rot-item scope-${item.scope}`,
    dataset: { id: item.id },
  },
  check,
  el('span', { class: 'today-rot-cat', title: labelOf(item.category, t) }, emojiOf(item.category)),
  text,
  edit);

  edit.addEventListener('click', () => startEdit(row, item));
  return row;
}

/**
 * 그 자리에서 글자 고치기.
 * Enter 로 저장, Esc 로 취소, 다른 곳을 누르면 저장합니다.
 * 고치는 동안에는 순환이 돌면 안 됩니다. 글자가 흘러가면 고칠 수가 없습니다.
 */
function startEdit(row, item) {
  if (row.querySelector('.today-rot-input')) return;
  const textBtn = row.querySelector('.today-rot-text');
  if (!textBtn) return;

  const input = el('input', {
    type: 'text',
    class: 'field today-rot-input',
    value: item.text,
    'aria-label': t('today.todo.edit', item.text),
    title: t('today.todo.editHint'),
    maxlength: '200',
  });

  let closed = false;
  const close = (save) => {
    if (closed) return;
    closed = true;
    setHover(false);
    // 저장하면 목록이 다시 그려지므로 되돌릴 필요가 없습니다. 취소면 원래 버튼을 되돌립니다.
    if (save && renameItem(item.id, input.value)) return;
    input.replaceWith(textBtn);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); close(true); }
    else if (e.key === 'Escape') { e.preventDefault(); close(false); }
  });
  input.addEventListener('blur', () => close(true));

  textBtn.replaceWith(input);
  setHover(true);   // 고치는 동안 순환을 멈춥니다
  input.focus();
  input.select();
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
    /*
     * 버튼입니다. 문구가 '눌러서 계획표를 여세요' 라고 말하고 있습니다.
     *
     * div 로 두었더니 눌러도 아무 일이 없었습니다. 할 일 위젯만 카드가 button 이 아니라
     * div(.today-card-static) 여서, 카드 단위 위임이 잡는 선택자에 걸리지 않았습니다.
     * 여기를 버튼으로 두면 키보드로도 갈 수 있습니다. (div 는 초점이 가지 않습니다)
     */
    track.append(el('button', {
      class: 'today-rot-empty', type: 'button',
      onclick: () => goToTab('todo'),
    }, t(finishedToday ? 'today.todo.allDone' : 'today.todo.empty')));
    return track;
  }

  rows.forEach((item, i) => track.append(todoRow(item, i, rows.length)));

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
  clock: { tab: 'time', title: 'today.clock.title', hint: 'today.clock.hint', body: clockBody },
  timer: { tab: 'time', title: 'today.timer.title', hint: 'today.timer.hint', body: timerBody },
  quote: { tab: 'quote', title: 'today.quote.title', hint: 'today.quote.hint', body: quoteBody },
  memo: { tab: 'memo', title: 'today.memo.title', hint: 'today.memo.hint', body: memoBody },
  calc: { tab: 'calc', title: 'today.calc.title', hint: 'today.calc.hint', body: calcBody },
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

/* 편집 중에 그리지 못하고 미뤄 둔 것이 있는지. 편집이 끝나면 한 번 그립니다. */
let renderHeld = false;

function renderWidgets() {
  const host = $('#today-widgets');
  if (!host) return;
  /*
   * 손가락이 카드에 걸려 있는 동안에는 위젯을 다시 그리지 않습니다.
   *
   * 아래 replaceChildren 은 위젯 노드를 통째로 갈아치웁니다. 그런데 이 함수는
   * 날씨가 도착하거나, 할 일이 하나 바뀌거나, 설정이 바뀌기만 해도 불립니다.
   * 그 순간 손가락 밑의 노드가 DOM 에서 빠지면 브라우저가 pointercancel 을 쏘고,
   * 한 번 취소된 손가락으로는 그 뒤에 무엇을 해도 끌 수 없습니다.
   *
   * 편집 모드만 보면 늦습니다. 꾹 누르고 있는 0.5초 사이가 그대로 뚫립니다.
   * 앱을 열자마자 날씨가 도착하므로 하필 그때 잘 걸렸습니다. 그래서 '누르는 중'
   * 까지 포함해서 봅니다.
   */
  if (arrangeBusy()) { renderHeld = true; return; }
  const { widgets } = getPrefs();
  if (!widgets.length) {
    /*
     * 이쪽도 버튼입니다. 문구가 '설정 탭에서 골라 주세요' 라고 말하는데
     * 누를 수 없으면 읽은 사람이 직접 탭을 찾아가야 합니다.
     */
    host.replaceChildren(el('button', {
      class: 'today-rot-empty', type: 'button',
      onclick: () => goToTab('settings'),
    }, t('today.empty')));
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

/**
 * 위젯 하나의 몸통만 다시 그립니다. 카드 껍데기와 머리는 그대로 둡니다.
 *
 * 왜 통째로 갈면 안 되는가
 *   renderWidgets 의 replaceChildren 은 카드를 전부 새로 만듭니다.
 *   그런데 이 함수가 날씨 도착·할 일 변경 어느 쪽으로도 불립니다.
 *   날씨가 도착했다고 할 일 줄까지 갈아 버리면, 고치기 버튼을 누르려던 손가락이
 *   허공을 짚습니다. 자동 검사에서도 '방금 있던 요소가 없다' 로 터집니다.
 *   바뀐 카드만 손대면 옆 카드는 건드리지 않습니다.
 *
 * @returns {boolean} 그 카드가 화면에 있어 실제로 갈아 끼웠으면 true
 */
function renderWidgetBody(name) {
  const spec = WIDGETS[name];
  if (!spec) return false;
  const card = $(`#today-widgets [data-widget="${name}"]`);
  const head = card?.querySelector('.today-card-head');
  if (!card || !head) return false;
  /*
   * 손가락이 카드에 걸려 있는 동안에는 손대지 않습니다.
   * 이유는 renderWidgets 쪽에 적어 두었습니다. 여기도 같은 위험입니다.
   */
  if (arrangeBusy()) { renderHeld = true; return true; }
  card.replaceChildren(head, spec.body());
  return true;
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

/* =========================================================
   기능 바로가기 (런처)

   이 앱에는 탭 막대가 없습니다. 좌우로 쓸거나 ••• 을 눌러야 다른 화면으로 가는데,
   처음 켠 사람은 그 사실을 모르니 '오늘' 하나만 보고 앱이 그게 전부인 줄 압니다.
   위젯을 늘리는 것으로는 이 문제가 풀리지 않습니다. 위젯은 '요약' 이라
   기록이 없는 첫날에는 '없습니다' 만 적힌 빈 상자가 됩니다.

   그래서 자리를 차지하되 절대 비지 않는 것을 둡니다.
   이모지는 전부 aria-hidden 이고 이름은 옆의 글자가 맡습니다.
   (이모지만 두면 🗓️ 이 'spiral calendar', ⏱️ 가 'stopwatch' 로 읽힙니다)
   ========================================================= */

/**
 * 바로가기에 올릴 탭.
 * 지금 보고 있는 화면이라 '오늘' 자신은 뺍니다. 숨긴 탭도 애초에 들어오지 않습니다.
 */
export function launcherTabs(tabs) {
  return (Array.isArray(tabs) ? tabs : []).filter((name) => name && name !== 'today');
}

function renderLauncher() {
  const host = $('#today-launcher');
  if (!host) return;
  const tabs = launcherTabs(visibleTabs());
  /*
   * '오늘' 말고 전부 숨겨 둔 사람도 있습니다. 그때 빈 nav 를 남겨 두면
   * 위아래 여백만 벌어지고, 화면 읽기 프로그램에는 아무것도 없는 이정표가 읽힙니다.
   */
  host.hidden = tabs.length === 0;
  if (host.hidden) { host.replaceChildren(); return; }
  host.setAttribute('aria-label', t('today.launcher.label'));
  host.replaceChildren(...tabs.map((name) => el('button', {
    class: 'today-launch', type: 'button', dataset: { tab: name },
  },
  el('span', { class: 'today-launch-icon', 'aria-hidden': 'true' }, tabIcon(name)),
  el('span', { class: 'today-launch-name' }, t(`tab.${name}`)))));
}

/* =========================================================
   바로 적기

   할 일 하나 적으러 탭을 넘어갔다 돌아오는 것이 첫 사용에서 가장 많이 막히는 자리였습니다.
   저장은 각 모듈의 문(addItem / addMemo / recordCalc)을 통해서만 합니다.
   여기서 localStorage 를 직접 건드리면 같은 데이터를 쓰는 곳이 둘로 갈라집니다.
   ========================================================= */

function quickTodo(e) {
  e.preventDefault();
  const input = $('#today-quick-todo');
  const text = input?.value.trim();
  if (!text) return;
  if (!addItem(text)) return;
  input.value = '';
  toast(t('today.quick.todoDone', text));
}

function showCalcOut(message, isError) {
  const out = $('#today-quick-calc-out');
  if (!out) return;
  out.hidden = false;
  out.classList.toggle('is-error', isError === true);
  out.textContent = message;
}

function quickCalc(e) {
  e.preventDefault();
  const input = $('#today-quick-calc');
  const raw = input?.value.trim();
  if (!raw) return;
  try {
    const value = evaluate(raw);
    showCalcOut(`${raw} = ${formatNumber(value)}`, false);
    // 기록에 남겨야 '최근 계산' 위젯과 계산기 탭에서 다시 꺼낼 수 있습니다.
    recordCalc(raw, value);
    // 결과를 이어서 계산할 수 있도록 남겨 둡니다. 계산기 탭과 같은 습관입니다.
    input.value = String(value);
  } catch {
    /*
     * 엔진이 주는 문구는 한국어로 박혀 있습니다. 영어로 쓰는 사람에게 한국어가
     * 튀어나오는 것보다는, 짧아도 고른 언어로 말하는 편이 낫습니다.
     */
    showCalcOut(t('today.quick.calcError'), true);
  }
}

function quickMemo(e) {
  e.preventDefault();
  const input = $('#today-quick-memo');
  const text = input?.value.trim();
  if (!text) return;
  if (!addMemo(text)) return;
  input.value = '';
  toast(t('today.quick.memoDone'));
}

function renderAll() {
  const lang = getLang();
  $('#panel-today')?.setAttribute('lang', lang);
  const dateEl = $('#today-date');
  if (dateEl) dateEl.textContent = formatDate(lang);
  /*
   * 이 패널의 정적 문구(바로 적기 칸의 이름과 안내)는 여기서 언어를 맞춥니다.
   * applyStatic 은 문서 전체에 한 번도 불리지 않아서, 부르지 않으면
   * 영어로 바꿔도 한국어가 그대로 남습니다.
   */
  // applyStatic 은 root.querySelectorAll 을 부릅니다. null 을 넘기면 그 자리에서 던집니다.
  const panel = $('#panel-today');
  if (panel) applyStatic(panel);
  renderLauncher();
  renderWidgets();
  syncTimer();
  syncClock();
}

export function initToday() {
  const host = $('#today-widgets');
  if (!host) return;

  /*
   * 바로가기는 다시 그릴 때마다 칩이 새 노드가 되므로 컨테이너에 위임합니다.
   * 칩 안의 이모지/글자를 눌러도 closest 로 버튼까지 올라갑니다.
   */
  $('#today-launcher')?.addEventListener('click', (e) => {
    const chip = e.target.closest('.today-launch');
    if (chip?.dataset.tab) goToTab(chip.dataset.tab);
  });

  // 바로 적기. form 이라 Enter 로도 넘어갑니다.
  $('#today-quick-todo-form')?.addEventListener('submit', quickTodo);
  $('#today-quick-calc-form')?.addEventListener('submit', quickCalc);
  /*
   * 다시 치기 시작하면 앞선 결과와 오류를 지웁니다.
   * 남겨 두면 '((1+' 를 고쳐 '(1+2)' 로 만들어 놓고도 빨간 '계산할 수 없습니다' 가
   * 그대로 붙어 있어, 고친 것이 틀린 줄 압니다.
   */
  $('#today-quick-calc')?.addEventListener('input', () => {
    const out = $('#today-quick-calc-out');
    if (!out || out.hidden) return;
    out.hidden = true;
    out.textContent = '';
    out.classList.remove('is-error');
  });
  $('#today-quick-memo-form')?.addEventListener('submit', quickMemo);

  // 위젯이 다시 그려져도 살아 있도록 컨테이너에 한 번만 위임합니다.
  host.addEventListener('click', (e) => {
    /*
     * 줄에서 '글' 을 눌렀을 때만 계획표로 건너뜁니다.
     * 줄 전체를 기준으로 잡으면 체크칸이나 고치기를 눌러도 탭이 넘어가 버립니다.
     */
    const text = e.target.closest('.today-rot-text');
    if (text) {
      goToTab('todo');
      revealItem(text.dataset.id);
      return;
    }
    // 체크칸과 고치기는 제 일만 하고 여기서 끝냅니다.
    if (e.target.closest('.today-rot-check, .today-rot-edit, .today-rot-input')) return;
    if (e.target.closest('#today-rot-toggle')) {
      paused = !paused;
      updateRotateControl();
      syncTimer();
      return;
    }
    /*
     * 카드 아무 데나 눌러도 그 탭으로 갑니다.
     *
     * 예전에는 '.today-card' 로 찾았는데, 할 일 위젯만 카드가 button 이 아니라
     * div 라서 클래스가 'today-card-static' 입니다. 클래스 선택자는 토큰이 정확히
     * 맞아야 걸리므로 할 일 카드만 통째로 빠져, 제목이나 여백을 눌러도 아무 일이
     * 없었습니다. data 속성으로 찾으면 둘 다 걸립니다.
     */
    const card = e.target.closest('[data-widget][data-goto]');
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

  onTodoChange(() => {
    // 할 일 카드만 다시 그립니다. 없으면(위젯을 끈 경우) 그릴 것도 없습니다.
    if (!renderWidgetBody('todo')) return;
    updateTodoCount();
    scrollToIndex(false);
    updateRotateControl();
    // 남은 개수가 바뀌면 순환을 돌릴지 말지도 달라집니다. (shouldRun 이 rows.length 를 봅니다)
    syncTimer();
  });
  // 날씨가 도착했다고 할 일 줄을 뜯어내면 안 됩니다. 날씨 카드만 손댑니다.
  onWeatherChange(() => { renderWidgetBody('weather'); });
  // 손가락이 떨어지고 편집도 끝나면, 그동안 미뤄 둔 그리기를 한 번 처리합니다.
  onArrangeChange(() => {
    if (arrangeBusy() || !renderHeld) return;
    renderHeld = false;
    renderAll();
  });
  onLangChange(renderAll);
  onPrefsChange(renderAll);

  renderAll();
}
