/**
 * 메모 · 낙서판 모듈
 * 낙서판은 Pointer Events 로 마우스/터치/펜을 동일하게 처리합니다.
 */
import { $, el, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

const MEMO_KEY = 'memo.items';
const DRAW_KEY = 'memo.drawing';
const COLORS = ['#1a1d21', '#e0533d', '#3b6ef6', '#1a8f5a', '#c47b12', '#8b5cf6'];
const MAX_UNDO = 12;

let memos = [];
let canvas, ctx;
let drawing = false;
let penColor = COLORS[0];
let penSize = 3;
let eraser = false;
let undoStack = [];

// --- 메모 ---
function renderMemos() {
  const list = $('#memo-list');
  $('#memo-count').textContent = memos.length ? `${memos.length}개` : '';
  list.replaceChildren();
  if (!memos.length) {
    list.append(el('li', { class: 'empty' }, '저장된 메모가 없습니다.'));
    return;
  }
  memos.forEach((memo) => {
    list.append(el('li', { class: 'memo-item' },
      el('div', { class: 'memo-body' }, memo.text),
      el('div', { class: 'row', style: 'margin-top:5px' },
        el('span', { class: 'memo-time grow' }, new Date(memo.at).toLocaleString('ko-KR')),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: async () => {
            try { await navigator.clipboard.writeText(memo.text); toast('복사했습니다'); }
            catch { toast('복사를 지원하지 않는 환경입니다', 'error'); }
          },
        }, '복사'),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => { memos = memos.filter((m) => m.id !== memo.id); save(MEMO_KEY, memos); renderMemos(); },
        }, '삭제'),
      ),
    ));
  });
}

// --- 낙서판 ---
// 캔버스를 컨테이너 너비에 맞추고 devicePixelRatio 를 적용해 선명하게 그립니다.
function resizeCanvas(preserve = true) {
  const snapshot = preserve && canvas.width ? canvas.toDataURL('image/png') : null;
  const cssWidth = canvas.parentElement.clientWidth || 320;
  const cssHeight = Math.round(Math.min(Math.max(cssWidth * 0.62, 220), 420));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (snapshot) restoreImage(snapshot);
}

function restoreImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  img.src = dataUrl;
}

function pushUndo() {
  try {
    undoStack.push(canvas.toDataURL('image/png'));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch { /* 캔버스가 오염된 경우 무시 */ }
}

function pointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  if (!ctx) return;
  e.preventDefault();
  pushUndo();
  drawing = true;
  canvas.setPointerCapture?.(e.pointerId);
  const p = pointFromEvent(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  // 점 하나만 찍는 경우도 보이도록 아주 짧은 선을 그립니다.
  ctx.lineTo(p.x + 0.01, p.y);
  applyStroke();
}

function applyStroke() {
  ctx.lineWidth = eraser ? Math.max(penSize * 3, 12) : penSize;
  ctx.strokeStyle = eraser ? '#ffffff' : penColor;
  ctx.globalCompositeOperation = 'source-over';
  ctx.stroke();
}

function onPointerMove(e) {
  if (!drawing || !ctx) return;
  e.preventDefault();
  const p = pointFromEvent(e);
  ctx.lineTo(p.x, p.y);
  applyStroke();
}

function onPointerUp() {
  if (!drawing) return;
  drawing = false;
  ctx?.closePath();
}

function clearCanvas() {
  pushUndo();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function renderPenColors() {
  const box = $('#pen-colors');
  box.replaceChildren();
  COLORS.forEach((color) => {
    const btn = el('button', {
      class: 'pen-dot',
      type: 'button',
      style: `background:${color}`,
      'aria-label': `펜 색 ${color}`,
      'aria-pressed': String(color === penColor && !eraser),
      onclick: () => {
        penColor = color;
        eraser = false;
        $('#pen-eraser').setAttribute('aria-pressed', 'false');
        renderPenColors();
      },
    });
    box.append(btn);
  });
}

export function initMemo() {
  memos = load(MEMO_KEY, []);
  if (!Array.isArray(memos)) memos = [];
  renderMemos();

  $('#memo-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#memo-input');
    const text = input.value.trim();
    if (!text) return;
    memos.unshift({ id: crypto.randomUUID(), text, at: Date.now() });
    input.value = '';
    save(MEMO_KEY, memos);
    renderMemos();
    toast('메모를 저장했습니다');
  });

  $('#memo-input').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      $('#memo-form').requestSubmit();
    }
  });

  // --- 캔버스 준비 ---
  canvas = $('#draw-canvas');
  resizeCanvas(false);
  renderPenColors();

  const savedDrawing = load(DRAW_KEY, null);
  if (typeof savedDrawing === 'string' && savedDrawing.startsWith('data:image')) {
    restoreImage(savedDrawing);
    $('#draw-status').textContent = '저장된 그림을 불러왔습니다';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);

  $('#pen-size').addEventListener('input', (e) => { penSize = Number(e.target.value) || 3; });

  $('#pen-eraser').addEventListener('click', (e) => {
    eraser = !eraser;
    e.currentTarget.setAttribute('aria-pressed', String(eraser));
    renderPenColors();
  });

  $('#draw-undo').addEventListener('click', () => {
    const prev = undoStack.pop();
    if (!prev) { toast('되돌릴 작업이 없습니다'); return; }
    restoreImage(prev);
  });

  $('#draw-clear').addEventListener('click', clearCanvas);

  $('#draw-save').addEventListener('click', () => {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      // localStorage 용량(보통 5MB)을 넘기지 않도록 크기를 확인합니다.
      if (dataUrl.length > 4_000_000) {
        toast('그림이 너무 커서 저장할 수 없습니다. PNG 로 내려받아 주세요.', 'error');
        return;
      }
      if (save(DRAW_KEY, dataUrl)) {
        $('#draw-status').textContent = `저장됨 · ${new Date().toLocaleTimeString('ko-KR')}`;
        toast('그림을 저장했습니다');
      } else {
        toast('저장 공간이 부족합니다', 'error');
      }
    } catch {
      toast('그림을 저장하지 못했습니다', 'error');
    }
  });

  $('#draw-download').addEventListener('click', () => {
    try {
      const link = document.createElement('a');
      link.download = `낙서_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      toast('내려받기에 실패했습니다', 'error');
    }
  });

  // 창 크기가 바뀌면 캔버스를 다시 맞춥니다. (연속 호출 방지를 위해 디바운스)
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => resizeCanvas(true), 200);
  });
}
