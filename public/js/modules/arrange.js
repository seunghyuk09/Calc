/**
 * arrange.js — 화면 편집 (카드를 그 탭에서 직접 끌어 옮기고 크기를 고릅니다)
 *
 * 예전에는 설정 탭까지 들어가 목록의 ▲▼ 를 눌러야 순서를 바꿀 수 있었습니다.
 * 보고 있는 화면과 고치는 화면이 달라서, 바꿔 놓고 다시 건너가 확인해야 했습니다.
 * 여기서는 보고 있는 그 탭에서 카드를 손가락으로 끌어 옮깁니다.
 *
 * 편집 모드를 따로 두는 이유:
 * 카드 안에는 계산기 자판, 체크박스, 입력창이 들어 있습니다. 평소에 드래그를 걸어 두면
 * 숫자를 누르려다 카드가 끌려갑니다. 그래서 '편집 중'일 때만 손잡이가 나타납니다.
 *
 * 다루는 것은 두 가지입니다. 둘 다 '한 상자 안의 목록'이라 같은 코드로 움직입니다.
 *   카드   : 각 탭의 .panel > [data-card]      -> prefs.cardOrder[탭]
 *   위젯   : '오늘' 탭의 #today-widgets > [data-widget] -> prefs.widgets
 *
 * 저장은 prefs.js 가 합니다. 여기서는 DOM 과 손가락만 다룹니다.
 */
import { $, $$, el } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import {
  CARD_SIZES, CARD_SPANS, ALL_WIDGETS,
  getPrefs, setPrefs, setCardPref, setCardOrder, cardPref, onPrefsChange,
} from '../lib/prefs.js';

/** 지금 편집 중인 탭. null 이면 편집 모드가 아닙니다. */
let current = null;

/** 드래그 중인 정보. null 이면 끌고 있지 않습니다. */
let drag = null;

/** 자동 스크롤 타이머 id. 카드를 화면 끝으로 끌면 패널이 따라 스크롤합니다. */
let autoScrollRaf = 0;

/** 꾹 누르고 있는 중인 정보. null 이면 누르고 있지 않습니다. */
let hold = null;

/** 지금 편집 중인 탭 이름. 테스트와 다른 모듈이 상태를 볼 때 씁니다. */
export function arrangingTab() {
  return current;
}

/**
 * 지금 손가락이 카드에 걸려 있는지. 편집 중 · 꾹 누르는 중 · 끄는 중을 모두 포함합니다.
 *
 * 편집 모드만 보면 늦습니다. 꾹 누르고 있는 0.5초 사이에 화면이 다시 그려지면
 * 눌려 있던 노드가 DOM 에서 빠지고, 그 순간 브라우저가 pointercancel 을 쏩니다.
 * 한 번 취소되면 그 뒤에 무엇을 해도 그 손가락으로는 끌 수 없습니다.
 * (날씨 응답이 도착하거나 실패하는 시점이 하필 여기에 자주 걸렸습니다)
 */
export function arrangeBusy() {
  return !!(current || drag || hold);
}

/*
 * 편집이 켜지고 꺼질 때 알려 줍니다.
 *
 * '오늘' 탭 위젯은 today.js 가 replaceChildren 으로 통째로 다시 그립니다.
 * 날씨가 도착하거나 할 일이 하나 바뀌기만 해도 그 일이 일어나는데,
 * 그러면 손가락으로 잡고 있던 카드가 DOM 에서 사라져 드래그가 그 자리에서 끊깁니다.
 * 그래서 편집 중에는 다시 그리지 말고, 끝난 뒤에 한 번 그리도록 신호를 보냅니다.
 */
const arrangeListeners = new Set();

export function onArrangeChange(fn) {
  arrangeListeners.add(fn);
  return () => arrangeListeners.delete(fn);
}

function notifyArrange() {
  arrangeListeners.forEach((fn) => {
    try { fn(current); } catch (err) { console.error('[arrange] 알림 실패', err); }
  });
}

const panelOf = (tab) => document.querySelector(`#panel-${tab}`);

/**
 * 그 탭에서 옮길 수 있는 것들이 담긴 상자와 항목 종류.
 * '오늘' 탭만 위젯 상자를 따로 쓰고, 나머지는 패널 자신이 상자입니다.
 */
function boxOf(tab) {
  const panel = panelOf(tab);
  if (!panel) return null;
  if (tab === 'today') {
    const host = $('#today-widgets');
    return host ? { host, kind: 'widget', panel } : null;
  }
  return { host: panel, kind: 'card', panel };
}

/** 상자 안에서 실제로 옮길 수 있는 항목들. (도구줄이나 안내문은 제외) */
function itemsOf(box) {
  const sel = box.kind === 'widget' ? '[data-widget]' : '[data-card]';
  return [...box.host.children].filter((node) => node.matches(sel));
}

const idOf = (node) => node.dataset.card || node.dataset.widget || '';

/** 화면에 보여 줄 이름. 카드와 위젯의 사전 키가 다릅니다. */
function labelOf(node) {
  const id = idOf(node);
  return node.dataset.widget ? t(`cz.widget.${id}`) : t(`cz.card.${id}`);
}

/* ---------- 도구줄 ---------- */

function optButton(label, on, onClick, extra) {
  const btn = el('button', {
    class: `arr-opt${on ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': String(on),
    ...extra,
  }, label);
  btn.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

/**
 * 카드 위에 붙는 편집 도구줄.
 *
 * 손잡이만으로는 키보드로 순서를 바꿀 수 없어 ▲▼ 도 같이 답니다.
 * 손가락으로 끌 수 없는 환경(키보드만 쓰는 경우)에서도 같은 일을 할 수 있어야 합니다.
 */
function toolbar(node, box, index, total) {
  const id = idOf(node);
  const name = labelOf(node);

  const grab = el('button', {
    class: 'arr-grab', type: 'button',
    'aria-label': t('arr.grab', name),
    title: t('arr.grab', name),
    dataset: { grab: id },
  }, '⠿');

  const move = (delta) => {
    const items = itemsOf(box);
    const from = items.indexOf(node);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    // 아래로 갈 때는 목표의 '다음' 자리에, 위로 갈 때는 목표 '앞'에 넣습니다.
    box.host.insertBefore(node, delta > 0 ? items[to].nextSibling : items[to]);
    commit(box);
    announce(t('arr.moved', name, to + 1, items.length));
    // 다시 그려지면 이 버튼은 사라지므로, 새로 그려진 같은 자리의 버튼으로 초점을 옮깁니다.
    refocus(id, delta > 0 ? 'down' : 'up');
  };

  const row = el('div', { class: 'arr-bar', dataset: { arrBar: id } },
    grab,
    el('span', { class: 'arr-name' }, name),
    el('div', { class: 'arr-nudge' },
      el('button', {
        class: 'arr-opt arr-step', type: 'button', dataset: { arrMove: 'up' },
        disabled: index === 0, 'aria-label': `${name} ▲`,
      }, '▲'),
      el('button', {
        class: 'arr-opt arr-step', type: 'button', dataset: { arrMove: 'down' },
        disabled: index === total - 1, 'aria-label': `${name} ▼`,
      }, '▼'),
    ),
  );
  row.querySelector('[data-arr-move="up"]').addEventListener('click', (e) => { e.stopPropagation(); move(-1); });
  row.querySelector('[data-arr-move="down"]').addEventListener('click', (e) => { e.stopPropagation(); move(1); });

  /*
   * 크기·폭 고르기. 위젯에도 답니다.
   * 예전에는 카드에만 달아서, '오늘' 탭에서는 크기를 바꿀 방법이 아예 없었습니다.
   */
  {
    const pref = cardPref(id);
    row.append(
      el('div', { class: 'arr-opts', role: 'group', 'aria-label': t('arr.aria.size') },
        ...CARD_SIZES.map((size) => optButton(
          t(`arr.size.${size}`), pref.size === size,
          () => { setCardPref(id, { size }); refocus(id, `size:${size}`); },
          { dataset: { arrSize: size } },
        ))),
      el('div', { class: 'arr-opts', role: 'group', 'aria-label': t('arr.aria.span') },
        ...CARD_SPANS.map((span) => optButton(
          t(`arr.span.${span}`), pref.span === span,
          () => { setCardPref(id, { span }); refocus(id, `span:${span}`); },
          { dataset: { arrSpan: span } },
        ))),
    );
  }
  return row;
}

/**
 * 눌렀던 버튼으로 초점을 되돌립니다.
 * 설정이 바뀌면 도구줄을 다시 그리는데, 그때 초점이 몸통으로 튀면
 * 키보드로 연달아 누를 수가 없습니다.
 */
let pendingFocus = null;
function refocus(id, what) {
  pendingFocus = { id, what };
}

function applyPendingFocus() {
  if (!pendingFocus) return;
  const { id, what } = pendingFocus;
  pendingFocus = null;
  const bar = document.querySelector(`[data-arr-bar="${CSS.escape(id)}"]`);
  if (!bar) return;
  let target = null;
  if (what === 'up' || what === 'down') target = bar.querySelector(`[data-arr-move="${what}"]`);
  else if (what.startsWith('size:')) target = bar.querySelector(`[data-arr-size="${what.slice(5)}"]`);
  else if (what.startsWith('span:')) target = bar.querySelector(`[data-arr-span="${what.slice(5)}"]`);
  // 끝으로 밀려 ▲▼ 가 꺼졌으면 손잡이로 물러납니다. 비활성 버튼에는 초점이 가지 않습니다.
  if (!target || target.disabled) target = bar.querySelector('.arr-grab');
  try { target?.focus({ preventScroll: true }); } catch { /* 초점 실패는 치명적이지 않습니다 */ }
}

function announce(text) {
  const live = $('#arr-live');
  if (live) live.textContent = text;
}

/* ---------- 편집 모드 켜고 끄기 ---------- */

/** 도구줄을 싹 걷어냅니다. */
function stripBars(root = document) {
  $$('.arr-bar', root).forEach((bar) => bar.remove());
}

/** 지금 상태대로 도구줄을 다시 답니다. */
function decorate() {
  if (!current) return;
  const box = boxOf(current);
  if (!box) return;
  stripBars(box.host);
  const items = itemsOf(box);
  items.forEach((node, i) => {
    node.dataset.arrItem = 'on';
    node.prepend(toolbar(node, box, i, items.length));
  });
  const bar = $('#arr-hint');
  if (bar) bar.textContent = items.length ? t('arr.hint') : t('arr.none');
  applyPendingFocus();
}

/**
 * 편집 모드 시작.
 * @param {string} tab 편집할 탭 이름
 */
export function startArrange(tab) {
  const box = boxOf(tab);
  if (!box) return false;
  if (current && current !== tab) stopArrange();
  current = tab;
  document.body.dataset.arranging = 'on';
  box.panel.dataset.arranging = 'on';
  const dock = $('#arr-dock');
  if (dock) dock.hidden = false;
  decorate();
  // 편집을 시작하자마자 '완료'로 초점을 보내 두면 키보드로 빠져나올 길이 분명해집니다.
  try { $('#arr-done')?.focus({ preventScroll: true }); } catch { /* 초점 실패는 넘어갑니다 */ }
  notifyArrange();
  return true;
}

/** 편집 모드 종료. 도구줄을 걷고 표시를 지웁니다. */
export function stopArrange() {
  cancelHold();
  if (!current) return;
  endDrag(true);
  const box = boxOf(current);
  if (box) {
    stripBars(box.host);
    box.panel.removeAttribute('data-arranging');
    itemsOf(box).forEach((node) => { delete node.dataset.arrItem; });
  }
  // 탭을 옮기고 나서 껐다면 예전 패널에 표시가 남아 있을 수 있어 전부 훑습니다.
  $$('.panel[data-arranging]').forEach((p) => p.removeAttribute('data-arranging'));
  stripBars();
  delete document.body.dataset.arranging;
  const dock = $('#arr-dock');
  if (dock) dock.hidden = true;
  current = null;
  pendingFocus = null;
  notifyArrange();
}

/* ---------- 순서 저장 ---------- */

/** 지금 DOM 순서를 저장합니다. */
function commit(box) {
  const ids = itemsOf(box).map(idOf).filter(Boolean);
  if (!ids.length) return;
  if (box.kind === 'widget') {
    // 저장에는 '켜져 있는 위젯'만 들어갑니다. 꺼진 것은 애초에 화면에 없습니다.
    const on = ids.filter((name) => ALL_WIDGETS.includes(name));
    setPrefs({ widgets: on });
  } else {
    setCardOrder(current, ids);
  }
}

/* ---------- 손가락으로 끌기 ---------- */

/* ---------- 꾹 눌러 편집 켜기 ----------
 *
 * 편집은 원래 메뉴(•••)의 '화면 편집' 버튼으로만 켤 수 있었습니다.
 * 탭이 아홉 개라 좁은 화면에서는 그 버튼이 목록 아래로 밀려 보이지 않고,
 * 손으로 쓰는 사람은 홈 화면 아이콘처럼 '꾹 누르기'를 먼저 시도합니다.
 * 그래서 카드나 위젯을 꾹 누르면 편집이 켜지고, 손을 떼지 않고 그대로 끌 수 있게 했습니다.
 */

/** 몇 ms 눌러야 편집이 켜지는지. 안드로이드 홈 화면과 비슷하게 잡았습니다. */
const HOLD_MS = 500;
/** 이만큼(px) 넘게 움직이면 누른 것이 아니라 스크롤로 봅니다. */
const HOLD_MOVE = 10;

/**
 * 지금 누른 자리가 '꾹 눌러 편집'을 켜도 되는 자리인지 봅니다.
 * @returns {{item: Element, tab: string}|null}
 */
function holdTargetOf(e) {
  if (current || drag) return null;               // 이미 편집 중이면 손잡이가 따로 있습니다
  const item = e.target.closest?.('[data-card], [data-widget]');
  if (!item) return null;
  const tab = item.closest('.panel')?.id?.replace(/^panel-/, '');
  if (!tab) return null;
  const box = boxOf(tab);
  // 그 탭에서 실제로 옮길 수 있는 것이어야 합니다. ('오늘' 탭은 위젯만 옮깁니다)
  if (!box || item.parentElement !== box.host) return null;
  /*
   * 카드 안의 입력칸과 버튼은 제 일을 해야 합니다. 계산기 숫자를 길게 눌렀다고
   * 편집이 켜지면 곤란합니다. 다만 '오늘' 탭 위젯은 그 자체가 <button> 이라,
   * 자기 자신인 경우에는 막지 않습니다.
   */
  const inner = e.target.closest('input, textarea, select, button, a, canvas, [contenteditable]');
  if (inner && inner !== item) return null;
  /*
   * 노드가 아니라 id 를 들고 있습니다.
   * 누르고 있는 0.5초 사이에 today.js 가 위젯을 다시 그리면 이 노드는 버려집니다.
   * 그때 죽은 노드를 잡으면 편집만 켜지고 끌리지는 않습니다. 실제로 그랬습니다.
   */
  const id = idOf(item);
  return id ? { id, tab } : null;
}

/** id 로 지금 화면에 있는 항목을 다시 찾습니다. 다시 그려졌어도 같은 id 는 그대로입니다. */
function findItem(box, id) {
  return itemsOf(box).find((node) => idOf(node) === id) || null;
}

function cancelHold() {
  if (!hold) return;
  clearTimeout(hold.timer);
  hold = null;
  // 누르다 만 동안 미뤄 둔 그리기가 있으면 지금 처리하라고 알려 줍니다.
  notifyArrange();
}

/** 꾹 누르기가 끝까지 갔을 때. 편집을 켜고, 누르고 있던 그 항목을 바로 잡아 줍니다. */
function holdFired(info) {
  hold = null;
  if (!startArrange(info.tab)) return;
  // 길게 눌러 글자가 선택되는 경우가 있어 지워 줍니다.
  try { window.getSelection()?.removeAllRanges(); } catch { /* 선택이 없으면 그만입니다 */ }
  try { navigator.vibrate?.(24); } catch { /* 진동이 없는 기기도 있습니다 */ }

  const box = boxOf(info.tab);
  if (!box) return;
  const item = findItem(box, info.id);
  if (!item) return;                              // 그 사이에 없어진 카드라면 편집만 켜고 맙니다
  try { item.setPointerCapture(info.pointerId); } catch { /* 캡처가 안 돼도 이동은 됩니다 */ }
  /*
   * 손을 뗐다가 다시 손잡이를 찾아 잡게 하면 두 번 일입니다.
   * 누르고 있는 그 손가락을 그대로 드래그로 넘깁니다.
   * 기준점은 '지금 손가락 위치'라야 카드가 튀지 않습니다.
   */
  drag = {
    box, card: item, grab: item, pointerId: info.pointerId,
    startX: info.x, startY: info.y, moved: false,
  };
  item.dataset.arrDrag = 'on';
  announce(t('arr.held'));
}

function startHold(e) {
  cancelHold();
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const found = holdTargetOf(e);
  if (!found) return;
  const info = { ...found, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
  info.timer = setTimeout(() => holdFired(info), HOLD_MS);
  hold = info;
}

/** 누르고 있는 동안의 움직임. 조금 움직이는 것은 봐주고, 많이 움직이면 스크롤로 봅니다. */
function moveHold(e) {
  if (!hold || e.pointerId !== hold.pointerId) return;
  if (Math.abs(e.clientX - hold.x) > HOLD_MOVE || Math.abs(e.clientY - hold.y) > HOLD_MOVE) {
    cancelHold();
    return;
  }
  // 손가락이 조금 밀렸으면 기준점을 따라 옮깁니다. 그래야 잡는 순간 카드가 튀지 않습니다.
  hold.x = e.clientX;
  hold.y = e.clientY;
}

/** 패널 위/아래 끝에서 이만큼 안쪽에 오면 따라 스크롤합니다. */
const EDGE = 72;
const EDGE_SPEED = 14;

function autoScroll(panel, clientY) {
  cancelAnimationFrame(autoScrollRaf);
  const rect = panel.getBoundingClientRect();
  let dir = 0;
  if (clientY < rect.top + EDGE) dir = -1;
  else if (clientY > rect.bottom - EDGE) dir = 1;
  if (!dir) return;
  const step = () => {
    if (!drag) return;
    panel.scrollTop += dir * EDGE_SPEED;
    autoScrollRaf = requestAnimationFrame(step);
  };
  autoScrollRaf = requestAnimationFrame(step);
}

function onPointerDown(e) {
  // 편집이 꺼져 있을 때만 '꾹 누르기'를 셉니다. 켜져 있으면 바로 잡습니다.
  if (!current) { startHold(e); return; }
  if (drag) return;
  const box = boxOf(current);
  if (!box) return;

  /*
   * 편집 중에는 카드 아무 데나 잡아도 끌립니다.
   *
   * 예전에는 손잡이(⠿)만 잡을 수 있었습니다. 손가락으로는 그 작은 칸을 정확히
   * 누르기 어려워 '드래그가 안 된다'는 말을 들었습니다. 홈 화면 아이콘 정렬처럼,
   * 편집 중이면 카드 어디를 잡든 끌리는 것이 자연스럽습니다.
   *
   * 도구줄의 ▲▼ 와 크기 버튼은 눌려야 하므로 제외합니다.
   * 손잡이는 '누르는 버튼'이 아니라 '잡는 곳'이라 여기서 받습니다.
   */
  const card = e.target.closest?.('[data-arr-item]');
  if (!card || card.parentElement !== box.host) return;
  const onBar = e.target.closest('.arr-bar');
  if (onBar && !e.target.closest('.arr-grab')) return;

  e.preventDefault();
  // 잡은 자리가 사라져도 이벤트가 이어지도록 카드 자신에게 포인터를 묶습니다.
  try { card.setPointerCapture(e.pointerId); } catch { /* 캡처 실패해도 이동은 됩니다 */ }
  drag = {
    box, card, grab: card, pointerId: e.pointerId,
    startX: e.clientX, startY: e.clientY, moved: false,
  };
  card.dataset.arrDrag = 'on';
}

function onPointerMove(e) {
  if (hold) moveHold(e);
  if (!drag || e.pointerId !== drag.pointerId) return;
  e.preventDefault();
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;   // 손 떨림은 무시합니다
  drag.moved = true;
  drag.card.style.transform = `translate(${dx}px, ${dy}px)`;

  autoScroll(drag.box.panel, e.clientY);

  // 포인터가 올라가 있는 형제를 찾습니다. 끌리는 카드 자신은 뺍니다.
  const target = itemsOf(drag.box).find((node) => {
    if (node === drag.card) return false;
    const r = node.getBoundingClientRect();
    return e.clientY >= r.top && e.clientY <= r.bottom
      && e.clientX >= r.left && e.clientX <= r.right;
  });
  if (!target) return;

  const r = target.getBoundingClientRect();
  const after = (e.clientY - r.top) > r.height / 2;
  const next = after ? target.nextSibling : target;
  if (next === drag.card || (after && target.nextSibling === drag.card)) return;

  /*
   * DOM 에서 자리를 옮기면 카드의 '원래 자리'가 바뀝니다.
   * 그대로 두면 손가락과 카드가 어긋나므로, 옮기기 직전의 화면 위치를 재어 두고
   * 옮긴 뒤 같은 화면 위치에 있도록 기준점을 다시 잡습니다.
   */
  const before = drag.card.getBoundingClientRect();
  drag.box.host.insertBefore(drag.card, next);
  drag.card.style.transform = '';
  const now = drag.card.getBoundingClientRect();
  drag.startX = e.clientX - (before.left - now.left);
  drag.startY = e.clientY - (before.top - now.top);
  drag.card.style.transform =
    `translate(${e.clientX - drag.startX}px, ${e.clientY - drag.startY}px)`;
}

/**
 * 드래그를 끝냅니다.
 * @param {boolean} silent 참이면 저장하지 않습니다. (편집 모드를 끄면서 정리할 때)
 */
function endDrag(silent = false) {
  cancelAnimationFrame(autoScrollRaf);
  autoScrollRaf = 0;
  if (!drag) return;
  const { card, grab, box, moved, pointerId } = drag;
  drag = null;
  card.style.transform = '';
  delete card.dataset.arrDrag;
  try { grab.releasePointerCapture(pointerId); } catch { /* 이미 풀렸으면 넘어갑니다 */ }
  if (silent || !moved) return;
  commit(box);
  const items = itemsOf(box);
  announce(t('arr.moved', labelOf(card), items.indexOf(card) + 1, items.length));
  // 저장하면 화면을 다시 그리는 모듈이 있어 도구줄이 날아갑니다. 다시 답니다.
  decorate();
}

function onPointerUp(e) {
  cancelHold();
  if (!drag || e.pointerId !== drag.pointerId) return;
  endDrag();
}

/*
 * 편집 중에는 카드를 '누르는' 일이 일어나면 안 됩니다.
 *
 * '오늘' 탭의 위젯은 통째로 <button> 이고, 누르면 해당 탭으로 건너뜁니다.
 * 손잡이를 놓는 순간에도 click 이 한 번 올라가기 때문에, 카드를 옮기자마자
 * 화면이 딴 탭으로 넘어가 버립니다. 잡아 채는 단계에서 끊습니다.
 *
 * 도구줄 버튼은 제 일을 해야 하므로 통과시킵니다. 손잡이는 누르는 버튼이 아니라
 * 잡는 손잡이라서 click 을 흘려보내면 안 됩니다.
 */
function onClickCapture(e) {
  if (!current) return;
  const item = e.target.closest?.('[data-arr-item]');
  if (!item) return;
  if (e.target.closest('.arr-grab')) { e.preventDefault(); e.stopPropagation(); return; }
  if (e.target.closest('.arr-bar')) return;
  e.preventDefault();
  e.stopPropagation();
}

/* ---------- 부트스트랩 ---------- */

export function initArrange() {
  const dock = $('#arr-dock');
  if (!dock) return;

  $('#arr-done')?.addEventListener('click', () => stopArrange());

  // 손잡이는 문서 전체에서 위임으로 받습니다. 도구줄은 계속 새로 그려집니다.
  document.addEventListener('pointerdown', onPointerDown, { passive: false });
  document.addEventListener('pointermove', onPointerMove, { passive: false });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  // 잡아 채는 단계여야 아래쪽(위젯 컨테이너)의 위임 처리보다 먼저 막을 수 있습니다.
  document.addEventListener('click', onClickCapture, true);

  /*
   * 손가락으로 끄는 동안 화면이 같이 스크롤되지 않게 막습니다.
   *
   * 손잡이(.arr-grab)에는 touch-action: none 이 걸려 있지만, 꾹 눌러서 잡는 경우에는
   * 누른 곳이 카드 본체입니다. 카드에 touch-action: none 을 걸면 편집 중에 화면을
   * 아예 못 굴리게 되므로 걸 수 없습니다. 대신 끄는 동안에만 touchmove 를 취소합니다.
   * (0.5초 동안 움직이지 않아야 잡히므로, 이 시점에는 스크롤이 시작되지 않았습니다)
   * preventDefault 가 먹으려면 passive 가 아니어야 합니다.
   */
  document.addEventListener('touchmove', (e) => {
    if (drag && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) { e.preventDefault(); stopArrange(); }
  });

  /*
   * 길게 누르면 브라우저가 글자 선택이나 상황 메뉴를 띄우려 합니다.
   * 편집을 켜는 동작과 겹치므로, 옮길 수 있는 항목 위에서는 막습니다.
   */
  document.addEventListener('contextmenu', (e) => {
    if (!hold && !current) return;
    if (e.target.closest?.('[data-arr-item], [data-card], [data-widget]')) e.preventDefault();
  });

  // 화면을 스크롤하면 누르고 있던 것으로 치지 않습니다.
  document.addEventListener('scroll', cancelHold, { capture: true, passive: true });

  /*
   * 설정이 바뀌면 today.js 가 위젯을, appearance.js 가 카드 크기를 다시 적용합니다.
   * 그 과정에서 도구줄이 통째로 날아가므로 다시 답니다.
   * 끌고 있는 중에는 건드리지 않습니다. 손가락 밑에서 DOM 이 바뀌면 자리가 튑니다.
   */
  onPrefsChange(() => {
    if (!current || drag) return;
    requestAnimationFrame(() => { if (current && !drag) decorate(); });
  });
}

/** 지금 보고 있는 탭이 바뀌면 편집 모드를 끕니다. 딴 화면에 도구줄이 남으면 혼란스럽습니다. */
export function arrangeFollowTab(tab) {
  if (current && current !== tab) stopArrange();
}
