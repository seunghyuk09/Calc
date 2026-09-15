/**
 * verify-assets.mjs
 * 배포 전에 정적 파일이 실제로 존재하고 서로 어긋나지 않는지 확인합니다.
 * - 서비스 워커가 캐싱하려는 파일이 모두 존재하는가
 * - manifest 가 가리키는 아이콘이 모두 존재하는가
 * - index.html 이 참조하는 로컬 리소스가 모두 존재하는가
 * 브라우저를 띄우지 않고 돌아가므로 CI 에서 가볍게 쓸 수 있습니다.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

/*
 * 1-b) 반대 방향도 봅니다: public/js 아래 모든 .js 가 APP_SHELL 에 들어 있는가.
 * 목록에 적힌 파일이 존재하는지만 보면, 새로 만든 모듈을 목록에 안 넣은 것을 잡지 못합니다.
 * 실제로 prefs.js 와 appearance.js 가 이렇게 빠져 있었습니다.
 * 빠지면 오프라인에서 앱이 뜨다가 그 모듈만 못 불러와 화면이 멈춥니다.
 */
function jsFilesUnder(dir, prefix = 'js') {
  const out = [];
  readdirSync(resolve(publicDir, dir), { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory()) out.push(...jsFilesUnder(`${dir}/${entry.name}`, `${prefix}/${entry.name}`));
    else if (entry.name.endsWith('.js')) out.push(`${prefix}/${entry.name}`);
  });
  return out;
}
if (shellBlock) {
  const listed = new Set([...shellBlock.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]));
  jsFilesUnder('js').forEach((p) => {
    if (!listed.has(p)) problems.push(`sw.js APP_SHELL 에 빠진 스크립트: ${p}`);
  });
}

/*
 * 1-c) 안전 영역 변수 이름.
 * 안드로이드 WebView 의 env(safe-area-inset-*) 는 믿을 수 없어서(크로미움 버그),
 * Capacitor 가 documentElement 에 --safe-area-inset-* 를 심어 줍니다.
 * CSS 가 그 이름을 안 쓰면 폰에서만 조용히 안 먹습니다. 브라우저 검사로는 안 잡힙니다.
 */
const appCss = readFileSync(resolve(publicDir, 'css/app.css'), 'utf-8');
['top', 'right', 'bottom', 'left'].forEach((side) => {
  if (!appCss.includes(`var(--safe-area-inset-${side},`)) {
    problems.push(`app.css 가 Capacitor 의 --safe-area-inset-${side} 를 쓰지 않습니다 (안드로이드에서 안전 영역이 0 이 됩니다)`);
  }
});

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

// 5) iOS 앱 아이콘: 알파 채널이 있으면 App Store 업로드가 거부됩니다(ERROR ITMS-90717).
//    또한 arm64 전용 바이너리는 UIRequiredDeviceCapabilities 에 arm64 가 있어야 합니다(ERROR ITMS-90502).
// 6) E2E 가 무시하기로 한 브라우저 API 를 앱이 실제로 쓰기 시작하면 안 됩니다.
//    tests/e2e.mjs 의 콘솔 검사는 compute-pressure 권한 위반을 '브라우저 잡음'으로 거릅니다.
//    앱이 이 API 를 쓰게 되면 그 필터가 진짜 오류를 가리므로, 여기서 먼저 막습니다.
const IGNORED_BROWSER_APIS = ['PressureObserver', 'compute-pressure'];
[...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map((m) => m[1]).concat('js/main.js')
  .filter((file) => existsSync(resolve(publicDir, file)))
  .forEach((file) => {
    const code = readFileSync(resolve(publicDir, file), 'utf-8');
    IGNORED_BROWSER_APIS.forEach((api) => {
      if (code.includes(api)) {
        problems.push(
          `${file} 가 ${api} 를 씁니다. E2E 콘솔 검사가 이 API 의 권한 위반을 무시하도록 돼 있어`
          + ' 진짜 오류가 가려집니다. tests/e2e.mjs 의 IGNORED_CONSOLE 을 먼저 손보세요',
        );
      }
    });
  });

const iosIcon = resolve(root, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
if (existsSync(iosIcon)) {
  const png = readFileSync(iosIcon);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(sig)) {
    problems.push('iOS 아이콘이 PNG 파일이 아닙니다');
  } else {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const colorType = png[25]; // 2 = RGB(알파 없음), 4/6 = 알파 포함
    if (width !== 1024 || height !== 1024) {
      problems.push(`iOS 아이콘은 1024x1024 여야 합니다 (현재: ${width}x${height})`);
    }
    if (colorType !== 2 && colorType !== 0 && colorType !== 3) {
      problems.push(`iOS 아이콘에 알파 채널이 있습니다 (PNG color type ${colorType}). 'node scripts/make-ios-icon.mjs' 로 다시 만드세요`);
    }
    // tRNS 청크도 투명도를 만들므로 함께 막습니다.
    if (png.includes(Buffer.from('tRNS', 'ascii'))) {
      problems.push("iOS 아이콘에 tRNS 투명도 청크가 있습니다. 'node scripts/make-ios-icon.mjs' 로 다시 만드세요");
    }
  }
}

const iosPlist = resolve(root, 'ios/App/App/Info.plist');
if (existsSync(iosPlist)) {
  const plist = readFileSync(iosPlist, 'utf-8');
  const caps = plist.match(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? '';
  if (caps.includes('armv7')) {
    problems.push('ios/App/App/Info.plist 의 UIRequiredDeviceCapabilities 에 armv7 이 있습니다. arm64 로 바꾸세요');
  }
  if (!caps.includes('arm64')) {
    problems.push('ios/App/App/Info.plist 의 UIRequiredDeviceCapabilities 에 arm64 가 없습니다');
  }
}

if (problems.length) {
  console.error('정적 파일 검사 실패:');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('정적 파일 검사 통과: sw.js / manifest / index.html / iOS 아이콘이 모두 유효합니다');
