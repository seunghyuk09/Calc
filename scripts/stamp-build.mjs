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

const sha = (process.argv[2] || process.env.GITHUB_SHA || '').trim();
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
