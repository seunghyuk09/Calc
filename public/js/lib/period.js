/**
 * period.js
 * 계획표의 기간(일/주/월/연) 키를 다루는 순수 함수 모음.
 *
 * 키 형식
 *   day   : 2026-09-14
 *   week  : 2026-W38   (일요일 시작. 1월 1일이 든 주가 그 해 1주차)
 *   month : 2026-09
 *   year  : 2026
 *
 * 주 시작일을 월요일(ISO 8601)에서 일요일로 바꿨습니다.
 * 달력을 일~토로 보는 쪽이 익숙하고, 달력의 한 줄과 '주간' 단위가 정확히 겹쳐야
 * '이번 주'를 한 줄로 표시할 수 있기 때문입니다.
 * 예전 키로 저장된 주간 계획은 fromLegacyIsoWeek 로 옮깁니다.
 *
 * 주의: 모든 계산은 로컬 시간 기준입니다.
 * toISOString() 은 UTC 로 변환되어 한국 시간 오전에는 전날로 밀리므로 쓰지 않습니다.
 */

export const SCOPES = ['day', 'week', 'month', 'year'];

const pad = (n) => String(n).padStart(2, '0');

/** 시/분/초를 버린 로컬 날짜를 만듭니다. */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const DAY_MS = 24 * 60 * 60 * 1000;

/** 그 날짜가 속한 주의 일요일. */
export function weekStart(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/** 그 해 1주차(= 1월 1일이 든 주)의 일요일. */
function firstWeekStart(year) {
  return weekStart(new Date(year, 0, 1));
}

/**
 * 주차를 계산합니다.
 * 규칙: 1월 1일이 든 주가 그 해 1주차입니다. 한 주는 일요일에서 시작합니다.
 * 12월 말이라도 그 주에 다음 해 1월 1일이 들어 있으면 다음 해 1주차가 됩니다.
 */
export function weekParts(date) {
  const start = weekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  // 이 주가 다음 해 1월 1일을 품고 있으면 그 해의 1주차입니다.
  const nextJan1 = new Date(end.getFullYear(), 0, 1);
  if (end.getFullYear() !== start.getFullYear() && start <= nextJan1 && nextJan1 <= end) {
    return { year: end.getFullYear(), week: 1 };
  }
  const year = start.getFullYear();
  // 날짜 뺄셈은 서머타임이 있는 지역에서 한 시간씩 어긋납니다. 반올림으로 흡수합니다.
  const week = 1 + Math.round((start - firstWeekStart(year)) / (7 * DAY_MS));
  return { year, week };
}

/** 주차의 일요일 날짜를 돌려줍니다. */
export function weekStartOf(year, week) {
  const d = firstWeekStart(year);
  d.setDate(d.getDate() + (week - 1) * 7);
  return d;
}

/**
 * 예전 ISO 주차 키(월요일 시작)를 지금 키(일요일 시작)로 옮깁니다.
 * 그 주의 월요일이 든 '일요일 시작 주'로 보냅니다. 하루 앞당겨진 같은 주입니다.
 * 주 시작일을 바꾸기 전에 저장해 둔 주간 계획이 엉뚱한 주로 가지 않게 하려는 용도입니다.
 */
export function fromLegacyIsoWeek(key) {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO 규칙: 1월 4일이 든 주가 1주차, 월요일 시작
  const jan4 = new Date(year, 0, 4);
  const isoIdx = (jan4.getDay() + 6) % 7;
  const monday = new Date(year, 0, 4 - isoIdx + (week - 1) * 7);
  return keyOf('week', monday);
}

/** 날짜와 단위로부터 기간 키를 만듭니다. */
export function keyOf(scope, date = new Date()) {
  const d = startOfDay(date);
  switch (scope) {
    case 'day': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'week': {
      const { year, week } = weekParts(d);
      return `${year}-W${pad(week)}`;
    }
    case 'month': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    case 'year': return String(d.getFullYear());
    default: throw new Error(`알 수 없는 단위: ${scope}`);
  }
}

/** 기간 키를 대표 날짜(시작일)로 되돌립니다. */
export function dateOf(scope, key) {
  if (scope === 'day') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
    if (!m) throw new Error(`잘못된 day 키: ${key}`);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (scope === 'week') {
    const m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) throw new Error(`잘못된 week 키: ${key}`);
    return weekStartOf(Number(m[1]), Number(m[2]));
  }
  if (scope === 'month') {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m) throw new Error(`잘못된 month 키: ${key}`);
    return new Date(Number(m[1]), Number(m[2]) - 1, 1);
  }
  if (scope === 'year') {
    const m = /^(\d{4})$/.exec(key);
    if (!m) throw new Error(`잘못된 year 키: ${key}`);
    return new Date(Number(m[1]), 0, 1);
  }
  throw new Error(`알 수 없는 단위: ${scope}`);
}

/**
 * 기간을 앞뒤로 이동합니다.
 * 주/월 이동은 대표 날짜를 옮긴 뒤 키를 다시 계산하므로 연말연시 경계도 정확합니다.
 */
export function shift(scope, key, delta) {
  const d = dateOf(scope, key);
  if (scope === 'day') d.setDate(d.getDate() + delta);
  else if (scope === 'week') d.setDate(d.getDate() + delta * 7);
  else if (scope === 'month') d.setMonth(d.getMonth() + delta);
  else if (scope === 'year') d.setFullYear(d.getFullYear() + delta);
  return keyOf(scope, d);
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// getDay() 가 일요일을 0 으로 주므로 일요일부터 적습니다.
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 주의 날짜 범위만. ('2026년 38주차 · ' 같은 앞머리가 없습니다)
 * 달력을 한 줄로 접었을 때처럼 자리가 좁은 곳에서 씁니다.
 * 앞머리까지 넣으면 좁은 화면에서 잘려서 며칠인지 알 수가 없습니다.
 */
export function weekRange(key, lang = 'en') {
  const d = dateOf('week', key);
  const end = new Date(d);
  end.setDate(end.getDate() + 6);
  const sameMonth = d.getMonth() === end.getMonth();
  if (lang === 'ko') {
    return sameMonth
      ? `${d.getMonth() + 1}월 ${d.getDate()}–${end.getDate()}일`
      : `${d.getMonth() + 1}월 ${d.getDate()}일 – ${end.getMonth() + 1}월 ${end.getDate()}일`;
  }
  return sameMonth
    ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}–${end.getDate()}`
    : `${MONTHS_EN[d.getMonth()]} ${d.getDate()} – ${MONTHS_EN[end.getMonth()]} ${end.getDate()}`;
}

/**
 * 화면에 보여줄 기간 이름.
 * @param {'day'|'week'|'month'|'year'} scope
 * @param {string} key
 * @param {'ko'|'en'} lang 기본값 'en'
 */
export function label(scope, key, lang = 'en') {
  const d = dateOf(scope, key);
  const ko = lang === 'ko';

  if (scope === 'day') {
    return ko
      ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`
      : `${WEEKDAYS_EN[d.getDay()]}, ${MONTHS_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  if (scope === 'week') {
    const week = Number(key.split('-W')[1]);
    const isoYear = Number(key.split('-W')[0]);
    const range = weekRange(key, lang);
    return ko ? `${isoYear}년 ${week}주차 · ${range}` : `Week ${week}, ${isoYear} · ${range}`;
  }

  if (scope === 'month') {
    return ko ? `${d.getFullYear()}년 ${d.getMonth() + 1}월` : `${MONTHS_EN[d.getMonth()]} ${d.getFullYear()}`;
  }

  return ko ? `${d.getFullYear()}년` : String(d.getFullYear());
}

/** 지금이 속한 기간인지 */
export function isCurrent(scope, key) {
  return key === keyOf(scope, new Date());
}
