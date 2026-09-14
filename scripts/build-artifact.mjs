/**
 * build-artifact.mjs
 * public/index.html 로부터 Artifact 배포용 단일 페이지(artifact/app.html)를 생성합니다.
 * Artifact 는 <!doctype>/<html>/<head>/<body> 태그를 직접 쓸 수 없으므로
 * <title> + <link> + body 내용 + <script> 만 남긴 형태로 변환합니다.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'public/index.html'), 'utf-8');

const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim();
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!title || !body) throw new Error('index.html 에서 title 또는 body 를 찾지 못했습니다');

// 경로 앞의 "./" 를 제거합니다. (Artifact 는 상대 경로로 게시 파일을 참조)
const content = body
  .replace(/src="\.\//g, 'src="')
  .replace(/href="\.\//g, 'href="')
  .trim();

const out = `<title>${title}</title>
<link rel="stylesheet" href="css/app.css">
<script>
  // Artifact 배포본에는 서비스 워커를 함께 올리지 않으므로 등록을 건너뜁니다.
  window.__DK_DISABLE_SW = true;
</script>
${content}
`;

mkdirSync(resolve(root, 'artifact'), { recursive: true });
writeFileSync(resolve(root, 'artifact/app.html'), out, 'utf-8');
console.log(`artifact/app.html 생성 완료 (${out.length} bytes)`);
