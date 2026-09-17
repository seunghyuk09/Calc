import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를, dom.js 가 document 를 참조하므로 import 전에 가짜를 세웁니다.
const bag = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: (k) => bag.delete(k),
  },
  location: { protocol: 'http:', hostname: '127.0.0.1', port: '8099' },
  matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { } }),
  addEventListener() { },
};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() { },
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() { }, remove() { }, toggle() { } },
    setAttribute() { }, addEventListener() { }, append() { }, appendChild() { },
  }),
};

const { hintEnv } = await import('../public/js/modules/banner.js');

/*
 * 배너 아래쪽 안내가 어느 문구를 고를지 가리는 판정.
 *
 * 실제로 났던 사고: 프로토콜만 보고 '웹' 으로 판정해, 안드로이드 앱 안에서
 * '브라우저 메뉴 → 홈 화면에 추가 하면 앱처럼 쓸 수 있어요' 를 띄웠습니다.
 * 앱 주소가 https://localhost 라 프로토콜이 https: 였기 때문입니다.
 */

test('안드로이드 앱(https://localhost)은 앱으로 본다', () => {
  assert.equal(hintEnv({ protocol: 'https:', hostname: 'localhost', port: '' }), 'native');
});

test('iOS 앱(capacitor://localhost)도 앱으로 본다', () => {
  assert.equal(hintEnv({ protocol: 'capacitor:', hostname: 'localhost', port: '' }), 'native');
});

test('개발 서버(포트 있음)는 웹으로 본다', () => {
  assert.equal(hintEnv({ protocol: 'http:', hostname: 'localhost', port: '8099' }), 'web');
  assert.equal(hintEnv({ protocol: 'https:', hostname: 'localhost', port: '8443' }), 'web');
});

test('배포된 웹(GitHub Pages)은 웹으로 본다', () => {
  assert.equal(hintEnv({ protocol: 'https:', hostname: 'seunghyuk09.github.io', port: '' }), 'web');
});

test('아티팩트(claude.ai)도 웹으로 본다', () => {
  assert.equal(hintEnv({ protocol: 'https:', hostname: 'claude.ai', port: '' }), 'web');
});

test('단일 파일(file://)은 파일로 본다', () => {
  assert.equal(hintEnv({ protocol: 'file:', hostname: '', port: '' }), 'file');
});

test('값이 없거나 이상해도 던지지 않고 파일로 떨어진다', () => {
  [null, undefined, {}, { protocol: 'blob:' }].forEach((v) => {
    assert.doesNotThrow(() => hintEnv(v));
    assert.equal(hintEnv(v), 'file', JSON.stringify(v));
  });
});
