/**
 * calendar.js — TO DO 탭의 월 달력
 *
 * 어느 날에 무슨 일이 있는지 한눈에 보기 위한 화면입니다.
 * 칸이 작아 내용을 다 쓸 수 없으므로 분류 이모지만 놓고,
 * 날짜를 누르면 그 날의 할 일이 아래로 펼쳐집니다.
 *
 * 일간(day) 계획만 표시합니다.
 * 주간/월간/연간은 특정 하루에 속하지 않아서, 달력에 올리면 어느 날인지 거짓으로 알려주게 됩니다.
 */
import { $, el } from '../lib/dom.js';
import { t, getLang, onLangChange } from '../lib/i18n.js';
import { emojiOf } from '../lib/categories.js';
import { getItems, onTodoChange, openDate } from './todo.js';

const MAX_DOTS = 3;         // 한 칸에 보여 줄 이모지 개수. 넘치면 +N 으로 줄입니다.
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

let cursor = firstOfMonth(new Date());   // 지금 보고 있는 달
let selected = null;                     // 펼쳐 놓은 날짜 (YYYY-MM-DD)

const pad = (n) => String(n).padStart(2, '0');

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Date -> 'YYYY-MM-DD'. period.js 의 keyOf('day') 와 같은 형식입니다. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 달력에 깔 날짜들.
 * 1일이 속한 주의 일요일부터, 말일이 속한 주의 토요일까지 채웁니다.
 * (달마다 줄 수가 달라지지만, 빈 줄을 억지로 만드는 것보다 낫습니다)
 */
export function monthGrid(monthStart) {
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  end.setDate(end.getDate() + (6 - end.getDay()));

  const out = [];
  const walk = new Date(start);
  // 안전장치: 어떤 달도 6주(42칸)를 넘지 않습니다. 날짜 계산이 어긋나도 무한 루프가 되지 않게 막습니다.
  while (walk <= end && out.length < 42) {
    out.push(new Date(walk));
    walk.setDate(walk.getDate() + 1);
  }
  return out;
}

/**
 * 날짜별 일간 할 일 묶음.
 * 손상된 항목이 섞여 있어도 달력 전체가 죽지 않도록 걸러냅니다.
 */
export function groupByDay(items = getItems()) {
  const map = new Map();
  items.forEach((item) => {
    if (!item || item.scope !== 'day' || typeof item.period !== 'string') return;
    if (typeof item.text !== 'string') return;
    if (!map.has(item.period)) map.set(item.period, []);
    map.get(item.period).push(item);
  });
  return map;
}

function monthLabel(date, lang) {
  try {
    return date.toLocaleDateString(lang === 'en' ? 'en-US' : 'ko-KR',
      { year: 'numeric', month: 'long' });
  } catch {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  }
}

function renderDetail(dayItems) {
  const box = $('#cal-detail');
  if (!box) return;

  if (!selected) {
    box.replaceChildren(el('p', { class: 'card-sub' }, t('cal.pick')));
    return;
  }

  const rows = dayItems.get(selected) || [];
  const head = el('div', { class: 'cal-detail-head' },
    el('span', { class: 'cal-detail-date' }, selected),
    el('span', { class: 'card-sub' }, t('cal.count', rows.length)));

  if (!rows.length) {
    box.replaceChildren(head, el('p', { class: 'empty' }, t('cal.empty')));
    return;
  }

  box.replaceChildren(head, el('ul', { class: 'cal-detail-list' },
    ...rows.map((item) => {
      const btn = el('button', {
        class: `cal-detail-item${item.done ? ' done' : ''}`,
        type: 'button',
        'aria-label': `${item.text}. ${t('cal.goHint')}`,
      },
      el('span', { class: 'cal-detail-emoji', 'aria-hidden': 'true' }, emojiOf(item.category)),
      el('span', { class: 'cal-detail-text' }, item.text));
      // 누르면 계획표를 그 날짜로 옮기고 해당 항목을 강조합니다.
      btn.addEventListener('click', () => openDate(selected, item.id));
      return el('li', {}, btn);
    })));
}

function render() {
  const grid = $('#cal-grid');
  if (!grid) return;
  const lang = getLang();
  const byDay = groupByDay();
  const todayKey = dayKey(new Date());
  const month = cursor.getMonth();

  const labelEl = $('#cal-label');
  if (labelEl) labelEl.textContent = monthLabel(cursor, lang);

  grid.replaceChildren(
    ...WEEKDAY_KEYS.map((key, i) => el('div', {
      class: `cal-wd${i === 0 ? ' sun' : ''}${i === 6 ? ' sat' : ''}`,
    }, t(`cal.wd.${key}`))),
    ...monthGrid(cursor).map((date) => {
      const key = dayKey(date);
      const rows = byDay.get(key) || [];
      const undone = rows.filter((r) => !r.done).length;
      const outside = date.getMonth() !== month;

      // 같은 분류가 여러 건이면 이모지를 한 번만 보여 줍니다. 칸이 금방 가득 차기 때문입니다.
      const emojis = [...new Set(rows.map((r) => emojiOf(r.category)))];
      const shown = emojis.slice(0, MAX_DOTS);
      const more = emojis.length - shown.length;

      const cell = el('button', {
        class: [
          'cal-day',
          outside ? 'is-outside' : '',
          key === todayKey ? 'is-today' : '',
          key === selected ? 'is-selected' : '',
          rows.length ? 'has-items' : '',
        ].filter(Boolean).join(' '),
        type: 'button',
        dataset: { day: key },
        'aria-pressed': String(key === selected),
        'aria-label': rows.length
          ? `${key}. ${t('cal.count', rows.length)}${undone ? `, ${t('cal.undone', undone)}` : ''}`
          : `${key}. ${t('cal.empty')}`,
      },
      el('span', { class: 'cal-num' }, String(date.getDate())),
      el('span', { class: 'cal-marks', 'aria-hidden': 'true' },
        ...shown.map((e) => el('span', { class: 'cal-mark' }, e)),
        more > 0 ? el('span', { class: 'cal-more' }, `+${more}`) : ''));

      return cell;
    }),
  );

  renderDetail(byDay);
}

/** 달을 옮깁니다. 보고 있던 날짜 선택은 유지합니다. */
function moveMonth(delta) {
  cursor = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  render();
}

export function initCalendar() {
  const grid = $('#cal-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-day');
    if (!cell) return;
    // 같은 날을 다시 누르면 접습니다. 펼친 뒤 닫을 방법이 없으면 답답합니다.
    selected = selected === cell.dataset.day ? null : cell.dataset.day;
    render();
  });

  $('#cal-prev')?.addEventListener('click', () => moveMonth(-1));
  $('#cal-next')?.addEventListener('click', () => moveMonth(1));
  $('#cal-today')?.addEventListener('click', () => {
    cursor = firstOfMonth(new Date());
    selected = dayKey(new Date());
    render();
  });

  onTodoChange(render);
  onLangChange(render);
  render();
}
