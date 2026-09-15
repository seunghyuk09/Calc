/**
 * i18n.js
 * TO DO(계획표) 기능의 표시 언어를 한국어/영어 중에서 고를 수 있게 합니다.
 *
 * 범위: TO DO(계획표) 탭과 '오늘' 탭, 그리고 날씨 설명(WMO)까지 다룹니다.
 * 나머지 화면은 한국어 고정이며, 필요하면 같은 구조로 사전만 늘리면 됩니다.
 */
import { load, save } from './store.js';

const LANG_KEY = 'ui.lang';
export const LANGS = ['ko', 'en'];
const DEFAULT_LANG = 'ko';

// 값이 함수인 항목은 인자를 받아 문장을 만듭니다. (복수형 처리 등)
const DICT = {
  ko: {
    'today.weather.title': '현재 날씨',
    'today.weather.loading': '날씨를 불러오는 중…',
    'today.weather.error': '날씨를 불러오지 못했습니다',
    'today.weather.hint': '눌러서 주간 예보 보기',
    'today.todo.title': '오늘 할 일',
    'today.todo.remaining': (n) => `${n}개 남음`,
    'today.todo.empty': '등록된 할 일이 없습니다. 눌러서 계획표를 여세요.',
    'today.todo.allDone': '오늘 할 일을 모두 마쳤습니다 🎉',
    'today.todo.hint': '눌러서 계획표로 이동',
    'today.rotate.pause': '순환 멈춤',
    'today.rotate.play': '순환 시작',
    'today.aria.rotation': '미완료 할 일 순환',
    'today.aria.position': (i, n) => `${n}개 중 ${i}번째`,
    'todo.title': '계획표',
    'todo.scope.day': '일간',
    'todo.scope.week': '주간',
    'todo.scope.month': '월간',
    'todo.scope.year': '연간',
    'todo.nav.prev': '이전 기간',
    'todo.nav.next': '다음 기간',
    'todo.nav.today': '오늘',
    'todo.input.placeholder': '계획을 입력하고 Enter',
    'todo.btn.add': '추가',
    'todo.filter.all': '전체',
    'todo.filter.active': '진행 중',
    'todo.filter.done': '완료',
    'todo.btn.carry': '이월',
    'todo.btn.carryHint': '직전 기간의 미완료 항목을 이 기간으로 가져옵니다',
    'todo.btn.clearDone': '완료 삭제',
    'todo.empty.none': '이 기간에 등록된 계획이 없습니다.',
    'todo.empty.filter': '해당하는 항목이 없습니다.',
    'todo.aria.done': '완료 표시',
    'todo.aria.delete': '삭제',
    'todo.aria.scopeTabs': '계획 단위',
    'todo.count.total': (n) => `누적 ${n}건`,
    'todo.toast.nothingToCarry': '직전 기간에 이월할 항목이 없습니다',
    'todo.toast.carried': (n) => `미완료 ${n}건을 이 기간으로 옮겼습니다`,
    'todo.toast.nothingToClear': '이 기간에 완료된 항목이 없습니다',
    'todo.toast.cleared': (n) => `완료 항목 ${n}건을 삭제했습니다`,
  },
  en: {
    'today.weather.title': 'Current weather',
    'today.weather.loading': 'Loading weather…',
    'today.weather.error': "Couldn't load the weather",
    'today.weather.hint': 'Tap for the weekly forecast',
    'today.todo.title': "Today's tasks",
    'today.todo.remaining': (n) => `${n} left`,
    'today.todo.empty': 'Nothing here yet. Tap to open the planner.',
    'today.todo.allDone': 'All done for today 🎉',
    'today.todo.hint': 'Tap to open the planner',
    'today.rotate.pause': 'Pause rotation',
    'today.rotate.play': 'Start rotation',
    'today.aria.rotation': 'Unfinished task carousel',
    'today.aria.position': (i, n) => `Item ${i} of ${n}`,
    'todo.title': 'Planner',
    'todo.scope.day': 'Day',
    'todo.scope.week': 'Week',
    'todo.scope.month': 'Month',
    'todo.scope.year': 'Year',
    'todo.nav.prev': 'Previous period',
    'todo.nav.next': 'Next period',
    'todo.nav.today': 'Today',
    'todo.input.placeholder': 'Add a plan and press Enter',
    'todo.btn.add': 'Add',
    'todo.filter.all': 'All',
    'todo.filter.active': 'Active',
    'todo.filter.done': 'Done',
    'todo.btn.carry': 'Carry over',
    'todo.btn.carryHint': 'Move unfinished items from the previous period here',
    'todo.btn.clearDone': 'Clear done',
    'todo.empty.none': 'No plans for this period yet.',
    'todo.empty.filter': 'Nothing matches this filter.',
    'todo.aria.done': 'Mark as done',
    'todo.aria.delete': 'Delete',
    'todo.aria.scopeTabs': 'Planning scope',
    'todo.count.total': (n) => `${n} plan${n === 1 ? '' : 's'} all-time`,
    'todo.toast.nothingToCarry': 'Nothing to carry over from the previous period',
    'todo.toast.carried': (n) => `Moved ${n} unfinished item${n === 1 ? '' : 's'} here`,
    'todo.toast.nothingToClear': 'No completed items in this period',
    'todo.toast.cleared': (n) => `Cleared ${n} completed item${n === 1 ? '' : 's'}`,
  },
};

let current = DEFAULT_LANG;
const listeners = new Set();

/** 현재 언어 코드 */
export function getLang() { return current; }

/** 언어를 바꾸고 저장한 뒤, 등록된 구독자에게 알립니다. */
export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  save(LANG_KEY, lang);
  listeners.forEach((fn) => {
    try { fn(lang); } catch (err) { console.error('[i18n] 갱신 실패', err); }
  });
}

/** 언어가 바뀔 때 호출할 함수를 등록합니다. 해제 함수를 돌려줍니다. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 문구를 찾습니다. 사전에 없으면 키를 그대로 돌려줘 화면이 비지 않게 합니다.
 * @param {string} key
 * @param {...any} args 함수형 항목에 넘길 값
 */
export function t(key, ...args) {
  const entry = DICT[current]?.[key] ?? DICT[DEFAULT_LANG]?.[key];
  if (entry == null) {
    console.warn('[i18n] 없는 문구 키:', key);
    return key;
  }
  return typeof entry === 'function' ? entry(...args) : entry;
}

/** 저장된 언어를 불러옵니다. 앱 시작 시 한 번 호출합니다. */
export function initLang() {
  const saved = load(LANG_KEY, null);
  current = LANGS.includes(saved) ? saved : DEFAULT_LANG;
  return current;
}

/**
 * data-i18n 속성이 붙은 정적 요소의 문구를 현재 언어로 채웁니다.
 *   data-i18n           -> textContent
 *   data-i18n-placeholder -> placeholder 속성
 *   data-i18n-aria      -> aria-label 속성
 *   data-i18n-title     -> title 속성
 */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
}

/** 사전에 빠진 키가 없는지 확인합니다. (테스트용) */
export function dictKeys(lang) { return Object.keys(DICT[lang] || {}); }
