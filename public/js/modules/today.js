/**
 * '오늘' 탭 — 플래너의 첫 페이지
 *
 * 앱을 열면 가장 먼저 보이는 화면입니다. 두 가지만 보여줍니다.
 *  1) 현재 날씨: 아이콘 + 기온. 누르면 날씨 탭의 주간 예보로 이동합니다.
 *  2) 오늘 할 일: 체크하지 않은 항목이 천천히 순환합니다. 누르면 계획표의 해당 항목으로 갑니다.
 *
 * 자동으로 움직이는 화면은 읽으려는 순간 지나가버리므로,
 * 손을 올리거나 포커스가 들어오면 멈추고 일시정지 버튼도 따로 둡니다. (WCAG 2.2.2)
 * OS 의 '동작 줄이기' 설정이 켜져 있으면 자동 순환을 아예 하지 않습니다.
 */
import { $, el } from '../lib/dom.js';
import { t, getLang, onLangChange } from '../lib/i18n.js';
import { isCurrent, SCOPES } from '../lib/period.js';
import { getItems, onTodoChange, revealItem } from './todo.js';
import { getWeather, onWeatherChange, describe } from './weather.js';
import { goToTab, onTabChange } from '../lib/nav.js';

const ROTATE_MS = 3500;
const VISIBLE_ROWS = 3; // 상자 안에 한 번에 보이는 할 일 개수

let rotateTimer = null;
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

function renderWeather() {
  const box = $('#today-weather');
  if (!box) return;
  const wx = getWeather();
  const lang = getLang();

  if (wx.status === 'loading') {
    box.replaceChildren(
      el('div', { class: 'today-wx-icon' }, el('span', { class: 'spinner' })),
      el('div', { class: 'today-wx-body' },
        el('div', { class: 'today-wx-desc' }, t('today.weather.loading'))),
    );
    return;
  }

  if (wx.status === 'error') {
    box.replaceChildren(
      el('div', { class: 'today-wx-icon' }, '🌡️'),
      el('div', { class: 'today-wx-body' },
        el('div', { class: 'today-wx-desc' }, t('today.weather.error')),
        el('div', { class: 'today-wx-sub' }, t('today.weather.hint'))),
    );
    return;
  }

  const [desc, icon] = describe(wx.code, lang);
  const high = numOr(wx.high);
  const low = numOr(wx.low);
  box.replaceChildren(
    el('div', { class: 'today-wx-icon', 'aria-hidden': 'true' }, icon),
    el('div', { class: 'today-wx-body' },
      el('div', { class: 'today-wx-temp' }, `${numOr(wx.temperature, 1)}°`),
      el('div', { class: 'today-wx-desc' }, desc),
      el('div', { class: 'today-wx-sub' },
        `${wx.place?.name || ''} · ${low}° / ${high}°`),
    ),
    el('div', { class: 'today-wx-go', 'aria-hidden': 'true' }, '›'),
  );
  // 스크린리더에는 한 문장으로 읽히도록 카드 전체에 라벨을 답니다.
  box.closest('.today-card')?.setAttribute(
    'aria-label',
    `${t('today.weather.title')}: ${desc} ${numOr(wx.temperature, 1)}도. ${t('today.weather.hint')}`,
  );
}

function renderTodo() {
  const track = $('#today-rot');
  const countEl = $('#today-todo-count');
  if (!track || !countEl) return;

  rows = todayRows();
  countEl.textContent = rows.length ? t('today.todo.remaining', rows.length) : '';

  if (!rows.length) {
    const items = getItems();
    // 항목 자체가 없는 것과 '전부 끝낸 것'은 다른 상황이라 문구를 나눕니다.
    const finishedToday = items.some((item) => (
      item?.done && SCOPES.includes(item.scope) && typeof item.period === 'string'
      && isCurrent(item.scope, item.period)
    ));
    track.replaceChildren(el('div', { class: 'today-rot-empty' },
      t(finishedToday ? 'today.todo.allDone' : 'today.todo.empty')));
    updateRotateControl();
    return;
  }

  track.replaceChildren(...rows.map((item, i) => el('button', {
    class: 'today-rot-item',
    type: 'button',
    dataset: { id: item.id },
    'aria-label': `${item.text}. ${t('today.aria.position', i + 1, rows.length)}. ${t('today.todo.hint')}`,
  },
  el('span', { class: `today-rot-dot scope-${item.scope}`, 'aria-hidden': 'true' }),
  el('span', { class: 'today-rot-text' }, item.text),
  )));

  if (rotateIndex > maxRotateIndex(rows.length)) rotateIndex = 0;
  scrollToIndex(false);
  updateRotateControl();
}

/** 현재 순환 위치로 스크롤합니다. 항목 높이가 제각각이어도 되도록 실제 위치를 씁니다. */
function scrollToIndex(smooth = true) {
  const track = $('#today-rot');
  const target = track?.children?.[rotateIndex];
  if (!track || !target) return;
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

function renderAll() {
  const lang = getLang();
  $('#panel-today')?.setAttribute('lang', lang);
  const dateEl = $('#today-date');
  if (dateEl) dateEl.textContent = formatDate(lang);
  renderWeather();
  renderTodo();
  syncTimer();
}

export function initToday() {
  // --- 날씨 카드: 누르면 주간 예보로 ---
  $('#today-weather-card').addEventListener('click', () => {
    goToTab('weather');
    // 탭을 바꾼 직후에는 아직 숨김이 풀리지 않아 스크롤이 먹지 않습니다. 한 프레임 뒤에 옮깁니다.
    requestAnimationFrame(() => {
      $('#wx-week')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  });

  // --- 할 일: 누르면 계획표의 그 항목으로 ---
  $('#today-rot').addEventListener('click', (e) => {
    const btn = e.target.closest('.today-rot-item');
    if (!btn) return;
    goToTab('todo');
    revealItem(btn.dataset.id);
  });

  // --- 순환 멈춤/시작 ---
  const track = $('#today-rot');
  $('#today-rot-toggle').addEventListener('click', () => {
    paused = !paused;
    updateRotateControl();
    syncTimer();
  });

  // 손이 올라가 있거나 포커스가 들어와 있는 동안은 멈춥니다.
  const hold = () => { hovering = true; syncTimer(); };
  const release = () => { hovering = false; syncTimer(); };
  track.addEventListener('pointerenter', hold);
  track.addEventListener('pointerleave', release);
  track.addEventListener('pointerdown', hold);
  track.addEventListener('focusin', hold);
  track.addEventListener('focusout', release);

  // 탭을 떠나거나 앱이 백그라운드로 가면 타이머를 멈춥니다.
  onTabChange((name) => {
    tabActive = name === 'today';
    if (tabActive) renderAll(); else syncTimer();
  });
  document.addEventListener('visibilitychange', syncTimer);

  onTodoChange(() => { renderTodo(); syncTimer(); });
  onWeatherChange(renderWeather);
  onLangChange(renderAll);

  renderAll();
}
