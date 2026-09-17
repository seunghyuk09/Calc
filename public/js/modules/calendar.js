/**
 * calendar.js — 계획표 카드 안의 달력
 *
 * 달력은 계획을 적어 넣는 칸 바로 위, 진행률과 분류 이모지 사이에 있습니다.
 * 예전에는 따로 카드였는데 좁은 화면의 절반 가까이를 쓰면서 정작 입력칸을 밀어냈습니다.
 *
 * 모양은 계획표에서 고른 단위를 그대로 따릅니다.
 *   일간 — 고른 날짜 한 줄 (칸 하나에 격자를 놓아 봐야 의미가 없습니다)
 *   주간 — 그 주 이레
 *   월간 — 그 달 한 판
 *   연간 — 열두 달을 작게, 한 줄에 넉 장씩 석 줄
 *
 * 움직이는 줄도 하나뿐입니다. 예전에는 달력이 제 ‹ › 를 따로 갖고 있어
 * 계획표의 ‹ › 와 어느 쪽을 움직이는지 헷갈렸습니다. 이제 계획표의 줄이 둘 다 움직입니다.
 * 이 파일은 보는 기간을 스스로 정하지 않고, todo.js 가 알려 주는 것을 따라 그립니다.
 *
 * 일간(day) 계획만 칸에 표시합니다.
 * 주간/월간/연간은 특정 하루에 속하지 않아서, 달력에 올리면 어느 날인지 거짓으로 알려주게 됩니다.
 *
 * 한 주는 일요일에서 시작합니다.
 * 계획표의 '주간' 단위와 달력의 한 줄이 정확히 겹쳐야 '이번 주'를 한 줄로 강조할 수 있어서,
 * 둘 다 일요일 시작으로 맞춰 두었습니다. (period.js 의 weekParts 와 같은 기준)
 */
import { $, el } from '../lib/dom.js';
import { t, getLang, onLangChange } from '../lib/i18n.js';
import { load, save } from '../lib/store.js';
import { emojiOf, labelOf } from '../lib/categories.js';
import { keyOf, dateOf, label } from '../lib/period.js';
import {
  getItems, onTodoChange, onViewChange, getView,
  openDate, openPeriod, gotoDate, normalizeTime, sortDayRows,
} from './todo.js';

const MAX_DOTS = 3;         // 한 칸에 보여 줄 이모지 개수. 넘치면 +N 으로 줄입니다.

/** 화면에 쓸 요일 머리글 순서. 일요일 시작입니다. */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/*
 * 지금 그리고 있는 자리. todo.js 의 '보는 기간' 에서 옵니다.
 * 이 파일이 스스로 바꾸는 곳은 없습니다. 바꾸는 일은 전부 todo.js 를 거칩니다.
 * 그래야 달력과 아래 목록이 서로 다른 날을 가리키는 일이 생기지 않습니다.
 */
let cursor = new Date();

/*
 * 년·월 고르기 판.
 *
 * ‹ › 만으로는 한 해 전으로 가려면 열두 번을 눌러야 합니다.
 * 기간 이름을 누르면 판이 열리고, 판에서 연도를 누르면 연도 격자로 바뀝니다.
 * (Material 날짜 선택기의 흐름입니다. 달 격자 <-> 연도 격자)
 */
let pickOpen = false;
let pickMode = 'month';     // 'month' | 'year'
let pickYear = new Date().getFullYear();   // 판이 보고 있는 해
let pickYearPage = 0;       // 연도 격자가 보고 있는 12년 묶음 (0 이면 pickYear 가 든 묶음)

/** 연도 격자 한 판에 놓는 개수. 4열 x 3줄입니다. */
const YEARS_PER_PAGE = 12;

/*
 * 보기 방식. 'grid' 는 달력, 'agenda' 는 날짜별로 묶은 시간순 목록입니다.
 * Google 캘린더의 '일정(Schedule)' 보기가 후자입니다. 격자를 버리고 앞으로 올 일을
 * 시간순 목록으로 늘어놓아, 좁은 화면에서 읽기 쉽습니다.
 */
const VIEW_KEY = 'cal.view';
let calView = load(VIEW_KEY, 'grid') === 'agenda' ? 'agenda' : 'grid';

/** 일정 목록이 앞으로 며칠까지 훑을지. 두 달이면 '다음에 뭐 있더라' 에 충분합니다. */
const AGENDA_DAYS = 62;

const pad = (n) => String(n).padStart(2, '0');

function firstOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** 일요일을 0 으로 두는 요일 번호. getDay() 그대로이고, period.js 와 같은 기준입니다. */
const dayIndex = (date) => date.getDay();

/** Date -> 'YYYY-MM-DD'. period.js 의 keyOf('day') 와 같은 형식입니다. */
export function dayKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * 달력 모양. 계획표에서 고른 단위를 그대로 씁니다.
 * 모르는 값이 저장돼 있어도 달력이 사라지지 않게 월간으로 떨어뜨립니다.
 */
export function shapeOf(scope) {
  return scope === 'day' || scope === 'week' || scope === 'year' ? scope : 'month';
}

/**
 * 기준 날짜가 든 주의 일요일부터 7칸.
 */
export function weekRow(anchor) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  start.setDate(start.getDate() - dayIndex(start));
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(d);
  }
  return out;
}

/**
 * 달력에 깔 날짜들.
 * 1일이 속한 주의 일요일부터, 말일이 속한 주의 토요일까지 채웁니다.
 * (달마다 줄 수가 달라지지만, 빈 줄을 억지로 만드는 것보다 낫습니다)
 */
export function monthGrid(monthStart) {
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1);
  start.setDate(start.getDate() - dayIndex(start));
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
  end.setDate(end.getDate() + (6 - dayIndex(end)));

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
 * 한 해의 열두 달. 각 달의 1일입니다.
 * 연간 보기가 이걸 넉 장씩 석 줄로 늘어놓습니다.
 */
export function monthsOfYear(year) {
  const out = [];
  for (let m = 0; m < 12; m += 1) out.push(new Date(year, m, 1));
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

/** 같은 분류가 여러 건이어도 이모지는 한 번만. 같은 그림이 겹치면 개수만 헷갈립니다. */
function marksOf(rows) {
  const marks = [];
  const seen = new Set();
  rows.forEach((item) => {
    const e = emojiOf(item.category);
    if (seen.has(e)) return;
    seen.add(e);
    marks.push(e);
  });
  return marks;
}

/** 요일 머리글 일곱 칸. 주간·월간이 씁니다. */
function weekdayHead() {
  return WEEKDAY_KEYS.map((key) => el('div', {
    class: `cal-wd${key === 'sun' ? ' sun' : ''}${key === 'sat' ? ' sat' : ''}`,
  }, t(`cal.wd.${key}`)));
}

/**
 * 날짜 한 칸. 누르면 아래 목록이 그 날짜로 옮겨 갑니다.
 * @param {Date} date
 * @param {{byDay: Map, todayKey: string, view: object, month: number|null}} ctx
 */
function dayCell(date, ctx) {
  const key = dayKey(date);
  const rows = ctx.byDay.get(key) || [];
  // 주간에는 '이 달 밖' 이라는 개념이 없습니다. 한 주가 두 달에 걸치는 게 정상입니다.
  const outside = ctx.month !== null && date.getMonth() !== ctx.month;
  const marks = marksOf(rows);

  /*
   * 칸마다 '선택' 표시를 붙이지 않습니다.
   * 달력 모양이 곧 보고 있는 기간이라, 월간이면 그 달 전부가, 주간이면 이레 전부가
   * 선택된 셈입니다. 전부 칠하면 화면만 뭉치고 알려 주는 것이 없습니다.
   */
  const classes = ['cal-day'];
  if (outside) classes.push('is-outside');
  if (key === ctx.todayKey) classes.push('is-today');
  if (rows.length) classes.push('has-items');

  const undone = rows.filter((x) => !x.done).length;
  const cell = el('button', {
    class: classes.join(' '),
    type: 'button',
    dataset: { day: key },
    'aria-label': rows.length
      ? `${key}. ${t('cal.count', rows.length)}${undone ? `, ${t('cal.undone', undone)}` : ''}`
      : `${key}. ${t('cal.empty')}`,
  },
  el('span', { class: 'cal-num' }, String(date.getDate())),
  el('span', { class: 'cal-marks' },
    ...marks.slice(0, MAX_DOTS).map((e) => el('span', { class: 'cal-mark' }, e)),
    marks.length > MAX_DOTS ? el('span', { class: 'cal-more' }, `+${marks.length - MAX_DOTS}`) : ''));

  // 날짜를 고르면 그 하루로 내려갑니다. 그 뒤에 입력한 계획도 그 날짜로 들어갑니다.
  cell.addEventListener('click', () => openDate(key));
  return cell;
}

/* ---------- 모양별로 그리기 ---------- */

/**
 * 일간 — 고른 날짜 하나.
 *
 * 칸 하나짜리 격자는 의미가 없어서, 요일과 날짜를 한 줄로 보여 줍니다.
 *
 * 이 줄을 누르면 그 날이 든 달의 월간으로 올라갑니다.
 * 한 칸만 남기고 끝내면 다른 날짜를 고를 길이 사라집니다. (월간에서 날짜를 누르면
 * 일간으로 내려오므로, 되돌아가는 길이 없으면 한 번 내려간 뒤 갇힙니다)
 */
function dayShape(ctx) {
  const key = dayKey(cursor);
  const rows = ctx.byDay.get(key) || [];
  const marks = marksOf(rows);
  const undone = rows.filter((x) => !x.done).length;
  const count = rows.length
    ? `${t('cal.count', rows.length)}${undone ? `, ${t('cal.undone', undone)}` : ''}`
    : t('cal.empty');

  return [el('button', {
    class: `cal-one${key === ctx.todayKey ? ' is-today' : ''}`,
    type: 'button',
    dataset: { day: key },
    'aria-label': `${key}. ${count} — ${t('cal.toMonth')}`,
    onclick: () => openPeriod('month', new Date(cursor)),
  },
  el('span', { class: 'cal-one-date' }, label('day', key, ctx.lang)),
  el('span', { class: 'cal-marks' },
    ...marks.slice(0, MAX_DOTS).map((e) => el('span', { class: 'cal-mark' }, e)),
    marks.length > MAX_DOTS ? el('span', { class: 'cal-more' }, `+${marks.length - MAX_DOTS}`) : ''),
  el('span', { class: 'cal-one-count' }, rows.length ? t('cal.count', rows.length) : t('cal.empty')),
  el('span', { class: 'cal-one-up', 'aria-hidden': 'true' }, '⌃'))];
}

/** 주간 — 그 주 이레. */
function weekShape(ctx) {
  return [...weekdayHead(), ...weekRow(cursor).map((d) => dayCell(d, { ...ctx, month: null }))];
}

/** 월간 — 그 달 한 판. */
function monthShape(ctx) {
  const start = firstOfMonth(cursor);
  return [...weekdayHead(), ...monthGrid(start).map((d) => dayCell(d, { ...ctx, month: start.getMonth() }))];
}

/**
 * 한 달을 아주 작게. 연간 보기가 열두 장을 늘어놓습니다.
 *
 * 칸 하나가 10px 남짓이라 날짜는 누를 수 없습니다. (손가락으로 못 맞춥니다)
 * 달 한 장 전체가 버튼이고, 누르면 그 달의 월간으로 내려갑니다.
 */
function miniMonth(monthStart, ctx) {
  const month = monthStart.getMonth();
  const cells = monthGrid(monthStart).map((d) => {
    // 옆 달 날짜는 자리만 지킵니다. 숫자를 흐리게 놔두면 작은 판에서 지저분합니다.
    if (d.getMonth() !== month) return el('span', { class: 'cal-mini-day is-blank' }, '');
    const key = dayKey(d);
    const rows = ctx.byDay.get(key) || [];
    const classes = ['cal-mini-day'];
    if (key === ctx.todayKey) classes.push('is-today');
    if (rows.length) classes.push('has-items');
    return el('span', { class: classes.join(' ') }, String(d.getDate()));
  });

  const monthKey = `${monthStart.getFullYear()}-${pad(month + 1)}`;
  const count = monthGrid(monthStart)
    .filter((d) => d.getMonth() === month)
    .reduce((n, d) => n + (ctx.byDay.get(dayKey(d))?.length || 0), 0);

  return el('button', {
    class: `cal-mini${monthKey === ctx.todayMonth ? ' is-now' : ''}`,
    type: 'button',
    dataset: { miniMonth: monthKey },
    'aria-label': count
      ? `${t('cal.pick.monthName', month + 1)}. ${t('cal.count', count)}`
      : `${t('cal.pick.monthName', month + 1)}. ${t('cal.empty')}`,
    // 달을 누르면 그 달의 월간으로 내려갑니다. (연간 -> 월간 -> 일간)
    onclick: () => openPeriod('month', new Date(monthStart)),
  },
  el('span', { class: 'cal-mini-head' }, t('cal.pick.monthName', month + 1)),
  el('span', { class: 'cal-mini-grid' }, ...cells));
}

/**
 * 연간 — 열두 달을 넉 장씩 석 줄.
 * 한 해가 한 화면에 들어와야 '스크롤에 힘쓰지 않는다' 는 말이 성립합니다.
 */
function yearShape(ctx) {
  const year = cursor.getFullYear();
  return [
    el('div', { class: 'cal-year-head' }, String(year)),
    el('div', { class: 'cal-year-grid' },
      ...monthsOfYear(year).map((m) => miniMonth(m, ctx))),
  ];
}

const SHAPES = { day: dayShape, week: weekShape, month: monthShape, year: yearShape };

function render() {
  const grid = $('#cal-grid');
  if (!grid) return;
  // 일정 목록일 때는 격자를 그릴 필요가 없습니다. 안 보이는 것을 그리는 건 낭비입니다.
  if (calView === 'agenda') { renderAgenda(); return; }

  const shape = shapeOf(getView().scope);
  const now = new Date();
  const ctx = {
    byDay: groupByDay(),
    todayKey: keyOf('day'),
    todayMonth: `${now.getFullYear()}-${pad(now.getMonth() + 1)}`,
    lang: getLang(),
    month: null,
  };

  // CSS 가 이 값으로 칸 배치를 바꿉니다. (하나 / 이레 / 한 달 / 열두 달)
  grid.dataset.shape = shape;
  grid.setAttribute('aria-label', t(`cal.aria.${shape}`));
  grid.replaceChildren(...SHAPES[shape](ctx));
}

/* ---------- 일정(Schedule) 보기 ----------
 *
 * Google 캘린더의 '일정' 보기와 같은 꼴입니다.
 * 격자를 버리고, 오늘부터 앞으로 올 일을 날짜별로 묶어 시간순으로 늘어놓습니다.
 * 한 줄에 시각 · 분류 이모지 · 글이 들어가고, 오늘 줄에는 표가 붙습니다.
 *
 * 일간 계획만 놓습니다. 주/월/연 계획은 특정 하루에 속하지 않아서,
 * 날짜별 목록에 올리면 어느 날인지 거짓으로 알려주게 됩니다. (달력 격자와 같은 이유입니다)
 */

/** 오늘부터 AGENDA_DAYS 일 안에서, 일이 있는 날만 날짜순으로 묶습니다. */
export function agendaDays(items = getItems(), from = new Date(), span = AGENDA_DAYS) {
  const byDay = groupByDay(items);
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const out = [];
  for (let i = 0; i < span; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = dayKey(d);
    const rows = byDay.get(key);
    if (!rows || !rows.length) continue;
    out.push({ key, date: d, rows: sortDayRows(rows) });
  }
  return out;
}

function renderAgenda() {
  const host = $('#cal-agenda');
  if (!host) return;
  const lang = getLang();
  const todayKey = keyOf('day');
  const days = agendaDays();

  if (!days.length) {
    host.replaceChildren(el('p', { class: 'cal-agenda-empty' }, t('cal.agenda.empty')));
    return;
  }

  const blocks = days.map((day) => {
    const head = el('div', { class: `cal-agenda-head${day.key === todayKey ? ' is-today' : ''}` },
      el('span', { class: 'cal-agenda-date' }, label('day', day.key, lang)),
      day.key === todayKey ? el('span', { class: 'cal-agenda-mark' }, t('cal.agenda.today')) : '');

    const rows = day.rows.map((item) => {
      const time = normalizeTime(item.time);
      return el('button', {
        class: `cal-agenda-row${item.done ? ' is-done' : ''}`,
        type: 'button',
        dataset: { agendaId: item.id, agendaDay: day.key },
        // 누르면 계획표가 그 날짜로 옮겨 가고 그 항목을 잠깐 강조합니다.
        onclick: () => openDate(day.key, item.id),
      },
      el('span', { class: `cal-agenda-time${time ? '' : ' is-allday'}` },
        time || t('cal.agenda.allDay')),
      el('span', { class: 'cal-agenda-cat', title: labelOf(item.category, t) }, emojiOf(item.category)),
      el('span', { class: 'cal-agenda-text' }, item.text));
    });

    return el('div', { class: 'cal-agenda-day' }, head, ...rows);
  });

  host.replaceChildren(...blocks);
}

/** 보기 전환을 화면에 반영합니다. 달력과 목록은 한 번에 하나만 보입니다. */
function applyView() {
  const grid = $('#cal-grid');
  const agenda = $('#cal-agenda');
  const isAgenda = calView === 'agenda';
  if (grid) grid.hidden = isAgenda;
  if (agenda) agenda.hidden = !isAgenda;
  $('#cal-view-grid')?.setAttribute('aria-selected', String(!isAgenda));
  $('#cal-view-agenda')?.setAttribute('aria-selected', String(isAgenda));
  // 일정 목록은 오늘부터 앞으로 훑습니다. 고른 기간과 무관하므로 판을 열어 둘 이유가 없습니다.
  if (isAgenda) closePick();
}

function setView(next) {
  calView = next === 'agenda' ? 'agenda' : 'grid';
  save(VIEW_KEY, calView);
  applyView();
  render();
}

/** 지금 보기 방식. 테스트와 다른 모듈이 상태를 볼 때 씁니다. */
export function calendarView() {
  return calView;
}

/* ---------- 년·월 고르기 판 ---------- */

/**
 * 연도 격자가 보여 줄 12년의 첫 해.
 *
 * 12로 나눠떨어지는 자리에 맞추면 2026년에 '2016 – 2027' 이 나옵니다. 읽기 이상합니다.
 * 보고 있는 해가 가운데쯤 오도록 잡습니다. (2026 -> 2021 – 2032)
 */
function yearPageStart() {
  return pickYear - 5 + pickYearPage * YEARS_PER_PAGE;
}

/** 판을 지금 상태대로 다시 그립니다. */
function renderPick() {
  const panel = $('#cal-pick');
  const grid = $('#cal-pick-grid');
  const title = $('#cal-pick-title');
  const opener = $('#period-label');
  if (!panel || !grid || !title) return;

  panel.hidden = !pickOpen;
  opener?.setAttribute('aria-expanded', String(pickOpen));
  if (!pickOpen) { grid.replaceChildren(); return; }

  const now = new Date();
  const cells = [];

  if (pickMode === 'month') {
    title.textContent = String(pickYear);
    title.title = t('cal.pick.toYears');
    title.setAttribute('aria-label', t('cal.pick.month', pickYear));
    $('#cal-pick-prev')?.setAttribute('aria-label', t('cal.pick.prevYear'));
    $('#cal-pick-next')?.setAttribute('aria-label', t('cal.pick.nextYear'));
    grid.setAttribute('aria-label', t('cal.pick.month', pickYear));

    for (let m = 1; m <= 12; m += 1) {
      const onNow = pickYear === now.getFullYear() && m === now.getMonth() + 1;
      const onCursor = pickYear === cursor.getFullYear() && m === cursor.getMonth() + 1;
      const cell = el('button', {
        class: `cal-pick-cell${onCursor ? ' is-on' : ''}${onNow ? ' is-now' : ''}`,
        type: 'button',
        dataset: { pickMonth: String(m) },
        'aria-pressed': String(onCursor),
      }, t('cal.pick.monthName', m));
      cell.addEventListener('click', () => {
        /*
         * 고른 달의 1일로 옮깁니다. 단위는 건드리지 않습니다.
         * 일간이었으면 그 달 1일이, 월간이었으면 그 달이, 연간이었으면 그 해가 열립니다.
         */
        closePick();
        gotoDate(new Date(pickYear, m - 1, 1));
      });
      cells.push(cell);
    }
  } else {
    const start = yearPageStart();
    title.textContent = `${start} – ${start + YEARS_PER_PAGE - 1}`;
    title.title = t('cal.pick.year');
    title.setAttribute('aria-label', t('cal.pick.year'));
    $('#cal-pick-prev')?.setAttribute('aria-label', t('cal.pick.prevYears'));
    $('#cal-pick-next')?.setAttribute('aria-label', t('cal.pick.nextYears'));
    grid.setAttribute('aria-label', t('cal.pick.year'));

    for (let i = 0; i < YEARS_PER_PAGE; i += 1) {
      const y = start + i;
      const cell = el('button', {
        class: `cal-pick-cell${y === cursor.getFullYear() ? ' is-on' : ''}${y === now.getFullYear() ? ' is-now' : ''}`,
        type: 'button',
        dataset: { pickYear: String(y) },
        'aria-pressed': String(y === cursor.getFullYear()),
      }, String(y));
      cell.addEventListener('click', () => {
        // 해를 고르면 달 격자로 돌아갑니다. 아직 어느 달인지 안 골랐습니다.
        pickYear = y;
        pickYearPage = 0;
        pickMode = 'month';
        renderPick();
        $('#cal-pick-grid')?.querySelector('.cal-pick-cell.is-on, .cal-pick-cell')?.focus();
      });
      cells.push(cell);
    }
  }
  grid.replaceChildren(...cells);
}

function openPick() {
  pickOpen = true;
  pickMode = 'month';
  pickYear = cursor.getFullYear();
  pickYearPage = 0;
  renderPick();
  // 판을 열면 첫 칸으로 초점을 보내야 키보드로 바로 고를 수 있습니다.
  $('#cal-pick-grid')?.querySelector('.cal-pick-cell.is-on, .cal-pick-cell')?.focus();
}

function closePick({ restoreFocus = false } = {}) {
  if (!pickOpen) return;
  pickOpen = false;
  renderPick();
  if (restoreFocus) $('#period-label')?.focus();
}

/** 판의 ‹ › . 달 격자면 한 해씩, 연도 격자면 12년씩 움직입니다. */
function movePick(delta) {
  if (pickMode === 'month') pickYear += delta;
  else pickYearPage += delta;
  renderPick();
}

/** 판이 열려 있는지. 테스트와 다른 모듈이 상태를 볼 때 씁니다. */
export function isPickOpen() {
  return pickOpen;
}

/** 보고 있는 기간이 바뀌면 달력도 따라갑니다. 달력은 스스로 옮겨 다니지 않습니다. */
function followView(view) {
  try {
    // 주간은 일요일이, 월간은 1일이, 연간은 1월 1일이 대표 날짜입니다. (period.js 의 dateOf 규칙)
    cursor = dateOf(view.scope, view.period);
  } catch { /* 저장값이 손상된 경우 보고 있던 자리를 그대로 둡니다 */ }
  // 달력이 딴 해로 옮겨 갔는데 고르기 판이 옛 해를 보고 있으면 어긋나 보입니다.
  closePick();
  render();
}

export function initCalendar() {
  const grid = $('#cal-grid');
  if (!grid) return;

  // --- 보기 전환 ---
  $('#cal-view-grid')?.addEventListener('click', () => setView('grid'));
  $('#cal-view-agenda')?.addEventListener('click', () => setView('agenda'));
  applyView();

  // --- 년·월 고르기 판 ---
  // 여는 자리는 계획표의 기간 이름입니다. 달력이 제 이름표를 따로 갖고 있지 않습니다.
  $('#period-label')?.addEventListener('click', () => {
    if (pickOpen) closePick({ restoreFocus: true }); else openPick();
  });
  $('#cal-pick-prev')?.addEventListener('click', () => movePick(-1));
  $('#cal-pick-next')?.addEventListener('click', () => movePick(1));
  $('#cal-pick-title')?.addEventListener('click', () => {
    // 달 격자에서 연도를 누르면 연도 격자로, 연도 격자에서 누르면 되돌아옵니다.
    pickMode = pickMode === 'month' ? 'year' : 'month';
    pickYearPage = 0;
    renderPick();
    $('#cal-pick-grid')?.querySelector('.cal-pick-cell.is-on, .cal-pick-cell')?.focus();
  });
  // 판 밖을 누르거나 Esc 를 누르면 닫습니다. 열어 둔 채 다른 곳을 만지면 헷갈립니다.
  document.addEventListener('pointerdown', (e) => {
    if (!pickOpen) return;
    if (e.target.closest?.('#cal-pick, #period-label')) return;
    closePick();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pickOpen) { e.preventDefault(); closePick({ restoreFocus: true }); }
  });

  onTodoChange(() => render());
  onViewChange(followView);
  onLangChange(() => { render(); renderPick(); });

  followView(getView());
}

/** 테스트에서 상태를 확인할 때 씁니다. */
export function shownMonth() {
  return `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
}

/** 요일 머리글 순서. 일요일 시작인지 확인할 때 씁니다. */
export const WEEK_START_KEYS = WEEKDAY_KEYS;
