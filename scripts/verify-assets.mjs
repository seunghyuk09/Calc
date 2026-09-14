/**
 * verify-assets.mjs
 * 배포 전에 정적 파일이 실제로 존재하고 서로 어긋나지 않는지 확인합니다.
 * - 서비스 워커가 캐싱하려는 파일이 모두 존재하는가
 * - manifest 가 가리키는 아이콘이 모두 존재하는가
 * - index.html 이 참조하는 로컬 리소스가 모두 존재하는가
 * 브라우저를 띄우지 않고 돌아가므로 CI 에서 가볍게 쓸 수 있습니다.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const problems = [];

const mustExist = (relPath, source) => {
  if (!existsSync(resolve(publicDir, relPath))) {
    problems.push(`${source} 가 참조하는 파일이 없습니다: ${relPath}`);
  }
};

// 1) 서비스 워커의 APP_SHELL 목록
const sw = readFileSync(resolve(publicDir, 'sw.js'), 'utf-8');
const shellBlock = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1];
if (!shellBlock) problems.push('sw.js 에서 APP_SHELL 목록을 찾지 못했습니다');
else {
  [...shellBlock.matchAll(/'\.\/([^']*)'/g)]
    .map((m) => m[1])
    .filter(Boolean) // './' (루트) 는 건너뜀
    .forEach((p) => mustExist(p, 'sw.js APP_SHELL'));
}

// 2) manifest 아이콘
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.webmanifest'), 'utf-8'));
if (!Array.isArray(manifest.icons) || !manifest.icons.length) problems.push('manifest 에 아이콘이 없습니다');
manifest.icons.forEach((icon) => mustExist(icon.src.replace(/^\.\//, ''), 'manifest icons'));
if (manifest.start_url !== './') problems.push(`manifest start_url 은 './' 여야 합니다 (현재: ${manifest.start_url})`);

// 3) index.html 이 참조하는 로컬 리소스
const html = readFileSync(resolve(publicDir, 'index.html'), 'utf-8');
[...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)]
  .map((m) => m[1])
  .forEach((p) => mustExist(p, 'index.html'));

// 4) 모든 JS 모듈의 상대 import 경로
const jsFiles = [...new Set([
  ...[...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map((m) => m[1]),
  'js/main.js',
])];
jsFiles.forEach((file) => {
  const full = resolve(publicDir, file);
  if (!existsSync(full)) return; // 위에서 이미 보고됨
  const code = readFileSync(full, 'utf-8');
  [...code.matchAll(/from\s+'(\.[^']+)'/g)].forEach((m) => {
    const target = resolve(dirname(full), m[1]);
    if (!existsSync(target)) problems.push(`${file} 의 import 대상이 없습니다: ${m[1]}`);
  });
});

if (problems.length) {
  console.error('정적 파일 검사 실패:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('정적 파일 검사 통과: sw.js / manifest / index.html 참조가 모두 유효합니다');
