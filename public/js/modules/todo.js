/**
 * todo.js — 계획표 (일 / 주 / 월 / 연)
 *
 * 각 항목은 { scope, period } 로 어느 기간에 속하는지 기록합니다.
 *
 * 화면 구성
 *   달력이 위, 목록이 아래입니다. 달력에서 날짜를 누르면 목록이 그 날로 옮겨 가고,
 *   입력한 계획도 그 날짜로 들어갑니다. '어디에 추가되는지'를 기간 표시줄이 늘 보여 줍니다.
 *
 * 단위별로 목록이 다르게 보입니다.
 *   일간 : 그 하루치를 그대로 나열합니다.
 *   주간 : 그 주의 주간 목표 + 그 주 7일의 일간 계획을 날짜별로 묶어 보여 줍니다.
 *   월/연 : 그 단위로 적은 것만 보여 줍니다. (일간까지 합치면 수백 줄이 됩니다)
 */
import { $, $$, el, uid, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { t, getLang, onLangChange, applyStatic } from '../lib/i18n.js';
import { keyOf, shift, label, isCurrent, dateOf, fromLegacyIsoWeek, SCOPES } from '../lib/period.js';
import {
  allCategories, allCategoriesIncludingHidden, emojiOf, labelOf, isCategory,
  addCategory, removeCategory, setCategoryEmoji, hideCategory,
  onCategoryChange, EMOJI_CHOICES, DEFAULT_CATEGORY,
} from '../lib/categories.js';

const KEY = 'todo.items';
const VIEW_KEY = 'todo.view';
const CAT_KEY = 'todo.lastCategory';
const WEEK_BASE_KEY = 'todo.weekBase';

let items = [];
let scope = 'day';
let period = keyOf('day');
let filter = 'all';
let picked = DEFAULT_CATEGORY;   // 입력창 옆에서 고른 분류

const changeListeners = new Set();
const viewListeners = new Set();

/** 항목이 바뀔 때 알립니다. ('오늘' 탭 요약과 달력이 구독합니다) */
export function onTodoChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

/** 보고 있는 단위/기간이 바뀔 때 알립니다. (달력이 따라 움직입니다) */
export function onViewChange(fn) {
  viewListeners.add(fn);
  return () => viewListeners.delete(fn);
}

function notifyChange() {
  changeListeners.forEach((fn) => {
    try { fn(items); } catch (err) { console.error('[todo] 구독자 오류', err); }
  });
}

function notifyView() {
  viewListeners.forEach((fn) => {
    try { fn({ scope, period }); } catch (err) { console.error('[todo] 뷰 구독자 오류', err); }
  });
}

export function getItems() {
  return items;
}

/** 지금 보고 있는 단위와 기간. 달력이 어느 달을 펼칠지 정할 때 씁니다. */
export function getView() {
  return { scope, period };
}

const persist = () => { save(KEY, items); notifyChange(); };
const saveView = () => { save(VIEW_KEY, { scope, period }); notifyView(); };

/**
 * 예전 형식(기간 없이 저장된 할 일)을 오늘 계획으로 옮깁니다.
 * 분류가 없던 시절의 항목에는 기본 분류를 넣어 줍니다.
 *
 * 옮긴 결과를 저장할지 판단할 수 있게 changed 를 같이 돌려줍니다.
 * 메모리에서만 옮기면 화면은 맞는데 저장소에는 옛 값이 그대로 남습니다.
 * 주 시작일 이사는 '한 번만' 도는 표시를 남기므로, 저장하지 않으면 다음에 켤 때
 * 이미 옮긴 줄 알고 건너뛰면서 옛 키가 영영 그대로 남습니다.
 */
function migrate(raw) {
  if (!Array.isArray(raw)) return { list: [], changed: false };
  const today = keyOf('day');
  let moved = 0;
  const result = raw.map((item) => {
    const withCat = isCategory(item?.category) ? item : { ...item, category: DEFAULT_CATEGORY };
    if (withCat && SCOPES.includes(withCat.scope) && typeof withCat.period === 'string') return withCat;
    moved += 1;
    return { ...withCat, scope: 'day', period: today };
  });
  if (moved) console.info(`[planner] 이전 형식의 할 일 ${moved}건을 오늘 계획으로 옮겼습니다.`);

  const weeks = migrateWeekBase(result);
  // 분류를 채운 것도 '바뀐 것'입니다. 원본과 같은 객체가 아니면 어딘가 손을 댄 것입니다.
  const touched = weeks.length !== raw.length || weeks.some((item, i) => item !== raw[i]);
  return { list: weeks, changed: touched };
}

/** 주 시작일 이사가 아직 안 돌았는지. */
function weekBaseNeeded() {
  return load(WEEK_BASE_KEY, null) !== 'sun';
}

/**
 * 주 시작일을 월요일(ISO)에서 일요일로 바꿨습니다.
 *
 * '2026-W38' 이라는 같은 글자가 가리키는 7일이 달라지므로, 그냥 두면 저장해 둔 주간 계획이
 * 엉뚱한 주로 밀립니다. 예전 키가 가리키던 주의 월요일을 찾아, 그 월요일이 든 새 주로 옮깁니다.
 * (하루 앞당겨진 같은 주입니다)
 *
 * 한 번만 돌아야 합니다. 두 번 돌면 한 주씩 계속 밀립니다.
 * 다 돌았다는 표시는 여기서 남기지 않습니다. 옮긴 항목을 저장한 뒤에 남겨야
 * 저장이 어긋났을 때 표시만 남고 값은 옛것인 상태가 되지 않습니다. (initTodo 가 남깁니다)
 */
function migrateWeekBase(list) {
  if (!weekBaseNeeded()) return list;
  let moved = 0;
  const out = list.map((item) => {
    if (!item || item.scope !== 'week' || typeof item.period !== 'string') return item;
    const next = fromLegacyIsoWeek(item.period);
    if (!next || next === item.period) return item;
    moved += 1;
    return { ...item, period: next };
  });
  if (moved) console.info(`[planner] 주 시작일이 일요일로 바뀌어 주간 계획 ${moved}건을 옮겼습니다.`);
  return out;
}

/* ---------- 기간 계산 ---------- */

const pad = (n) => String(n).padStart(2, '0');
const dayKeyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 주 키('2026-W38')에 속한 7일의 날짜 키. 일요일부터입니다. */
export function daysOfWeek(weekKey) {
  const start = dateOf('week', weekKey);
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(dayKeyOf(d));
  }
  return out;
}

const inPeriod = (item) => item.scope === scope && item.period === period;

function applyFilter(rows) {
  if (filter === 'active') return rows.filter((x) => !x.done);
  if (filter === 'done') return rows.filter((x) => x.done);
  return rows;
}

/**
 * 화면에 그릴 묶음들.
 * 단위마다 모양이 달라서, 그리는 쪽이 분기하지 않도록 여기서 같은 형태로 맞춰 줍니다.
 * @returns {{key: string|null, title: string|null, rows: object[]}[]}
 */
function groups() {
  if (scope !== 'week') {
    return [{ key: null, title: null, rows: applyFilter(items.filter(inPeriod)) }];
  }

  // 주간: 그 주의 주간 목표를 먼저, 그다음 7일을 날짜순으로.
  const out = [];
  const weekRows = applyFilter(items.filter((x) => x.scope === 'week' && x.period === period));
  if (weekRows.length) out.push({ key: null, title: t('todo.week.goals'), rows: weekRows });

  const lang = getLang();
  daysOfWeek(period).forEach((key) => {
    const rows = applyFilter(items.filter((x) => x.scope === 'day' && x.period === key));
    if (!rows.length) return;
    out.push({ key, title: label('day', key, lang), rows });
  });
  return out;
}

/** 진행률에 쓰는 '이 기간의 전체 항목'. 필터와 무관합니다. */
function periodRows() {
  if (scope !== 'week') return items.filter(inPeriod);
  const days = new Set(daysOfWeek(period));
  return items.filter((x) => (
    (x.scope === 'week' && x.period === period)
    || (x.scope === 'day' && days.has(x.period))
  ));
}

/* ---------- 그리기 ---------- */

function renderHeader() {
  const labelEl = $('#period-label');
  labelEl.textContent = label(scope, period, getLang());
  labelEl.classList.toggle('is-current', isCurrent(scope, period));

  const rows = periodRows();
  const done = rows.filter((x) => x.done).length;
  const ratio = rows.length ? (done / rows.length) * 100 : 0;

  const fill = $('#todo-progress-fill');
  fill.style.width = `${ratio}%`;
  fill.classList.toggle('is-complete', rows.length > 0 && done === rows.length);
  $('#todo-progress-text').textContent = `${done} / ${rows.length}`;

  // 전체 통계 (모든 기간 합계)
  const total = items.length;
  $('#todo-count').textContent = total ? t('todo.count.total', total) : '';
}

function itemRow(item, shownRows) {
  const checkbox = el('input', { type: 'checkbox', 'aria-label': t('todo.aria.done') });
  checkbox.checked = item.done;
  checkbox.addEventListener('change', () => {
    item.done = checkbox.checked;
    item.doneAt = checkbox.checked ? Date.now() : null;
    persist();
    // 다시 그리면 DOM 이 교체되어 포커스가 body 로 날아갑니다. 같은 자리로 되돌립니다.
    renderKeepingFocus({ id: item.id, kind: 'check' });
  });

  return el('li', { class: `todo-item${item.done ? ' done' : ''}`, dataset: { id: item.id } },
    checkbox,
    el('span', { class: 'todo-cat', title: labelOf(item.category, t) }, emojiOf(item.category)),
    el('span', { class: 'todo-text' }, item.text),
    el('button', {
      class: 'btn btn-sm btn-ghost',
      title: t('todo.aria.delete'),
      'aria-label': t('todo.aria.delete'),
      onclick: () => {
        // 삭제 후에는 다음 항목의 삭제 버튼으로, 없으면 입력창으로 포커스를 넘깁니다.
        const idx = shownRows.findIndex((x) => x.id === item.id);
        const nextId = shownRows.filter((x) => x.id !== item.id)[Math.min(idx, shownRows.length - 2)]?.id;
        items = items.filter((x) => x.id !== item.id);
        persist();
        renderKeepingFocus(nextId ? { id: nextId, kind: 'delete' } : null);
      },
    }, '✕'),
  );
}

function render() {
  renderHeader();
  const list = $('#todo-list');
  list.replaceChildren();

  const blocks = groups();
  const shown = blocks.flatMap((g) => g.rows);

  if (!shown.length) {
    list.append(el('li', { class: 'empty' },
      t(filter === 'all' ? 'todo.empty.none' : 'todo.empty.filter')));
    return;
  }

  blocks.forEach((group) => {
    if (group.title) {
      // 날짜 소제목을 누르면 그 날짜로 옮겨 갑니다. 주간에서 하루를 손보러 들어가는 길입니다.
      const head = group.key
        ? el('button', {
          class: 'todo-group-head is-link', type: 'button',
          dataset: { groupDay: group.key },
          onclick: () => openDate(group.key),
        }, group.title, el('span', { class: 'todo-group-go', 'aria-hidden': 'true' }, '›'))
        : el('div', { class: 'todo-group-head' }, group.title);
      list.append(el('li', { class: 'todo-group' }, head));
    }
    group.rows.forEach((item) => list.append(itemRow(item, shown)));
  });
}

/**
 * 목록을 다시 그린 뒤 포커스를 복원합니다.
 * 항목이 필터로 사라졌으면 입력창으로 보냅니다. (포커스가 사라지면 키보드 사용자가 길을 잃습니다)
 */
function renderKeepingFocus(hint) {
  render();
  if (!hint) { $('#todo-input').focus(); return; }
  const li = [...$('#todo-list').children].find((n) => n.dataset?.id === hint.id);
  if (!li) { $('#todo-input').focus(); return; }
  const target = hint.kind === 'check' ? li.querySelector('input') : li.querySelector('button');
  target?.focus();
}

function syncScopeTabs() {
  $$('.scope-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.scope === scope));
  });
}

function syncFilterChips() {
  $$('[data-filter]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === filter));
  });
}

function setScope(next) {
  /*
   * 보고 있던 날짜를 그대로 두고 단위만 바꿉니다.
   * 예전에는 무조건 '오늘'로 튀어서, 달력에서 22일을 고르고 주간을 누르면
   * 22일이 든 주가 아니라 이번 주가 열렸습니다.
   */
  let anchor;
  try { anchor = dateOf(scope, period); } catch { anchor = new Date(); }
  /*
   * 다만 지금 보고 있는 기간 안에 오늘이 들어 있으면 오늘을 기준으로 옮깁니다.
   * '2026년'을 보다가 일간으로 가면 1월 1일(그 기간의 첫날)보다 오늘이 자연스럽습니다.
   * 반대로 22일을 골라 둔 상태라면 오늘이 아니므로 22일이 든 주/달로 갑니다.
   */
  if (isCurrent(scope, period)) anchor = new Date();
  scope = next;
  period = keyOf(scope, anchor);
  syncScopeTabs();
  saveView();
  render();
}

function movePeriod(delta) {
  period = shift(scope, period, delta);
  saveView();
  render();
}

/** 직전 기간의 미완료 항목을 현재 기간으로 옮깁니다. */
function carryOver() {
  const from = shift(scope, period, -1);
  const pending = items.filter((x) => x.scope === scope && x.period === from && !x.done);
  if (!pending.length) {
    toast(t('todo.toast.nothingToCarry'));
    return;
  }
  pending.forEach((item) => { item.period = period; });
  persist();
  render();
  toast(t('todo.toast.carried', pending.length));
}

/**
 * 패널의 lang 속성을 현재 언어로 맞춥니다.
 * 이게 없으면 스크린리더가 영어 문구를 한국어 발음으로 읽습니다. (WCAG 3.1.2)
 * 사용자가 입력한 항목은 #todo-list 에 lang="ko" 가 고정돼 있어 영향받지 않습니다.
 */
function applyPanelLang() {
  $('#panel-todo').setAttribute('lang', getLang());
}

/**
 * 특정 항목이 보이도록 단위/기간/필터를 맞추고 잠깐 강조합니다.
 * '오늘' 탭에서 할 일을 눌렀을 때 그 항목이 어디 있는지 바로 알 수 있게 합니다.
 */
export function revealItem(id) {
  const target = items.find((item) => item.id === id);
  if (!target) return false;

  scope = SCOPES.includes(target.scope) ? target.scope : 'day';
  period = target.period;
  filter = 'all';
  saveView();
  syncScopeTabs();
  syncFilterChips();
  render();

  const li = [...$('#todo-list').children].find((n) => n.dataset?.id === id);
  if (li) {
    li.classList.add('is-revealed');
    li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // 강조는 잠깐만 둡니다. 계속 남아 있으면 '선택된 항목'처럼 오해됩니다.
    setTimeout(() => li.classList.remove('is-revealed'), 2000);
  }
  return true;
}

/**
 * 달력에서 날짜를 눌렀을 때 쓰는 진입점.
 * 계획표를 그 날짜로 옮기고, 항목 id 가 있으면 잠깐 강조합니다.
 * 이 뒤에 입력한 계획은 그 날짜로 들어갑니다.
 */
export function openDate(dateKey, itemId = null) {
  if (typeof dateKey !== 'string') return false;
  if (itemId && revealItem(itemId)) return true;
  scope = 'day';
  period = dateKey;
  filter = 'all';
  saveView();
  syncScopeTabs();
  syncFilterChips();
  render();
  return true;
}

/* ---------- 분류 고르기 ---------- */

/**
 * 입력창 위의 분류 칩 줄.
 * 예전에는 드롭다운이라 무엇이 있는지 열어 봐야 알았습니다.
 * 이모지가 그대로 달력에 나가므로, 고르는 자리에서도 이모지가 보여야 합니다.
 */
function renderCategoryRow() {
  const box = $('#todo-cats');
  if (!box) return;
  const list = allCategories();
  // 고른 분류가 숨겨지거나 지워졌을 수 있습니다.
  if (!list.some((c) => c.id === picked)) picked = list[0]?.id || DEFAULT_CATEGORY;

  box.replaceChildren(...list.map((c) => {
    const name = labelOf(c.id, t);
    const btn = el('button', {
      class: `cat-chip${c.id === picked ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': String(c.id === picked),
      'aria-label': name,
      title: name,
      dataset: { cat: c.id },
    }, el('span', { class: 'cat-chip-emoji', 'aria-hidden': 'true' }, c.emoji));
    btn.addEventListener('click', () => {
      picked = c.id;
      save(CAT_KEY, picked);
      renderCategoryRow();
    });
    return btn;
  }));

  /*
   * 편집 버튼을 같은 줄 끝에 붙입니다.
   * 따로 한 줄을 주면 좁은 화면에서 목록이 그만큼 줄어듭니다.
   * 분류를 고르는 자리 바로 옆이라 '여기서 분류를 손본다'는 것도 분명해집니다.
   */
  const edit = $('#cat-edit');
  const open = edit ? !edit.hidden : false;
  const toggle = el('button', {
    // is-on 은 '고른 분류'라는 뜻이라 여기 붙이면 고른 분류가 둘로 보입니다.
    class: `cat-chip cat-edit-chip${open ? ' is-open' : ''}`,
    type: 'button',
    'aria-expanded': String(open),
    'aria-controls': 'cat-edit',
    'aria-label': t('cat.edit'),
    title: t('cat.edit'),
    dataset: { catEdit: '1' },
  }, el('span', { class: 'cat-chip-emoji', 'aria-hidden': 'true' }, '🏷️'));
  toggle.addEventListener('click', () => {
    if (!edit) return;
    edit.hidden = !edit.hidden;
    renderCategoryRow();
  });
  box.append(toggle);
}

/** 이모지 고르는 판. 입력칸에 직접 붙여 넣어도 됩니다. */
function emojiGrid(current, onPick) {
  const grid = el('div', { class: 'emoji-grid' }, ...EMOJI_CHOICES.map((e) => {
    const b = el('button', {
      class: `emoji-opt${e === current ? ' is-on' : ''}`,
      type: 'button', dataset: { emoji: e }, 'aria-label': e,
    }, e);
    b.addEventListener('click', () => onPick(e));
    return b;
  }));
  return grid;
}

/**
 * 분류 편집 화면.
 * 기본 분류는 이모지만 바꾸고 숨길 수 있습니다. (지우면 예전 계획의 분류가 끊어집니다)
 * 내 분류는 만들고 지울 수 있습니다.
 */
function renderCategoryEditor() {
  const box = $('#cat-edit-body');
  if (!box) return;

  const rows = allCategoriesIncludingHidden().map((c) => {
    const name = labelOf(c.id, t);

    // 이모지 바꾸기: 눌러서 펼치는 판. 줄마다 판을 깔아 두면 화면이 폭발합니다.
    const pickBox = el('details', { class: 'cat-pick' },
      el('summary', {
        class: 'cat-pick-summary', 'aria-label': t('cat.changeEmoji', name), title: t('cat.changeEmoji', name),
      }, c.emoji));
    pickBox.append(emojiGrid(c.emoji, (e) => {
      setCategoryEmoji(c.id, e);
      pickBox.open = false;
    }));

    const tail = c.builtin
      ? (() => {
        const b = el('button', {
          class: `cz-toggle${c.hidden ? '' : ' is-on'}`,
          type: 'button',
          dataset: { catToggle: c.id },
          'aria-pressed': String(!c.hidden),
        }, t(c.hidden ? 'cz.hidden' : 'cz.shown'));
        if (c.locked) { b.disabled = true; b.title = t('cat.lockedHint'); }
        else b.addEventListener('click', () => hideCategory(c.id, !c.hidden));
        return b;
      })()
      : el('button', {
        class: 'btn btn-sm btn-ghost', type: 'button',
        dataset: { catRemove: c.id },
        'aria-label': t('cat.remove', name), title: t('cat.remove', name),
        onclick: () => removeCategory(c.id),
      }, '✕');

    return el('div', { class: 'cat-edit-row', dataset: { catRow: c.id } },
      pickBox,
      el('span', { class: 'cz-row-label' }, name),
      tail);
  });

  // 새로 만들기
  let newEmoji = '⭐';
  const preview = el('summary', { class: 'cat-pick-summary' }, newEmoji);
  const newPick = el('details', { class: 'cat-pick' }, preview);
  newPick.append(emojiGrid(newEmoji, (e) => {
    newEmoji = e;
    preview.textContent = e;
    newPick.open = false;
  }));

  const nameInput = el('input', {
    class: 'field grow', id: 'cat-new-name', maxlength: '20', autocomplete: 'off',
    placeholder: t('cat.newPlaceholder'), 'aria-label': t('cat.newPlaceholder'),
  });
  const addBtn = el('button', { class: 'btn btn-sm btn-primary', type: 'button', id: 'cat-new-add' },
    t('cat.add'));
  addBtn.addEventListener('click', () => {
    const made = addCategory(nameInput.value, newEmoji);
    if (!made) { toast(t('cat.needName'), 'error'); return; }
    nameInput.value = '';
    /*
     * 방금 만든 분류를 바로 골라 줍니다.
     * addCategory 안에서 구독자(renderCategoryRow)가 먼저 도는 바람에
     * 여기서 다시 그리지 않으면 예전에 고른 분류가 그대로 남습니다.
     */
    picked = made;
    save(CAT_KEY, picked);
    renderCategoryRow();
  });
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
  });

  box.replaceChildren(
    el('div', { class: 'cat-edit-list' }, ...rows),
    el('div', { class: 'cat-edit-new' }, newPick, nameInput, addBtn),
    el('p', { class: 'card-sub' }, t('cat.hint')),
  );
}

export function initTodo() {
  /*
   * 옮긴 결과는 반드시 저장까지 해야 합니다.
   * 주 시작일 이사는 '다 돌았다'는 표시를 남기고 한 번만 돕니다. 메모리에서만 옮기고 끝내면
   * 다음에 켤 때 이미 옮긴 줄 알고 건너뛰는데, 저장소에는 옛 키가 그대로라 주간 계획이
   * 한 주 밀린 채로 굳습니다. 표시는 저장이 끝난 뒤에 남깁니다.
   */
  const needsWeekBase = weekBaseNeeded();
  const migrated = migrate(load(KEY, []));
  items = migrated.list;
  if (migrated.changed) save(KEY, items);
  if (needsWeekBase) save(WEEK_BASE_KEY, 'sun');
  notifyChange(); // 첫 로드 결과도 '오늘' 탭에 반영합니다

  const view = load(VIEW_KEY, null);
  if (view && SCOPES.includes(view.scope)) {
    scope = view.scope;
    // 저장된 기간이 손상됐을 수 있으므로 검증 후 사용합니다.
    try { shift(scope, view.period, 0); period = view.period; }
    catch { period = keyOf(scope); }
  } else {
    period = keyOf(scope);
  }
  const lastCat = load(CAT_KEY, null);
  picked = isCategory(lastCat) ? lastCat : DEFAULT_CATEGORY;
  syncScopeTabs();

  // 언어는 설정 탭에서 바꿉니다. 여기서는 바뀐 결과만 받아 다시 그립니다.
  onLangChange(() => {
    applyStatic($('#panel-todo'));
    applyPanelLang();
    renderCategoryRow();
    renderCategoryEditor();
    render();
  });
  applyStatic($('#panel-todo'));
  applyPanelLang();

  // 분류를 고치면 입력줄과 편집 화면, 그리고 목록의 이모지가 한꺼번에 따라가야 합니다.
  onCategoryChange(() => {
    renderCategoryRow();
    renderCategoryEditor();
    render();
    notifyChange();   // 달력 칸의 이모지도 다시 그립니다
  });
  renderCategoryRow();
  renderCategoryEditor();

  $('#scope-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.scope-tab');
    if (btn) setScope(btn.dataset.scope);
  });

  $('#period-prev').addEventListener('click', () => movePeriod(-1));
  $('#period-next').addEventListener('click', () => movePeriod(1));
  $('#period-today').addEventListener('click', () => {
    period = keyOf(scope);
    saveView();
    render();
  });

  $('#todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#todo-input');
    const text = input.value.trim();
    if (!text) return;
    items.unshift({
      id: uid(), text, done: false, scope, period,
      category: isCategory(picked) ? picked : DEFAULT_CATEGORY,
      at: Date.now(), doneAt: null,
    });
    input.value = '';
    persist();
    render();
  });

  $$('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      syncFilterChips();
      render();
    });
  });

  $('#todo-carry').addEventListener('click', carryOver);

  $('#todo-clear-done').addEventListener('click', () => {
    const before = items.length;
    // 지금 보고 있는 기간의 완료 항목만 지웁니다. (주간이면 그 주의 일간까지 포함합니다)
    const ids = new Set(periodRows().filter((x) => x.done).map((x) => x.id));
    items = items.filter((x) => !ids.has(x.id));
    persist();
    render();
    const removed = before - items.length;
    toast(removed ? t('todo.toast.cleared', removed) : t('todo.toast.nothingToClear'));
  });

  render();
  notifyView();
}
