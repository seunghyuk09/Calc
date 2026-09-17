import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를, dom.js 가 document 를 참조하므로 import 전에 가짜를 세웁니다.
const bag = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: (k) => bag.delete(k),
  },
  location: { protocol: 'http:' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, append() {}, appendChild() {},
  }),
};

const { normalizeTime, minutesOf, sortDayRows, hoursToShow } = await import('../public/js/modules/todo.js');

/*
 * 하루 안의 시각.
 *
 * 저장 형식은 'HH:MM' 24시간제입니다. <input type="time"> 이 주는 값과 같아
 * 변환 없이 오갑니다. 비어 있으면 '종일' 이고, 종일이 언제나 맨 위에 옵니다.
 * (Google 캘린더와 Todoist 의 하루 보기가 같은 차례입니다)
 */

test('제대로 된 시각은 그대로 통과', () => {
  ['00:00', '07:05', '12:30', '23:59'].forEach((v) => {
    assert.equal(normalizeTime(v), v, v);
  });
});

test('자리를 덜 채운 값도 받아 준다', () => {
  assert.equal(normalizeTime('9:5'), '09:05');
  assert.equal(normalizeTime('9:05'), '09:05');
  assert.equal(normalizeTime('09:5'), '09:05');
  assert.equal(normalizeTime(' 7:00 '), '07:00');
});

test('시각이 아닌 값은 null', () => {
  ['', '  ', '24:00', '23:60', '25:10', '9', '9:', ':30', '오전 9시', '09-30', 'abc']
    .forEach((v) => assert.equal(normalizeTime(v), null, JSON.stringify(v)));
});

test('문자열이 아닌 값도 던지지 않고 null', () => {
  [null, undefined, 0, 930, {}, [], true].forEach((v) => {
    assert.doesNotThrow(() => normalizeTime(v));
    assert.equal(normalizeTime(v), null, String(v));
  });
});

test('정렬값: 종일은 -1 이라 언제나 맨 위', () => {
  assert.equal(minutesOf({ time: '00:00' }), 0);
  assert.equal(minutesOf({ time: '07:30' }), 450);
  assert.equal(minutesOf({ time: '23:59' }), 1439);
  assert.equal(minutesOf({}), -1);
  assert.equal(minutesOf({ time: '' }), -1);
  assert.equal(minutesOf(null), -1);
  assert.equal(minutesOf({ time: '엉터리' }), -1, '망가진 값은 종일로 봅니다');
});

test('하루 정렬: 종일이 먼저, 그다음 이른 시각부터', () => {
  const rows = [
    { id: 'c', time: '18:30' },
    { id: 'a', time: '07:00' },
    { id: 'z' },
    { id: 'b', time: '12:00' },
  ];
  assert.deepEqual(sortDayRows(rows).map((x) => x.id), ['z', 'a', 'b', 'c']);
});

test('같은 시각이면 원래 차례를 지킨다 (넣은 순서가 뒤집히면 안 됩니다)', () => {
  const rows = [
    { id: '1', time: '09:00' },
    { id: '2', time: '09:00' },
    { id: '3', time: '09:00' },
  ];
  assert.deepEqual(sortDayRows(rows).map((x) => x.id), ['1', '2', '3']);
});

test('종일이 여러 개여도 자기들끼리의 차례는 지킨다', () => {
  const rows = [{ id: 'x' }, { id: 'y' }, { id: 'w', time: '08:00' }, { id: 'z' }];
  assert.deepEqual(sortDayRows(rows).map((x) => x.id), ['x', 'y', 'z', 'w']);
});

test('정렬이 원본 배열을 건드리지 않는다', () => {
  const rows = [{ id: 'b', time: '10:00' }, { id: 'a', time: '08:00' }];
  const before = rows.map((x) => x.id).join(',');
  sortDayRows(rows);
  assert.equal(rows.map((x) => x.id).join(','), before, '원본이 뒤집혔습니다');
});

test('빈 목록과 항목 하나도 던지지 않는다', () => {
  assert.deepEqual(sortDayRows([]), []);
  assert.deepEqual(sortDayRows([{ id: 'a' }]).map((x) => x.id), ['a']);
});

test('자정과 하루 끝이 제자리에 온다 (경계)', () => {
  const rows = [{ id: '밤', time: '23:59' }, { id: '자정', time: '00:00' }, { id: '종일' }];
  assert.deepEqual(sortDayRows(rows).map((x) => x.id), ['종일', '자정', '밤']);
});

/*
 * 시간대 보기가 그릴 시간 줄.
 *
 * 기본 범위는 06~22 시입니다. 그런데 지금이 그 밖(새벽 3시)이면 '지금' 줄이
 * 아예 안 그려져서, 지금 뭘 넣을 자리가 화면에 없었습니다.
 * 지금 시각은 범위와 상관없이 늘 들어가야 합니다.
 */

/*
 * 보여 줄 시간 목록.
 *
 * 예전에는 06~22 시를 늘 깔아 두고 열 때마다 지금 시각으로 화면을 끌어내렸습니다.
 * 빈 줄 열일곱 개를 지나야 했고, 읽던 자리가 저 혼자 움직였습니다.
 * 이제 기본은 '일정이 있는 시각만' 이고, 빈 시간에 넣고 싶을 때만 전부 펼칩니다.
 */

test('시간대 보기: 기본은 일정이 있는 시각만', () => {
  assert.deepEqual(hoursToShow([]), [], '아무것도 없으면 줄도 없습니다');
  assert.deepEqual(
    hoursToShow([{ scope: 'day', time: '09:30' }, { scope: 'day', time: '14:00' }]),
    [9, 14],
  );
});

test('시간대 보기: 기본 범위라는 게 없다 (06~22시를 깔지 않는다)', () => {
  // 예전 규칙이 되살아나면 여기서 잡힙니다.
  assert.equal(hoursToShow([]).length, 0);
  assert.deepEqual(hoursToShow([{ scope: 'day', time: '12:00' }]), [12]);
});

test('시간대 보기: 이른 시간·늦은 시간도 일정이 있으면 나온다', () => {
  const hours = hoursToShow([{ scope: 'day', time: '02:30' }, { scope: 'day', time: '23:00' }]);
  assert.deepEqual(hours, [2, 23]);
});

test('시간대 보기: 전부 펼치면 스물네 줄', () => {
  const hours = hoursToShow([], true);
  assert.equal(hours.length, 24);
  assert.equal(hours[0], 0);
  assert.equal(hours[23], 23);
});

test('시간대 보기: 전부 펼쳐도 순서는 이른 시각부터', () => {
  const hours = hoursToShow([{ scope: 'day', time: '23:00' }], true);
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b));
});

test('시간대 보기: 같은 시간이 두 번 들어가지 않는다', () => {
  const hours = hoursToShow([{ scope: 'day', time: '03:00' }, { scope: 'day', time: '03:45' }]);
  assert.deepEqual(hours, [3], '한 시간 안에 둘이 있어도 줄은 하나');
});
