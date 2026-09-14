/**
 * period.js
 * 계획표의 기간(일/주/월/연) 키를 다루는 순수 함수 모음.
 *
 * 키 형식
 *   day   : 2026-09-14
 *   week  : 2026-W38   (ISO 8601 주차 — 월요일 시작, 첫 목요일이 있는 주가 1주차)
 *   month : 2026-09
 *   year  : 2026
 *
 * 주의: 모든 계산은 로컬 시간 기준입니다.
 * toISOString() 은 UTC 로 변환되어 한국 시간 오전에는 전날로 밀리므로 쓰지 않습니다.
 */

export const SCOPES = ['day', 'week', 'month', 'year'];

const pad = (n) => String(n).padStart(2, '0');

/** 시/분/초를 버린 로컬 날짜를 만듭니다. */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** 월요일을 0 으로 두는 요일 번호 (ISO 기준) */
const isoDayIndex = (date) => (date.getDay() + 6) % 7;

/**
 * ISO 8601 주차를 계산합니다.
 * 규칙: 그 주의 목요일이 속한 해가 그 주의 연도이고, 1월 4일이 항상 1주차에 포함됩니다.
 */
export function isoWeekParts(date) {
  const thursday = startOfDay(date);
  // 해당 주의 목요일로 이동 (월=0 이므로 +3 이 목요일)
  thursday.setDate(thursday.getDate() - isoDayIndex(thursday) + 3);
  const isoYear = thursday.getFullYear();

  // 그 해 1월 4일이 속한 주의 목요일 = 1주차의 목요일
  const jan4 = new Date(isoYear, 0, 4);
  const week1Thursday = new Date(isoYear, 0, 4 - isoDayIndex(jan4) + 3);

  const week = 1 + Math.round((thursday - week1Thursday) / (7 * 24 * 60 * 60 * 1000));
  return { year: isoYear, week };
}

/** ISO 주차의 월요일 날짜를 반환합니다. */
export function isoWeekStart(isoYear, week) {
  const jan4 = new Date(isoYear, 0, 4);
  return new Date(isoYear, 0, 4 - isoDayIndex(jan4) + (week - 1) * 7);
}

/** 날짜와 단위로부터 기간 키를 만듭니다. */
export function keyOf(scope, date = new Date()) {
  const d = startOfDay(date);
  switch (scope) {
    case 'day': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'week': {
      const { year, week } = isoWeekParts(d);
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
    return isoWeekStart(Number(m[1]), Number(m[2]));
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 화면에 보여줄 기간 이름 (영문) */
export function label(scope, key) {
  const d = dateOf(scope, key);
  if (scope === 'day') {
    return `${WEEKDAYS[isoDayIndex(d)]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  if (scope === 'week') {
    const end = new Date(d);
    end.setDate(end.getDate() + 6);
    const [, week] = key.split('-W');
    const range = d.getMonth() === end.getMonth()
      ? `${MONTHS[d.getMonth()]} ${d.getDate()}–${end.getDate()}`
      : `${MONTHS[d.getMonth()]} ${d.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}`;
    return `Week ${Number(week)} · ${range}`;
  }
  if (scope === 'month') return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

/** 지금이 속한 기간인지 */
export function isCurrent(scope, key) {
  return key === keyOf(scope, new Date());
}
