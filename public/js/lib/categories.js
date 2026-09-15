/**
 * categories.js — 할 일의 활동 분류
 *
 * 달력 칸은 작아서 글을 넣을 수 없습니다. 그래서 분류를 이모지 하나로만 보여 줍니다.
 * 이모지는 '어떤 종류의 일인지' 알아보는 용도이고, 자세한 내용은 날짜를 눌러 펼쳐 봅니다.
 *
 * 분류는 두 종류입니다.
 *   기본 분류 : 여기 박혀 있고, 이름은 i18n 의 'cat.<id>' 를 씁니다. 지울 수는 없고 숨길 수 있습니다.
 *   내 분류   : 사용자가 만든 것. 이름과 이모지를 직접 정하고 지울 수 있습니다.
 *
 * 기본 분류의 이모지도 바꿀 수 있습니다. 바꾼 값만 따로 저장해 두고,
 * 기본값을 나중에 고치더라도 사용자가 손댄 것만 남습니다.
 *
 * id 는 저장값입니다. 한 번 정하면 바꾸지 않습니다. (바꾸면 기존 할 일의 분류가 끊어집니다)
 */
import { load, save } from './store.js';

const KEY = 'todo.categories';

/** 기본 분류. 이름은 i18n 의 'cat.<id>' 에 있습니다. */
export const BUILTIN = [
  { id: 'work', emoji: '💼' },
  { id: 'personal', emoji: '🏠' },
  { id: 'study', emoji: '📚' },
  { id: 'health', emoji: '🏃' },
  { id: 'meet', emoji: '🤝' },
  { id: 'money', emoji: '💰' },
  { id: 'etc', emoji: '📌' },
];

export const DEFAULT_CATEGORY = 'etc';

/** 지울 수도 숨길 수도 없는 분류. 하나도 없으면 분류를 고를 수 없게 됩니다. */
const LOCKED = [DEFAULT_CATEGORY];

const BUILTIN_IDS = BUILTIN.map((c) => c.id);
const BUILTIN_MAP = new Map(BUILTIN.map((c) => [c.id, c]));

/** 이모지 고르기 판에 올릴 후보. 분류로 쓸 만한 것만 추렸습니다. */
export const EMOJI_CHOICES = [
  '💼', '🏠', '📚', '🏃', '🤝', '💰', '📌', '✅',
  '🗓️', '⏰', '✈️', '🚗', '🍽️', '☕', '🛒', '🎁',
  '🎵', '🎮', '🎨', '📷', '🐶', '🌱', '💊', '🏥',
  '🧹', '🧺', '🍳', '💡', '🔧', '📞', '✉️', '💬',
  '🎯', '🔥', '⭐', '❤️', '🌙', '☀️', '⚽', '🏋️',
  '👨‍👩‍👧', '🎂', '📝', '💻', '🧠', '🙏', '🚿', '🛏️',
];

/** 사용자가 만든 분류의 id 접두사. 기본 분류와 절대 겹치지 않게 합니다. */
const USER_PREFIX = 'u_';

const isStr = (v) => typeof v === 'string';

/**
 * 이모지는 한 글자로 보여야 달력 칸이 무너지지 않습니다.
 * 다만 '👨‍👩‍👧' 처럼 여러 코드포인트가 붙어 한 글자로 보이는 것도 있어서,
 * 코드포인트 수가 아니라 '글자소(grapheme)' 하나인지로 봅니다.
 * Intl.Segmenter 가 없는 환경에서는 길이 상한으로만 막습니다.
 */
function normalizeEmoji(raw) {
  if (!isStr(raw)) return '';
  const text = raw.trim();
  if (!text) return '';
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
      const first = [...seg.segment(text)][0];
      return first ? first.segment : '';
    }
  } catch { /* 아래 폴백으로 갑니다 */ }
  // 폴백: 서로게이트 쌍이 잘리지 않게 코드포인트 단위로 자릅니다.
  const points = [...text];
  return points.slice(0, 8).join('');
}

/** 저장된 값을 읽어 옵니다. 망가져 있어도 앱이 죽지 않게 전부 검사합니다. */
function readStore() {
  const raw = load(KEY, null);
  const out = { custom: [], emoji: {}, hidden: [] };
  if (!raw || typeof raw !== 'object') return out;

  if (Array.isArray(raw.custom)) {
    const seen = new Set();
    raw.custom.forEach((c) => {
      if (!c || typeof c !== 'object') return;
      if (!isStr(c.id) || !c.id.startsWith(USER_PREFIX) || seen.has(c.id)) return;
      const emoji = normalizeEmoji(c.emoji);
      const label = isStr(c.label) ? c.label.trim().slice(0, 20) : '';
      if (!emoji || !label) return;
      seen.add(c.id);
      out.custom.push({ id: c.id, emoji, label });
    });
  }

  if (raw.emoji && typeof raw.emoji === 'object') {
    Object.entries(raw.emoji).forEach(([id, value]) => {
      if (!BUILTIN_MAP.has(id)) return;   // 없어진 기본 분류의 찌꺼기는 버립니다
      const emoji = normalizeEmoji(value);
      if (emoji) out.emoji[id] = emoji;
    });
  }

  if (Array.isArray(raw.hidden)) {
    out.hidden = raw.hidden.filter((id) => (
      isStr(id) && BUILTIN_MAP.has(id) && !LOCKED.includes(id)
    )).filter((id, i, arr) => arr.indexOf(id) === i);
  }
  return out;
}

const listeners = new Set();

export function onCategoryChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function writeStore(next) {
  save(KEY, next);
  listeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error('[categories] 구독자 오류', err); }
  });
}

/**
 * 고를 수 있는 분류 전체. 기본 분류(숨긴 것 제외) 다음에 내 분류가 옵니다.
 * label 은 내 분류만 들어 있습니다. 기본 분류의 이름은 화면에서 i18n 으로 채웁니다.
 */
export function allCategories() {
  const store = readStore();
  const hidden = new Set(store.hidden);
  const base = BUILTIN
    .filter((c) => !hidden.has(c.id))
    .map((c) => ({ id: c.id, emoji: store.emoji[c.id] || c.emoji, builtin: true }));
  return base.concat(store.custom.map((c) => ({ ...c, builtin: false })));
}

/** 숨긴 것까지 포함한 전체. 설정 화면에서 다시 켜려면 숨긴 것도 보여야 합니다. */
export function allCategoriesIncludingHidden() {
  const store = readStore();
  const hidden = new Set(store.hidden);
  const base = BUILTIN.map((c) => ({
    id: c.id,
    emoji: store.emoji[c.id] || c.emoji,
    builtin: true,
    hidden: hidden.has(c.id),
    locked: LOCKED.includes(c.id),
  }));
  return base.concat(store.custom.map((c) => ({ ...c, builtin: false, hidden: false, locked: false })));
}

function findAny(id) {
  const store = readStore();
  if (BUILTIN_MAP.has(id)) {
    return { id, emoji: store.emoji[id] || BUILTIN_MAP.get(id).emoji, builtin: true };
  }
  return store.custom.find((c) => c.id === id) || null;
}

/**
 * 모르는 값이 들어와도 화면이 비지 않도록 기본 분류로 떨어뜨립니다.
 * 분류를 지운 뒤에도 그 분류로 저장된 할 일이 남아 있으므로 꼭 필요합니다.
 */
export function categoryOf(id) {
  return findAny(id) || findAny(DEFAULT_CATEGORY);
}

export function emojiOf(id) {
  return categoryOf(id).emoji;
}

/** 화면에 쓸 이름. 기본 분류는 i18n 을, 내 분류는 저장된 이름을 씁니다. */
export function labelOf(id, t) {
  const cat = categoryOf(id);
  return cat.builtin ? t(`cat.${cat.id}`) : cat.label;
}

/** 지금 고를 수 있는 분류인지. (숨긴 분류는 false 입니다) */
export function isCategory(id) {
  return isStr(id) && allCategories().some((c) => c.id === id);
}

/** 저장된 적이 있는 분류인지. 숨겼거나 지운 분류도 true 입니다. */
export function isKnownCategory(id) {
  return isStr(id) && findAny(id) !== null;
}

/* ---------- 편집 ---------- */

/**
 * 내 분류를 새로 만듭니다.
 * @returns {string|null} 만들어진 id. 이름이나 이모지가 비면 null.
 */
export function addCategory(label, emoji) {
  const name = isStr(label) ? label.trim().slice(0, 20) : '';
  const mark = normalizeEmoji(emoji);
  if (!name || !mark) return null;
  const store = readStore();
  // 시간만 쓰면 같은 밀리초에 두 번 눌렀을 때 겹칩니다. 뒤에 난수를 붙입니다.
  const id = `${USER_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  store.custom.push({ id, emoji: mark, label: name });
  writeStore(store);
  return id;
}

/** 내 분류를 지웁니다. 기본 분류에는 쓸 수 없습니다. (그건 hideCategory 입니다) */
export function removeCategory(id) {
  if (!isStr(id) || !id.startsWith(USER_PREFIX)) return false;
  const store = readStore();
  const next = store.custom.filter((c) => c.id !== id);
  if (next.length === store.custom.length) return false;
  store.custom = next;
  writeStore(store);
  return true;
}

/** 분류의 이모지를 바꿉니다. 기본 분류는 바꾼 값만 따로 저장합니다. */
export function setCategoryEmoji(id, emoji) {
  const mark = normalizeEmoji(emoji);
  if (!mark) return false;
  const store = readStore();
  if (BUILTIN_MAP.has(id)) {
    store.emoji[id] = mark;
    writeStore(store);
    return true;
  }
  const mine = store.custom.find((c) => c.id === id);
  if (!mine) return false;
  mine.emoji = mark;
  writeStore(store);
  return true;
}

/** 기본 분류를 목록에서 뺍니다. 지우지는 않으므로 언제든 되돌릴 수 있습니다. */
export function hideCategory(id, hidden = true) {
  if (!BUILTIN_MAP.has(id) || LOCKED.includes(id)) return false;
  const store = readStore();
  const set = new Set(store.hidden);
  if (hidden) set.add(id); else set.delete(id);
  store.hidden = [...set];
  writeStore(store);
  return true;
}

/** 전부 기본값으로. 이미 저장된 할 일의 분류 값은 건드리지 않습니다. */
export function resetCategories() {
  writeStore({ custom: [], emoji: {}, hidden: [] });
}

/** 테스트와 검사용. 기본 분류 id 목록입니다. */
export const CATEGORY_IDS = BUILTIN_IDS;
