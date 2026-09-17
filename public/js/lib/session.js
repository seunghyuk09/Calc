/**
 * session.js — 앱을 열 때 어느 화면을 보여 줄지
 *
 * 앱을 새로 켤 때는 언제나 '오늘' 로 엽니다. 그건 main.js 의 부팅 경로가 합니다.
 * 여기 있는 것은 '잠깐 다른 앱을 보다 돌아왔을 때' 의 규칙입니다.
 *
 * 재는 것은 '앱을 떠나 있던 시간' 입니다. 화면을 켜 둔 채 가만히 있던 시간은
 * 세지 않습니다. 읽고 있는데 화면이 저 혼자 바뀌면 그게 더 나쁩니다.
 *
 * 여기에는 판정만 둡니다. 시각을 읽고 쓰는 일은 main.js 가 합니다.
 * (그래야 이 규칙을 브라우저 없이 검사할 수 있습니다)
 */

/** 이 시간 넘게 떠나 있었으면 처음 화면으로 돌아갑니다. */
export const AWAY_RESET_MS = 10 * 60 * 1000;

/**
 * 자리를 비운 지 오래인가.
 *
 * @param {number} lastSeen 마지막으로 앱을 떠난 시각(epoch ms). 기록이 없으면 0.
 * @param {number} now 지금 시각(epoch ms).
 * @param {number} limit 기준 시간(ms).
 * @returns {boolean}
 */
export function awayTooLong(lastSeen, now = Date.now(), limit = AWAY_RESET_MS) {
  const last = Number(lastSeen);
  // 처음 쓰는 경우엔 기록이 없습니다. 이때는 어차피 처음 화면으로 엽니다.
  if (!Number.isFinite(last) || last <= 0) return false;
  const gap = Number(now) - last;
  /*
   * 기기 시계가 뒤로 가면(시간대 변경, 수동 조정) 음수가 납니다.
   * 그 값으로 화면을 바꾸지 않습니다. 사용자가 한 일이 아닙니다.
   */
  if (!Number.isFinite(gap) || gap < 0) return false;
  return gap > limit;
}
