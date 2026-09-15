/**
 * categories.js — 할 일의 활동 분류
 *
 * 달력 칸은 작아서 글을 넣을 수 없습니다. 그래서 분류를 이모지 하나로만 보여 줍니다.
 * 이모지는 '어떤 종류의 일인지' 알아보는 용도이고, 자세한 내용은 날짜를 눌러 펼쳐 봅니다.
 *
 * 목록을 늘릴 때 주의할 점:
 *  - id 는 저장값이라 한 번 정하면 바꾸지 않습니다. (바꾸면 기존 할 일의 분류가 사라집니다)
 *  - i18n 에 'cat.<id>' 키를 한/영 모두 추가해야 합니다.
 */

export const CATEGORIES = [
  { id: 'work', emoji: '💼' },
  { id: 'personal', emoji: '🏠' },
  { id: 'study', emoji: '📚' },
  { id: 'health', emoji: '🏃' },
  { id: 'meet', emoji: '🤝' },
  { id: 'money', emoji: '💰' },
  { id: 'etc', emoji: '📌' },
];

export const DEFAULT_CATEGORY = 'etc';

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

/** 모르는 값이 들어와도 화면이 비지 않도록 기본 분류로 떨어뜨립니다. */
export function categoryOf(id) {
  return BY_ID.get(id) || BY_ID.get(DEFAULT_CATEGORY);
}

export function emojiOf(id) {
  return categoryOf(id).emoji;
}

/** 저장할 값인지 확인합니다. */
export function isCategory(id) {
  return typeof id === 'string' && BY_ID.has(id);
}
