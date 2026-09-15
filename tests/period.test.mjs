import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyOf, dateOf, shift, label, weekRange, weekParts, weekStart, fromLegacyIsoWeek, isCurrent,
} from '../public/js/lib/period.js';

const d = (y, m, day) => new Date(y, m - 1, day);

test('기간 키 생성', () => {
  assert.equal(keyOf('day', d(2026, 9, 14)), '2026-09-14');
  assert.equal(keyOf('month', d(2026, 9, 14)), '2026-09');
  assert.equal(keyOf('year', d(2026, 9, 14)), '2026');
  assert.equal(keyOf('week', d(2026, 9, 16)), '2026-W38');
});

/*
 * 주차 경계.
 * 한 주는 일요일 시작이고, 1월 1일이 든 주가 그 해 1주차입니다.
 * 기대값은 구현에서 뽑은 것이 아니라 같은 규칙을 파이썬으로 따로 구현해 계산한 값입니다.
 * (구현에서 뽑으면 자기 자신을 검증하는 꼴이 됩니다)
 */
test('주차 경계 (일요일 시작, 1월 1일이 든 주가 1주차)', () => {
  const cases = [
    [d(2026, 9, 13), '2026-W38'],  // 일요일 — 주의 첫날
    [d(2026, 9, 19), '2026-W38'],  // 토요일 — 주의 끝날
    [d(2026, 9, 20), '2026-W39'],  // 다음 일요일부터 다음 주
    [d(2025, 12, 27), '2025-W52'],
    [d(2025, 12, 28), '2026-W01'], // 1월 1일이 든 주 -> 다음 해 1주차
    [d(2026, 1, 1), '2026-W01'],
    [d(2020, 12, 31), '2021-W01'],
    [d(2021, 1, 1), '2021-W01'],
    [d(2016, 1, 3), '2016-W02'],
    [d(2024, 12, 30), '2025-W01'],
    [d(2026, 12, 26), '2026-W52'],
    [d(2026, 12, 31), '2027-W01'],
  ];
  for (const [date, expected] of cases) {
    assert.equal(keyOf('week', date), expected, `${date.toDateString()} 의 주차`);
  }
});

test('주차 연도는 1월 1일을 품은 쪽', () => {
  assert.deepEqual(weekParts(d(2021, 1, 1)), { year: 2021, week: 1 });
  assert.deepEqual(weekParts(d(2026, 9, 16)), { year: 2026, week: 38 });
});

test('키에서 날짜로 되돌리기', () => {
  assert.equal(keyOf('day', dateOf('day', '2026-09-14')), '2026-09-14');
  assert.equal(keyOf('week', dateOf('week', '2026-W38')), '2026-W38');
  assert.equal(keyOf('month', dateOf('month', '2026-09')), '2026-09');
  assert.equal(keyOf('year', dateOf('year', '2026')), '2026');
  // 주의 대표 날짜는 월요일이어야 함
  assert.equal(dateOf('week', '2026-W38').getDay(), 0);   // 0 = 일요일
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
  assert.equal(shift('week', '2020-W52', 1), '2021-W01');
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
  assert.equal(label('week', '2026-W38'), 'Week 38, 2026 · Sep 13–19');
  // 달을 걸치는 주
  assert.match(label('week', '2026-W01'), /Dec 28 – Jan 3/);
});

test('표시 이름 — 한국어', () => {
  assert.equal(label('day', '2026-09-14', 'ko'), '2026년 9월 14일 (월)');
  assert.equal(label('month', '2026-09', 'ko'), '2026년 9월');
  assert.equal(label('year', '2026', 'ko'), '2026년');
  assert.equal(label('week', '2026-W38', 'ko'), '2026년 38주차 · 9월 13–19일');
  assert.equal(label('week', '2026-W01', 'ko'), '2026년 1주차 · 12월 28일 – 1월 3일');
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
  assert.equal(weekRange('2026-W38', 'ko'), '9월 13–19일');
  assert.equal(weekRange('2026-W38', 'en'), 'Sep 13–19');
});

test('weekRange: 달을 걸친 주', () => {
  // 2026-W40 은 9월 27일(일) ~ 10월 3일(토)
  assert.equal(weekRange('2026-W40', 'ko'), '9월 27일 – 10월 3일');
  assert.equal(weekRange('2026-W40', 'en'), 'Sep 27 – Oct 3');
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

/*
 * 왕복: 어떤 날짜든 '키 -> 그 주 일요일 -> 키' 가 제자리로 돌아와야 합니다.
 * 같은 규칙을 파이썬으로 따로 구현해 2015~2030 전 날짜를 돌려 봤을 때 어긋나는 날이 없었습니다.
 * 여기서도 같은 범위를 확인합니다. 연말연시 경계가 해마다 다르게 걸립니다.
 */
test('주차 왕복: 2015~2030 모든 날이 제자리로 돌아온다', () => {
  const walk = new Date(2015, 0, 1);
  const end = new Date(2030, 11, 31);
  let checked = 0;
  while (walk <= end) {
    const key = keyOf('week', walk);
    const back = dateOf('week', key);
    assert.equal(keyOf('week', back), key, `${walk.toDateString()} 의 키 ${key} 가 왕복에서 어긋났습니다`);
    assert.equal(back.getTime(), weekStart(walk).getTime(),
      `${walk.toDateString()} 의 주 시작일이 어긋났습니다`);
    assert.equal(back.getDay(), 0, `${key} 의 시작이 일요일이 아닙니다`);
    checked += 1;
    walk.setDate(walk.getDate() + 1);
  }
  assert.ok(checked > 5800, `검사한 날이 너무 적습니다 (${checked})`);
});

/*
 * 예전 ISO 키(월요일 시작)에서 지금 키(일요일 시작)로의 이사.
 * 그냥 두면 같은 '2026-W38' 글자가 다른 7일을 가리켜, 저장해 둔 주간 계획이 엉뚱한 주로 밀립니다.
 */
test('옛 ISO 주차 키를 지금 키로 옮긴다', () => {
  // ISO 2026-W38 은 9/14(월)~9/20(일). 그 월요일이 든 새 주는 9/13(일)~9/19(토) = 2026-W38
  assert.equal(fromLegacyIsoWeek('2026-W38'), '2026-W38');
  assert.equal(weekRange(fromLegacyIsoWeek('2026-W38'), 'ko'), '9월 13–19일');

  // 옮긴 주에는 언제나 원래 주의 월요일이 들어 있어야 합니다.
  for (const key of ['2020-W53', '2021-W01', '2024-W01', '2026-W01', '2026-W52', '2030-W40']) {
    const moved = fromLegacyIsoWeek(key);
    assert.ok(moved, `${key} 를 옮기지 못했습니다`);
    const start = dateOf('week', moved);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    // 옛 규칙으로 그 주의 월요일을 다시 계산해, 옮긴 주 안에 들어 있는지 봅니다.
    const [y, w] = key.split('-W').map(Number);
    const jan4 = new Date(y, 0, 4);
    const monday = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
    assert.ok(start <= monday && monday <= end,
      `${key} -> ${moved} 인데 원래 월요일 ${monday.toDateString()} 이 범위 밖입니다`);
  }
});

test('옛 키 이사: 형식이 아니면 null', () => {
  for (const bad of ['', '2026-38', '2026W38', 'abcd-W01', null, undefined, '2026-09-14']) {
    assert.equal(fromLegacyIsoWeek(bad), null, `${String(bad)} 를 통과시켰습니다`);
  }
});
