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
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {},
};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, addEventListener() {}, append() {}, appendChild() {},
  }),
};

const { isNativeUrl } = await import('../public/js/modules/update.js');

/*
 * '지금 앱 안인가' 를 주소만 보고 가리는 판정.
 *
 * 이 판정이 sw.js 와 어긋나면 한쪽만 앱이라고 여기는 순간이 생기고,
 * 그때 앱 안에서 서비스 워커가 등록돼 업데이트 경로가 통째로 어긋납니다.
 * sw.js 의 규칙: hostname === 'localhost' && 포트 없음.
 */

test('안드로이드 앱: https://localhost (포트 없음) 은 앱', () => {
  assert.equal(isNativeUrl({ protocol: 'https:', hostname: 'localhost', port: '' }), true);
});

test('iOS 앱: capacitor://localhost 는 앱', () => {
  assert.equal(isNativeUrl({ protocol: 'capacitor:', hostname: 'localhost', port: '' }), true);
});

test('개발 서버는 앱이 아니다 (포트가 있습니다)', () => {
  assert.equal(isNativeUrl({ protocol: 'http:', hostname: 'localhost', port: '8099' }), false);
  assert.equal(isNativeUrl({ protocol: 'http:', hostname: '127.0.0.1', port: '8099' }), false);
  assert.equal(isNativeUrl({ protocol: 'https:', hostname: 'localhost', port: '8443' }), false);
});

test('배포된 웹(GitHub Pages)은 앱이 아니다', () => {
  assert.equal(isNativeUrl({ protocol: 'https:', hostname: 'seunghyuk09.github.io', port: '' }), false);
});

test('아티팩트(claude.ai)도 앱이 아니다', () => {
  assert.equal(isNativeUrl({ protocol: 'https:', hostname: 'claude.ai', port: '' }), false);
});

test('단일 파일(file://)은 앱이 아니다', () => {
  assert.equal(isNativeUrl({ protocol: 'file:', hostname: '', port: '' }), false);
});

test('http://localhost 는 앱이 아니다 (로컬 서버일 뿐입니다)', () => {
  assert.equal(isNativeUrl({ protocol: 'http:', hostname: 'localhost', port: '' }), false);
});

test('값이 없거나 이상해도 던지지 않는다', () => {
  [null, undefined, {}, { protocol: 'https:' }].forEach((v) => {
    assert.doesNotThrow(() => isNativeUrl(v));
    assert.equal(isNativeUrl(v), false, JSON.stringify(v));
  });
});
