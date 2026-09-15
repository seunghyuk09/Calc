/**
 * build-standalone.mjs
 * public/ 의 HTML·CSS·JS 를 하나의 HTML 파일로 합칩니다.
 *
 * 목적: 웹서버 없이 파일을 더블클릭(file://)만으로 열 수 있게 하기 위함입니다.
 * ES 모듈은 file:// 에서 CORS 로 차단되므로, 각 모듈을 IIFE 로 감싸 하나의
 * 일반 <script> 안에 넣습니다. IIFE 로 감싸야 모듈 간 같은 이름
 * (예: store.js 의 clearAll 과 calculator.js 의 clearAll)이 충돌하지 않습니다.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(root, 'public');
const ENTRY = 'js/main.js';

/** 모듈 경로 -> 자바스크립트 식별자로 쓸 수 있는 이름 */
const moduleVar = (relPath) => `__m_${relPath.replace(/[^A-Za-z0-9]/g, '_')}`;

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)';?\s*$/gm;

/** 모듈이 export 하는 이름 목록을 원본에서 뽑습니다. (import 이름 검증용) */
const exportsCache = new Map();
function exportsOf(relPath) {
  if (exportsCache.has(relPath)) return exportsCache.get(relPath);
  const full = resolve(publicDir, relPath);
  if (!existsSync(full)) throw new Error(`모듈을 찾을 수 없습니다: ${relPath}`);
  const text = readFileSync(full, 'utf-8');
  const names = [
    ...[...text.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
    ...[...text.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]),
  ];
  exportsCache.set(relPath, names);
  return names;
}

/**
 * 모듈 하나를 IIFE 로 변환합니다.
 * @returns {{code: string, deps: string[]}}
 */
function transform(relPath) {
  const full = resolve(publicDir, relPath);
  if (!existsSync(full)) throw new Error(`모듈을 찾을 수 없습니다: ${relPath}`);
  let src = readFileSync(full, 'utf-8');

  // 1) import 구문을 수집하고 제거합니다.
  const deps = [];
  const bindings = [];
  const importedNames = [];
  src = src.replace(IMPORT_RE, (_match, names, spec) => {
    if (!spec.startsWith('.')) throw new Error(`${relPath}: 외부 패키지 import 는 지원하지 않습니다 (${spec})`);
    const depPath = relative(publicDir, resolve(dirname(full), spec)).replace(/\\/g, '/');
    deps.push(depPath);
    importedNames.push({ depPath, names: names.split(',').map((n) => n.trim()).filter(Boolean) });
    bindings.push(`  const { ${names.trim()} } = ${moduleVar(depPath)};`);
    return ''; // import 줄은 제거
  });

  // 2) export 를 수집하고 키워드를 제거합니다.
  const exported = [];
  src = src.replace(/^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, (_m, asyncKw, name) => {
    exported.push(name);
    return `${asyncKw || ''}function ${name}`;
  });
  src = src.replace(/^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind, name) => {
    exported.push(name);
    return `${kind} ${name}`;
  });

  // 변환하지 못한 import/export 가 남아 있으면 조용히 깨진 번들을 만들지 않도록 즉시 실패시킵니다.
  // (남은 import 는 일반 <script> 안에서 SyntaxError 를 일으켜 앱 전체가 뜨지 않습니다)
  const leftoverImport = src.match(/^\s*import[\s({'"].*/gm);
  if (leftoverImport) throw new Error(`${relPath}: 변환하지 못한 import 구문 — ${leftoverImport[0].trim()}`);
  const leftoverExport = src.match(/^\s*export[\s{*].*/gm);
  if (leftoverExport) throw new Error(`${relPath}: 지원하지 않는 export 구문 — ${leftoverExport[0].trim()}`);

  // import 한 이름이 실제로 그 모듈의 export 에 있는지 확인합니다.
  // 구조분해는 없는 키를 조용히 undefined 로 만들기 때문에, ESM 이라면 로드 즉시 터질 오류가
  // 사용자가 버튼을 누르는 시점까지 숨습니다.
  importedNames.forEach(({ depPath, names }) => {
    const depExports = exportsOf(depPath);
    names.forEach((n) => {
      if (!depExports.includes(n)) {
        throw new Error(`${relPath}: '${depPath}' 에 존재하지 않는 이름을 import 합니다 — ${n}`);
      }
    });
  });

  const code = [
    `/* ===== ${relPath} ===== */`,
    `const ${moduleVar(relPath)} = (function () {`,
    ...bindings,
    src.trim(),
    `  return { ${exported.join(', ')} };`,
    `})();`,
  ].join('\n');

  return { code, deps };
}

/** 진입점부터 의존성을 따라가며 위상 정렬합니다. */
function collect(entry) {
  const cache = new Map();
  const ordered = [];
  const visiting = new Set();

  const visit = (relPath) => {
    if (cache.has(relPath)) return;
    if (visiting.has(relPath)) throw new Error(`순환 의존성: ${relPath}`);
    visiting.add(relPath);
    const result = transform(relPath);
    result.deps.forEach(visit); // 의존 모듈이 먼저 나오도록
    visiting.delete(relPath);
    cache.set(relPath, result);
    ordered.push(result.code);
  };

  visit(entry);
  return ordered;
}

// --- 조립 ---
const bundle = collect(ENTRY).join('\n\n');
const css = readFileSync(resolve(publicDir, 'css/app.css'), 'utf-8');
const html = readFileSync(resolve(publicDir, 'index.html'), 'utf-8');

const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() || 'Daily Kit';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!body) throw new Error('index.html 에서 body 를 찾지 못했습니다');

// 파비콘은 SVG 를 data URI 로 인라인합니다.
const favSvg = readFileSync(resolve(publicDir, 'assets/favicon.svg'), 'utf-8');
const favData = `data:image/svg+xml;base64,${Buffer.from(favSvg, 'utf-8').toString('base64')}`;

// 단일 파일에는 서비스워커/매니페스트를 함께 둘 수 없으므로 해당 참조를 제거합니다.
const cleanBody = body
  .replace(/<script type="module"[\s\S]*?<\/script>/g, '')
  .trim();

// 단일 파일에는 assets/ 폴더가 없으므로, JS 안에 남은 아이콘 상대경로도 data URI 로 바꿉니다.
// (알림 아이콘 등 — 그대로 두면 존재하지 않는 파일을 가리킵니다)
const bundleWithIcons = bundle.replace(/\.\/assets\/icon-192\.png/g, favData);
if (/\.\/assets\//.test(bundleWithIcons)) {
  throw new Error('번들에 처리하지 못한 ./assets/ 참조가 남아 있습니다');
}

const out = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="theme-color" content="#3b6ef6">
<link rel="icon" href="${favData}" type="image/svg+xml">
<style>
${css}
</style>
</head>
<body>
${cleanBody}
<script>
/* 단일 파일 빌드 — scripts/build-standalone.mjs 가 생성합니다. 직접 수정하지 마세요. */
"use strict";
// 웹서버 없이 여는 버전이므로 서비스 워커 등록을 건너뜁니다.
window.__DK_DISABLE_SW = true;
(function () {
${bundleWithIcons}
})();
</script>
</body>
</html>
`;

mkdirSync(resolve(root, 'dist'), { recursive: true });
const outPath = resolve(root, 'dist/데일리킷.html');
writeFileSync(outPath, out, 'utf-8');
// out.length 는 문자 수입니다. 한글은 UTF-8 에서 3바이트라 그대로 쓰면 실제보다 작게 보고됩니다.
const outBytes = Buffer.byteLength(out, 'utf-8');
console.log(`생성 완료: dist/데일리킷.html (${(outBytes / 1024).toFixed(1)} KB, ${outBytes} bytes)`);
