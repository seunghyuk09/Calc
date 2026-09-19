/**
 * 메모 · 낙서판 모듈
 * 낙서판은 Pointer Events 로 마우스/터치/펜을 동일하게 처리합니다.
 */
import { $, el, toast, uid } from '../lib/dom.js';
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
/*
 * 판에 깔아 둔 메모와 그때 잡은 판 높이.
 *
 * 창 크기가 바뀌면 캔버스를 다시 만드는데, 그냥 두면 메모를 올려 길어진 판이
 * 기본 높이로 줄면서 글씨가 세로로 뭉갭니다. (1142px -> 225px 로 찌그러졌습니다)
 * 아직 그 위에 그리지 않았으면 새 폭에 맞춰 메모를 다시 그리고,
 * 이미 그렸으면 그림을 지킬 수 없으므로 높이만이라도 유지합니다.
 */
let placedMemo = null;
let boardCssHeight = 0;

/**
 * 메모를 낙서판으로 보냅니다.
 *
 * 그림으로 바꿔 판에 깔고, 낙서판이 화면에 오도록 옮겨 줍니다.
 * 원본 메모는 목록에 그대로 남습니다.
 */
function sendMemoToBoard(memo) {
  const placed = placeMemoOnCanvas(memo);
  if (!placed) { toast('낙서판을 찾지 못했습니다', 'error'); return; }
  $('#draw-status').textContent = placed.cut
    ? `메모를 올렸습니다 · ${placed.cut}줄은 담지 못했습니다`
    : '메모를 올렸습니다 · 위에 바로 그릴 수 있습니다';
  // 바로 그릴 수 있게 낙서판을 보여 줍니다. 목록 아래에 있으면 올려 준 걸 못 봅니다.
  $('[data-card="memo.draw"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  toast(placed.cut
    ? `메모를 낙서판에 올렸습니다 (${placed.cut}줄은 잘렸습니다)`
    : '메모를 낙서판에 올렸습니다');
}

// --- 메모 ---
function renderMemos() {
  const list = $('#memo-list');
  /*
   * 메모 탭을 숨겨 두면 이 패널이 문서에서 빠집니다. (appearance.js 의 applyTabLayout)
   * '오늘' 탭에서 메모를 적으면 여기까지 내려오는데, 그때 두 요소가 모두 null 입니다.
   * 저장은 이미 끝났으므로 그릴 곳이 없으면 조용히 돌아갑니다.
   */
  if (!list) return;
  const count = $('#memo-count');
  if (count) count.textContent = memos.length ? `${memos.length}개` : '';
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
          dataset: { memoDraw: memo.id },
          title: '이 메모를 그림으로 만들어 낙서판에 깝니다',
          onclick: () => sendMemoToBoard(memo),
        }, '🖍️ 낙서판으로'),
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
function resizeCanvas(preserve = true, cssHeightWanted = 0) {
  const snapshot = preserve && canvas.width ? canvas.toDataURL('image/png') : null;
  const cssWidth = canvas.parentElement.clientWidth || 320;
  // 메모를 올릴 때는 글 길이에 맞춘 높이를 그대로 씁니다. 평소에는 폭에 비례한 기본값입니다.
  const cssHeight = cssHeightWanted
    ? Math.round(cssHeightWanted)
    : Math.round(Math.min(Math.max(cssWidth * 0.62, 220), 420));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  resetContext();

  if (snapshot) restoreImage(snapshot);
}

function restoreImage(dataUrl) {
  const img = new Image();
  img.onload = () => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    resetContext();
  };
  img.src = dataUrl;
}

/**
 * 되돌리기 한 칸.
 *
 * 그림만이 아니라 캔버스 크기도 같이 담습니다.
 * 메모를 올리면 글 길이에 맞춰 판이 길어지는데, 크기를 안 담아 두면 되돌릴 때
 * 예전 그림이 새 크기로 늘어나 찌그러집니다.
 */
function pushUndo() {
  try {
    undoStack.push({
      url: canvas.toDataURL('image/png'),
      w: canvas.width,
      h: canvas.height,
      cssH: canvas.style.height,
    });
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  } catch { /* 캔버스가 오염된 경우 무시 */ }
}

/** 캔버스 그리기 상태를 화면 배율에 맞춰 다시 잡습니다. */
function resetContext() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return dpr;
}

function pointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function onPointerDown(e) {
  if (!ctx) return;
  e.preventDefault();
  // 그 위에 그리기 시작하면 더는 '메모만 깔린 판'이 아닙니다. 다시 그려 주면 그림이 지워집니다.
  placedMemo = null;
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
  placedMemo = null;
  pushUndo();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  resetContext();
}

/* ---------- 메모를 이미지로 만들어 낙서판에 올리기 ----------
 *
 * 회의 중에 적어 둔 메모를 낙서판으로 보내, 중요한 부분에 동그라미를 치거나
 * 화살표를 긋기 위한 기능입니다. 글을 그림으로 바꿔 판에 깔아 두면 그 위에 그릴 수 있습니다.
 *
 * 글자를 '그림'으로 바꾸므로 한 번 올리면 글자를 고칠 수 없습니다.
 * 원본 메모는 목록에 그대로 남습니다. 지우지 않습니다.
 */

/** 글씨 크기와 줄 간격. 글이 길면 이 안에서 줄여 맞춥니다. */
const MEMO_FONT_MAX = 19;
const MEMO_FONT_MIN = 12;
const MEMO_PAD = 18;
/*
 * 판 높이 상한.
 *
 * 입력칸이 한 메모를 2000자로 막고 있습니다. 그 2000자가 가장 좁은 화면(320px)에서
 * 가장 작은 글씨로 펼쳐져도 다 들어가도록 잡은 값입니다. 회의록이 잘려 나가는 것보다
 * 판이 긴 편이 낫습니다. (판이 길면 스크롤해서 그리면 됩니다)
 * 그래도 넘치는 경우(예전 버전이나 손으로 넣은 더 긴 값)에는 몇 줄이 잘렸는지 알려 줍니다.
 */
const MEMO_MAX_CSS_HEIGHT = 2400;

/**
 * 글을 판 너비에 맞춰 줄로 자릅니다.
 *
 * 한국어는 단어 사이에 공백이 없어서 공백 기준으로만 자르면 한 줄이 통째로 넘칩니다.
 * 그래서 한 글자씩 재되, 영어처럼 공백이 있으면 그 직전에서 끊어 단어가 갈라지지 않게 합니다.
 */
export function wrapLines(measure, text, maxWidth) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((paragraph) => {
    if (!paragraph) { out.push(''); return; }
    /*
     * 글자를 코드포인트 단위로 담습니다.
     * 문자열 인덱스로 자르면 이모지 같은 서로게이트 쌍이 반쪽 나서 글자가 깨집니다.
     * (여러 글자가 붙어 한 글자로 보이는 이모지는 줄이 갈릴 수 있지만, 깨지지는 않습니다)
     */
    let buf = [];
    let lastSpace = -1;   // 지금 줄에서 마지막으로 본 공백의 자리
    for (const ch of paragraph) {
      // 줄 첫머리의 공백은 줄을 바꾸며 생긴 찌꺼기입니다. 버립니다.
      if (!buf.length && ch === ' ') continue;

      if (buf.length && measure(buf.join('') + ch) > maxWidth) {
        if (lastSpace > 0) {
          // 공백이 있었으면 거기서 끊어 단어가 갈라지지 않게 합니다. (영어)
          out.push(buf.slice(0, lastSpace).join(''));
          buf = buf.slice(lastSpace + 1);
        } else {
          // 공백이 없으면 (한국어) 그 자리에서 끊습니다.
          out.push(buf.join(''));
          buf = [];
        }
        lastSpace = buf.lastIndexOf(' ');
        // 끊은 자리에 있던 공백은 새 줄 앞에 남기지 않습니다.
        if (ch === ' ') continue;
      }

      buf.push(ch);
      if (ch === ' ') lastSpace = buf.length - 1;
    }
    out.push(buf.join(''));
  });
  return out;
}

/** 저장된 시각을 사람이 읽는 꼴로. */
function stampOf(at) {
  try { return new Date(at).toLocaleString('ko-KR'); }
  catch { return ''; }
}

/**
 * 메모 하나를 낙서판에 깔아 놓습니다.
 *
 * 판에 있던 그림은 지웁니다. 대신 되돌리기 한 칸을 먼저 쌓아 두므로
 * '되돌리기'를 누르면 원래 그림과 원래 판 크기로 돌아옵니다.
 *
 * @returns {{lines:number, fontSize:number, cut:number}|null} 실패하면 null
 */
function placeMemoOnCanvas(memo, { keepUndo = true } = {}) {
  if (!canvas || !memo || typeof memo.text !== 'string') return null;

  // 창 크기가 바뀌어 다시 그리는 경우에는 되돌리기를 쌓지 않습니다. 한 칸이 계속 늘어납니다.
  if (keepUndo) pushUndo();

  const cssWidth = canvas.parentElement.clientWidth || 320;
  const maxTextWidth = cssWidth - MEMO_PAD * 2;
  const probe = canvas.getContext('2d');

  /*
   * 글씨 크기를 위에서부터 줄여 가며, 기본 판 높이 안에 들어가는 크기를 찾습니다.
   * 가장 작은 크기로도 안 들어가면 판을 길게 늘입니다. (상한까지)
   */
  const baseCssHeight = Math.round(Math.min(Math.max(cssWidth * 0.62, 220), 420));
  let fontSize = MEMO_FONT_MAX;
  let lines = [];
  let needed = 0;
  for (; fontSize >= MEMO_FONT_MIN; fontSize -= 1) {
    probe.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
    lines = wrapLines((t) => probe.measureText(t).width, memo.text, maxTextWidth);
    needed = MEMO_PAD * 2 + 26 + lines.length * Math.round(fontSize * 1.5);
    if (needed <= baseCssHeight) break;
  }
  if (fontSize < MEMO_FONT_MIN) fontSize = MEMO_FONT_MIN;

  const cssHeight = Math.min(Math.max(needed, baseCssHeight), MEMO_MAX_CSS_HEIGHT);
  // 판을 새로 깝니다. 앞의 그림은 되돌리기에 들어가 있으므로 preserve 는 false 입니다.
  resizeCanvas(false, cssHeight);

  const lineHeight = Math.round(fontSize * 1.5);
  const bodyTop = MEMO_PAD + 26;
  // 잘린 줄 수. 판 상한을 넘겼을 때만 0 보다 큽니다.
  const fit = Math.max(Math.floor((cssHeight - bodyTop - MEMO_PAD) / lineHeight), 1);
  const shown = lines.slice(0, fit);
  const cut = lines.length - shown.length;

  // 바탕을 흰 종이로 깔아야 지우개(흰색)와 색이 맞습니다.
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // 머리글: 언제 적은 메모인지.
  ctx.fillStyle = '#8a8f98';
  ctx.font = '12px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(`메모 · ${stampOf(memo.at)}`, MEMO_PAD, MEMO_PAD);

  // 본문.
  ctx.fillStyle = '#1a1d21';
  ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
  shown.forEach((line, i) => {
    ctx.fillText(line, MEMO_PAD, bodyTop + i * lineHeight);
  });

  if (cut > 0) {
    ctx.fillStyle = '#c0392b';
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(`… ${cut}줄이 더 있습니다 (판에 다 담지 못했습니다)`,
      MEMO_PAD, cssHeight - MEMO_PAD - 14);
  }
  ctx.restore();
  resetContext();

  placedMemo = memo;
  boardCssHeight = cssHeight;
  return { lines: lines.length, fontSize, cut };
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

/**
 * 밖에서 메모를 한 줄 남깁니다. ('오늘' 탭의 빠른 입력이 씁니다)
 *
 * 메모 탭을 숨겨 둔 사람도 적을 수 있어야 합니다. 저장은 언제나 되고,
 * 화면이 없으면 renderMemos 가 알아서 건너뜁니다.
 *
 * @param {string} text 메모 내용
 * @returns {boolean} 실제로 저장했으면 true (빈 글이면 false)
 */
export function addMemo(text) {
  const body = typeof text === 'string' ? text.trim() : '';
  if (!body) return false;
  memos.unshift({ id: uid(), text: body, at: Date.now() });
  save(MEMO_KEY, memos);
  renderMemos();
  return true;
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
    memos.unshift({ id: uid(), text, at: Date.now() });
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
    // 판 크기가 달랐으면 그 크기로 되돌린 뒤에 그림을 얹어야 찌그러지지 않습니다.
    placedMemo = null;
    if (prev.w !== canvas.width || prev.h !== canvas.height) {
      canvas.width = prev.w;
      canvas.height = prev.h;
      canvas.style.height = prev.cssH;
      resetContext();
    }
    boardCssHeight = parseFloat(prev.cssH) || 0;
    restoreImage(prev.url);
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
    resizeTimer = setTimeout(() => {
      if (placedMemo) {
        // 아직 아무것도 안 그렸으면 새 폭에 맞춰 메모를 처음부터 다시 그립니다. (늘어나지 않습니다)
        placeMemoOnCanvas(placedMemo, { keepUndo: false });
        return;
      }
      // 메모를 올려 길어진 판이면 그 높이를 지킵니다. 기본 높이로 줄이면 그림이 뭉갭니다.
      resizeCanvas(true, boardCssHeight);
    }, 200);
  });
}
