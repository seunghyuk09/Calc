import test from 'node:test';
import assert from 'node:assert/strict';
import { keyOf, dateOf, shift, label, weekRange, isoWeekParts, isCurrent } from '../public/js/lib/period.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('기간 키 생성', () => {
  assert.equal(keyOf('day', d(2026, 9, 14)), '2026-09-14');
  assert.equal(keyOf('month', d(2026, 9, 14)), '2026-09');
  assert.equal(keyOf('year', d(2026, 9, 14)), '2026');
  assert.equal(keyOf('week', d(2026, 9, 14)), '2026-W38');
});

// ISO 8601 주차의 까다로운 경계들. Python datetime.date.isocalendar() 와 대조한 값입니다.
test('ISO 주차 경계', () => {
  const cases = [
    [d(2020, 12, 31), '2020-W53'], // 연말이 전년도 주차
    [d(2021, 1, 1), '2020-W53'],
    [d(2021, 1, 4), '2021-W01'],
    [d(2025, 12, 29), '2026-W01'], // 연초가 다음해 1주차
    [d(2026, 1, 1), '2026-W01'],
    [d(2016, 1, 3), '2015-W53'],
    [d(2024, 12, 30), '2025-W01'],
    [d(2023, 1, 1), '2022-W52'],
  ];
  for (const [date, expected] of cases) {
    assert.equal(keyOf('week', date), expected, `${date.toDateString()} 의 주차`);
  }
});

test('주차 연도는 그 주 목요일이 속한 해', () => {
  assert.deepEqual(isoWeekParts(d(2021, 1, 1)), { year: 2020, week: 53 });
  assert.deepEqual(isoWeekParts(d(2026, 9, 14)), { year: 2026, week: 38 });
});

test('키에서 날짜로 되돌리기', () => {
  assert.equal(keyOf('day', dateOf('day', '2026-09-14')), '2026-09-14');
  assert.equal(keyOf('week', dateOf('week', '2026-W38')), '2026-W38');
  assert.equal(keyOf('month', dateOf('month', '2026-09')), '2026-09');
  assert.equal(keyOf('year', dateOf('year', '2026')), '2026');
  // 주의 대표 날짜는 월요일이어야 함
  assert.equal(dateOf('week', '2026-W38').getDay(), 1);
});

test('잘못된 키는 예외', () => {
  assert.throws(() => dateOf('day', '2026-9-14'), /잘못된 day 키/);
  assert.throws(() => dateOf('week', '2026-38'), /잘못된 week 키/);
  assert.throws(() => keyOf('decade', new Date()), /알 수 없는 단위/);
});

test('기간 이동 — 연말 경계 포함', () => {
  assert.equal(shift('day', '2026-12-31', 1), '2027-01-01');
  assert.equal(shift('day', '2026-01-01', -1), '2025-12-31');
  assert.equal(shift('week', '2026-W01', -1), '2025-W52');
  assert.equal(shift('week', '2020-W53', 1), '2021-W01');
  assert.equal(shift('month', '2026-12', 1), '2027-01');
  assert.equal(shift('month', '2026-01', -1), '2025-12');
  assert.equal(shift('year', '2026', 1), '2027');
});

test('기간 이동 왕복은 제자리', () => {
  for (const [scope, key] of [['day', '2026-09-14'], ['week', '2026-W38'], ['month', '2026-09'], ['year', '2026']]) {
    assert.equal(shift(scope, shift(scope, key, 1), -1), key, `${scope} 왕복`);
  }
});

test('월 이동 시 말일 넘침 없음', () => {
  // 1월 31일에서 한 달 뒤가 3월로 튀면 안 됩니다. (대표 날짜가 1일이므로 안전)
  assert.equal(shift('month', '2026-01', 1), '2026-02');
  assert.equal(shift('month', '2026-03', -1), '2026-02');
});

test('표시 이름 — 영문 (기본값)', () => {
  assert.equal(label('day', '2026-09-14'), 'Mon, Sep 14, 2026');
  assert.equal(label('month', '2026-09'), 'Sep 2026');
  assert.equal(label('year', '2026'), '2026');
  assert.equal(label('week', '2026-W38'), 'Week 38, 2026 · Sep 14–20');
  // 달을 걸치는 주
  assert.match(label('week', '2026-W01'), /Dec 29 – Jan 4/);
});

test('표시 이름 — 한국어', () => {
  assert.equal(label('day', '2026-09-14', 'ko'), '2026년 9월 14일 (월)');
  assert.equal(label('month', '2026-09', 'ko'), '2026년 9월');
  assert.equal(label('year', '2026', 'ko'), '2026년');
  assert.equal(label('week', '2026-W38', 'ko'), '2026년 38주차 · 9월 14–20일');
  assert.equal(label('week', '2026-W01', 'ko'), '2026년 1주차 · 12월 29일 – 1월 4일');
});

test('요일 표기가 한/영 모두 정확', () => {
  // 2026-09-14 는 월요일, 2026-09-20 은 일요일
  assert.match(label('day', '2026-09-14', 'ko'), /\(월\)$/);
  assert.match(label('day', '2026-09-20', 'ko'), /\(일\)$/);
  assert.match(label('day', '2026-09-14'), /^Mon,/);
  assert.match(label('day', '2026-09-20'), /^Sun,/);
});

test('현재 기간 판별', () => {
  const now = new Date();
  for (const scope of ['day', 'week', 'month', 'year']) {
    assert.equal(isCurrent(scope, keyOf(scope, now)), true, `${scope} 현재`);
  }
  assert.equal(isCurrent('year', '1999'), false);
});

test('주 표기는 ISO 연도를 포함해 다른 해와 구분됨', () => {
  // 연도가 없으면 2020-W53 과 2026-W53 이 같은 문자열이 되어 구분이 불가능했습니다.
  const a = label('week', '2020-W53', 'ko');
  const b = label('week', '2026-W53', 'ko');
  assert.notEqual(a, b, '다른 해의 같은 주차가 같은 문자열이면 안 됩니다');
  assert.match(a, /^2020년 53주차/);
  assert.match(b, /^2026년 53주차/);
  // 연말에 걸친 주는 달력 연도가 아니라 ISO 연도를 써야 합니다 (2025-12-29 는 2026-W01)
  assert.match(label('week', '2026-W01', 'ko'), /^2026년 1주차/);
  assert.match(label('week', '2026-W01', 'en'), /^Week 1, 2026/);
});

/*
 * 달력을 한 줄로 접으면 자리가 좁아서 '2026년 38주차 · ' 앞머리가 통째로 잘립니다.
 * 며칠 주간인지가 안 보이면 접는 의미가 없으므로 범위만 따로 뽑아 씁니다.
 */
test('weekRange: 같은 달 안의 주', () => {
  assert.equal(weekRange('2026-W38', 'ko'), '9월 14–20일');
  assert.equal(weekRange('2026-W38', 'en'), 'Sep 14–20');
});

test('weekRange: 달을 걸친 주', () => {
  // 2026-W40 은 9월 28일(월) ~ 10월 4일(일)
  assert.equal(weekRange('2026-W40', 'ko'), '9월 28일 – 10월 4일');
  assert.equal(weekRange('2026-W40', 'en'), 'Sep 28 – Oct 4');
});

test('weekRange 는 label 의 뒷부분과 정확히 같다 (두 곳이 어긋나면 안 됩니다)', () => {
  for (const key of ['2026-W01', '2026-W38', '2026-W40', '2026-W53']) {
    for (const lang of ['ko', 'en']) {
      const full = label('week', key, lang);
      assert.ok(full.endsWith(weekRange(key, lang)),
        `${lang} ${key}: "${full}" 가 "${weekRange(key, lang)}" 로 끝나지 않습니다`);
    }
  }
});
