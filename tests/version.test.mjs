import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { BUILD, shortVersion, isStamped } = await import('../public/js/lib/version.js');

test('저장소 사본은 항상 dev 로 남아 있어야 한다', () => {
  // 실제 SHA 가 커밋되면 빌드 동기화 검사가 매번 실패하고, 앱이 엉뚱한 버전을 보고합니다.
  assert.equal(BUILD.commit, 'dev', 'version.js 에 실제 SHA 가 커밋돼 있습니다');
  assert.equal(BUILD.builtAt, '');
  assert.equal(shortVersion(), 'dev');
  assert.equal(isStamped(), false);
});

test('BUILD 는 얼려 둬서 실행 중에 바뀌지 않는다', () => {
  assert.throws(() => { BUILD.commit = '바꾸기'; }, TypeError);
});

test('스탬프 스크립트: 40자리 SHA 를 찍고 되돌릴 수 있다', () => {
  const path = 'public/js/lib/version.js';
  const before = readFileSync(path, 'utf-8');
  const sha = 'a'.repeat(40);
  try {
    execFileSync('node', ['scripts/stamp-build.mjs', sha], { encoding: 'utf-8' });
    const after = readFileSync(path, 'utf-8');
    assert.ok(after.includes(`commit: '${sha}'`), 'SHA 가 찍히지 않았습니다');
    assert.ok(/builtAt: '\d{4}-\d{2}-\d{2}T/.test(after), '빌드 시각이 찍히지 않았습니다');
    // 주석과 함수는 그대로 남아야 다음 빌드에서도 같은 자리를 찾습니다.
    assert.ok(after.includes('export function shortVersion'), '파일 구조가 깨졌습니다');
  } finally {
    writeFileSync(path, before, 'utf-8');
  }
  assert.equal(readFileSync(path, 'utf-8'), before, '원래 내용으로 되돌리지 못했습니다');
});

test('스탬프 스크립트: 40자리가 아니면 거부한다', () => {
  for (const bad of ['nope', '', 'ABCDEF', 'a'.repeat(39), 'z'.repeat(40)]) {
    assert.throws(
      () => execFileSync('node', ['scripts/stamp-build.mjs', bad], { stdio: 'pipe' }),
      `"${bad}" 를 통과시켰습니다`,
    );
  }
});
