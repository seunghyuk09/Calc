/**
 * TO DO (계획표) 모듈
 * 일(day) · 주(week) · 월(month) · 연(year) 단위로 계획을 나눠 관리합니다.
 * 각 항목은 { scope, period } 로 어느 기간에 속하는지 기록합니다.
 * 화면 문구는 한국어/영어 중에서 고를 수 있습니다. (i18n.js)
 */
import { $, el, toast, uid } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { keyOf, shift, label, isCurrent, SCOPES } from '../lib/period.js';
import { t, getLang, setLang, onLangChange, applyStatic, LANGS } from '../lib/i18n.js';

const KEY = 'todo.items';
const VIEW_KEY = 'todo.view';

let items = [];
let scope = 'day';
let period = keyOf('day');
let filter = 'all';

const persist = () => save(KEY, items);
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
      render();
    });
    list.append(el('li', { class: `todo-item${item.done ? ' done' : ''}` },
      checkbox,
      el('span', { class: 'todo-text' }, item.text),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        title: t('todo.aria.delete'),
        'aria-label': t('todo.aria.delete'),
        onclick: () => { items = items.filter((t) => t.id !== item.id); persist(); render(); },
      }, '✕'),
    ));
  });
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

/** 언어 전환 버튼의 눌림 상태를 현재 언어에 맞춥니다. */
function renderLangSwitch() {
  document.querySelectorAll('.lang-btn').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === getLang()));
  });
}

export function initTodo() {
  items = migrate(load(KEY, []));

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

  // 언어 전환: 정적 문구와 목록을 모두 다시 그립니다.
  $('#lang-switch').addEventListener('click', (e) => {
    const btn = e.target.closest('.lang-btn');
    if (btn && LANGS.includes(btn.dataset.lang)) setLang(btn.dataset.lang);
  });
  onLangChange(() => {
    applyStatic($('#panel-todo'));
    renderLangSwitch();
    render();
  });
  applyStatic($('#panel-todo'));
  renderLangSwitch();

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
