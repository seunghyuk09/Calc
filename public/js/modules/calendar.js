/**
 * calendar.js — TO DO 탭 맨 위의 월 달력
 *
 * 한 달을 통째로 보면서 날짜를 눌러 그 날로 옮겨 가는 것이 기본 흐름입니다.
 * 칸이 작아 내용을 다 쓸 수 없으므로 분류 이모지만 놓고,
 * 자세한 것은 바로 아래 목록 카드가 보여 줍니다. (누른 날짜로 목록이 옮겨 갑니다)
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
import { keyOf, dateOf, weekRange, weekParts, label } from '../lib/period.js';
import { getItems, onTodoChange, onViewChange, getView, openDate, normalizeTime, sortDayRows } from './todo.js';

const MAX_DOTS = 3;         // 한 칸에 보여 줄 이모지 개수. 넘치면 +N 으로 줄입니다.
const FOLD_KEY = 'cal.folded';

/** 화면에 쓸 요일 머리글 순서. 일요일 시작입니다. */
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/*
 * 지금 보고 있는 자리. '달'이 아니라 '날짜'로 들고 있습니다.
 * 펼쳤을 때는 이 날짜가 속한 달을, 접었을 때는 이 날짜가 속한 주를 그립니다.
 * 그래야 ‹ › 가 펼침/접힘에 따라 달 단위와 주 단위로 자연스럽게 갈립니다.
 */
let cursor = new Date();
/*
 * 접힌 상태.
 * 한 달치는 좁은 화면의 절반 가까이를 씁니다. 하루치 목록을 손볼 때는
 * 지금 주 한 줄만 남기면 목록이 그만큼 넓어집니다. 고른 상태는 기억합니다.
 */
let folded = load(FOLD_KEY, false) === true;

/*
 * 년·월 고르기 판.
 *
 * ‹ › 만으로는 한 해 전으로 가려면 열두 번을 눌러야 합니다.
 * 달 이름을 누르면 판이 열리고, 판에서 연도를 누르면 연도 격자로 바뀝니다.
 * (Material 날짜 선택기의 흐름입니다. 달 격자 <-> 연도 격자)
 */
let pickOpen = false;
let pickMode = 'month';     // 'month' | 'year'
let pickYear = new Date().getFullYear();   // 판이 보고 있는 해
let pickYearPage = 0;       // 연도 격자가 보고 있는 12년 묶음 (0 이면 pickYear 가 든 묶음)

/** 연도 격자 한 판에 놓는 개수. 4열 x 3줄입니다. */
const YEARS_PER_PAGE = 12;

/*
 * 보기 방식. 'grid' 는 한 달 격자, 'agenda' 는 날짜별로 묶은 시간순 목록입니다.
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
 * 접었을 때 보여 줄 한 줄. 기준 날짜가 든 주의 일요일부터 7칸입니다.
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

/**
 * 지금 보고 있는 기간에 이 날짜가 들어가는지.
 * 단위마다 강조 범위가 다릅니다. 일간은 하루, 주간은 그 줄 전체, 월간은 그 달 전체입니다.
 */
function inView(date, view) {
  const key = dayKey(date);
  if (view.scope === 'day') return key === view.period;
  if (view.scope === 'week') {
    const { year, week } = weekParts(date);
    return `${year}-W${pad(week)}` === view.period;
  }
  if (view.scope === 'month') {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}` === view.period;
  }
  return false;   // 연간은 달력 전체가 강조돼 의미가 없습니다
}

function render() {
  const grid = $('#cal-grid');
  if (!grid) return;
  // 일정 목록일 때는 격자를 그릴 필요가 없습니다. 안 보이는 것을 그리는 건 낭비입니다.
  if (calView === 'agenda') { renderAgenda(); return; }

  const lang = getLang();
  const view = getView();
  const byDay = groupByDay();
  const todayKey = keyOf('day');
  const month = cursor.getMonth();


  const foldBtn = $('#cal-fold');
  if (foldBtn) {
    const mark = $('#cal-fold-mark');
    if (mark) mark.textContent = folded ? '⌄' : '⌃';
    foldBtn.setAttribute('aria-expanded', String(!folded));
    foldBtn.title = t(folded ? 'cal.unfold' : 'cal.fold');
    foldBtn.setAttribute('aria-label', t(folded ? 'cal.unfold' : 'cal.fold'));
  }

  // 접었으면 커서가 든 주 한 줄만, 펼쳤으면 커서가 든 달 전체를 그립니다.
  const days = folded ? weekRow(cursor) : monthGrid(firstOfMonth(cursor));
  // 접었을 때는 날짜 범위만 씁니다. '2026년 38주차 ·' 까지 넣으면 좁은 화면에서 잘립니다.
  $('#cal-label').textContent = folded
    ? weekRange(keyOf('week', cursor), lang)
    : monthLabel(firstOfMonth(cursor), lang);
  // 접었을 때 ‹ › 는 주 단위로 움직입니다. 버튼 설명도 같이 바꿔야 헷갈리지 않습니다.
  $('#cal-prev')?.setAttribute('aria-label', t(folded ? 'cal.prevWeek' : 'cal.prev'));
  $('#cal-next')?.setAttribute('aria-label', t(folded ? 'cal.nextWeek' : 'cal.next'));
  const todayBtn = $('#cal-today');
  if (todayBtn) todayBtn.textContent = t(folded ? 'cal.thisWeek' : 'cal.today');

  const cells = [
    ...WEEKDAY_KEYS.map((key) => el('div', {
      class: `cal-wd${key === 'sun' ? ' sun' : ''}${key === 'sat' ? ' sat' : ''}`,
    }, t(`cal.wd.${key}`))),
  ];

  days.forEach((date) => {
    const key = dayKey(date);
    const rows = byDay.get(key) || [];
    // 접었을 때는 '이 달 밖'이라는 개념이 없습니다. 한 주가 두 달에 걸치는 게 정상입니다.
    const outside = !folded && date.getMonth() !== month;

    // 같은 분류가 여러 건이어도 이모지는 한 번만 놓습니다. 같은 그림이 겹치면 개수만 헷갈립니다.
    const marks = [];
    const seen = new Set();
    rows.forEach((item) => {
      const e = emojiOf(item.category);
      if (seen.has(e)) return;
      seen.add(e);
      marks.push(e);
    });

    const classes = ['cal-day'];
    if (outside) classes.push('is-outside');
    if (key === todayKey) classes.push('is-today');
    if (inView(date, view)) classes.push('is-selected');
    if (rows.length) classes.push('has-items');

    const undone = rows.filter((x) => !x.done).length;
    const cell = el('button', {
      class: classes.join(' '),
      type: 'button',
      dataset: { day: key },
      'aria-label': rows.length
        ? `${key}. ${t('cal.count', rows.length)}${undone ? `, ${t('cal.undone', undone)}` : ''}`
        : `${key}. ${t('cal.empty')}`,
      'aria-pressed': String(inView(date, view)),
    },
    el('span', { class: 'cal-num' }, String(date.getDate())),
    el('span', { class: 'cal-marks' },
      ...marks.slice(0, MAX_DOTS).map((e) => el('span', { class: 'cal-mark' }, e)),
      marks.length > MAX_DOTS ? el('span', { class: 'cal-more' }, `+${marks.length - MAX_DOTS}`) : ''));

    // 누르면 아래 목록이 그 날짜로 옮겨 갑니다. 그 뒤에 입력한 계획도 그 날짜로 들어갑니다.
    cell.addEventListener('click', () => {
      openDate(key);
      // 달력이 딴 달을 보고 있었다면 고른 날짜의 달로 따라옵니다.
      if (outside) { cursor = new Date(date); render(); }
    });
    cells.push(cell);
  });

  grid.replaceChildren(...cells);
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

/** 보기 전환을 화면에 반영합니다. 격자와 목록은 한 번에 하나만 보입니다. */
function applyView() {
  const grid = $('#cal-grid');
  const agenda = $('#cal-agenda');
  const isAgenda = calView === 'agenda';
  if (grid) grid.hidden = isAgenda;
  if (agenda) agenda.hidden = !isAgenda;
  $('#cal-view-grid')?.setAttribute('aria-selected', String(!isAgenda));
  $('#cal-view-agenda')?.setAttribute('aria-selected', String(isAgenda));
  // 일정 목록에서는 달을 오가는 ‹ › 와 요일 머리글이 의미가 없습니다.
  $('.cal-nav')?.toggleAttribute('hidden', isAgenda);
  $('#cal-pick')?.toggleAttribute('hidden', isAgenda || !pickOpen);
}

function setView(next) {
  calView = next === 'agenda' ? 'agenda' : 'grid';
  save(VIEW_KEY, calView);
  if (calView === 'agenda') closePick();
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
  const opener = $('#cal-pick-open');
  if (!panel || !grid || !title) return;

  panel.hidden = !pickOpen;
  opener?.setAttribute('aria-expanded', String(pickOpen));
  if (!pickOpen) { grid.replaceChildren(); return; }

  const lang = getLang();
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
        // 고른 달의 1일로 옮깁니다. 접혀 있으면 그 주가, 펼쳐져 있으면 그 달이 보입니다.
        cursor = new Date(pickYear, m - 1, 1);
        closePick();
        render();
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
  // 언어가 바뀌면 판 안의 글자도 따라가야 합니다. lang 은 위에서 읽어 둔 값으로 충분합니다.
  void lang;
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
  if (restoreFocus) $('#cal-pick-open')?.focus();
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

/** 접혀 있으면 한 주씩, 펼쳐져 있으면 한 달씩 움직입니다. */
function move(delta) {
  const next = new Date(cursor);
  if (folded) next.setDate(next.getDate() + delta * 7);
  else next.setMonth(next.getMonth() + delta, 1);
  cursor = next;
  render();
}

/** 보고 있는 기간이 바뀌면 달력도 그 달을 펼칩니다. */
function followView(view) {
  try {
    // 주간은 일요일이, 월간은 1일이 대표 날짜입니다. (period.js 의 dateOf 규칙)
    cursor = dateOf(view.scope, view.period);
  } catch { /* 저장값이 손상된 경우 보고 있던 자리를 그대로 둡니다 */ }
  // 달력이 딴 달로 옮겨 갔는데 고르기 판이 옛 해를 보고 있으면 어긋나 보입니다.
  closePick();
  render();
}

export function initCalendar() {
  const grid = $('#cal-grid');
  if (!grid) return;

  $('#cal-prev')?.addEventListener('click', () => move(-1));
  $('#cal-next')?.addEventListener('click', () => move(1));
  $('#cal-today')?.addEventListener('click', () => {
    cursor = new Date();
    render();
  });
  $('#cal-fold')?.addEventListener('click', () => {
    folded = !folded;
    save(FOLD_KEY, folded);
    render();
  });

  // --- 보기 전환 ---
  $('#cal-view-grid')?.addEventListener('click', () => setView('grid'));
  $('#cal-view-agenda')?.addEventListener('click', () => setView('agenda'));
  applyView();

  // --- 년·월 고르기 판 ---
  $('#cal-pick-open')?.addEventListener('click', () => {
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
    if (e.target.closest?.('#cal-pick, #cal-pick-open')) return;
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

/** 접혀 있는지. 테스트에서 확인할 때 씁니다. */
export function isFolded() {
  return folded;
}

/** 테스트에서 상태를 확인할 때 씁니다. */
export function shownMonth() {
  return `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
}

/** 요일 머리글 순서. 일요일 시작인지 확인할 때 씁니다. */
export const WEEK_START_KEYS = WEEKDAY_KEYS;
