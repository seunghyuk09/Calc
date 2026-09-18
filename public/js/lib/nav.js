/**
 * nav.js — 탭 이동 중계
 *
 * 모듈끼리 서로 import 하면 순환 참조가 생기므로(today -> main -> today),
 * 실제 탭 전환 함수는 main.js 가 등록하고 다른 모듈은 goToTab() 만 부릅니다.
 * 활성 탭이 바뀌면 구독자에게 알려, 보이지 않는 탭이 타이머를 돌리지 않게 합니다.
 */

let navigate = null;
const listeners = new Set();

/** main.js 가 부트스트랩 때 실제 전환 함수를 등록합니다. */
export function setNavigator(fn) {
  navigate = fn;
}

/** 다른 탭으로 이동합니다. 아직 등록 전이면 아무 일도 하지 않습니다. */
export function goToTab(name) {
  if (typeof navigate !== 'function') {
    console.warn('[nav] 탭 전환 함수가 아직 등록되지 않았습니다:', name);
    return;
  }
  navigate(name);
}

/** 활성 탭이 바뀔 때마다 호출됩니다. 해제 함수를 돌려줍니다. */
export function onTabChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** main.js 가 탭을 바꾼 뒤 호출합니다. */
export function notifyTabChange(name) {
  // 구독자 하나가 던져도 나머지 구독자와 탭 전환 자체는 살아 있어야 합니다.
  listeners.forEach((fn) => {
    try { fn(name); } catch (err) { console.error('[nav] 구독자 오류', err); }
  });
}

/**
 * 탭 앞에 붙는 이모지.
 *
 * 목록이 index.html 한 군데에만 있도록 사이드바 버튼에서 읽어 씁니다.
 * 이모지는 aria-hidden 이라 '이름' 이 아니라 장식입니다.
 * 화면 읽기 프로그램에 읽히는 이름은 언제나 옆에 있는 글자입니다.
 * (이모지만 두면 🗓️ 이 'spiral calendar' 로, ⏱️ 가 'stopwatch' 로 읽힙니다)
 */
export function tabIcon(name) {
  const span = document.querySelector(`.tab[data-tab="${name}"] span[aria-hidden="true"]`);
  return span ? span.textContent.trim() : '';
}
