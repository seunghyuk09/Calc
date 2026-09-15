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
  assert.equal(t('todo.count.total', 1), '1 plan all-time');
  assert.equal(t('todo.count.total', 3), '3 plans all-time');
  assert.equal(t('todo.toast.carried', 1), 'Moved 1 unfinished item here');
  assert.equal(t('todo.toast.carried', 2), 'Moved 2 unfinished items here');
  setLang('ko');
  assert.equal(t('todo.count.total', 3), '누적 3건');
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

// ---------- 사전 값의 품질 ----------
// 키 일치만으로는 빈 문구, 번역 누락(양쪽이 같은 글자), 타입 불일치를 못 잡습니다.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as i18n from '../public/js/lib/i18n.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 특정 언어의 모든 문구를 실제로 만들어 봅니다. 함수형은 1과 3을 넣어 확인합니다. */
function renderAll(lang) {
  setLang(lang);
  const out = {};
  for (const key of dictKeys(lang)) {
    out[key] = [t(key, 1), t(key, 3)];
  }
  return out;
}

test('모든 문구가 비어 있지 않고 키를 그대로 노출하지 않음', () => {
  for (const lang of LANGS) {
    const rendered = renderAll(lang);
    for (const [key, [a]] of Object.entries(rendered)) {
      assert.equal(typeof a, 'string', `${lang}:${key} 가 문자열이 아닙니다`);
      assert.ok(a.trim().length > 0, `${lang}:${key} 가 비어 있습니다`);
      assert.notEqual(a, key, `${lang}:${key} 가 키를 그대로 반환합니다 (사전 누락)`);
    }
  }
});

test('두 언어의 문구가 서로 달라야 함 (번역 누락 방지)', () => {
  const ko = renderAll('ko');
  const en = renderAll('en');
  for (const key of Object.keys(ko)) {
    assert.notEqual(ko[key][0], en[key][0],
      `${key} 의 한/영 문구가 동일합니다. 번역이 빠졌는지 확인하세요.`);
  }
});

test('함수형 항목은 두 언어 모두 함수여야 함 (타입 불일치 방지)', () => {
  const ko = renderAll('ko');
  const en = renderAll('en');
  for (const key of Object.keys(ko)) {
    const koVaries = ko[key][0] !== ko[key][1];
    const enVaries = en[key][0] !== en[key][1];
    assert.equal(koVaries, enVaries,
      `${key} 가 한쪽만 인자를 반영합니다 (한쪽은 함수, 한쪽은 고정 문자열)`);
  }
});

test('index.html 의 data-i18n 키가 모두 사전에 존재', () => {
  // 오타가 나면 화면에 키 문자열이 그대로 뜨는데, console.warn 뿐이라 E2E 콘솔 검사도 통과합니다.
  const html = readFileSync(resolve(ROOT, 'public/index.html'), 'utf-8');
  const used = new Set();
  for (const attr of ['data-i18n', 'data-i18n-placeholder', 'data-i18n-aria', 'data-i18n-title']) {
    for (const m of html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))) used.add(m[1]);
  }
  assert.ok(used.size >= 10, `data-i18n 속성이 너무 적게 발견됐습니다 (${used.size})`);
  const known = new Set(dictKeys('ko'));
  for (const key of used) {
    assert.ok(known.has(key), `index.html 이 쓰는 '${key}' 가 사전에 없습니다`);
  }
});

/**
 * public/js 아래 모든 .js 를 읽어 하나로 잇습니다.
 * 특정 파일만 검사하면 새 모듈이 사전을 쓰기 시작해도 테스트가 알아채지 못합니다.
 * ('오늘' 탭을 추가했을 때 실제로 이 문제가 났습니다)
 */
function allAppJs() {
  const root = resolve(ROOT, 'public/js');
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(readFileSync(full, 'utf-8'));
    }
  };
  walk(root);
  return out.join('\n');
}

test('앱 코드가 t() 로 부르는 키가 모두 사전에 존재', () => {
  const src = allAppJs();
  const known = new Set(dictKeys('ko'));
  const used = [...src.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 5, `t() 호출이 너무 적게 발견됐습니다 (${used.length})`);
  for (const key of used) {
    assert.ok(known.has(key), `앱 코드가 부르는 '${key}' 가 사전에 없습니다`);
  }
});

test('사전에 있지만 아무데서도 쓰이지 않는 키가 없음', () => {
  const html = readFileSync(resolve(ROOT, 'public/index.html'), 'utf-8');
  const blob = html + allAppJs();
  const unused = dictKeys('ko').filter((k) => !blob.includes(k));
  assert.deepEqual(unused, [], '쓰이지 않는 사전 키는 지우거나 사용하세요');
});
