import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를 참조하므로 import 전에 최소한의 전역을 만들어 둡니다.
globalThis.window = {
  localStorage: {
    length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {},
  },
  location: { protocol: 'http:' },
};
// intro.js 가 dom.js 를 거쳐 document 를 건드리므로 최소한만 흉내 냅니다.
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };

const { shouldShowIntro, INTRO_VERSION, INTRO_STEPS } = await import('../public/js/modules/intro.js');

/*
 * 처음 켰을 때 한 번 보여 주는 사용 안내.
 *
 * '첫 접속' 은 기록이 아예 없는 상태입니다.
 * 업데이트를 받았다고 쓰던 사람에게 안내가 튀어나오면 그건 방해입니다.
 */

test('기록이 하나도 없으면 띄운다 (이게 첫 접속입니다)', () => {
  assert.equal(shouldShowIntro(false, null), true);
});

test('이미 본 사람에게는 안 띄운다', () => {
  assert.equal(shouldShowIntro(false, { v: INTRO_VERSION, at: 1 }), false);
  assert.equal(shouldShowIntro(false, { v: INTRO_VERSION + 3, at: 1 }), false, '앞선 판을 본 경우');
});

test('쓰던 사람에게는 안 띄운다 (업데이트 받았다고 튀어나오면 안 됩니다)', () => {
  assert.equal(shouldShowIntro(true, null), false);
});

test('내용을 크게 고쳐 판을 올리면 예전 판을 본 사람에게 다시 띄운다', () => {
  assert.equal(shouldShowIntro(false, { v: INTRO_VERSION - 1, at: 1 }), true);
});

test('다만 쓰던 사람이면 판이 올라가도 띄우지 않는다', () => {
  // 판이 올라갔다고 쓰던 사람의 화면을 덮지 않습니다. 설정 탭에서 직접 열면 됩니다.
  assert.equal(shouldShowIntro(true, { v: INTRO_VERSION - 1, at: 1 }), false);
});

test('저장값이 망가져 있어도 던지지 않는다', () => {
  // localStorage 는 사용자가 직접 고칠 수 있고 예전 버전이 남아 있을 수도 있습니다.
  [undefined, 0, '', 'yes', [], {}, { v: null }, { v: 'x' }].forEach((bad) => {
    assert.equal(typeof shouldShowIntro(false, bad), 'boolean', JSON.stringify(bad));
  });
  assert.equal(shouldShowIntro(false, { v: 'x' }), true, '판 번호를 못 읽으면 안 본 것으로 봅니다');
});

test('장은 다섯 개이고, 장마다 아이콘과 두 문구 키를 갖는다', () => {
  assert.equal(INTRO_STEPS.length, 5);
  INTRO_STEPS.forEach((s, i) => {
    assert.ok(s.icon && s.icon.length > 0, `${i}번째 아이콘`);
    assert.match(s.title, /^intro\./, `${i}번째 제목 키`);
    assert.match(s.text, /^intro\./, `${i}번째 본문 키`);
  });
});

test('장 목록은 밖에서 고칠 수 없다', () => {
  // 얼려 두지 않으면 어느 모듈이 순서를 바꿔 놓아도 알아채지 못합니다.
  assert.ok(Object.isFrozen(INTRO_STEPS));
});
