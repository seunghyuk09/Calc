import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를 참조하므로 import 전에 최소한의 전역을 만들어 둡니다.
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { protocol: 'http:' },
};
// calendar.js 가 dom.js 를 거쳐 document 를 건드리므로 최소한만 흉내 냅니다.
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };

const { monthGrid, weekRow, groupByDay, dayKey } = await import('../public/js/modules/calendar.js');
const { emojiOf, isCategory, CATEGORY_IDS } = await import('../public/js/lib/categories.js');
const { daysOfWeek } = await import('../public/js/modules/todo.js');

const item = (over = {}) => ({
  id: over.id ?? 'x', text: over.text ?? '할 일', done: over.done ?? false,
  scope: over.scope ?? 'day', period: over.period ?? '2026-09-15',
  category: over.category ?? 'work',
});

test('dayKey: 로컬 시간대 기준 YYYY-MM-DD', () => {
  assert.equal(dayKey(new Date(2026, 8, 15)), '2026-09-15');
  assert.equal(dayKey(new Date(2026, 0, 1)), '2026-01-01');
  // UTC 로 바꾸면 시간대에 따라 하루가 밀립니다. 로컬 기준이어야 합니다.
  assert.equal(dayKey(new Date(2026, 11, 31, 23, 30)), '2026-12-31');
});

/*
 * 한 주는 일요일에서 시작합니다.
 * 달력의 한 줄과 계획표의 '주간' 단위가 정확히 겹쳐야 '이번 주'를 한 줄로 강조할 수 있어서,
 * 둘 다 일요일 시작으로 맞춰 두었습니다. 한쪽만 바꾸면 한 주가 두 줄에 걸쳐 끊깁니다.
 */
test('monthGrid: 일요일에서 시작해 토요일에서 끝난다', () => {
  const grid = monthGrid(new Date(2026, 8, 1)); // 2026-09
  assert.equal(grid[0].getDay(), 0, '첫 칸이 일요일이 아닙니다');
  assert.equal(grid[grid.length - 1].getDay(), 6, '마지막 칸이 토요일이 아닙니다');
  assert.equal(grid.length % 7, 0, '칸 수가 7의 배수가 아닙니다');
});

test('monthGrid: 모든 줄이 일요일에서 시작한다 (주 강조가 한 줄에 들어가야 합니다)', () => {
  for (let m = 0; m < 12; m += 1) {
    const grid = monthGrid(new Date(2026, m, 1));
    for (let i = 0; i < grid.length; i += 7) {
      assert.equal(grid[i].getDay(), 0, `${2026}-${m + 1} 의 ${i / 7 + 1}번째 줄이 일요일로 시작하지 않습니다`);
    }
  }
});

test('weekRow: 기준 날짜가 든 주의 일요일부터 7칸', () => {
  const row = weekRow(new Date(2026, 8, 17));   // 목요일
  assert.equal(row.length, 7);
  assert.equal(dayKey(row[0]), '2026-09-13');   // 일
  assert.equal(dayKey(row[6]), '2026-09-19');   // 토
  assert.ok(row.map(dayKey).includes('2026-09-17'));
});

test('weekRow 와 daysOfWeek 가 같은 주를 가리킨다 (달력과 목록이 어긋나면 안 됩니다)', () => {
  // 달력 한 줄(weekRow)과 목록이 묶는 7일(daysOfWeek)이 정확히 같아야 합니다.
  const fromCal = weekRow(new Date(2026, 8, 17)).map(dayKey);
  const fromTodo = daysOfWeek('2026-W38');
  assert.deepEqual(fromCal, fromTodo);
});

test('daysOfWeek: 연말에 걸친 주도 7일을 준다', () => {
  // 2026-W52 는 12월 20일(일)~26일(토), 그다음 주가 해를 넘깁니다.
  for (const key of ['2026-W52', '2026-W53', '2027-W01']) {
    const week = daysOfWeek(key);
    assert.equal(week.length, 7, `${key} 가 7일이 아닙니다`);
    assert.equal(new Set(week).size, 7, `${key} 에 같은 날짜가 두 번 들어 있습니다`);
  }
});

test('monthGrid: 해당 달의 모든 날짜를 담는다', () => {
  for (const month of [0, 1, 5, 11]) {
    const grid = monthGrid(new Date(2026, month, 1));
    const keys = new Set(grid.map(dayKey));
    const last = new Date(2026, month + 1, 0).getDate();
    for (let d = 1; d <= last; d += 1) {
      assert.ok(keys.has(dayKey(new Date(2026, month, d))),
        `${2026}-${month + 1}-${d} 이 달력에 없습니다`);
    }
  }
});

test('monthGrid: 윤년 2월도 빠짐없이 담는다', () => {
  const grid = monthGrid(new Date(2028, 1, 1)); // 2028 은 윤년
  assert.ok(grid.map(dayKey).includes('2028-02-29'), '2월 29일이 빠졌습니다');
});

test('monthGrid: 어떤 달도 42칸을 넘지 않는다', () => {
  for (let y = 2024; y <= 2030; y += 1) {
    for (let m = 0; m < 12; m += 1) {
      assert.ok(monthGrid(new Date(y, m, 1)).length <= 42, `${y}-${m + 1} 이 42칸을 넘었습니다`);
    }
  }
});

test('groupByDay: 일간 항목만 날짜별로 모은다', () => {
  const map = groupByDay([
    item({ id: 'a', period: '2026-09-15' }),
    item({ id: 'b', period: '2026-09-15' }),
    item({ id: 'c', period: '2026-09-16' }),
    item({ id: 'w', scope: 'week', period: '2026-W38' }),
    item({ id: 'm', scope: 'month', period: '2026-09' }),
  ]);
  assert.deepEqual(map.get('2026-09-15').map((i) => i.id), ['a', 'b']);
  assert.deepEqual(map.get('2026-09-16').map((i) => i.id), ['c']);
  assert.equal(map.has('2026-W38'), false, '주간 항목이 달력에 올라왔습니다');
  assert.equal(map.has('2026-09'), false, '월간 항목이 달력에 올라왔습니다');
});

test('groupByDay: 망가진 항목이 있어도 던지지 않는다', () => {
  const map = groupByDay([
    null,
    undefined,
    { scope: 'day' },                       // period 없음
    { scope: 'day', period: 123 },          // period 가 문자열이 아님
    { scope: 'day', period: '2026-09-15' }, // text 없음
    item({ id: 'ok' }),
  ]);
  assert.deepEqual(map.get('2026-09-15').map((i) => i.id), ['ok']);
});

test('groupByDay: 빈 입력이면 빈 맵', () => {
  assert.equal(groupByDay([]).size, 0);
});

test('분류: 모르는 값은 기본 분류로 떨어진다', () => {
  assert.equal(emojiOf('없는분류'), emojiOf('etc'));
  assert.equal(emojiOf(undefined), emojiOf('etc'));
  assert.equal(isCategory('없는분류'), false);
  assert.equal(isCategory('work'), true);
});

test('분류: 이모지가 서로 겹치지 않는다 (달력에서 구분이 안 됩니다)', () => {
  const emojis = CATEGORY_IDS.map(emojiOf);
  assert.equal(new Set(emojis).size, emojis.length, `중복: ${emojis.join(' ')}`);
});
