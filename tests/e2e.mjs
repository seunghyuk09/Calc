/**
 * e2e.mjs — 실제 Chromium 으로 앱 전체를 검증합니다.
 * 실행: node tests/e2e.mjs  (public/ 를 http 로 서빙한 상태여야 함)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 스크린샷은 테스트 부산물이라 저장소에 커밋하지 않습니다.
// docs/ 에 쓰면 npm test 를 돌릴 때마다 작업 트리가 더러워집니다.
const SHOT_DIR = resolve(ROOT, 'test-results');
const shot = (name) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  return join(SHOT_DIR, name);
};

// 크롬 실행 파일 경로.
// 개발 컨테이너에는 미리 설치된 크로미움이 있고, CI 에서는 Playwright 가 설치한 것을 씁니다.
// 둘 다 없으면 executablePath 를 생략해 Playwright 기본 해석에 맡깁니다.
const PINNED_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const CHROME = process.env.CHROME_PATH
  || (existsSync(PINNED_CHROME) ? PINNED_CHROME : null);

// 단일 파일(file://) 빌드에서는 서비스 워커와 manifest 를 쓸 수 없으므로 해당 검증을 건너뜁니다.
const EXTERNAL_BASE = process.env.BASE_URL || '';
const IS_FILE = EXTERNAL_BASE.startsWith('file:');

// ---------- 내장 정적 파일 서버 ----------
// 외부에서 서버를 띄워 둘 필요가 없도록 테스트가 직접 서빙합니다.
// (CI 와 로컬이 동일하게 동작하고, 서버가 죽어서 테스트가 실패하는 일이 없습니다)
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function startStaticServer(dir) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      // 상위 디렉터리 탈출 방지
      const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      let filePath = join(dir, safePath);
      if (safePath === '/' || safePath.endsWith('/')) filePath = join(filePath, 'index.html');
      if (!filePath.startsWith(dir)) { res.writeHead(403).end('forbidden'); return; }

      const body = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        // 서비스 워커가 등록되려면 같은 출처에서 제공되어야 합니다. 캐시는 끕니다.
        'Cache-Control': 'no-store',
      }).end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
    }
  });
  return new Promise((resolveServer) => {
    // 포트 0 을 쓰면 비어 있는 포트를 OS 가 골라 줍니다. (포트 충돌 없음)
    server.listen(0, '127.0.0.1', () => {
      resolveServer({ server, port: server.address().port });
    });
  });
}

const results = [];
let consoleErrors = [];
let pageErrors = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// Open-Meteo 공식 문서 스키마에 맞춘 모의 응답 (컨테이너 네트워크가 차단되어 실호출 불가)
const MOCK_FORECAST = {
  latitude: 37.56, longitude: 126.97, timezone: 'Asia/Seoul',
  current: {
    time: '2026-09-14T13:00', temperature_2m: 24.3, relative_humidity_2m: 62,
    apparent_temperature: 25.8, precipitation: 0.2, weather_code: 2, wind_speed_10m: 9.4,
  },
  daily: {
    time: ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'],
    weather_code: [2, 3, 61, 80, 0, 1, 95],
    temperature_2m_max: [27.1, 26.4, 23.8, 24.9, 28.3, 29.0, 25.5],
    temperature_2m_min: [18.2, 19.0, 18.4, 17.7, 18.9, 20.1, 19.3],
    precipitation_probability_max: [10, 25, 80, 65, 0, 5, 90],
  },
};
const MOCK_GEO = {
  results: [{ id: 1, name: '부산', latitude: 35.1028, longitude: 129.0403, country: '대한민국', admin1: '부산광역시' }],
};

const main = async () => {
  // 외부에서 BASE_URL 을 주지 않으면 내장 서버로 public/ 을 서빙합니다.
  let httpServer = null;
  let BASE = EXTERNAL_BASE;
  if (!BASE) {
    const started = await startStaticServer(resolve(ROOT, 'public'));
    httpServer = started.server;
    BASE = `http://127.0.0.1:${started.port}`;
  }

  const launchOptions = { args: ['--no-sandbox'] };
  if (CHROME) launchOptions.executablePath = CHROME;
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: [],
  });
  const page = await context.newPage();

  /*
   * 브라우저가 스스로 내는 잡음은 앱 오류가 아닙니다.
   * compute-pressure 는 앱 어디에서도 쓰지 않는 API 인데(scripts/verify-assets.mjs 가 강제),
   * file:// 문서에서는 이 권한이 기본 차단이라 브라우저 내부가 건드리면 위반 메시지가 납니다.
   * 근거: 같은 커밋(306ac37)이 CI 에서 한 번 실패하고 재실행에서 통과했습니다.
   *       로컬 3회 재현되지 않았고, main 은 같은 시간대에 통과했습니다.
   * 앱이 쓰지 않는 기능만 이름으로 짚어 거릅니다. 나머지 콘솔 에러는 그대로 실패시킵니다.
   */
  const IGNORED_CONSOLE = [
    /Permissions policy violation: compute-pressure is not allowed/,
  ];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // 외부 API 를 모의 응답으로 가로챕니다.
  await page.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  await page.route('**/geocoding-api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_GEO) }));
  // 유튜브 임베드는 실제로 부르지 않습니다.
  await page.route('**/youtube-nocookie.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>mock player</body></html>' }));

  console.log(`\n▶ ${BASE} 로드`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]', { timeout: 10000 });
  check('앱 부팅 완료 (data-ready)', true);
  check('첫 화면은 오늘 탭', (await page.getAttribute('.tab[data-tab="today"]', 'aria-selected')) === 'true',
    `실제 선택 탭: ${await page.getAttribute('.tab[data-tab="today"]', 'aria-selected')}`);
  check('오늘 탭에 날짜 표시', ((await page.textContent('#today-date')) || '').length > 4,
    `실제: ${await page.textContent('#today-date')}`);

  // ---------- 1. 계산기 ----------
  console.log('\n▶ 계산기');
  await page.click('.tab[data-tab="calc"]');
  const press = async (label) => { await page.click(`#keypad button:text-is("${label}")`); };

  await press('7'); await press('×'); await press('8'); await press('=');
  check('키패드 7 × 8 = 56', (await page.textContent('#calc-result')) === '56',
    `실제: ${await page.textContent('#calc-result')}`);

  await press('AC');
  check('AC 로 초기화', (await page.textContent('#calc-result')) === '0');

  // 소수점 오차 검증
  await page.fill('#calc-expr', '0.1+0.2');
  await page.press('#calc-expr', 'Enter');
  check('0.1+0.2 = 0.3 (부동소수점 보정)', (await page.textContent('#calc-result')) === '0.3',
    `실제: ${await page.textContent('#calc-result')}`);

  // 우선순위 + 괄호
  await page.fill('#calc-expr', '(2+3)*4-6/2');
  await page.press('#calc-expr', 'Enter');
  check('(2+3)*4-6/2 = 17', (await page.textContent('#calc-result')) === '17',
    `실제: ${await page.textContent('#calc-result')}`);

  // 천단위 구분
  await page.fill('#calc-expr', '1234*1000');
  await page.press('#calc-expr', 'Enter');
  check('1234*1000 = 1,234,000 (천단위 표기)', (await page.textContent('#calc-result')) === '1,234,000',
    `실제: ${await page.textContent('#calc-result')}`);

  // 0 나누기 에러
  await page.fill('#calc-expr', '5/0');
  await page.press('#calc-expr', 'Enter');
  const errText = await page.textContent('#calc-result');
  const hasErrClass = await page.evaluate(() => document.querySelector('#calc-result').classList.contains('is-error'));
  check('5/0 은 에러 표시', hasErrClass && errText.includes('0으로'), `실제: ${errText}`);

  // 계산 기록 누적
  const histCount = await page.locator('#calc-history .hist-item').count();
  check('계산 기록이 쌓임', histCount >= 4, `${histCount}건`);

  // --- PC: 괄호와 기호를 키보드로 직접 입력 ---
  // 수식창을 클릭하지 않고도 쳐지는지 봅니다. (전역 keydown 경로)
  await page.click('#calc-result');   // 입력칸이 아닌 곳에 포커스
  await page.keyboard.type('(12+8)*3%');
  const typedExpr = await page.inputValue('#calc-expr');
  check('PC 키보드로 괄호·기호 입력', typedExpr.endsWith('(12+8)*3%'),
    `실제: ${typedExpr}`);
  await page.keyboard.press('Escape');
  check('Escape 로 초기화', (await page.inputValue('#calc-expr')) === '');

  // PC 에서는 시스템 키보드를 막을 이유가 없습니다.
  check('PC 에서는 inputmode 가 text', (await page.getAttribute('#calc-expr', 'inputmode')) === 'text',
    `실제: ${await page.getAttribute('#calc-expr', 'inputmode')}`);

  // --- 다른 탭에서 누른 키가 계산기로 새지 않아야 함 ---
  // 가로 페이저로 바꾸면서 패널이 hidden 을 안 쓰게 됐는데,
  // 계산기가 hidden 으로 활성 여부를 판단하고 있어 모든 탭에서 입력을 가로챘습니다.
  await page.click('.tab[data-tab="quote"]');
  await page.waitForTimeout(400);
  await page.keyboard.press('7');
  await page.keyboard.press('7');
  await page.waitForTimeout(150);
  check('다른 탭에서 누른 숫자가 계산기로 새지 않음',
    (await page.inputValue('#calc-expr')) === '',
    `실제: ${await page.inputValue('#calc-expr')}`);
  await page.click('.tab[data-tab="calc"]');
  await page.waitForTimeout(400);

  // --- 계산 기록 메모 ---
  const firstRow = page.locator('#calc-history .hist-item').first();
  await firstRow.locator('.hist-note-btn').click();
  await page.fill('#calc-history .hist-note-input', '9월 정산 견적');
  await page.click('#calc-history .hist-note-form button[type="submit"]');
  await page.waitForTimeout(250);
  check('계산 기록에 메모 저장',
    (await firstRow.locator('.hist-note').textContent()) === '9월 정산 견적',
    `실제: ${await firstRow.locator('.hist-note').count()}건`);

  // 메모가 있는 줄은 버튼 모양이 바뀌어야 알아볼 수 있습니다.
  check('메모가 있으면 버튼 표시가 바뀜',
    (await firstRow.locator('.hist-note-btn').textContent()) === '📝');

  // 값 넣기 버튼과 메모 버튼이 분리돼 있어야 오조작이 없습니다.
  await page.click('#calc-expr');
  await page.fill('#calc-expr', '');
  await firstRow.locator('.hist-main').click();
  check('기록의 값 버튼은 수식에 값을 넣음',
    (await page.inputValue('#calc-expr')).length > 0,
    `실제: ${await page.inputValue('#calc-expr')}`);

  // 메모를 비우면 지워집니다.
  await firstRow.locator('.hist-note-btn').click();
  await page.fill('#calc-history .hist-note-input', '');
  await page.click('#calc-history .hist-note-form button[type="submit"]');
  await page.waitForTimeout(250);
  check('메모를 비우면 삭제됨', (await firstRow.locator('.hist-note').count()) === 0);

  await page.fill('#calc-expr', '');

  // ---------- 2. TO DO (일/주/월/연 계획표, 한/영) ----------
  console.log('\n▶ TO DO');
  check('탭 이름이 TO DO', (await page.textContent('.tab[data-tab="todo"]')).includes('TO DO'),
    await page.textContent('.tab[data-tab="todo"]'));
  await page.click('.tab[data-tab="todo"]');
  await page.waitForSelector('#scope-tabs', { timeout: 5000 });

  // 언어 전환은 설정 탭에 있으므로, 거기서 바꾸고 TO DO 로 돌아옵니다.
  const setLanguage = async (lang) => {
    await page.click('.tab[data-tab="settings"]');
    await page.waitForSelector('#lang-switch', { timeout: 5000 });
    await page.click(`.lang-btn[data-lang="${lang}"]`);
    await page.waitForTimeout(150);
    await page.click('.tab[data-tab="todo"]');
    await page.waitForTimeout(150);
  };


  // 언어 전환은 설정 탭에 있습니다 (TO DO 카드에는 없어야 함)
  check('TO DO 카드에는 언어 버튼이 없음',
    (await page.locator('#panel-todo .lang-switch').count()) === 0);
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(150);
  check('설정 탭에 언어 전환이 있음', (await page.locator('#panel-settings #lang-switch').count()) === 1);
  check('기본 언어 한국어', (await page.getAttribute('.lang-btn[data-lang="ko"]', 'aria-pressed')) === 'true');
  const langBox = await page.locator('.lang-btn[data-lang="ko"]').boundingBox();
  check('언어 버튼이 충분히 큼 (최소 높이 36px)', langBox.height >= 36, `실제 ${Math.round(langBox.height)}px`);
  await page.click('.tab[data-tab="todo"]');
  await page.waitForTimeout(150);
  check('한국어 단위 라벨', (await page.textContent('.scope-tab[data-scope="day"]')) === '일간',
    await page.textContent('.scope-tab[data-scope="day"]'));
  check('한국어 추가 버튼', (await page.textContent('#todo-form button[type="submit"]')) === '추가');
  check('한국어 입력 안내', (await page.getAttribute('#todo-input', 'placeholder')) === '계획을 입력하고 Enter');
  check('한국어 기간 표기', /^\d{4}년 \d{1,2}월 \d{1,2}일 \(.\)$/.test(await page.textContent('#period-label')),
    await page.textContent('#period-label'));

  // 영어로 전환
  await setLanguage('en');
  check('영어 전환 — 단위 라벨', (await page.textContent('.scope-tab[data-scope="day"]')) === 'Day');
  check('영어 전환 — 추가 버튼', (await page.textContent('#todo-form button[type="submit"]')) === 'Add');
  check('영어 전환 — 입력 안내', (await page.getAttribute('#todo-input', 'placeholder')) === 'Add a plan and press Enter');
  check('영어 전환 — 기간 표기', /^\w{3}, \w{3} \d{1,2}, \d{4}$/.test(await page.textContent('#period-label')),
    await page.textContent('#period-label'));
  check('영어 전환 — 필터 라벨', (await page.textContent('.chip[data-filter="active"]')) === 'Active');
  check('영어 전환 — 이월 버튼', (await page.textContent('#todo-carry')).includes('Carry over'));
  // 지적 반영: 전환되는 문구를 넓게 확인 (이전에는 6개만 단언)
  for (const [sel, expected] of [
    ['.scope-tab[data-scope="week"]', 'Week'],
    ['.scope-tab[data-scope="month"]', 'Month'],
    ['.scope-tab[data-scope="year"]', 'Year'],
    ['.chip[data-filter="all"]', 'All'],
    ['.chip[data-filter="done"]', 'Done'],
    ['#period-today', 'Today'],
    ['#todo-clear-done', 'Clear done'],
    ['#panel-todo .card-title', 'Planner'],
  ]) {
    check(`영어 전환 — ${expected}`, (await page.textContent(sel)).trim() === expected,
      `실제: ${(await page.textContent(sel)).trim()}`);
  }
  check('영어 전환 — 패널 lang 속성', (await page.getAttribute('#panel-todo', 'lang')) === 'en',
    `실제: ${await page.getAttribute('#panel-todo', 'lang')}`);
  check('사용자 입력 영역은 lang 고정', (await page.getAttribute('#todo-list', 'lang')) === 'ko');
  check('이월 버튼에 설명 title', (await page.getAttribute('#todo-carry', 'title')).includes('previous period'),
    await page.getAttribute('#todo-carry', 'title'));

  // 한국어로 되돌리기 (역방향 전환)
  await setLanguage('ko');
  check('한국어 복귀 — 단위 라벨', (await page.textContent('.scope-tab[data-scope="day"]')) === '일간');
  check('한국어 복귀 — 패널 lang', (await page.getAttribute('#panel-todo', 'lang')) === 'ko');
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(150);
  check('한국어 복귀 — 이전 버튼 눌림 해제',
    (await page.getAttribute('.lang-btn[data-lang="en"]', 'aria-pressed')) === 'false');
  await page.click('.tab[data-tab="todo"]');
  await setLanguage('en');

  check('기본 단위는 Day', (await page.getAttribute('.scope-tab[data-scope="day"]', 'aria-selected')) === 'true');
  const dayLabel = await page.textContent('#period-label');
  check('오늘 기간이 강조 표시', await page.evaluate(() =>
    document.querySelector('#period-label').classList.contains('is-current')), dayLabel);

  const addPlan = async (text) => {
    await page.fill('#todo-input', text);
    await page.press('#todo-input', 'Enter');
  };

  await addPlan('Write report');
  await addPlan('Workout');
  check('Day 계획 2개 추가', (await page.locator('#todo-list .todo-item').count()) === 2);
  check('진행률 0/2', (await page.textContent('#todo-progress-text')) === '0 / 2');

  await page.locator('#todo-list .todo-item input[type="checkbox"]').first().check();
  check('완료 체크 반영', (await page.locator('#todo-list .todo-item.done').count()) === 1);
  check('진행률 1/2 로 갱신', (await page.textContent('#todo-progress-text')) === '1 / 2');

  // 동적 생성 요소의 언어 전환 (이전에는 전혀 검증되지 않음)
  check('동적 요소 — 영어 체크박스 이름',
    (await page.getAttribute('#todo-list .todo-item input', 'aria-label')) === 'Mark as done');
  check('동적 요소 — 영어 삭제 버튼 이름',
    (await page.getAttribute('#todo-list .todo-item button', 'aria-label')) === 'Delete');
  await setLanguage('ko');
  check('동적 요소 — 한국어 체크박스 이름',
    (await page.getAttribute('#todo-list .todo-item input', 'aria-label')) === '완료 표시');
  check('동적 요소 — 한국어 삭제 버튼 이름',
    (await page.getAttribute('#todo-list .todo-item button', 'aria-label')) === '삭제');
  await setLanguage('en');

  await page.click('.chip[data-filter="active"]');
  check('Active 필터', (await page.locator('#todo-list .todo-item').count()) === 1);

  // 결과가 없는 필터의 안내 문구 (한 번도 렌더된 적 없었음)
  await page.click('.chip[data-filter="done"]');
  await page.waitForTimeout(150);
  check('Done 필터 — 완료 1건 표시', (await page.locator('#todo-list .todo-item').count()) === 1);
  await page.click('.chip[data-filter="active"]');
  await page.waitForTimeout(150);
  // 체크하면 이 항목은 Active 필터에서 사라집니다. check() 는 클릭 후 사라진 노드의
  // 상태를 확인하려다 멈추므로 click() 을 씁니다.
  await page.locator('#todo-list .todo-item input').first().click();
  await page.waitForTimeout(250);
  check('필터로 결과가 비면 전용 안내 문구',
    (await page.textContent('#todo-list .empty')) === 'Nothing matches this filter.',
    await page.textContent('#todo-list .empty'));
  // 체크로 항목이 사라지면 포커스가 입력창으로 이동해야 함 (body 로 날아가면 키보드 사용자가 길을 잃음)
  check('항목이 필터에서 사라지면 포커스가 입력창으로',
    (await page.evaluate(() => document.activeElement?.id)) === 'todo-input',
    await page.evaluate(() => document.activeElement?.id || '(none)'));
  await page.click('.chip[data-filter="all"]');
  await page.waitForTimeout(150);
  // check()/uncheck() 는 클릭 후 상태를 재검증하는데, 이 앱은 클릭 즉시 목록을 다시 그려
  // 노드가 교체되므로 검증이 stale 노드를 봅니다. click() 으로 누르고 상태는 따로 확인합니다.
  await page.locator('#todo-list .todo-item input').first().click();
  await page.waitForTimeout(250);
  check('체크 후에도 체크박스에 포커스 유지 (전체 필터)',
    (await page.evaluate(() => document.activeElement?.type)) === 'checkbox',
    await page.evaluate(() => document.activeElement?.tagName || '(none)'));
  check('전체 필터에서는 항목이 사라지지 않음',
    (await page.locator('#todo-list .todo-item').count()) === 2);

  // 기간 이동: 다음 날에는 항목이 없어야 함 (기간별로 분리되는지)
  await page.click('#period-next');
  check('다음 날은 빈 목록', (await page.locator('#todo-list .todo-item').count()) === 0,
    await page.textContent('#period-label'));
  check('빈 목록 안내가 영어', (await page.textContent('#todo-list .empty')) === 'No plans for this period yet.',
    await page.textContent('#todo-list .empty'));
  check('다음 날은 현재 기간 아님', !(await page.evaluate(() =>
    document.querySelector('#period-label').classList.contains('is-current'))));

  // 이월: 직전(오늘)의 미완료 1건이 넘어와야 함
  await page.click('#todo-carry');
  await page.waitForTimeout(300);
  check('이월로 미완료 1건 이동', (await page.locator('#todo-list .todo-item').count()) === 1);
  check('완료 항목은 이월되지 않음', (await page.locator('#todo-list .todo-item.done').count()) === 0);

  await page.click('#period-today');
  check('Today 버튼으로 복귀', (await page.locator('#todo-list .todo-item').count()) === 1,
    '이월되고 남은 완료 1건');

  // 단위 전환: Week / Month / Year 는 각각 독립된 목록
  for (const [sc, text, pattern] of [
    ['week', 'Ship v1 beta', /^Week \d+, \d{4} · /],
    ['month', 'Hire designer', /^\w{3} \d{4}$/],
    ['year', 'Launch product', /^\d{4}$/],
  ]) {
    await page.click(`.scope-tab[data-scope="${sc}"]`);
    await page.waitForTimeout(150);
    const lbl = await page.textContent('#period-label');
    check(`${sc} 단위 기간 표기`, pattern.test(lbl), `실제: ${lbl}`);
    check(`${sc} 단위는 빈 목록에서 시작`, (await page.locator('#todo-list .todo-item').count()) === 0);
    await addPlan(text);
    check(`${sc} 계획 추가`, (await page.locator('#todo-list .todo-item').count()) === 1);
  }

  // Day 로 돌아와도 Day 항목만 보여야 함
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(150);
  check('Day 로 복귀 시 Day 항목만 표시', (await page.locator('#todo-list .todo-item').count()) === 1);
  // 총합 5건: 오늘 1(완료) + 내일 1(이월됨) + week/month/year 각 1
  // 이월은 항목을 옮기는 것이지 복제하는 것이 아니므로 총합은 늘지 않습니다.
  check('전체 계획 수 집계 (이월은 복제가 아님)',
    (await page.textContent('#todo-count')).includes('5 plans all-time'),
    await page.textContent('#todo-count'));

  // ---------- 3. 날씨 (모의 응답) ----------
  console.log('\n▶ 날씨');
  await page.click('.tab[data-tab="weather"]');
  await page.waitForSelector('.wx-temp', { timeout: 8000 });
  check('현재 기온 렌더링', (await page.textContent('.wx-temp')) === '24.3°',
    `실제: ${await page.textContent('.wx-temp')}`);
  check('WMO 코드 2 -> 부분적으로 흐림', (await page.textContent('.wx-desc')).includes('부분적으로 흐림'),
    `실제: ${await page.textContent('.wx-desc')}`);
  const dayCount = await page.locator('#wx-week .wx-day').count();
  check('주간 예보 7일 렌더링', dayCount === 7, `${dayCount}일`);
  check('첫 줄은 "오늘"', (await page.locator('.wx-day-name').first().textContent()) === '오늘');

  await page.fill('#wx-query', '부산');
  await page.click('#wx-search-form button[type="submit"]');
  await page.waitForTimeout(600);
  check('도시 검색 후 지역명 갱신', (await page.textContent('#wx-place')).includes('부산'),
    `실제: ${await page.textContent('#wx-place')}`);

  // ---------- 3-b. 오늘 (플래너 첫 페이지) ----------
  console.log('\n▶ 오늘');

  // 순환이 돌려면 보이는 줄 수(3)보다 많은 미완료 항목이 필요합니다.
  await page.click('.tab[data-tab="todo"]');
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(120);
  for (const text of ['오늘 A', '오늘 B', '오늘 C', '오늘 D',
    '월말 정산 자료 취합하고 팀 전체에 공유하기 — 줄바꿈 없는 아주 긴 제목으로 가로 넘침을 확인합니다']) {
    await page.fill('#todo-input', text);
    await page.press('#todo-input', 'Enter');
  }

  // 새로고침 뒤 유지되는지 확인할 때 쓸 기준값입니다. (고정 숫자를 박으면 검사 추가마다 깨집니다)
  const dayPlanCount = await page.locator('#todo-list .todo-item').count();

  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(200);

  const rotCount = await page.locator('#today-rot .today-rot-item').count();
  check('오늘 탭에 미완료 할 일이 모임', rotCount >= 4, `${rotCount}건`);
  check('완료 항목은 오늘 탭에 안 나옴',
    !(await page.textContent('#today-rot')).includes('Buy milk'),
    await page.textContent('#today-rot'));
  check('남은 개수 표시', ((await page.textContent('#today-todo-count')) || '').length > 0,
    await page.textContent('#today-todo-count'));

  // 현재 날씨가 아이콘 + 기온으로 요약됨 (모의 응답 기준 24.3°, WMO 2 = ⛅)
  check('오늘 탭 기온 요약', (await page.textContent('.today-wx-temp')) === '24.3°',
    `실제: ${await page.textContent('.today-wx-temp')}`);
  check('오늘 탭 날씨 아이콘', (await page.textContent('.today-wx-icon')).trim() === '⛅',
    `실제: ${await page.textContent('.today-wx-icon')}`);

  // 순환 멈춤 버튼은 넘칠 때만 보입니다.
  check('순환 버튼 노출 (항목이 넘칠 때)', await page.isVisible('#today-rot-toggle'));

  // 반대 경우도 봅니다. hidden 속성이 CSS 에 밀려 무시되는 일이 실제로 있었습니다.
  await page.evaluate(() => {
    const btn = document.querySelector('#today-rot-toggle');
    btn.hidden = true;
  });
  check('hidden 을 걸면 실제로 사라짐 (CSS 가 hidden 을 이기지 않음)',
    !(await page.isVisible('#today-rot-toggle')));
  await page.evaluate(() => { document.querySelector('#today-rot-toggle').hidden = false; });
  await page.click('#today-rot-toggle');
  check('순환 멈춤 상태 반영', (await page.getAttribute('#today-rot-toggle', 'aria-pressed')) === 'true');
  await page.click('#today-rot-toggle');
  check('순환 재시작 상태 반영', (await page.getAttribute('#today-rot-toggle', 'aria-pressed')) === 'false');

  // 자동 순환이 실제로 도는지 확인합니다. (버튼 상태만 보면 타이머가 죽어도 통과합니다)
  const rotTop = () => page.evaluate(() => document.querySelector('#today-rot').scrollTop);
  await page.evaluate(() => { document.querySelector('#today-rot').scrollTop = 0; });
  const beforeRotate = await rotTop();
  await page.waitForTimeout(4200);   // ROTATE_MS(3500) 한 번은 지나야 합니다
  const afterRotate = await rotTop();
  check('자동 순환이 실제로 스크롤을 옮김', afterRotate > beforeRotate,
    `${beforeRotate} -> ${afterRotate}`);

  // 멈추면 정말 멈춰야 합니다.
  await page.click('#today-rot-toggle');
  const beforePause = await rotTop();
  await page.waitForTimeout(4200);
  const afterPause = await rotTop();
  check('일시정지하면 순환이 멈춤', afterPause === beforePause,
    `${beforePause} -> ${afterPause}`);
  await page.click('#today-rot-toggle');   // 다시 켜 둡니다

  // 할 일을 누르면 계획표의 그 항목으로
  const firstTaskText = await page.locator('#today-rot .today-rot-item .today-rot-text').first().textContent();
  await page.locator('#today-rot .today-rot-item').first().click();
  await page.waitForTimeout(200);
  check('할 일 클릭 -> TO DO 탭으로 이동',
    (await page.getAttribute('.tab[data-tab="todo"]', 'aria-selected')) === 'true');
  check('클릭한 항목이 강조됨',
    (await page.locator('#todo-list .todo-item.is-revealed').count()) === 1);
  check('강조된 항목이 누른 항목과 같음',
    (await page.locator('#todo-list .todo-item.is-revealed .todo-text').textContent()) === firstTaskText,
    `기대: ${firstTaskText}`);

  // 날씨 카드를 누르면 날씨 탭으로
  await page.click('.tab[data-tab="today"]');
  await page.click('#today-weather-card');
  await page.waitForTimeout(200);
  check('날씨 카드 클릭 -> 날씨 탭으로 이동',
    (await page.getAttribute('.tab[data-tab="weather"]', 'aria-selected')) === 'true');

  // ---------- 3-c. 좌우 스와이프로 페이지 넘기기 ----------
  console.log('\n▶ 스와이프 (모바일 에뮬레이션)');

  // 스와이프는 전용 컨텍스트에서 봅니다.
  //  - 마우스 드래그로는 안 됩니다. 페이저가 브라우저의 네이티브 가로 스크롤이기 때문입니다.
  //  - 합성 휠 이벤트도 안 됩니다. 헤드리스 Chromium 이 scroll-snap 과 함께 처리하지 못합니다.
  //  - 터치 스크롤은 isMobile 에뮬레이션이 켜져 있어야 동작합니다.
  const swipeCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul',
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  await swipeCtx.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  const sp = await swipeCtx.newPage();
  const cdp = await swipeCtx.newCDPSession(sp);
  await sp.goto(BASE, { waitUntil: 'networkidle' });
  await sp.waitForSelector('body[data-ready="true"]');
  await sp.waitForTimeout(400);

  // 뒤로가기 제스처로 앱을 벗어나면 #main 자체가 사라집니다.
  // 그때 예외로 죽지 않고 검사 실패로 보이도록 -1 을 돌려줍니다.
  const pagerLeft = () => sp.evaluate(() => document.querySelector('#main')?.scrollLeft ?? -1);

  /**
   * 스크롤이 멈출 때까지 기다립니다.
   * 고정 대기(900ms)로는 느린 러너에서 9장을 가로지르는 부드러운 스크롤이 끝나지 않아
   * 애니메이션 도중 값을 읽고 검사가 흔들립니다. (CI 에서 실제로 났습니다)
   */
  const settlePager = async () => {
    let prev = null;
    for (let i = 0; i < 50; i += 1) {
      const now = await pagerLeft();
      if (now === prev) return now;
      prev = now;
      await sp.waitForTimeout(100);
    }
    return prev;
  };

  /** 화면 가운데 높이에서 가로로 dx 만큼 손가락을 끕니다. */
  const swipe = async (dx, steps = 12) => {
    const box = await sp.locator('#main').boundingBox();
    const y = box.y + box.height / 2;
    const x0 = dx < 0 ? box.x + box.width * 0.85 : box.x + box.width * 0.15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x0 + (dx * i) / steps, y }],
      });
      await sp.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settlePager();          // 스냅 애니메이션이 끝날 때까지
    await sp.waitForTimeout(250); // 탭 상태 반영(스크롤 멈춤 감지 120ms) 여유
  };
  const selectedTab = () => sp.evaluate(() =>
    document.querySelector('.tab[aria-selected="true"]')?.dataset.tab ?? '(앱 이탈)');

  // 폰에서는 시스템 키보드가 계산기 자판을 가리므로 띄우지 않습니다.
  check('폰에서는 계산기 입력칸의 inputmode 가 none',
    (await sp.getAttribute('#calc-expr', 'inputmode')) === 'none',
    `실제: ${await sp.getAttribute('#calc-expr', 'inputmode')}`);

  const W = await sp.evaluate(() => document.querySelector('#main').clientWidth);
  check('첫 화면은 페이저 첫 장', (await pagerLeft()) === 0 && (await selectedTab()) === 'today',
    `scrollLeft=${await pagerLeft()} tab=${await selectedTab()}`);

  await swipe(-W * 0.7);
  check('왼쪽으로 쓸면 화면이 한 장 밀림', Math.round(await pagerLeft()) === W,
    `기대 ${W}, 실제 ${await pagerLeft()}`);
  check('밀린 뒤 탭도 따라옴 (계산기)', (await selectedTab()) === 'calc', `실제 ${await selectedTab()}`);

  await swipe(-W * 0.7);
  check('한 번 더 쓸면 두 장째 (날씨)',
    Math.round(await pagerLeft()) === W * 2 && (await selectedTab()) === 'weather',
    `scrollLeft=${await pagerLeft()} tab=${await selectedTab()}`);

  await swipe(W * 0.7);
  check('오른쪽으로 쓸면 되돌아옴 (계산기)',
    Math.round(await pagerLeft()) === W && (await selectedTab()) === 'calc',
    `scrollLeft=${await pagerLeft()} tab=${await selectedTab()}`);

  // 첫 장에서 더 오른쪽으로 쓸어도 끝으로 순환하지 않아야 합니다.
  // 그리고 무엇보다 앱을 벗어나면 안 됩니다.
  // 브라우저는 가로 페이저의 끝에서 바깥으로 끄는 제스처를 '뒤로가기'로 받아들입니다.
  // (히스토리가 없으면 about:blank 로 나가버립니다. overscroll-behavior 로는 막히지 않습니다)
  const urlBeforeEdge = sp.url();
  await swipe(W * 0.7);
  await swipe(W * 0.7);
  check('첫 장에서 더 쓸어도 앱을 벗어나지 않음 (뒤로가기 제스처 차단)',
    sp.url() === urlBeforeEdge, `${urlBeforeEdge} -> ${sp.url()}`);
  check('첫 장에서 더 쓸어도 제자리',
    (await pagerLeft()) === 0 && (await selectedTab()) === 'today',
    `scrollLeft=${await pagerLeft()} tab=${await selectedTab()}`);

  // 마지막 장에서 왼쪽으로 쓸 때도 같습니다.
  await sp.click('.tab[data-tab="settings"]');
  const lastLeft = await settlePager();
  const urlBeforeLastEdge = sp.url();
  await swipe(-W * 0.7);
  // 픽셀이 아니라 '몇 번째 장인가'로 봅니다. 스냅 위치가 1~2px 어긋나도 의미는 같습니다.
  const lastIndex = Math.round(lastLeft / W);
  check('마지막 장에서 더 쓸어도 제자리이고 앱을 벗어나지 않음',
    Math.round((await pagerLeft()) / W) === lastIndex && sp.url() === urlBeforeLastEdge,
    `${lastIndex}번째 장 유지 여부: scrollLeft ${lastLeft} -> ${await pagerLeft()}, url ${sp.url().slice(-20)}`);

  // 탭 버튼으로도 같은 자리로 가야 합니다.
  await sp.click('.tab[data-tab="today"]');
  await settlePager();
  await sp.click('.tab[data-tab="settings"]');
  const settingsLeft = await settlePager();
  check('탭 버튼을 누르면 그 장으로 스크롤', Math.round(settingsLeft / W) === 9,
    `기대 9번째 장(${W * 9}), 실제 ${settingsLeft}`);

  // 낙서판 위에서는 페이저가 움직이면 안 됩니다 (그림이 끊깁니다).
  await sp.click('.tab[data-tab="memo"]');
  const memoLeft = await settlePager();
  const cBox = await sp.locator('#draw-canvas').boundingBox();
  const cy = cBox.y + cBox.height / 2;
  const cx = cBox.x + cBox.width * 0.85;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= 12; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: cx - (cBox.width * 0.7 * i) / 12, y: cy }],
    });
    await sp.waitForTimeout(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await settlePager();
  check('낙서판 위 스와이프는 페이지를 넘기지 않음 (touch-action: none)',
    (await pagerLeft()) === memoLeft, `${memoLeft} -> ${await pagerLeft()}`);

  await swipeCtx.close();

  // ---------- 4. 시계 · 타이머 ----------
  console.log('\n▶ 시계 · 타이머');
  await page.click('.tab[data-tab="time"]');
  await page.waitForTimeout(1100);
  const clockText = await page.textContent('#clock-time');
  check('시계가 HH:MM:SS 형식', /^\d{2}:\d{2}:\d{2}$/.test(clockText), `실제: ${clockText}`);
  check('세계시계 4개', (await page.locator('#world-clocks .world-item').count()) === 4);

  await page.click('.chip[data-min="5"]');
  check('프리셋 5분 적용', (await page.textContent('#timer-display')) === '05:00',
    `실제: ${await page.textContent('#timer-display')}`);

  await page.fill('#timer-min', '0');
  await page.fill('#timer-sec', '3');
  await page.dispatchEvent('#timer-sec', 'change');
  check('0분 3초 설정', (await page.textContent('#timer-display')) === '00:03',
    `실제: ${await page.textContent('#timer-display')}`);
  await page.click('#timer-start');
  await page.waitForTimeout(1600);
  const running = await page.textContent('#timer-display');
  // "MM:SS" 를 초 단위 숫자로 바꿔 비교합니다. (문자열 비교는 경계에서 불안정)
  const toSeconds = (t) => { const [m, sec] = t.split(':').map(Number); return m * 60 + sec; };
  check('타이머 카운트다운 동작', toSeconds(running) < 3, `3초 -> ${running}`);
  await page.click('#timer-reset');
  check('타이머 초기화', (await page.textContent('#timer-display')) === '00:03',
    `실제: ${await page.textContent('#timer-display')}`);

  await page.fill('#alarm-time', '07:30');
  await page.click('#alarm-set');
  check('알람 설정 표시', (await page.textContent('#alarm-status')).includes('07:30'),
    `실제: ${await page.textContent('#alarm-status')}`);

  // ---------- 5. 메모 · 낙서판 ----------
  console.log('\n▶ 메모 · 낙서판');
  await page.click('.tab[data-tab="memo"]');
  await page.waitForTimeout(300);

  await page.fill('#memo-input', '회의 3시\n장소: 2층');
  await page.click('#memo-form button[type="submit"]');
  check('메모 저장', (await page.locator('#memo-list .memo-item').count()) === 1);

  // 캔버스에 실제로 선을 그려 픽셀이 변했는지 확인
  const box = await page.locator('#draw-canvas').boundingBox();
  const blankPixels = await page.evaluate(() => {
    const c = document.querySelector('#draw-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n;
  });
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 110, { steps: 12 });
  await page.mouse.move(box.x + 240, box.y + 60, { steps: 12 });
  await page.mouse.up();
  const drawnPixels = await page.evaluate(() => {
    const c = document.querySelector('#draw-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n;
  });
  check('마우스로 캔버스에 그려짐', drawnPixels > blankPixels + 500,
    `빈 캔버스 ${blankPixels}px -> 그린 후 ${drawnPixels}px`);

  await page.click('#draw-save');
  await page.waitForTimeout(300);
  check('그림 저장 상태 표시', (await page.textContent('#draw-status')).includes('저장됨'),
    `실제: ${await page.textContent('#draw-status')}`);

  await page.click('#draw-undo');
  await page.waitForTimeout(400);
  const undonePixels = await page.evaluate(() => {
    const c = document.querySelector('#draw-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n += 1; return n;
  });
  check('되돌리기 동작', undonePixels < drawnPixels, `${drawnPixels}px -> ${undonePixels}px`);

  // ---------- 6. 글귀 ----------
  console.log('\n▶ 글귀');
  await page.click('.tab[data-tab="quote"]');
  const firstQuote = await page.textContent('#quote-text');
  check('기본 격언 표시', firstQuote.length > 3, `"${firstQuote.slice(0, 20)}…"`);
  await page.fill('#quote-input', '오늘의 집중이 내일을 만든다');
  await page.fill('#quote-author-input', '나');
  await page.click('#quote-form button[type="submit"]');
  check('내 글귀 등록', (await page.locator('#quote-list .memo-item').count()) === 1);
  check('등록 후 내 글귀가 표시됨', (await page.textContent('#quote-text')).includes('오늘의 집중'),
    `실제: ${await page.textContent('#quote-text')}`);

  // ---------- 7. 음악 ----------
  console.log('\n▶ 음악');
  await page.click('.tab[data-tab="music"]');
  await page.fill('#yt-input', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.click('#yt-form button[type="submit"]');
  await page.waitForSelector('#yt-holder iframe', { timeout: 5000 });
  const src = await page.getAttribute('#yt-holder iframe', 'src');
  check('YouTube 임베드 생성', src.includes('youtube-nocookie.com/embed/dQw4w9WgXcQ'), src);
  check('음악 서비스 바로가기 6개', (await page.locator('#svc-grid .svc-btn').count()) === 6);

  // ---------- 8. AI (키 없는 상태) ----------
  console.log('\n▶ AI 검색');
  await page.click('.tab[data-tab="ai"]');
  check('키 미설정 안내 표시', (await page.textContent('#ai-mode')).includes('키 미설정'),
    `실제: ${await page.textContent('#ai-mode')}`);
  await page.fill('#ai-input', '테스트 질문');
  await page.click('#ai-send');
  await page.waitForTimeout(400);
  check('키 없이 전송 시 안내 메시지', (await page.locator('.msg-err').count()) >= 1);

  // ---------- 9. 설정 ----------
  console.log('\n▶ 설정');
  await page.click('.tab[data-tab="settings"]');
  await page.fill('#set-banner', '집중 시간 | 오후 2시까지 마무리\n목표 | 주 3회 운동');
  await page.click('#set-banner-save');
  await page.waitForTimeout(300);
  check('배너 문구 반영', (await page.textContent('#banner-title')) === '집중 시간',
    `실제: ${await page.textContent('#banner-title')}`);
  check('배너 인디케이터 2개', (await page.locator('#banner-dots .banner-dot').count()) === 2);

  // 잘못된 API 키 형식 거부
  await page.fill('#set-apikey', 'wrong-key-format');
  await page.click('#set-apikey-save');
  await page.waitForTimeout(300);
  const toastText = await page.textContent('#toast');
  check('잘못된 형식의 API 키 거부', toastText.includes('sk-ant-'), `실제: ${toastText}`);

  // 테마 전환
  await page.selectOption('#set-theme', 'dark');
  await page.waitForTimeout(200);
  check('다크 테마 적용', (await page.getAttribute('html', 'data-theme')) === 'dark');
  await page.selectOption('#set-theme', 'light');
  await page.waitForTimeout(200);
  check('라이트 테마 적용', (await page.getAttribute('html', 'data-theme')) === 'light');

  // ---------- 10. 새로고침 후 데이터 유지 ----------
  console.log('\n▶ 영속성 / PWA');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  check('새로고침 후 설정 탭 복원', (await page.getAttribute('.tab[data-tab="settings"]', 'aria-selected')) === 'true');
  await page.click('.tab[data-tab="todo"]');
  await page.waitForTimeout(200);
  check('새로고침 후 Planner 단위/기간 복원',
    (await page.getAttribute('.scope-tab[data-scope="day"]', 'aria-selected')) === 'true');
  const dayPlansAfterReload = await page.locator('#todo-list .todo-item').count();
  check('새로고침 후 Day 계획 유지', dayPlansAfterReload === dayPlanCount,
    `새로고침 전 ${dayPlanCount}건 -> 후 ${dayPlansAfterReload}건`);
  check('새로고침 후 선택한 언어(영어) 유지',
    (await page.textContent('.scope-tab[data-scope="day"]')) === 'Day',
    await page.textContent('.scope-tab[data-scope="day"]'));
  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(150);
  check('새로고침 후 설정 탭 버튼 상태도 복원',
    (await page.getAttribute('.lang-btn[data-lang="en"]', 'aria-pressed')) === 'true');
  await page.click('.tab[data-tab="todo"]');
  await page.click('.tab[data-tab="memo"]');
  await page.waitForTimeout(400);
  check('새로고침 후 메모 유지', (await page.locator('#memo-list .memo-item').count()) === 1);
  await page.click('.tab[data-tab="todo"]');
  await page.waitForTimeout(200);

  if (IS_FILE) {
    // 단일 파일 빌드에서는 서비스 워커를 등록하지 않는 것이 정상 동작입니다.
    const swSkipped = await page.evaluate(async () => {
      // file:// 은 origin 이 null 이라 getRegistration() 자체가 SecurityError 를 던집니다.
      // 즉 등록이 시도되지 않았다는 뜻이므로 예외도 정상으로 취급합니다.
      try {
        if (!('serviceWorker' in navigator)) return true;
        const reg = await navigator.serviceWorker.getRegistration();
        return !reg;
      } catch {
        return true;
      }
    });
    check('단일 파일: 서비스 워커 등록 시도 안 함', swSkipped);
    const uidOk = await page.evaluate(() => {
      const el = document.querySelector('#todo-list .todo-item');
      return !!el; // 항목이 만들어졌다면 uid() 가 정상 동작한 것
    });
    check('단일 파일: uid() 동작 (보안 컨텍스트 무관)', uidOk);
  } else {
    const swState = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? (reg.active ? 'active' : 'registered') : 'none';
    });
    check('서비스 워커 등록', swState === 'active' || swState === 'registered', `상태: ${swState}`);

    const manifestOk = await page.evaluate(async () => {
      const res = await fetch('./manifest.webmanifest');
      const json = await res.json();
      return res.ok && json.icons?.length === 3 && json.start_url === './';
    });
    check('manifest 유효', manifestOk);
  }

  // ---------- 11. 스크린샷 ----------
  await page.click('.tab[data-tab="calc"]');
  await page.fill('#calc-expr', '(1250+890)*1.1');
  await page.press('#calc-expr', 'Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: IS_FILE ? shot('screenshot-standalone.png') : shot('screenshot-desktop.png'), fullPage: false });

  await page.click('.tab[data-tab="weather"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: IS_FILE ? shot('screenshot-standalone-weather.png') : shot('screenshot-weather.png'), fullPage: false });

  // 모바일 뷰포트
  const mobile = await context.newPage();
  await mobile.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('body[data-ready="true"]');
  await mobile.click('.tab[data-tab="calc"]');
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: IS_FILE ? shot('screenshot-standalone-mobile.png') : shot('screenshot-mobile.png'), fullPage: false });

  // 모바일에서 가로 스크롤이 생기지 않아야 함.
  // 탭 하나만 보면 놓칩니다. 실제로 '오늘' 탭의 긴 할 일 제목이 그리드 칼럼을 밀어
  // 화면 전체에 가로 스크롤을 만든 적이 있는데, 계산기 탭만 보던 검사는 통과했습니다.
  // 본문이 가로 페이저가 된 뒤로 document 의 scrollWidth 는 페이저 전체 폭을 담습니다.
  // 그래서 문서가 아니라 '패널 하나하나가 제 폭을 넘기는지'를 봅니다.
  // 원래 잡으려던 문제(긴 할 일 제목이 그리드 칼럼을 벌리는 것)가 바로 이 형태입니다.
  const overflowing = await mobile.evaluate(() => [...document.querySelectorAll('.panel')]
    .map((p) => ({ id: p.id, over: p.scrollWidth - p.clientWidth }))
    .filter((r) => r.over > 1)
    .map((r) => `${r.id}(+${r.over}px)`));
  check('모바일(390px) 모든 탭에서 가로 넘침 없음', overflowing.length === 0,
    overflowing.length ? `넘친 패널: ${overflowing.join(', ')}` : '전부 정상');
  await mobile.close();

  // ---------- 11-a. 커스터마이즈 (테마 · 탭 · 위젯 · 카드 크기) ----------
  console.log('\n▶ 커스터마이즈');
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#customize .cz-section');

  // 편집 UI 가 실제로 그려졌는지부터 확인합니다. 빈 상자면 아래 검사가 전부 무의미합니다.
  check('커스터마이즈 UI 렌더링', (await page.locator('#customize .cz-section').count()) === 5,
    `${await page.locator('#customize .cz-section').count()}개 구역`);

  const rootAttr = (name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
  const cssVar = (name) => page.evaluate((n) => (
    getComputedStyle(document.documentElement).getPropertyValue(n).trim()), name);

  // --- 스킨 ---
  const radiusBefore = await cssVar('--radius');
  await page.click('#customize [data-skin-opt="cute"]');
  await page.waitForTimeout(120);
  check('스킨 선택이 문서에 반영됨', (await rootAttr('data-skin')) === 'cute',
    `data-skin=${await rootAttr('data-skin')}`);
  const radiusCute = await cssVar('--radius');
  // 속성만 붙고 CSS 가 안 걸리면 아무것도 안 바뀝니다. 실제 계산값을 봅니다.
  check('스킨이 실제 모양을 바꿈 (모서리 반경)', radiusCute !== radiusBefore && radiusCute === '22px',
    `${radiusBefore} -> ${radiusCute}`);

  await page.click('#customize [data-skin-opt="default"]');
  await page.waitForTimeout(120);
  check('기본 스킨은 속성을 지움', (await rootAttr('data-skin')) === null,
    String(await rootAttr('data-skin')));

  // --- 강조색 ---
  const accentBefore = await cssVar('--accent');
  await page.click('#customize [data-accent-opt="pink"]');
  await page.waitForTimeout(120);
  check('강조색 선택이 문서에 반영됨', (await rootAttr('data-accent')) === 'pink');
  const accentPink = await cssVar('--accent');
  check('강조색이 실제로 바뀜', accentPink !== accentBefore && accentPink.length > 0,
    `${accentBefore} -> ${accentPink}`);

  // --- 스킨 x 다크 모드 ---
  // 스킨마다 라이트/다크 값을 따로 적어야 하므로, 한쪽만 넣고 빠뜨리기 쉽습니다.
  await page.click('#customize [data-skin-opt="cute"]');
  await page.selectOption('#set-theme', 'dark');
  await page.waitForTimeout(150);
  const cuteDarkBg = await cssVar('--bg');
  check('스킨이 다크 모드에서도 제 색을 씀', cuteDarkBg === '#221a20',
    `--bg=${cuteDarkBg} (기대 #221a20)`);
  await page.selectOption('#set-theme', 'light');
  await page.waitForTimeout(150);
  check('스킨이 라이트 모드에서도 제 색을 씀', (await cssVar('--bg')) === '#fdf7fb',
    `--bg=${await cssVar('--bg')}`);

  // --- 동작 줄이기가 스킨의 모션을 이긴다 ---
  // '미래' 스킨은 전환을 길게 잡습니다. OS 설정이 켜지면 반드시 0 이어야 합니다.
  await page.click('#customize [data-skin-opt="future"]');
  await page.waitForTimeout(120);
  const motionOn = await cssVar('--motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(120);
  const motionReduced = await cssVar('--motion');
  check('동작 줄이기가 스킨 모션을 이김', motionOn === '.42s' && motionReduced === '0s',
    `기본 ${motionOn} -> 줄이기 ${motionReduced}`);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.click('#customize [data-skin-opt="default"]');
  await page.selectOption('#set-theme', 'auto');
  await page.waitForTimeout(120);

  // --- 카드 크기 ---
  const padOf = (sel) => page.evaluate((s2) => (
    getComputedStyle(document.querySelector(s2)).paddingTop), sel);
  const padBefore = await padOf('[data-card="calc.hist"]');
  await page.click('#customize [data-card-row="calc.hist"] [data-size-opt="large"]');
  await page.waitForTimeout(120);
  check('카드 크기 속성 반영', (await page.getAttribute('[data-card="calc.hist"]', 'data-size')) === 'large');
  const padLarge = await padOf('[data-card="calc.hist"]');
  check('카드 크기가 실제 여백을 바꿈', padLarge !== padBefore && padLarge === '22px',
    `${padBefore} -> ${padLarge}`);
  const listH = await page.evaluate(() => (
    getComputedStyle(document.querySelector('#calc-history')).maxHeight));
  check('카드 크기가 목록 스크롤 높이도 바꿈', listH === '520px', listH);

  // --- 오늘 위젯 ---
  const widgetNames = () => page.evaluate(() => (
    [...document.querySelectorAll('#today-widgets [data-widget]')].map((n) => n.dataset.widget)));
  await page.click('#customize .cz-section:nth-of-type(4) .cz-row[data-row="clock"] .cz-toggle');
  await page.waitForTimeout(150);
  check('위젯을 켜면 오늘 탭에 추가됨', (await widgetNames()).includes('clock'),
    (await widgetNames()).join(', '));

  await page.click('#customize .cz-section:nth-of-type(4) .cz-row[data-row="weather"] .cz-toggle');
  await page.waitForTimeout(150);
  check('위젯을 끄면 사라짐', !(await widgetNames()).includes('weather'),
    (await widgetNames()).join(', '));

  // 시계 위젯이 실제로 시간을 보여주는지 (껍데기만 그리고 끝나는 경우를 잡습니다)
  await page.click('.tab[data-tab="today"]');
  await page.waitForTimeout(200);
  const widgetClock = (await page.textContent('#today-clock')) || '';
  check('시계 위젯이 시각을 표시함', /^\d{2}:\d{2}:\d{2}$/.test(widgetClock.trim()), widgetClock);

  // 위젯을 누르면 해당 탭으로 이동해야 합니다.
  await page.click('#today-clock');
  await page.waitForTimeout(400);
  check('위젯을 누르면 해당 탭으로 이동',
    (await page.getAttribute('.tab[data-tab="time"]', 'aria-selected')) === 'true');

  // --- 탭 순서와 숨김 ---
  const tabOrder = () => page.evaluate(() => (
    [...document.querySelectorAll('#tabs .tab')].map((b) => b.dataset.tab)));
  const panelOrder = () => page.evaluate(() => (
    [...document.querySelectorAll('#main .panel')].map((p2) => p2.id.replace('panel-', ''))));

  await page.click('.tab[data-tab="settings"]');
  await page.waitForTimeout(150);
  const orderBefore = await tabOrder();
  await page.click('#customize .cz-section:nth-of-type(3) .cz-row[data-row="calc"] [data-move="up"]');
  await page.waitForTimeout(200);
  const orderAfter = await tabOrder();
  check('탭 순서를 위로 옮김', orderAfter[0] === 'calc' && orderBefore[0] === 'today',
    `${orderBefore.slice(0, 3).join(',')} -> ${orderAfter.slice(0, 3).join(',')}`);
  // 버튼만 옮기고 패널을 안 옮기면 스와이프했을 때 엉뚱한 화면이 나옵니다.
  check('패널 순서도 함께 바뀜',
    JSON.stringify(await panelOrder()) === JSON.stringify(orderAfter),
    (await panelOrder()).slice(0, 3).join(','));

  await page.click('#customize .cz-section:nth-of-type(3) .cz-row[data-row="music"] .cz-toggle');
  await page.waitForTimeout(200);
  check('숨긴 탭은 버튼과 패널에서 모두 빠짐',
    !(await tabOrder()).includes('music') && !(await panelOrder()).includes('music'),
    (await tabOrder()).join(','));

  const lockedDisabled = await page.evaluate(() => (
    document.querySelector('#customize .cz-section:nth-of-type(3) .cz-row[data-row="settings"] .cz-toggle')?.disabled === true));
  check('설정 탭은 숨길 수 없음 (되돌릴 길이 사라지므로)', lockedDisabled === true);

  // --- 새로고침 후에도 유지 ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(250);
  check('새로고침 후 강조색 유지', (await rootAttr('data-accent')) === 'pink');
  check('새로고침 후 탭 순서 유지', (await tabOrder())[0] === 'calc',
    (await tabOrder()).slice(0, 3).join(','));
  check('새로고침 후 숨김 유지', !(await tabOrder()).includes('music'));
  check('새로고침 후 카드 크기 유지',
    (await page.getAttribute('[data-card="calc.hist"]', 'data-size')) === 'large');
  check('새로고침 후 위젯 구성 유지', (await widgetNames()).includes('clock'),
    (await widgetNames()).join(', '));

  // --- 초기화 ---
  await page.click('.tab[data-tab="settings"]');
  await page.waitForSelector('#customize .cz-section');
  page.once('dialog', (d) => d.accept());
  await page.click('#cz-reset');
  await page.waitForTimeout(250);
  check('초기화: 강조색이 기본으로', (await rootAttr('data-accent')) === null,
    String(await rootAttr('data-accent')));
  check('초기화: 탭 순서가 기본으로', (await tabOrder())[0] === 'today',
    (await tabOrder()).slice(0, 3).join(','));
  check('초기화: 숨긴 탭이 돌아옴', (await tabOrder()).includes('music'));
  check('초기화: 카드 크기가 기본으로',
    (await page.getAttribute('[data-card="calc.hist"]', 'data-size')) === null);

  // 스와이프 인덱스가 새 순서로 다시 계산되는지. 탭 개수가 바뀐 뒤 가장 깨지기 쉬운 부분입니다.
  await page.click('.tab[data-tab="weather"]');
  // 부드러운 스크롤이 끝날 때까지 기다립니다. 고정 대기는 느린 CI 에서 흔들립니다.
  let czLeft = -1;
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => document.querySelector('#main').scrollLeft);
    if (now === czLeft) break;
    czLeft = now;
    await page.waitForTimeout(100);
  }
  const snapOk = await page.evaluate(() => {
    const main = document.querySelector('#main');
    const tabs = [...document.querySelectorAll('#tabs .tab')].map((b) => b.dataset.tab);
    const i = tabs.indexOf('weather');
    return Math.abs(main.scrollLeft - i * main.clientWidth) < 4;
  });
  check('탭 구성이 바뀐 뒤에도 페이저 위치가 맞음', snapOk === true);

  // ---------- 11-b. 넓고 긴 화면에서 세로 여백 ----------
  // .panel 은 플렉스 아이템이라 화면 높이만큼 늘어나고 그 위에 display:grid 가 얹힙니다.
  // 그리드의 align-content 기본값(normal = stretch)은 남는 세로 공간을 행 사이에 나눠 넣어,
  // 카드가 적은 '오늘' 탭에서 날짜 줄과 카드 사이가 500px 넘게 벌어졌습니다.
  // 모바일(390x844)에서는 내용이 화면을 채워 드러나지 않으므로 넓고 긴 창으로 따로 봅니다.
  const desktop = await browser.newPage();
  await desktop.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  await desktop.setViewportSize({ width: 1440, height: 1200 });
  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.waitForSelector('body[data-ready="true"]');
  await desktop.waitForTimeout(300);

  const headToCard = await desktop.evaluate(() => {
    const panel = document.querySelector('#panel-today');
    const head = panel.querySelector('.today-head');
    const card = panel.querySelector('#today-weather-card');
    if (!head || !card) return -1;
    return Math.round(card.getBoundingClientRect().top - head.getBoundingClientRect().bottom);
  });
  // gap 은 14px 입니다. 여유를 둬도 40px 을 넘으면 늘어난 것입니다.
  check('넓은 화면 오늘 탭: 날짜 줄과 카드가 붙어 있음', headToCard >= 0 && headToCard <= 40,
    `간격 ${headToCard}px (기대 <= 40)`);

  const stretched = await desktop.evaluate(() => [...document.querySelectorAll('.panel.grid')]
    .filter((p) => !['start', 'flex-start'].includes(getComputedStyle(p).alignContent))
    .map((p) => `${p.id}(${getComputedStyle(p).alignContent})`));
  check('모든 그리드 패널이 위에서부터 쌓임', stretched.length === 0,
    stretched.length ? stretched.join(', ') : '전부 start');
  await desktop.close();

  // ---------- 12. 콘솔 에러 ----------
  console.log('\n▶ 콘솔');
  const realErrors = consoleErrors.filter((e) =>
    !e.includes('favicon') && !e.includes('net::ERR_') && !e.toLowerCase().includes('manifest'));
  check('페이지 JS 예외 없음', pageErrors.length === 0, pageErrors.join(' | ') || '없음');
  check('콘솔 에러 없음', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '없음');

  await browser.close();
  if (httpServer) await new Promise((done) => httpServer.close(done));

  // ---------- 요약 ----------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${'='.repeat(56)}`);
  console.log(`결과: ${passed}/${results.length} 통과${failed ? `, ${failed} 실패` : ''}`);
  if (failed) {
    console.log('\n실패 항목:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  ❌ ${r.name} — ${r.detail}`));
  }
  console.log('='.repeat(56));
  process.exit(failed ? 1 : 0);
};

main().catch((err) => { console.error('\n치명적 오류:', err); process.exit(2); });
