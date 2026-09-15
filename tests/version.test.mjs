import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const { BUILD, shortVersion, isStamped } = await import('../public/js/lib/version.js');

/*
 * 스탬프 스크립트가 건드리는 파일 전부.
 * 하나라도 빼먹고 되돌리면 작업 트리가 더러워져서
 * '빌드 결과물이 소스와 어긋나는지' 검사가 그 뒤로 계속 실패합니다.
 */
const STAMPED = ['public/js/lib/version.js', 'public/sw.js'];

const snapshot = () => STAMPED.map((path) => [path, readFileSync(path, 'utf-8')]);
const restore = (snap) => snap.forEach(([path, text]) => writeFileSync(path, text, 'utf-8'));

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

test('저장소 사본의 캐시 이름도 dev 로 남아 있어야 한다', () => {
  const sw = readFileSync('public/sw.js', 'utf-8');
  assert.ok(sw.includes("const CACHE_VERSION = 'daily-kit-dev'"),
    'sw.js 에 실제 캐시 이름이 커밋돼 있습니다');
});

test('스탬프 스크립트: 40자리 SHA 를 찍고 되돌릴 수 있다', () => {
  const before = snapshot();
  const sha = 'a'.repeat(40);
  try {
    execFileSync('node', ['scripts/stamp-build.mjs', sha], { encoding: 'utf-8' });
    const after = readFileSync('public/js/lib/version.js', 'utf-8');
    assert.ok(after.includes(`commit: '${sha}'`), 'SHA 가 찍히지 않았습니다');
    assert.ok(/builtAt: '\d{4}-\d{2}-\d{2}T/.test(after), '빌드 시각이 찍히지 않았습니다');
    // 주석과 함수는 그대로 남아야 다음 빌드에서도 같은 자리를 찾습니다.
    assert.ok(after.includes('export function shortVersion'), '파일 구조가 깨졌습니다');
  } finally {
    restore(before);
  }
  assert.deepEqual(snapshot(), before, '원래 내용으로 되돌리지 못했습니다');
});

/*
 * 서비스 워커의 캐시 이름도 같이 찍혀야 합니다.
 *
 * sw.js 는 캐시 우선이라, 이 파일이 안 바뀌면 브라우저가 워커를 갱신하지 않고
 * 옛 파일을 계속 내놓습니다. 손으로 올리게 뒀더니 최초 구현 이후 한 번도 올리지 않아
 * 배포 네 번이 통째로 사용자에게 가지 않았습니다. 그래서 자동으로 찍고, 여기서 확인합니다.
 */
test('스탬프 스크립트: 서비스 워커 캐시 이름도 커밋마다 달라진다', () => {
  const before = snapshot();
  try {
    execFileSync('node', ['scripts/stamp-build.mjs', 'a'.repeat(40)], { stdio: 'pipe' });
    const first = readFileSync('public/sw.js', 'utf-8');
    assert.ok(first.includes("const CACHE_VERSION = 'daily-kit-aaaaaaaaaaaa'"),
      '캐시 이름이 찍히지 않았습니다');

    execFileSync('node', ['scripts/stamp-build.mjs', 'b'.repeat(40)], { stdio: 'pipe' });
    const second = readFileSync('public/sw.js', 'utf-8');
    assert.ok(second.includes("const CACHE_VERSION = 'daily-kit-bbbbbbbbbbbb'"));
    assert.notEqual(first, second, '커밋이 달라도 sw.js 가 같으면 워커가 갱신되지 않습니다');

    // 워커의 나머지 구조는 그대로여야 다음 빌드에서도 같은 자리를 찾습니다.
    assert.ok(second.includes('const IS_NATIVE_APP'), '앱 판별 코드가 사라졌습니다');
    assert.ok(second.includes("self.addEventListener('fetch'"), 'fetch 처리가 사라졌습니다');
  } finally {
    restore(before);
  }
  assert.deepEqual(snapshot(), before, '원래 내용으로 되돌리지 못했습니다');
});

/*
 * 거부되어야 할 입력을 시험합니다.
 * 스크립트가 예상과 달리 성공하면 version.js 가 더럽혀진 채 남아 다음 검사까지 깨지므로,
 * 실패하든 통과하든 원래 내용으로 되돌립니다.
 */
function expectRejected(args, env, message) {
  const before = snapshot();
  try {
    assert.throws(
      () => execFileSync('node', ['scripts/stamp-build.mjs', ...args], { stdio: 'pipe', env }),
      message,
    );
  } finally {
    restore(before);
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
  const before = snapshot();
  const sha = 'd'.repeat(40);
  try {
    execFileSync('node', ['scripts/stamp-build.mjs'], {
      stdio: 'pipe', env: { ...process.env, GITHUB_SHA: sha },
    });
    assert.ok(readFileSync('public/js/lib/version.js', 'utf-8').includes(`commit: '${sha}'`));
  } finally {
    restore(before);
  }
});
