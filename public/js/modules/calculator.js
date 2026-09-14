/** 계산기 모듈: 키패드 + 키보드 입력 + 계산 기록 */
import { $, el, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { evaluate, formatNumber, normalize } from '../lib/calc-engine.js';

const HISTORY_KEY = 'calc.history';
const MAX_HISTORY = 40;

let history = [];
let exprInput, resultBox, historyList;

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

// 커서 위치에 문자열을 삽입합니다.
function insert(text) {
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
  exprInput.value = '';
  resultBox.classList.remove('is-error');
  resultBox.textContent = '0';
  exprInput.focus();
}

function renderHistory() {
  historyList.replaceChildren();
  if (!history.length) {
    historyList.append(el('li', { class: 'empty' }, '아직 계산 기록이 없습니다.'));
    return;
  }
  history.forEach((item) => {
    historyList.append(el('li', {
      class: 'hist-item',
      title: '클릭하면 결과를 수식에 넣습니다',
      onclick: () => { insert(String(item.value)); },
    },
      el('span', { class: 'hist-expr' }, item.expr),
      el('span', { class: 'hist-val' }, formatNumber(item.value)),
    ));
  });
}

function equals() {
  const raw = exprInput.value.trim();
  if (!raw) return;
  try {
    const value = evaluate(raw);
    resultBox.classList.remove('is-error');
    resultBox.textContent = formatNumber(value);
    history.unshift({ expr: raw, value, at: Date.now() });
    history = history.slice(0, MAX_HISTORY);
    save(HISTORY_KEY, history);
    renderHistory();
    // 결과를 이어서 계산할 수 있도록 수식 자리에 결과를 넣습니다.
    exprInput.value = String(value);
    exprInput.setSelectionRange(exprInput.value.length, exprInput.value.length);
  } catch (err) {
    resultBox.classList.add('is-error');
    resultBox.textContent = err.message || '계산할 수 없습니다';
  }
}

export function initCalculator() {
  exprInput = $('#calc-expr');
  resultBox = $('#calc-result');
  historyList = $('#calc-history');
  history = load(HISTORY_KEY, []);
  if (!Array.isArray(history)) history = [];
  renderHistory();

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

  exprInput.addEventListener('input', updatePreview);
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
  document.addEventListener('keydown', (e) => {
    const calcVisible = !$('#panel-calc').hidden;
    const typingElsewhere = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (!calcVisible || typingElsewhere || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[0-9+\-*/().%]$/.test(e.key)) { e.preventDefault(); insert(e.key); }
    else if (e.key === 'Enter' || e.key === '=') { e.preventDefault(); equals(); }
    else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
    else if (e.key === 'Escape') { e.preventDefault(); clearAll(); }
  });
}
