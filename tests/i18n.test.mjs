import test from 'node:test';
import assert from 'node:assert/strict';
import { t, getLang, setLang, onLangChange, dictKeys, LANGS, initLang } from '../public/js/lib/i18n.js';

// store.js 가 window 를 참조하므로 최소한의 전역을 만들어 둡니다.
globalThis.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };

test('언어 목록', () => {
  assert.deepEqual(LANGS, ['ko', 'en']);
});

test('두 언어의 사전 키가 정확히 일치', () => {
  const ko = dictKeys('ko').sort();
  const en = dictKeys('en').sort();
  assert.deepEqual(ko, en, '한쪽에만 있는 키가 있으면 그 언어에서 문구가 비어 보입니다');
  assert.ok(ko.length >= 20, `키가 너무 적습니다 (${ko.length})`);
});

test('기본 언어는 한국어', () => {
  assert.equal(initLang(), 'ko');
  assert.equal(getLang(), 'ko');
});

test('언어 전환과 문구 변경', () => {
  setLang('ko');
  assert.equal(t('todo.btn.add'), '추가');
  assert.equal(t('todo.nav.today'), '오늘');
  setLang('en');
  assert.equal(t('todo.btn.add'), 'Add');
  assert.equal(t('todo.nav.today'), 'Today');
});

test('잘못된 언어 코드는 무시', () => {
  setLang('en');
  setLang('fr');
  assert.equal(getLang(), 'en');
});

test('함수형 문구 — 복수형 처리', () => {
  setLang('en');
  assert.equal(t('todo.count.total', 1), '1 plan total');
  assert.equal(t('todo.count.total', 3), '3 plans total');
  assert.equal(t('todo.toast.carried', 1), 'Moved 1 unfinished item here');
  assert.equal(t('todo.toast.carried', 2), 'Moved 2 unfinished items here');
  setLang('ko');
  assert.equal(t('todo.count.total', 3), '전체 3건');
  assert.equal(t('todo.toast.carried', 2), '미완료 2건을 이 기간으로 옮겼습니다');
});

test('없는 키는 키 자체를 반환 (화면이 비지 않도록)', () => {
  assert.equal(t('todo.does.not.exist'), 'todo.does.not.exist');
});

test('언어 변경 구독', () => {
  setLang('ko');
  let got = null;
  const off = onLangChange((lang) => { got = lang; });
  setLang('en');
  assert.equal(got, 'en');
  off();
  setLang('ko');
  assert.equal(got, 'en', '해제 후에는 호출되지 않아야 합니다');
});

test('구독자가 예외를 던져도 다른 구독자에게 전파되지 않음', () => {
  setLang('ko');
  let reached = false;
  const off1 = onLangChange(() => { throw new Error('의도적 실패'); });
  const off2 = onLangChange(() => { reached = true; });
  setLang('en');
  assert.equal(reached, true);
  off1(); off2();
});
