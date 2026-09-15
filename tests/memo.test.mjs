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

const { wrapLines } = await import('../public/js/modules/memo.js');

/*
 * 줄바꿈은 캔버스 폭 계산에 달려 있는데, 캔버스는 노드에 없습니다.
 * 그래서 '글자 폭을 재는 함수'를 밖에서 넣도록 만들어 두었고, 여기서는 가짜 자를 씁니다.
 *
 * 한 글자 = 10px 로 두면 기대값을 손으로 셀 수 있습니다.
 * 한국어와 영어 글자 폭이 실제로는 다르지만, 자르는 규칙 자체는 폭과 무관합니다.
 */
const ruler = (per = 10) => (text) => [...text].length * per;

test('짧은 글은 그대로 한 줄', () => {
  assert.deepEqual(wrapLines(ruler(), '안녕', 100), ['안녕']);
});

test('줄바꿈 문자는 그대로 줄을 나눈다', () => {
  assert.deepEqual(wrapLines(ruler(), '가\n나\n다', 100), ['가', '나', '다']);
});

test('빈 줄도 살려 둔다 (문단 사이 간격이 사라지면 안 됩니다)', () => {
  assert.deepEqual(wrapLines(ruler(), '가\n\n나', 100), ['가', '', '나']);
});

test('한국어는 공백이 없어도 폭에 맞춰 끊긴다', () => {
  // 한 글자 10px, 폭 50px -> 다섯 글자마다 끊깁니다.
  assert.deepEqual(wrapLines(ruler(), '가나다라마바사아자차', 50),
    ['가나다라마', '바사아자차']);
});

test('영어는 단어 가운데가 아니라 공백에서 끊긴다', () => {
  // 폭 80px = 여덟 글자. 'hello world' 는 'hello' 에서 끊겨야 읽힙니다.
  assert.deepEqual(wrapLines(ruler(), 'hello world', 80), ['hello', 'world']);
});

test('한 단어가 한 줄보다 길면 그 안에서라도 끊는다 (무한 루프 금지)', () => {
  const out = wrapLines(ruler(), 'abcdefghij', 30);
  assert.ok(out.length >= 3, `끊기지 않았습니다: ${JSON.stringify(out)}`);
  assert.equal(out.join(''), 'abcdefghij', '글자가 사라지거나 늘었습니다');
});

test('끊은 뒤에도 글자는 하나도 사라지지 않는다', () => {
  const text = '회의 결론 예산 삼천만원 확정 다음회의는구월이십이일입니다 담당 김대리';
  const out = wrapLines(ruler(), text, 70);
  // 줄 끝의 공백만 없어질 수 있으므로 공백을 빼고 비교합니다.
  assert.equal(out.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  out.forEach((line) => {
    assert.ok(ruler()(line) <= 70 || [...line].length === 1,
      `한 줄이 폭을 넘었습니다: "${line}" (${ruler()(line)}px)`);
  });
});

test('여러 문단이 섞여도 각 문단이 따로 접힌다', () => {
  const out = wrapLines(ruler(), '가나다라마바\nhello world', 50);
  assert.deepEqual(out, ['가나다라마', '바', 'hello', 'world']);
});

test('빈 값과 이상한 값도 던지지 않는다', () => {
  assert.deepEqual(wrapLines(ruler(), '', 100), ['']);
  assert.deepEqual(wrapLines(ruler(), null, 100), ['']);
  assert.deepEqual(wrapLines(ruler(), undefined, 100), ['']);
  assert.doesNotThrow(() => wrapLines(ruler(), '가나다', 0));
});

test('폭이 0 이어도 끝난다 (한 글자씩이라도 내놓습니다)', () => {
  const out = wrapLines(ruler(), '가나다', 0);
  assert.equal(out.join(''), '가나다');
});

test('이모지가 쪼개지지 않는다', () => {
  // 코드포인트 단위로 도는지 확인합니다. surrogate pair 가 반쪽 나면 글자가 깨집니다.
  const out = wrapLines(ruler(), '👨‍👩‍👧가나다라마바사', 50);
  assert.ok(out.every((line) => !/[\uD800-\uDBFF]$/.test(line)),
    `줄 끝에서 이모지가 쪼개졌습니다: ${JSON.stringify(out)}`);
  assert.equal(out.join(''), '👨‍👩‍👧가나다라마바사');
});
