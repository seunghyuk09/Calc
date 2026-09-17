import test from 'node:test';
import assert from 'node:assert/strict';

// session.js 는 브라우저 전역을 건드리지 않습니다. 그대로 불러옵니다.
const { awayTooLong, startTab, AWAY_RESET_MS } = await import('../public/js/lib/session.js');

const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 8, 17, 9, 0, 0);
const TABS = ['today', 'calc', 'weather', 'todo', 'time', 'memo', 'quote', 'ai', 'settings'];

/*
 * '앱을 열면 계속 있던 탭에 있다' 는 지적에서 나온 규칙입니다.
 * 10분 넘게 떠나 있었으면 마지막 탭을 버리고 처음 화면으로 엽니다.
 */

test('기준은 10분', () => {
  assert.equal(AWAY_RESET_MS, 10 * 60 * 1000);
});

test('10분을 넘겨야 오래 비운 것으로 본다', () => {
  assert.equal(awayTooLong(NOW - 9 * MIN, NOW), false, '9분');
  assert.equal(awayTooLong(NOW - 10 * MIN, NOW), false, '딱 10분은 아직 아님');
  assert.equal(awayTooLong(NOW - 10 * MIN - 1, NOW), true, '10분 + 1ms');
  assert.equal(awayTooLong(NOW - 11 * MIN, NOW), true, '11분');
  assert.equal(awayTooLong(NOW - 26 * 60 * MIN, NOW), true, '하루');
});

test('기록이 없으면 오래 비운 것으로 보지 않는다 (처음 쓰는 경우)', () => {
  [0, null, undefined, '', NaN, -1].forEach((v) => {
    assert.equal(awayTooLong(v, NOW), false, String(v));
  });
});

test('기기 시계가 뒤로 가도 화면을 멋대로 바꾸지 않는다', () => {
  // 시간대를 바꾸거나 시계를 되돌리면 '미래에 마지막으로 봤다' 가 됩니다.
  assert.equal(awayTooLong(NOW + 60 * MIN, NOW), false);
});

test('잠깐 비웠으면 보던 탭 그대로', () => {
  assert.equal(startTab({ saved: 'calc', lastSeen: NOW - MIN, tabs: TABS, home: 'today', now: NOW }), 'calc');
});

test('오래 비웠으면 처음 화면으로', () => {
  assert.equal(startTab({ saved: 'calc', lastSeen: NOW - 11 * MIN, tabs: TABS, home: 'today', now: NOW }), 'today');
});

test('처음 쓰는 사람은 처음 화면으로', () => {
  assert.equal(startTab({ saved: undefined, lastSeen: 0, tabs: TABS, home: 'today', now: NOW }), 'today');
});

test("'오늘' 을 숨겨 뒀으면 남아 있는 첫 탭으로", () => {
  const hidden = ['calc', 'memo', 'settings'];
  assert.equal(startTab({ saved: 'memo', lastSeen: NOW - 11 * MIN, tabs: hidden, home: 'today', now: NOW }), 'calc');
  // 잠깐 비운 경우엔 숨기지 않은 마지막 탭을 그대로 씁니다.
  assert.equal(startTab({ saved: 'memo', lastSeen: NOW - MIN, tabs: hidden, home: 'today', now: NOW }), 'memo');
});

test('숨겨진 탭이 마지막 탭으로 남아 있으면 처음 화면으로', () => {
  // 설정에서 보던 탭을 꺼 버린 경우. 빈 화면이 남으면 안 됩니다.
  assert.equal(startTab({ saved: 'quote', lastSeen: NOW - MIN, tabs: ['today', 'calc'], home: 'today', now: NOW }), 'today');
});

test('탭 목록이 비어 있어도 던지지 않는다', () => {
  assert.doesNotThrow(() => startTab({ saved: 'calc', lastSeen: 0, tabs: [], home: 'today', now: NOW }));
  assert.equal(startTab({ saved: 'calc', lastSeen: 0, tabs: [], home: 'today', now: NOW }), 'today');
  assert.equal(startTab({ saved: 'calc', lastSeen: 0, tabs: null, home: 'today', now: NOW }), 'today');
});
