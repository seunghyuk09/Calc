/** 할 일 모듈: 추가/완료/삭제/필터, localStorage 저장 */
import { $, el, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

const KEY = 'todo.items';
let items = [];
let filter = 'all';
let listEl, countEl;

function persist() { save(KEY, items); }

function visible() {
  if (filter === 'active') return items.filter((t) => !t.done);
  if (filter === 'done') return items.filter((t) => t.done);
  return items;
}

function render() {
  listEl.replaceChildren();
  const rows = visible();
  const remain = items.filter((t) => !t.done).length;
  countEl.textContent = items.length ? `${remain}개 남음 / 전체 ${items.length}개` : '';

  if (!rows.length) {
    listEl.append(el('li', { class: 'empty' },
      filter === 'all' ? '할 일을 추가해보세요.' : '해당하는 항목이 없습니다.'));
    return;
  }

  rows.forEach((item) => {
    const checkbox = el('input', { type: 'checkbox', 'aria-label': '완료 표시' });
    checkbox.checked = item.done;
    checkbox.addEventListener('change', () => {
      item.done = checkbox.checked;
      item.doneAt = checkbox.checked ? Date.now() : null;
      persist();
      render();
    });
    listEl.append(el('li', { class: `todo-item${item.done ? ' done' : ''}` },
      checkbox,
      el('span', { class: 'todo-text' }, item.text),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        title: '삭제',
        'aria-label': '삭제',
        onclick: () => {
          items = items.filter((t) => t.id !== item.id);
          persist();
          render();
        },
      }, '✕'),
    ));
  });
}

export function initTodo() {
  listEl = $('#todo-list');
  countEl = $('#todo-count');
  items = load(KEY, []);
  if (!Array.isArray(items)) items = [];

  $('#todo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#todo-input');
    const text = input.value.trim();
    if (!text) return;
    items.unshift({ id: crypto.randomUUID(), text, done: false, at: Date.now(), doneAt: null });
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

  $('#todo-clear-done').addEventListener('click', () => {
    const before = items.length;
    items = items.filter((t) => !t.done);
    persist();
    render();
    toast(before === items.length ? '삭제할 완료 항목이 없습니다' : `완료 항목 ${before - items.length}개를 삭제했습니다`);
  });

  render();
}
