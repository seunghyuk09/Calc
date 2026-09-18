/** 계산기 모듈: 키패드 + 키보드 입력 + 계산 기록(메모 포함) */
import { $, el, toast, uid } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { evaluate, formatNumber, normalize } from '../lib/calc-engine.js';
import { onTabChange } from '../lib/nav.js';

const HISTORY_KEY = 'calc.history';
const MAX_HISTORY = 40;
const MAX_NOTE = 120;

let history = [];
let exprInput, resultBox, historyList;
// 전역 키보드 입력을 계산기로 보낼지 판단합니다.
// 예전에는 #panel-calc 의 hidden 을 봤지만, 가로 페이저로 바꾸면서 패널이
// 더 이상 hidden 을 쓰지 않아 항상 '보이는 중'으로 판정됐습니다.
// 그 결과 다른 탭에서 숫자를 눌러도 계산기에 입력됐습니다.
let calcActive = false;

/**
 * 손가락이 주 입력 수단인지 봅니다.
 * (pointer: coarse) 는 터치가 주 입력인 기기에서만 참입니다.
 * 터치스크린 노트북은 트랙패드가 주 입력이라 fine 으로 보고됩니다.
 */
function isTouchPrimary() {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches === true;
  } catch {
    return false;
  }
}

/**
 * 폰에서는 시스템 키보드가 올라와 계산기 자판을 가립니다.
 * inputmode="none" 은 '가상 키보드를 띄우지 말라'는 표준 신호입니다.
 * 물리 키보드 입력에는 영향이 없어서, 태블릿에 키보드를 붙여 써도 그대로 동작합니다.
 */
function applyKeyboardMode() {
  if (!exprInput) return;
  const touch = isTouchPrimary();
  exprInput.setAttribute('inputmode', touch ? 'none' : 'text');
  exprInput.dataset.keypadOnly = String(touch);
}

// 입력 중인 수식의 미리보기 결과를 갱신합니다.
function updatePreview() {
  const raw = exprInput.value.trim();
  resultBox.classList.remove('is-error');
  if (!raw) { resultBox.textContent = '0'; return; }
  try {
    resultBox.textContent = formatNumber(evaluate(raw));
  } catch {
    // 입력 도중(예: "1+")에는 에러를 띄우지 않고 이전 결과 유지 대신 흐리게 표시
    resultBox.textContent = '…';
  }
}

/**
 * 방금 = 를 눌러 결과가 수식 칸에 들어가 있는 상태.
 * 보통 계산기와 같게 동작시키려고 기억해 둡니다.
 *   결과 뒤에 연산자를 누르면  -> 결과에 이어서 계산 (3 다음 + -> "3+")
 *   결과 뒤에 숫자를 누르면    -> 새 계산 시작 (10 다음 7 -> "7")
 */
let justEvaluated = false;

/** 새 숫자를 시작하는 입력. 이때는 이전 결과를 지웁니다. */
const STARTS_NEW = /^[0-9.(]$/;

/** 커서를 수식 끝으로 보냅니다. */
function caretToEnd() {
  const end = exprInput.value.length;
  exprInput.focus();
  exprInput.setSelectionRange(end, end);
}

// 커서 위치에 문자열을 삽입합니다.
function insert(text) {
  /*
   * 포커스가 수식 칸에 없으면 selectionStart 가 0 이라 맨 앞에 끼어듭니다.
   * = 버튼을 누르면 포커스가 그 버튼으로 옮겨 가므로 실제로 이 일이 일어났습니다.
   * (1+2= 뒤에 +1 을 누르면 "+13" 이 되어 13 이 나왔습니다)
   */
  if (document.activeElement !== exprInput) caretToEnd();

  if (justEvaluated) {
    justEvaluated = false;
    // 숫자로 시작하면 이전 결과를 버리고 새 식을 씁니다. 연산자면 결과에 이어 붙입니다.
    if (STARTS_NEW.test(text)) {
      exprInput.value = '';
      exprInput.setSelectionRange(0, 0);
    } else {
      caretToEnd();
    }
  }

  const start = exprInput.selectionStart ?? exprInput.value.length;
  const end = exprInput.selectionEnd ?? exprInput.value.length;
  exprInput.value = exprInput.value.slice(0, start) + text + exprInput.value.slice(end);
  const caret = start + text.length;
  exprInput.setSelectionRange(caret, caret);
  exprInput.focus();
  updatePreview();
}

// 여는/닫는 괄호 중 문맥에 맞는 쪽을 넣습니다.
function insertParen() {
  const text = normalize(exprInput.value);
  const opened = (text.match(/\(/g) || []).length;
  const closed = (text.match(/\)/g) || []).length;
  const lastChar = text.slice(-1);
  const afterValue = /[0-9).%]/.test(lastChar);
  insert(opened > closed && afterValue ? ')' : '(');
}

function backspace() {
  justEvaluated = false;
  if (document.activeElement !== exprInput) caretToEnd();
  const start = exprInput.selectionStart ?? exprInput.value.length;
  const end = exprInput.selectionEnd ?? exprInput.value.length;
  if (start !== end) {
    exprInput.value = exprInput.value.slice(0, start) + exprInput.value.slice(end);
    exprInput.setSelectionRange(start, start);
  } else if (start > 0) {
    exprInput.value = exprInput.value.slice(0, start - 1) + exprInput.value.slice(start);
    exprInput.setSelectionRange(start - 1, start - 1);
  }
  exprInput.focus();
  updatePreview();
}

function clearAll() {
  justEvaluated = false;
  exprInput.value = '';
  resultBox.classList.remove('is-error');
  resultBox.textContent = '0';
  exprInput.focus();
}

/**
 * 저장된 기록을 현재 구조로 맞춥니다.
 * 메모 기능이 없던 시절 기록에는 id 도 note 도 없습니다.
 * 손상된 항목(수식이 없거나 값이 숫자가 아님)은 버립니다.
 */
function migrateHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item.expr === 'string' && Number.isFinite(item.value))
    .map((item) => ({
      ...item,
      id: typeof item.id === 'string' && item.id ? item.id : uid(),
      note: typeof item.note === 'string' && item.note ? item.note : null,
    }));
}

const rowOf = (id) => [...historyList.children].find((node) => node.dataset?.id === id);

/** 기록 한 줄에 메모 입력칸을 엽니다. */
function openNoteEditor(id) {
  const item = history.find((h) => h.id === id);
  const row = rowOf(id);
  if (!item || !row || row.querySelector('.hist-note-form')) return;

  row.querySelector('.hist-note')?.remove();
  const input = el('input', {
    class: 'field hist-note-input',
    maxlength: String(MAX_NOTE),
    placeholder: '왜 이 계산을 했나요?',
    'aria-label': '계산 기록 메모',
    autocomplete: 'off',
  });
  input.value = item.note || '';

  const commit = () => {
    const text = input.value.trim().slice(0, MAX_NOTE);
    item.note = text || null;
    save(HISTORY_KEY, history);
    renderHistory();
    toast(text ? '메모를 저장했습니다' : '메모를 지웠습니다');
  };

  const form = el('form', {
    class: 'hist-note-form',
    onsubmit: (e) => { e.preventDefault(); commit(); },
  },
  input,
  el('button', { class: 'btn btn-primary btn-sm', type: 'submit' }, '저장'),
  el('button', { class: 'btn btn-sm', type: 'button', onclick: () => renderHistory() }, '취소'));

  // Esc 로도 닫힙니다. 모달이 아니라서 닫는 방법이 버튼뿐이면 답답합니다.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); renderHistory(); }
  });

  row.append(form);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function renderHistory() {
  historyList.replaceChildren();
  if (!history.length) {
    historyList.append(el('li', { class: 'empty' }, '아직 계산 기록이 없습니다.'));
    return;
  }
  history.forEach((item) => {
    const row = el('li', { class: 'hist-item', dataset: { id: item.id } },
      // 줄 전체가 아니라 버튼을 눌러야 값이 들어갑니다.
      // 메모 버튼과 클릭 영역이 겹치면 실수로 값이 입력됩니다.
      el('button', {
        class: 'hist-main',
        type: 'button',
        title: '누르면 결과를 수식에 넣습니다',
        onclick: () => { insert(String(item.value)); },
      },
      el('span', { class: 'hist-expr' }, item.expr),
      el('span', { class: 'hist-val' }, formatNumber(item.value))),
      el('button', {
        class: 'hist-note-btn',
        type: 'button',
        title: item.note ? '메모 수정' : '메모 남기기',
        'aria-label': `${item.expr} 계산의 메모 ${item.note ? '수정' : '남기기'}`,
        onclick: () => openNoteEditor(item.id),
      }, item.note ? '📝' : '✎'),
    );
    if (item.note) row.append(el('p', { class: 'hist-note' }, item.note));
    historyList.append(row);
  });
}

function equals() {
  const raw = exprInput.value.trim();
  if (!raw) return;
  try {
    const value = evaluate(raw);
    resultBox.classList.remove('is-error');
    resultBox.textContent = formatNumber(value);
    history.unshift({ id: uid(), expr: raw, value, at: Date.now(), note: null });
    history = history.slice(0, MAX_HISTORY);
    save(HISTORY_KEY, history);
    renderHistory();
    // 결과를 이어서 계산할 수 있도록 수식 자리에 결과를 넣습니다.
    exprInput.value = String(value);
    justEvaluated = true;
    // 포커스가 = 버튼에 있으면 커서가 0 으로 남으므로 여기서 끝으로 되돌립니다.
    caretToEnd();
  } catch (err) {
    resultBox.classList.add('is-error');
    resultBox.textContent = err.message || '계산할 수 없습니다';
    justEvaluated = false;
  }
}

/**
 * 밖에서 계산 하나를 기록에 남깁니다. ('오늘' 탭의 빠른 계산이 씁니다)
 *
 * 남기지 않으면 오늘 탭에서 계산한 것이 어디에도 안 남아, 결과를 한 번 보고 나면
 * 다시 꺼낼 길이 없습니다. '최근 계산' 위젯과 계산기 탭이 같은 기록을 봅니다.
 *
 * historyList 는 initCalculator 가 잡아 둔 노드입니다. 계산기 탭을 숨겨 두면
 * 문서에서 빠지지만 노드 자체는 살아 있어, replaceChildren 은 그대로 동작합니다.
 *
 * @returns {boolean} 실제로 기록했으면 true
 */
export function recordCalc(expr, value) {
  const raw = typeof expr === 'string' ? expr.trim() : '';
  if (!raw || typeof value !== 'number' || !Number.isFinite(value)) return false;
  history.unshift({ id: uid(), expr: raw, value, at: Date.now(), note: null });
  history = history.slice(0, MAX_HISTORY);
  save(HISTORY_KEY, history);
  if (historyList) renderHistory();
  return true;
}

export function initCalculator() {
  exprInput = $('#calc-expr');
  resultBox = $('#calc-result');
  historyList = $('#calc-history');
  history = migrateHistory(load(HISTORY_KEY, []));
  renderHistory();

  applyKeyboardMode();
  // 태블릿에 키보드를 붙였다 떼는 것처럼 주 입력 수단이 바뀌면 다시 맞춥니다.
  try {
    window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', applyKeyboardMode);
  } catch { /* 지원하지 않는 브라우저는 초기값 그대로 둡니다 */ }

  onTabChange((tab) => { calcActive = tab === 'calc'; });

  $('#keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.ins) { insert(btn.dataset.ins); return; }
    switch (btn.dataset.act) {
      case 'clear': clearAll(); break;
      case 'back': backspace(); break;
      case 'paren': insertParen(); break;
      case 'equals': equals(); break;
      default: break;
    }
  });

  // 키보드로 직접 고치면 '방금 계산함' 상태는 의미가 없어집니다.
  exprInput.addEventListener('input', () => { justEvaluated = false; updatePreview(); });
  exprInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); equals(); }
    else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
  });

  $('#calc-clear-hist').addEventListener('click', () => {
    history = [];
    save(HISTORY_KEY, history);
    renderHistory();
    toast('계산 기록을 지웠습니다');
  });

  // 계산기 탭이 활성화된 상태에서 전역 키보드 입력을 수식창으로 흘려보냅니다.
  // PC 에서 수식창을 클릭하지 않고도 숫자·괄호·기호를 바로 칠 수 있게 하기 위한 것입니다.
  document.addEventListener('keydown', (e) => {
    const typingElsewhere = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (!calcActive || typingElsewhere || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9+\-*/().%]$/.test(e.key)) { e.preventDefault(); insert(e.key); }
    else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals(); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
  });
}
