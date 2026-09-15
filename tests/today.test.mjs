import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를 참조하므로 import 전에 최소한의 전역을 만들어 둡니다.
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { protocol: 'http:' },
};

const { todayRows, maxRotateIndex } = await import('../public/js/modules/today.js');
const { keyOf } = await import('../public/js/lib/period.js');

const item = (over = {}) => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  text: over.text ?? '할 일',
  done: over.done ?? false,
  scope: over.scope ?? 'day',
  period: over.period ?? keyOf(over.scope ?? 'day'),
});

test('오늘 목록: 미완료이면서 현재 기간인 항목만 고른다', () => {
  const rows = todayRows([
    item({ id: 'a', text: '오늘 할 일' }),
    item({ id: 'b', text: '끝낸 일', done: true }),
    item({ id: 'c', text: '지난 날', period: '2000-01-01' }),
    item({ id: 'd', text: '이번 주', scope: 'week' }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['a', 'd']);
});

test('오늘 목록: 짧은 주기가 먼저 온다 (일 → 주 → 월 → 연)', () => {
  const rows = todayRows([
    item({ id: 'y', scope: 'year' }),
    item({ id: 'm', scope: 'month' }),
    item({ id: 'd', scope: 'day' }),
    item({ id: 'w', scope: 'week' }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['d', 'w', 'm', 'y']);
});

test('오늘 목록: 망가진 항목이 있어도 던지지 않는다', () => {
  // localStorage 가 손상되면 null 이나 이상한 scope 가 섞여 들어올 수 있습니다.
  const rows = todayRows([
    null,
    undefined,
    { text: '스코프 없음', done: false },
    item({ id: 'ok' }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['ok']);
});

test('오늘 목록: 완료 항목만 있으면 빈 배열', () => {
  const rows = todayRows([item({ done: true }), item({ done: true })]);
  assert.deepEqual(rows, []);
});

test('순환 최대 위치: 보이는 개수보다 적으면 순환하지 않는다', () => {
  assert.equal(maxRotateIndex(0, 3), 0);
  assert.equal(maxRotateIndex(1, 3), 0);
  assert.equal(maxRotateIndex(3, 3), 0);
});

test('순환 최대 위치: 넘치는 만큼만 굴린다', () => {
  assert.equal(maxRotateIndex(4, 3), 1);
  assert.equal(maxRotateIndex(10, 3), 7);
  // 마지막 위치에서도 화면이 가득 차야 합니다. 안 그러면 빈 칸이 보입니다.
  const count = 10;
  const visible = 3;
  assert.equal(maxRotateIndex(count, visible) + visible, count);
});

test('순환 최대 위치: 음수가 나오지 않는다', () => {
  assert.equal(maxRotateIndex(-5, 3), 0);
});
