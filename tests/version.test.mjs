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

/*
 * 거부되어야 할 입력을 시험합니다.
 * 스크립트가 예상과 달리 성공하면 version.js 가 더럽혀진 채 남아 다음 검사까지 깨지므로,
 * 실패하든 통과하든 원래 내용으로 되돌립니다.
 */
function expectRejected(args, env, message) {
  const path = 'public/js/lib/version.js';
  const before = readFileSync(path, 'utf-8');
  try {
    assert.throws(
      () => execFileSync('node', ['scripts/stamp-build.mjs', ...args], { stdio: 'pipe', env }),
      message,
    );
  } finally {
    writeFileSync(path, before, 'utf-8');
  }
}

test('스탬프 스크립트: 40자리가 아니면 거부한다', () => {
  // CI 에는 GITHUB_SHA 가 늘 설정돼 있습니다. 그대로 두면 빈 인자일 때
  // 스크립트가 환경변수로 넘어가 성공해 버려, 검사가 환경에 따라 달라집니다.
  const env = { ...process.env };
  delete env.GITHUB_SHA;
  for (const bad of ['nope', '', 'ABCDEF', 'a'.repeat(39), 'z'.repeat(40)]) {
    expectRejected([bad], env, `"${bad}" 를 통과시켰습니다`);
  }
});

test('스탬프 스크립트: 인자를 주면 GITHUB_SHA 보다 인자가 이긴다', () => {
  // 빈 인자를 조용히 환경변수로 대체하면, 잘못 부른 것을 성공으로 오해합니다.
  expectRejected([''], { ...process.env, GITHUB_SHA: 'c'.repeat(40) },
    '빈 인자인데 GITHUB_SHA 로 넘어갔습니다');
});

test('스탬프 스크립트: 인자가 없으면 GITHUB_SHA 를 쓴다', () => {
  const path = 'public/js/lib/version.js';
  const before = readFileSync(path, 'utf-8');
  const sha = 'd'.repeat(40);
  try {
    execFileSync('node', ['scripts/stamp-build.mjs'], {
      stdio: 'pipe', env: { ...process.env, GITHUB_SHA: sha },
    });
    assert.ok(readFileSync(path, 'utf-8').includes(`commit: '${sha}'`));
  } finally {
    writeFileSync(path, before, 'utf-8');
  }
});
