/**
 * appearance.js — 커스터마이즈를 화면에 적용하고, 설정 탭의 편집 UI 를 그립니다.
 *
 * prefs.js 가 '무엇을 골랐는가'를, 이 파일이 '그래서 화면을 어떻게 바꾸는가'를 담당합니다.
 * 탭 순서는 가로 페이저의 스크롤 위치와 직결되므로, 여기서는 DOM 만 옮기고
 * 페이저를 다시 맞추는 일은 main.js 가 합니다. (applyTabLayout 의 반환값을 씁니다)
 */
import { $, $$, el } from '../lib/dom.js';
import { t, onLangChange } from '../lib/i18n.js';
import { load, save } from '../lib/store.js';
import {
  SKINS, BASES, ACCENTS, ALL_TABS, LOCKED_TABS, ALL_WIDGETS, CARD_SIZES, CARD_SPANS,
  getPrefs, setPrefs, setCardPref, resetPrefs, visibleTabs, cardPref, moveItem,
} from '../lib/prefs.js';

/** 탭 버튼과 패널의 원본을 보관합니다. 숨긴 탭은 DOM 에서 빠지므로 여기서 다시 꺼냅니다. */
const tabNodes = new Map();   // name -> { button, panel }
let snapshotTaken = false;

/** 카드가 어느 탭에 속하는지 보여 주려고, data-card 의 앞부분을 탭 이름으로 씁니다. */
const tabOfCard = (id) => String(id).split('.')[0];

function takeSnapshot() {
  if (snapshotTaken) return;
  ALL_TABS.forEach((name) => {
    const button = document.querySelector(`.tab[data-tab="${name}"]`);
    const panel = document.querySelector(`#panel-${name}`);
    if (button && panel) tabNodes.set(name, { button, panel });
  });
  snapshotTaken = true;
}

/** 스킨과 강조색을 문서에 답니다. 기본값이면 속성을 아예 지웁니다. */
export function applySkinAccent(prefs = getPrefs()) {
  const root = document.documentElement;
  if (prefs.skin && prefs.skin !== 'default') root.setAttribute('data-skin', prefs.skin);
  else root.removeAttribute('data-skin');
  if (prefs.base && prefs.base !== 'default') root.setAttribute('data-base', prefs.base);
  else root.removeAttribute('data-base');
  if (prefs.accent && prefs.accent !== 'blue') root.setAttribute('data-accent', prefs.accent);
  else root.removeAttribute('data-accent');
  syncThemeColor();
}

/**
 * 주소창 색을 실제 배경색과 맞춥니다.
 * 스킨마다 배경이 다르므로 고정값을 쓰면 앱 위아래에 다른 색 띠가 생깁니다.
 */
function syncThemeColor() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  } catch { /* 계산 실패 시 기존 값을 그대로 둡니다 */ }
}

/** 카드마다 저장된 크기/폭을 답니다. */
export function applyCardPrefs(prefs = getPrefs()) {
  $$('[data-card]').forEach((node) => {
    const { size, span } = cardPref(node.dataset.card, prefs);
    if (size === 'normal') node.removeAttribute('data-size'); else node.dataset.size = size;
    if (span === 'auto') node.removeAttribute('data-span'); else node.dataset.span = span;
  });
}

/**
 * 탭 버튼과 패널을 저장된 순서대로 다시 배치하고, 숨긴 것은 DOM 에서 뺍니다.
 * 반환값은 실제로 화면에 남은 탭 목록입니다. (main.js 가 페이저 인덱스 계산에 씁니다)
 */
export function applyTabLayout(prefs = getPrefs()) {
  takeSnapshot();
  const tabsBar = $('#tabs');
  const main = $('#main');
  if (!tabsBar || !main) return ALL_TABS.slice();

  const order = visibleTabs(prefs);
  order.forEach((name) => {
    const node = tabNodes.get(name);
    if (!node) return;
    // appendChild 는 이미 문서에 있는 노드를 '옮깁니다'. 리스너는 #tabs 에 위임돼 있어 그대로입니다.
    tabsBar.appendChild(node.button);
    main.appendChild(node.panel);
  });

  const shown = new Set(order);
  tabNodes.forEach((node, name) => {
    if (shown.has(name)) return;
    node.button.remove();
    node.panel.remove();
  });

  return order;
}

/* =========================================================
   설정 탭의 편집 UI
   ========================================================= */

const swatch = (name) => el('span', { class: `cz-dot cz-dot-${name}`, 'aria-hidden': 'true' });

function optionButton(label, active, onClick, extra = {}) {
  const btn = el('button', {
    class: `cz-opt${active ? ' is-on' : ''}`,
    type: 'button',
    'aria-pressed': String(active),
    ...extra,
  }, label);
  btn.addEventListener('click', onClick);
  return btn;
}

function renderSkins(prefs) {
  return el('div', { class: 'cz-opts' }, ...SKINS.map((name) => {
    const btn = optionButton(t(`cz.skin.${name}`), prefs.skin === name,
      () => setPrefs({ skin: name }), { dataset: { skinOpt: name } });
    btn.prepend(el('span', { class: `cz-skin-chip cz-skin-${name}`, 'aria-hidden': 'true' }));
    return btn;
  }));
}

function renderBases(prefs) {
  return el('div', { class: 'cz-opts' }, ...BASES.map((name) => {
    const btn = optionButton('', prefs.base === name, () => setPrefs({ base: name }), {
      class: `cz-swatch cz-swatch-base${prefs.base === name ? ' is-on' : ''}`,
      dataset: { baseOpt: name },
      title: t(`cz.base.${name}`),
      'aria-label': t(`cz.base.${name}`),
    });
    // 배경과 카드 두 색을 함께 보여 줘야 고르기 전에 분위기를 알 수 있습니다.
    btn.append(el('span', { class: `cz-base-chip cz-base-${name}`, 'aria-hidden': 'true' }));
    return btn;
  }));
}

function renderAccents(prefs) {
  return el('div', { class: 'cz-opts' }, ...ACCENTS.map((name) => {
    const btn = optionButton('', prefs.accent === name, () => setPrefs({ accent: name }), {
      class: `cz-swatch${prefs.accent === name ? ' is-on' : ''}`,
      dataset: { accentOpt: name },
      title: t(`cz.accent.${name}`),
      'aria-label': t(`cz.accent.${name}`),
    });
    btn.append(swatch(name));
    return btn;
  }));
}

/** 위/아래 이동 + 켜고 끄기가 붙은 목록 한 줄. 탭과 위젯이 같은 모양을 씁니다. */
function orderRow({ name, label, index, total, locked, on, onMove, onToggle }) {
  const up = el('button', {
    class: 'icon-btn', type: 'button', dataset: { move: 'up' }, 'aria-label': t('cz.moveUp', label),
  }, '▲');
  const down = el('button', {
    class: 'icon-btn', type: 'button', dataset: { move: 'down' }, 'aria-label': t('cz.moveDown', label),
  }, '▼');
  up.disabled = index === 0;
  down.disabled = index === total - 1;
  up.addEventListener('click', () => onMove(-1));
  down.addEventListener('click', () => onMove(1));

  const toggle = el('button', {
    class: `cz-toggle${on ? ' is-on' : ''}`,
    type: 'button',
    dataset: { toggle: name },
    'aria-pressed': String(on),
  }, t(on ? 'cz.shown' : 'cz.hidden'));
  if (locked) {
    toggle.disabled = true;
    toggle.title = t('cz.lockedHint');
  } else {
    toggle.addEventListener('click', onToggle);
  }

  // 화면 글자는 언어에 따라 바뀌므로, 식별은 항상 이 data 속성으로 합니다.
  return el('li', { class: 'cz-row', dataset: { row: name } },
    el('span', { class: 'cz-row-label' }, label),
    up, down, toggle);
}

function renderTabOrder(prefs) {
  const hidden = new Set(prefs.tabHidden);
  return el('ul', { class: 'cz-list' }, ...prefs.tabOrder.map((name, i) => orderRow({
    name,
    label: t(`tab.${name}`),
    index: i,
    total: prefs.tabOrder.length,
    locked: LOCKED_TABS.includes(name),
    on: !hidden.has(name),
    onMove: (d) => setPrefs({ tabOrder: moveItem(prefs.tabOrder, name, d) }),
    onToggle: () => setPrefs({
      tabHidden: hidden.has(name)
        ? prefs.tabHidden.filter((n) => n !== name)
        : prefs.tabHidden.concat(name),
    }),
  })));
}

function renderWidgets(prefs) {
  // 켜져 있는 것을 순서대로 먼저, 꺼진 것을 뒤에 붙여 한 목록으로 보여 줍니다.
  const off = ALL_WIDGETS.filter((n) => !prefs.widgets.includes(n));
  const rows = prefs.widgets.concat(off);
  return el('ul', { class: 'cz-list' }, ...rows.map((name, i) => {
    const on = prefs.widgets.includes(name);
    return orderRow({
      name,
      label: t(`cz.widget.${name}`),
      index: i,
      total: rows.length,
      // 꺼진 위젯은 순서를 바꿔도 의미가 없어 이동 버튼을 막습니다.
      locked: false,
      on,
      onMove: (d) => { if (on) setPrefs({ widgets: moveItem(prefs.widgets, name, d) }); },
      onToggle: () => setPrefs({
        widgets: on ? prefs.widgets.filter((n) => n !== name) : prefs.widgets.concat(name),
      }),
    });
  }));
}

function renderCards(prefs) {
  const cards = $$('[data-card]');
  if (!cards.length) return el('p', { class: 'card-sub' }, t('cz.cards.none'));

  // 탭별로 묶어서 보여 줍니다. 카드 이름만 나열하면 어느 화면 것인지 알 수 없습니다.
  const groups = new Map();
  cards.forEach((node) => {
    const id = node.dataset.card;
    const tab = tabOfCard(id);
    if (!groups.has(tab)) groups.set(tab, []);
    groups.get(tab).push(id);
  });

  return el('div', { class: 'cz-cards' }, ...[...groups.entries()].map(([tab, ids]) => (
    el('div', { class: 'cz-card-group' },
      el('div', { class: 'cz-group-title' }, t(`tab.${tab}`)),
      ...ids.map((id) => {
        const pref = cardPref(id, prefs);
        return el('div', { class: 'cz-card-row', dataset: { cardRow: id } },
          el('span', { class: 'cz-row-label' }, t(`cz.card.${id}`)),
          el('div', { class: 'cz-opts cz-opts-tight' }, ...CARD_SIZES.map((size) => (
            optionButton(t(`cz.size.${size}`), pref.size === size,
              () => setCardPref(id, { size }), { dataset: { sizeOpt: size } })
          ))),
          el('div', { class: 'cz-opts cz-opts-tight' }, ...CARD_SPANS.map((span) => (
            optionButton(t(`cz.span.${span}`), pref.span === span,
              () => setCardPref(id, { span }), { dataset: { spanOpt: span } })
          ))),
        );
      }))
  )));
}

/* ---------- 접었다 펴는 구역 ----------
 * 예전에는 다섯 구역이 전부 펼쳐져 있어서, 카드 크기를 고치려면 한참 내려야 했습니다.
 * 기본은 전부 접고, 접힌 줄에 '지금 값'을 같이 써서 열지 않고도 알 수 있게 합니다.
 *
 * 펼친 상태를 기억해야 합니다. 색을 하나 고를 때마다 이 화면을 다시 그리는데,
 * 기억하지 않으면 고를 때마다 구역이 닫혀 버립니다.
 */
const OPEN_KEY = 'ui.czOpen';
let openSections = new Set(Array.isArray(load(OPEN_KEY, null)) ? load(OPEN_KEY, []) : []);

function rememberOpen(name, open) {
  if (open) openSections.add(name); else openSections.delete(name);
  save(OPEN_KEY, [...openSections]);
}

/**
 * @param {string} name   저장용 식별자 (화면 글자는 언어에 따라 바뀌므로 쓰면 안 됩니다)
 * @param {string} now    접힌 줄에 같이 보여 줄 현재 값. 없으면 생략합니다.
 */
function section(name, titleKey, hintKey, now, body) {
  const box = el('details', { class: 'cz-section', dataset: { section: name } },
    el('summary', { class: 'cz-summary' },
      el('span', { class: 'cz-summary-title' }, t(titleKey)),
      now ? el('span', { class: 'cz-summary-now' }, now) : '',
      el('span', { class: 'cz-summary-mark', 'aria-hidden': 'true' }, '⌄')),
    hintKey ? el('p', { class: 'card-sub cz-hint' }, t(hintKey)) : '',
    body);
  box.open = openSections.has(name);
  box.addEventListener('toggle', () => rememberOpen(name, box.open));
  return box;
}

/** 접힌 줄에 쓸 요약. 켜진 개수처럼 '열어 볼 가치가 있는지' 알려 주는 값을 씁니다. */
function countNow(on, total) {
  return t('cz.nowCount', on, total);
}

function renderCustomize() {
  const host = $('#customize');
  if (!host) return;
  const prefs = getPrefs();

  const reset = el('button', {
    class: 'btn btn-sm btn-danger', type: 'button', id: 'cz-reset',
  }, t('cz.reset'));
  reset.addEventListener('click', () => {
    // 되돌릴 수 없는 동작이라 한 번 확인합니다.
    if (window.confirm(t('cz.resetConfirm'))) resetPrefs();
  });

  const shownTabs = prefs.tabOrder.length - prefs.tabHidden.length;
  const cardCount = $$('[data-card]').length;

  host.replaceChildren(
    section('skin', 'cz.skin.title', 'cz.skin.hint', t(`cz.skin.${prefs.skin}`), renderSkins(prefs)),
    section('base', 'cz.base.title', 'cz.base.hint', t(`cz.base.${prefs.base}`), renderBases(prefs)),
    section('accent', 'cz.accent.title', 'cz.accent.hint', t(`cz.accent.${prefs.accent}`), renderAccents(prefs)),
    section('tabs', 'cz.tabs.title', 'cz.tabs.hint', countNow(shownTabs, prefs.tabOrder.length), renderTabOrder(prefs)),
    section('widgets', 'cz.widgets.title', 'cz.widgets.hint', countNow(prefs.widgets.length, ALL_WIDGETS.length), renderWidgets(prefs)),
    section('cards', 'cz.cards.title', 'cz.cards.hint', t('cz.nowCards', cardCount), renderCards(prefs)),
    el('div', { class: 'row', style: 'margin-top:14px' }, reset),
  );
}

/**
 * 부트스트랩. 저장된 값을 화면에 적용하고 편집 UI 를 그립니다.
 * 탭 배치는 main.js 가 페이저까지 다시 맞춰야 해서 여기서 부르지 않습니다.
 */
export function initAppearance() {
  applySkinAccent();
  applyCardPrefs();
  renderCustomize();
  onLangChange(renderCustomize);
}

/** prefs 가 바뀔 때마다 화면과 편집 UI 를 다시 맞춥니다. (탭 배치 제외) */
export function refreshAppearance(prefs) {
  applySkinAccent(prefs);
  applyCardPrefs(prefs);
  renderCustomize();
}
