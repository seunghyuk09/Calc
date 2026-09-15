import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를 참조하므로 import 전에 동작하는 가짜 저장소를 만들어 둡니다.
const bag = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: (k) => bag.delete(k),
  },
  location: { protocol: 'http:' },
};

const cats = await import('../public/js/lib/categories.js');
const {
  BUILTIN, CATEGORY_IDS, DEFAULT_CATEGORY, EMOJI_CHOICES,
  allCategories, allCategoriesIncludingHidden, categoryOf, emojiOf, labelOf,
  isCategory, isKnownCategory,
  addCategory, removeCategory, setCategoryEmoji, hideCategory, resetCategories,
  onCategoryChange,
} = cats;

// store.js 는 모든 키에 접두사를 붙입니다. 가짜 저장소에 직접 심을 때도 맞춰야 합니다.
const KEY = 'daily-kit:todo.categories';
const seed = (value) => bag.set(KEY, JSON.stringify(value));
const wipe = () => bag.clear();

// 화면에서 쓰는 t() 대신, 키를 그대로 돌려주는 가짜를 씁니다.
const t = (key) => key;

test('기본값: 기본 분류가 모두 나온다', () => {
  wipe();
  const list = allCategories();
  assert.equal(list.length, BUILTIN.length);
  CATEGORY_IDS.forEach((id) => assert.ok(list.some((c) => c.id === id), `${id} 이 빠졌습니다`));
  assert.ok(list.every((c) => c.builtin === true));
});

test('기본 분류의 이모지가 서로 겹치지 않는다 (달력에서 구분이 안 됩니다)', () => {
  wipe();
  const emojis = CATEGORY_IDS.map(emojiOf);
  assert.equal(new Set(emojis).size, emojis.length, `중복: ${emojis.join(' ')}`);
});

test('이모지 후보 판에도 중복이 없다', () => {
  assert.equal(new Set(EMOJI_CHOICES).size, EMOJI_CHOICES.length);
  assert.ok(EMOJI_CHOICES.length >= 24, `후보가 너무 적습니다 (${EMOJI_CHOICES.length})`);
});

test('모르는 값은 기본 분류로 떨어진다', () => {
  wipe();
  assert.equal(emojiOf('없는분류'), emojiOf(DEFAULT_CATEGORY));
  assert.equal(emojiOf(undefined), emojiOf(DEFAULT_CATEGORY));
  assert.equal(isCategory('없는분류'), false);
  assert.equal(isCategory('work'), true);
});

test('내 분류 만들기: 목록 끝에 붙고 바로 고를 수 있다', () => {
  wipe();
  const id = addCategory('취미', '🎵');
  assert.ok(id, '만들어지지 않았습니다');
  const list = allCategories();
  assert.equal(list[list.length - 1].id, id);
  assert.equal(emojiOf(id), '🎵');
  assert.equal(labelOf(id, t), '취미');
  assert.equal(isCategory(id), true);
});

test('내 분류 만들기: 이름이나 이모지가 비면 만들지 않는다', () => {
  wipe();
  assert.equal(addCategory('', '🎵'), null);
  assert.equal(addCategory('   ', '🎵'), null);
  assert.equal(addCategory('취미', ''), null);
  assert.equal(addCategory('취미', '   '), null);
  assert.equal(allCategories().length, BUILTIN.length, '빈 값으로 만들어졌습니다');
});

test('내 분류 만들기: 같은 순간에 두 번 눌러도 id 가 겹치지 않는다', () => {
  wipe();
  const a = addCategory('가', '⭐');
  const b = addCategory('나', '🔥');
  assert.notEqual(a, b);
  assert.equal(allCategories().length, BUILTIN.length + 2);
});

test('내 분류 지우기', () => {
  wipe();
  const id = addCategory('취미', '🎵');
  assert.equal(removeCategory(id), true);
  assert.equal(isCategory(id), false);
  assert.equal(removeCategory(id), false, '두 번 지워졌습니다');
  // 기본 분류는 이 길로 지울 수 없습니다. (지우면 예전 계획의 분류가 끊어집니다)
  assert.equal(removeCategory('work'), false);
  assert.equal(isCategory('work'), true);
});

test('지운 분류로 저장된 계획도 화면이 비지 않는다', () => {
  wipe();
  const id = addCategory('취미', '🎵');
  removeCategory(id);
  assert.equal(emojiOf(id), emojiOf(DEFAULT_CATEGORY));
  assert.equal(isKnownCategory(id), false);
});

test('기본 분류의 이모지 바꾸기', () => {
  wipe();
  assert.equal(setCategoryEmoji('work', '🧑‍💻'), true);
  assert.equal(emojiOf('work'), '🧑‍💻');
  // 바꾼 값만 저장하므로 나머지는 그대로입니다.
  assert.equal(emojiOf('study'), BUILTIN.find((c) => c.id === 'study').emoji);
});

test('이모지 바꾸기: 여러 글자를 넣어도 한 글자만 남는다', () => {
  wipe();
  setCategoryEmoji('work', '🎵🎸🥁');
  assert.equal([...emojiOf('work')].length <= 8, true);
  assert.notEqual(emojiOf('work'), '🎵🎸🥁');

  // 여러 코드포인트가 붙어 한 글자로 보이는 이모지는 잘리면 안 됩니다.
  setCategoryEmoji('study', '👨‍👩‍👧');
  assert.equal(emojiOf('study'), '👨‍👩‍👧');
});

test('이모지 바꾸기: 빈 값은 무시한다', () => {
  wipe();
  const before = emojiOf('work');
  assert.equal(setCategoryEmoji('work', '   '), false);
  assert.equal(emojiOf('work'), before);
  assert.equal(setCategoryEmoji('없는분류', '⭐'), false);
});

test('기본 분류 숨기기와 되돌리기', () => {
  wipe();
  assert.equal(hideCategory('money'), true);
  assert.equal(isCategory('money'), false, '숨겼는데 아직 고를 수 있습니다');
  assert.equal(isKnownCategory('money'), true, '숨긴 것뿐인데 이모지까지 사라졌습니다');
  assert.equal(emojiOf('money'), '💰', '숨겨도 예전 계획의 이모지는 남아야 합니다');
  // 편집 화면에서는 숨긴 것도 보여야 다시 켤 수 있습니다.
  assert.ok(allCategoriesIncludingHidden().some((c) => c.id === 'money' && c.hidden));
  assert.equal(hideCategory('money', false), true);
  assert.equal(isCategory('money'), true);
});

test('기본 분류: 마지막 보루는 숨길 수 없다', () => {
  wipe();
  assert.equal(hideCategory(DEFAULT_CATEGORY), false);
  assert.equal(isCategory(DEFAULT_CATEGORY), true);
  assert.ok(allCategoriesIncludingHidden().some((c) => c.id === DEFAULT_CATEGORY && c.locked));
});

test('모두 숨겨도 고를 수 있는 분류가 남는다', () => {
  wipe();
  CATEGORY_IDS.forEach((id) => hideCategory(id));
  assert.ok(allCategories().length >= 1, '고를 수 있는 분류가 하나도 없습니다');
});

test('저장값이 망가져 있어도 던지지 않는다', () => {
  wipe();
  bag.set(KEY, '{이건 JSON 이 아닙니다');
  assert.doesNotThrow(() => allCategories());
  assert.equal(allCategories().length, BUILTIN.length);

  seed({ custom: '배열이 아님', emoji: 42, hidden: { a: 1 } });
  assert.equal(allCategories().length, BUILTIN.length);
});

test('저장값 정규화: 모양이 안 맞는 내 분류는 버린다', () => {
  wipe();
  seed({
    custom: [
      { id: 'u_ok', emoji: '🎵', label: '취미' },
      { id: 'work', emoji: '🎸', label: '가짜' },   // 기본 분류 id 를 가로채려는 것
      { id: 'u_noemoji', emoji: '', label: '이름만' },
      { id: 'u_nolabel', emoji: '⭐', label: '' },
      { id: 'u_ok', emoji: '🥁', label: '중복' },
      null,
      '문자열',
    ],
  });
  const mine = allCategories().filter((c) => !c.builtin);
  assert.deepEqual(mine.map((c) => c.id), ['u_ok']);
  assert.equal(mine[0].emoji, '🎵', '중복 항목이 앞의 것을 덮었습니다');
  assert.equal(emojiOf('work'), '💼', '기본 분류가 가짜 값으로 바뀌었습니다');
});

test('저장값 정규화: 없어진 기본 분류의 이모지 찌꺼기는 버린다', () => {
  wipe();
  seed({ emoji: { work: '🧑‍💻', 없어진분류: '👻' } });
  assert.equal(emojiOf('work'), '🧑‍💻');
  assert.doesNotThrow(() => allCategoriesIncludingHidden());
});

test('초기화: 전부 기본값으로 돌아온다', () => {
  wipe();
  addCategory('취미', '🎵');
  setCategoryEmoji('work', '🧑‍💻');
  hideCategory('money');
  resetCategories();
  assert.equal(allCategories().length, BUILTIN.length);
  assert.equal(emojiOf('work'), '💼');
  assert.equal(isCategory('money'), true);
});

test('바뀌면 구독자에게 알린다 (입력줄·편집판·달력이 같이 따라갑니다)', () => {
  wipe();
  let calls = 0;
  const off = onCategoryChange(() => { calls += 1; });
  addCategory('취미', '🎵');
  setCategoryEmoji('work', '🧑‍💻');
  hideCategory('money');
  assert.equal(calls, 3);
  off();
  addCategory('또', '⭐');
  assert.equal(calls, 3, '구독을 끊었는데도 불렸습니다');
});

test('구독자 하나가 던져도 나머지는 살아 있다', () => {
  wipe();
  let ok = 0;
  const offBad = onCategoryChange(() => { throw new Error('일부러'); });
  const offGood = onCategoryChange(() => { ok += 1; });
  assert.doesNotThrow(() => addCategory('취미', '🎵'));
  assert.equal(ok, 1);
  offBad(); offGood();
});

test('categoryOf 는 언제나 무언가를 돌려준다', () => {
  wipe();
  [null, undefined, 0, '', '없음', {}, []].forEach((bad) => {
    const got = categoryOf(bad);
    assert.ok(got && typeof got.emoji === 'string' && got.emoji.length > 0,
      `${String(bad)} 에서 빈 값이 나왔습니다`);
  });
});
