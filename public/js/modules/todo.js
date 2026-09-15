/**
 * TO DO (계획표) 모듈
 * 일(day) · 주(week) · 월(month) · 연(year) 단위로 계획을 나눠 관리합니다.
 * 각 항목은 { scope, period } 로 어느 기간에 속하는지 기록합니다.
 * 화면 문구는 한국어/영어 중에서 고를 수 있습니다. (i18n.js)
 */
import { $, el, toast, uid } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { keyOf, shift, label, isCurrent, SCOPES } from '../lib/period.js';
import { t, getLang, onLangChange, applyStatic } from '../lib/i18n.js';

const KEY = 'todo.items';
const VIEW_KEY = 'todo.view';

let items = [];
let scope = 'day';
let period = keyOf('day');
let filter = 'all';

// '오늘' 탭처럼 할 일을 함께 보여주는 화면이 바뀐 내용을 바로 반영하도록 알립니다.
const changeListeners = new Set();

/** 할 일 목록이 바뀔 때마다 호출됩니다. 해제 함수를 돌려줍니다. */
export function onTodoChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function notifyChange() {
  // 구독자 하나가 던져도 저장과 나머지 구독자는 살아 있어야 합니다.
  changeListeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error('[todo] 구독자 오류', err); }
  });
}

/** 다른 모듈이 읽기 전용으로 쓰는 사본입니다. 원본을 넘기면 밖에서 망가뜨릴 수 있습니다. */
export function getItems() {
  return items.map((item) => ({ ...item }));
}

const persist = () => { save(KEY, items); notifyChange(); };
const saveView = () => save(VIEW_KEY, { scope, period });

/**
 * 예전 버전(기간 개념이 없던 시절)의 데이터를 현재 구조로 옮깁니다.
 * 사라지면 곤란하므로 전부 '오늘' 계획으로 넣어 바로 보이게 합니다.
 */
function migrate(raw) {
  if (!Array.isArray(raw)) return [];
  const today = keyOf('day');
  let moved = 0;
  const result = raw.map((item) => {
    if (item && SCOPES.includes(item.scope) && typeof item.period === 'string') return item;
    moved += 1;
    return { ...item, scope: 'day', period: today };
  });
  if (moved) console.info(`[planner] 이전 형식의 할 일 ${moved}건을 오늘 계획으로 옮겼습니다.`);
  return result;
}

const inPeriod = (item) => item.scope === scope && item.period === period;

function visible() {
  const rows = items.filter(inPeriod);
  if (filter === 'active') return rows.filter((t) => !t.done);
  if (filter === 'done') return rows.filter((t) => t.done);
  return rows;
}

function renderHeader() {
  const labelEl = $('#period-label');
  labelEl.textContent = label(scope, period, getLang());
  labelEl.classList.toggle('is-current', isCurrent(scope, period));

  const rows = items.filter(inPeriod);
  const done = rows.filter((t) => t.done).length;
  const ratio = rows.length ? (done / rows.length) * 100 : 0;

  const fill = $('#todo-progress-fill');
  fill.style.width = `${ratio}%`;
  fill.classList.toggle('is-complete', rows.length > 0 && done === rows.length);
  $('#todo-progress-text').textContent = `${done} / ${rows.length}`;

  // 전체 통계 (모든 기간 합계)
  const total = items.length;
  $('#todo-count').textContent = total ? t('todo.count.total', total) : '';
}

function render() {
  renderHeader();
  const list = $('#todo-list');
  list.replaceChildren();

  const rows = visible();
  if (!rows.length) {
    list.append(el('li', { class: 'empty' },
      t(filter === 'all' ? 'todo.empty.none' : 'todo.empty.filter')));
    return;
  }

  rows.forEach((item) => {
    const checkbox = el('input', { type: 'checkbox', 'aria-label': t('todo.aria.done') });
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      item.doneAt = checkbox.checked ? Date.now() : null;
      persist();
      // 다시 그리면 DOM 이 교체되어 포커스가 body 로 날아갑니다. 같은 자리로 되돌립니다.
      renderKeepingFocus({ id: item.id, kind: 'check' });
    });
    list.append(el('li', { class: `todo-item${item.done ? ' done' : ''}`, dataset: { id: item.id } },
      checkbox,
      el('span', { class: 'todo-text' }, item.text),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        title: t('todo.aria.delete'),
        'aria-label': t('todo.aria.delete'),
        onclick: () => {
          // 삭제 후에는 다음 항목의 삭제 버튼으로, 없으면 입력창으로 포커스를 넘깁니다.
          const rest = visible().filter((t) => t.id !== item.id);
          const idx = rows.findIndex((t) => t.id === item.id);
          const nextId = rest[Math.min(idx, rest.length - 1)]?.id;
          items = items.filter((t) => t.id !== item.id);
          persist();
          renderKeepingFocus(nextId ? { id: nextId, kind: 'delete' } : null);
        },
      }, '✕'),
    ));
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

function setScope(next) {
  scope = next;
  period = keyOf(scope); // 단위를 바꾸면 현재 기간으로 맞춥니다
  document.querySelectorAll('.scope-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.scope === scope));
  });
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
  const pending = items.filter((t) => t.scope === scope && t.period === from && !t.done);
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

  document.querySelectorAll('.scope-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.scope === scope));
  });
  document.querySelectorAll('[data-filter]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.filter === 'all'));
  });
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

export function initTodo() {
  items = migrate(load(KEY, []));
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
  document.querySelectorAll('.scope-tab').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.scope === scope));
  });

  // 언어는 설정 탭에서 바꿉니다. 여기서는 바뀐 결과만 받아 다시 그립니다.
  onLangChange(() => {
    applyStatic($('#panel-todo'));
    applyPanelLang();
    render();
  });
  applyStatic($('#panel-todo'));
  applyPanelLang();

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
    items.unshift({ id: uid(), text, done: false, scope, period, at: Date.now(), doneAt: null });
    input.value = '';
    persist();
    render();
  });

  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      render();
    });
  });

  $('#todo-carry').addEventListener('click', carryOver);

  $('#todo-clear-done').addEventListener('click', () => {
    const before = items.length;
    // 지금 보고 있는 기간의 완료 항목만 지웁니다.
    items = items.filter((t) => !(inPeriod(t) && t.done));
    persist();
    render();
    const removed = before - items.length;
    toast(removed ? t('todo.toast.cleared', removed) : t('todo.toast.nothingToClear'));
  });

  render();
}
