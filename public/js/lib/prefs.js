/**
 * prefs.js — 화면 커스터마이즈 설정 저장소
 *
 * 테마 스킨/강조색, 탭 순서와 숨김, '오늘' 위젯 구성, 카드 크기를 한곳에서 관리합니다.
 * DOM 은 건드리지 않습니다. 실제 화면 적용은 appearance.js 가 합니다.
 *
 * localStorage 는 사용자가 직접 고칠 수 있고 예전 버전이 남아 있을 수도 있으므로,
 * 읽어 올 때마다 전부 검사해서 모르는 값은 버립니다.
 * 설정 하나가 망가졌다고 앱 전체가 죽으면 안 됩니다.
 */
import { load, save } from './store.js';

const PREFS_KEY = 'ui.prefs';

/** 고를 수 있는 스킨. CSS 의 :root[data-skin="..."] 와 짝이 맞아야 합니다. */
export const SKINS = ['default', 'refined', 'cute', 'future', 'retro', 'nature'];

/** 고를 수 있는 강조색. CSS 의 :root[data-accent="..."] 와 짝이 맞아야 합니다. */
export const ACCENTS = ['blue', 'violet', 'teal', 'green', 'amber', 'rose', 'slate', 'pink'];

/** 탭 전체 목록. 화면에 놓이는 순서의 기본값이기도 합니다. */
export const ALL_TABS = ['today', 'calc', 'weather', 'todo', 'time', 'memo', 'quote', 'music', 'ai', 'settings'];

/**
 * 숨길 수 없는 탭.
 * 설정 탭을 숨기면 되돌릴 방법이 사라지고, 오늘 탭은 앱의 첫 화면이라 남겨 둡니다.
 */
export const LOCKED_TABS = ['today', 'settings'];

/** '오늘' 탭에 놓을 수 있는 위젯. 순서도 이 배열의 순서를 기본값으로 씁니다. */
export const ALL_WIDGETS = ['weather', 'todo', 'clock', 'timer', 'quote', 'memo', 'calc'];

/** 카드 크기 프리셋. 여백, 내부 스크롤 높이, 큰 숫자 표시 크기가 함께 바뀝니다. */
export const CARD_SIZES = ['compact', 'normal', 'large'];

/** 카드 폭. auto 는 화면 폭에 따라 1칸, full 은 항상 가로 전체입니다. */
export const CARD_SPANS = ['auto', 'full'];

/**
 * 카드별 기본값.
 * 커스터마이즈 카드는 항목이 많아 좁은 칸에 넣으면 버튼이 줄줄이 접힙니다.
 * 사용자가 직접 '기본 폭'을 고르면 그 선택이 이깁니다.
 */
export const CARD_DEFAULTS = Object.freeze({
  'settings.customize': { size: 'normal', span: 'full' },
});

export const DEFAULTS = Object.freeze({
  skin: 'default',
  accent: 'blue',
  tabOrder: ALL_TABS.slice(),
  tabHidden: [],
  widgets: ['weather', 'todo'],
  cards: {},
});

const listeners = new Set();

const isStr = (v) => typeof v === 'string';

/**
 * 저장된 순서를 정규화합니다.
 * 모르는 이름은 버리고, 빠진 탭은 기본 순서대로 뒤에 붙입니다.
 * 이렇게 해야 나중에 탭이 추가돼도 기존 사용자 화면에서 사라지지 않습니다.
 */
function normalizeOrder(raw, all) {
  const seen = new Set();
  const out = [];
  if (Array.isArray(raw)) {
    raw.forEach((name) => {
      if (isStr(name) && all.includes(name) && !seen.has(name)) { seen.add(name); out.push(name); }
    });
  }
  all.forEach((name) => { if (!seen.has(name)) out.push(name); });
  return out;
}

/** 위젯 목록. 순서를 그대로 쓰되 모르는 이름과 중복만 걸러냅니다. (빈 목록도 허용) */
function normalizeWidgets(raw) {
  if (!Array.isArray(raw)) return DEFAULTS.widgets.slice();
  const seen = new Set();
  const out = [];
  raw.forEach((name) => {
    if (isStr(name) && ALL_WIDGETS.includes(name) && !seen.has(name)) { seen.add(name); out.push(name); }
  });
  return out;
}

function normalizeHidden(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((name) => (
    isStr(name) && ALL_TABS.includes(name) && !LOCKED_TABS.includes(name)
  )).filter((name, i, arr) => arr.indexOf(name) === i);
}

/** 카드별 크기 설정. 값이 이상하면 그 카드만 기본값으로 되돌립니다. */
function normalizeCards(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw).forEach(([id, value]) => {
    if (!isStr(id) || !value || typeof value !== 'object') return;
    const size = CARD_SIZES.includes(value.size) ? value.size : 'normal';
    const span = CARD_SPANS.includes(value.span) ? value.span : 'auto';
    out[id] = { size, span };
  });
  return out;
}

export function getPrefs() {
  const raw = load(PREFS_KEY, null) || {};
  return {
    skin: SKINS.includes(raw.skin) ? raw.skin : DEFAULTS.skin,
    accent: ACCENTS.includes(raw.accent) ? raw.accent : DEFAULTS.accent,
    tabOrder: normalizeOrder(raw.tabOrder, ALL_TABS),
    tabHidden: normalizeHidden(raw.tabHidden),
    widgets: normalizeWidgets(raw.widgets),
    cards: normalizeCards(raw.cards),
  };
}

/** 실제로 화면에 놓일 탭. 순서대로, 숨긴 것은 뺀 목록입니다. */
export function visibleTabs(prefs = getPrefs()) {
  const hidden = new Set(prefs.tabHidden);
  const list = prefs.tabOrder.filter((name) => !hidden.has(name));
  // 방어: 정규화를 뚫고 전부 사라지는 일이 생기면 기본 순서로 되돌립니다.
  return list.length ? list : ALL_TABS.slice();
}

/** 카드 하나의 설정. 저장된 게 없으면 그 카드의 기본값입니다. */
export function cardPref(id, prefs = getPrefs()) {
  return prefs.cards[id] || CARD_DEFAULTS[id] || { size: 'normal', span: 'auto' };
}

/** 여러 항목을 한 번에 바꿉니다. 저장 뒤 구독자에게 알립니다. */
export function setPrefs(patch) {
  const next = { ...getPrefs(), ...patch };
  save(PREFS_KEY, {
    skin: next.skin,
    accent: next.accent,
    tabOrder: next.tabOrder,
    tabHidden: next.tabHidden,
    widgets: next.widgets,
    cards: next.cards,
  });
  notify();
  return getPrefs();
}

/** 카드 하나의 크기/폭만 바꿉니다. */
export function setCardPref(id, patch) {
  const prefs = getPrefs();
  const current = cardPref(id, prefs);
  const cards = { ...prefs.cards, [id]: { ...current, ...patch } };
  return setPrefs({ cards: normalizeCards(cards) });
}

/** 전부 기본값으로 되돌립니다. */
export function resetPrefs() {
  return setPrefs({ ...DEFAULTS, tabOrder: ALL_TABS.slice(), tabHidden: [], widgets: DEFAULTS.widgets.slice(), cards: {} });
}

export function onPrefsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const prefs = getPrefs();
  // 구독자 하나가 던져도 나머지는 살아 있어야 합니다.
  listeners.forEach((fn) => {
    try { fn(prefs); } catch (err) { console.error('[prefs] 구독자 오류', err); }
  });
}

/** 배열에서 항목을 한 칸 옮깁니다. 끝에서 더 밀면 그대로 둡니다. */
export function moveItem(list, name, delta) {
  const out = list.slice();
  const from = out.indexOf(name);
  if (from < 0) return out;
  const to = from + delta;
  if (to < 0 || to >= out.length) return out;
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}
