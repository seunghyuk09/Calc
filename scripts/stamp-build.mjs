/**
 * stamp-build.mjs
 * public/js/lib/version.js 에 이번 빌드의 커밋 SHA 와 시각을 찍어 넣습니다.
 *
 * 배포 파이프라인에서만 돌립니다. 저장소 사본은 'dev' 로 남겨 둡니다.
 * (테스트마다 이 파일이 바뀌면 '빌드 결과물이 소스와 어긋나는지' 검사가 항상 실패합니다)
 *
 *   node scripts/stamp-build.mjs              # GITHUB_SHA 환경변수 사용
 *   node scripts/stamp-build.mjs <40자리 SHA> # 직접 지정
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, 'public/js/lib/version.js');
const swTarget = resolve(root, 'public/sw.js');

/*
 * 인자를 줬으면 그 값이 이깁니다. 비어 있어도 마찬가지입니다.
 * 빈 인자일 때 조용히 GITHUB_SHA 로 넘어가면, 잘못 부른 것을 성공으로 오해합니다.
 * (CI 에서는 GITHUB_SHA 가 늘 있어서 이 차이가 드러나지 않습니다)
 */
const explicit = process.argv[2];
const sha = (explicit !== undefined ? explicit : (process.env.GITHUB_SHA || '')).trim();
if (!/^[0-9a-f]{40}$/.test(sha)) {
  console.error(`[stamp] 40자리 커밋 SHA 가 필요합니다. 받은 값: "${sha}"`);
  process.exit(1);
}

const builtAt = new Date().toISOString();
const source = readFileSync(target, 'utf-8');

// 값만 바꿉니다. 주석과 함수는 그대로 둬야 다음 빌드에서도 같은 자리를 찾습니다.
const next = source
  .replace(/commit: '[^']*'/, `commit: '${sha}'`)
  .replace(/builtAt: '[^']*'/, `builtAt: '${builtAt}'`);

if (next === source) {
  console.error('[stamp] version.js 에서 바꿀 자리를 찾지 못했습니다. 파일 형식이 바뀌었는지 확인하세요.');
  process.exit(1);
}

// 실제로 찍혔는지 다시 읽어 확인합니다. 조용히 실패하면 앱이 영원히 'dev' 를 보고합니다.
writeFileSync(target, next, 'utf-8');
const check = readFileSync(target, 'utf-8');
if (!check.includes(`commit: '${sha}'`)) {
  console.error('[stamp] 기록 후 확인에 실패했습니다.');
  process.exit(1);
}

console.log(`[stamp] version.js -> commit=${sha.slice(0, 7)} builtAt=${builtAt}`);

/*
 * 서비스 워커의 캐시 이름에도 같은 커밋을 찍습니다.
 *
 * sw.js 는 캐시 우선이라, 이 파일 자체가 바뀌지 않으면 브라우저가 워커를 갱신하지 않고
 * 옛 파일을 계속 내놓습니다. 손으로 버전을 올리게 두면 반드시 잊습니다.
 * 실제로 최초 구현 이후 한 번도 올리지 않아, 배포 네 번이 통째로 사용자에게 가지 않았습니다.
 */
const swSource = readFileSync(swTarget, 'utf-8');
const swNext = swSource.replace(/const CACHE_VERSION = '[^']*'/, `const CACHE_VERSION = 'daily-kit-${sha.slice(0, 12)}'`);
if (swNext === swSource) {
  console.error('[stamp] sw.js 에서 CACHE_VERSION 을 찾지 못했습니다. 파일 형식이 바뀌었는지 확인하세요.');
  process.exit(1);
}
writeFileSync(swTarget, swNext, 'utf-8');
if (!readFileSync(swTarget, 'utf-8').includes(`'daily-kit-${sha.slice(0, 12)}'`)) {
  console.error('[stamp] sw.js 기록 후 확인에 실패했습니다.');
  process.exit(1);
}
console.log(`[stamp] sw.js -> CACHE_VERSION=daily-kit-${sha.slice(0, 12)}`);
