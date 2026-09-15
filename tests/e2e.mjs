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

/**
 * 탭 이동. 탭 버튼은 이제 '•••' 메뉴 서랍 안에만 있습니다.
 * 서랍을 열고 -> 고르고 -> 닫히는 것까지 기다립니다.
 * (고르면 자동으로 닫히는 것이 앱의 동작이라, 닫힘까지 확인해야 다음 조작이 안 막힙니다)
 */
async function goTab(pg, name) {
  if (await pg.locator('#sidebar').isHidden()) await pg.click('#menu-open');
  await pg.click(`.tab[data-tab="${name}"]`);
  await pg.waitForSelector('#sidebar', { state: 'hidden' });
  /*
   * 탭 전환은 부드러운 스크롤이라 클릭 직후에는 아직 움직이는 중입니다.
   * 여기서 기다리지 않으면 호출하는 쪽마다 고정 대기를 넣게 되고,
   * 느린 CI 에서 그 값이 모자라 실패합니다. (실제로 두 건이 그렇게 깨졌습니다)
   */
  await settlePagerOf(pg);
}

/*
 * 가로 페이저가 멈출 때까지 기다립니다.
 * 탭 전환은 부드러운 스크롤이라 즉시 끝나지 않고, 스크롤 도중에는
 * watchPagerScroll 의 정착 처리가 중간 패널을 활성 탭으로 잡습니다.
 * 고정 대기로는 느린 CI 에서 여러 장을 다 넘기지 못해 실제로 실패했습니다.
 */
/**
 * 이월·완료 삭제는 '⋯' 안으로 들어갔습니다. (늘 펼쳐 두면 입력줄이 묻힙니다)
 * 열려 있지 않으면 눌러도 닿지 않으므로 여기서 먼저 엽니다.
 */
async function openMore(pg) {
  if (!(await pg.evaluate(() => document.querySelector('#todo-more')?.open))) {
    await pg.click('#todo-more > summary');
  }
}

async function settlePagerOf(pg) {
  let prev = -1;
  for (let i = 0; i < 50; i += 1) {
    const now = await pg.evaluate(() => document.querySelector('#main')?.scrollLeft ?? -1);
    if (now === prev) return now;
    prev = now;
    await pg.waitForTimeout(100);
  }
  return prev;
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
  await goTab(page, 'calc');
  const press = async (label) => { await page.click(`#keypad button:text-is("${label}")`); };

  await press('7'); await press('×'); await press('8'); await press('=');
  check('키패드 7 × 8 = 56', (await page.textContent('#calc-result')) === '56',
    `실제: ${await page.textContent('#calc-result')}`);

  await press('AC');
  check('AC 로 초기화', (await page.textContent('#calc-result')) === '0');

  /*
   * = 뒤에 이어서 계산하기.
   * = 를 누르면 포커스가 그 버튼으로 옮겨 가 수식 칸의 커서가 0 으로 초기화됐고,
   * 그 자리에 입력이 끼어들어 1+2= 뒤에 +1 을 누르면 "+13" 이 되어 13 이 나왔습니다.
   */
  await press('AC');
  await press('1'); await press('+'); await press('2'); await press('=');
  check('1+2= 는 3', (await page.textContent('#calc-result')) === '3',
    `실제: ${await page.textContent('#calc-result')}`);
  await press('+'); await press('1');
  check('= 뒤에 연산자를 누르면 결과에 이어 붙음 (3+1)',
    (await page.inputValue('#calc-expr')) === '3+1',
    `실제 수식: ${await page.inputValue('#calc-expr')}`);
  await press('=');
  check('이어서 계산한 결과가 4', (await page.textContent('#calc-result')) === '4',
    `실제: ${await page.textContent('#calc-result')}`);

  // 보통 계산기는 = 뒤에 숫자를 누르면 새 식을 시작합니다.
  await press('AC');
  await press('5'); await press('+'); await press('5'); await press('=');
  await press('7');
  check('= 뒤에 숫자를 누르면 새 식 시작 (10 다음 7 -> 7)',
    (await page.inputValue('#calc-expr')) === '7',
    `실제 수식: ${await page.inputValue('#calc-expr')}`);
  await press('AC');

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
  await goTab(page, 'quote');
  await page.waitForTimeout(400);
  await page.keyboard.press('7');
  await page.keyboard.press('7');
  await page.waitForTimeout(150);
  check('다른 탭에서 누른 숫자가 계산기로 새지 않음',
    (await page.inputValue('#calc-expr')) === '',
    `실제: ${await page.inputValue('#calc-expr')}`);
  await goTab(page, 'calc');
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
  await goTab(page, 'todo');
  await page.waitForSelector('#scope-tabs', { timeout: 5000 });

  // 언어 전환은 설정 탭에 있으므로, 거기서 바꾸고 TO DO 로 돌아옵니다.
  const setLanguage = async (lang) => {
    await goTab(page, 'settings');
    await page.waitForSelector('#lang-switch', { timeout: 5000 });
    await page.click(`.lang-btn[data-lang="${lang}"]`);
    await page.waitForTimeout(150);
    await goTab(page, 'todo');
    await page.waitForTimeout(150);
  };


  // 언어 전환은 설정 탭에 있습니다 (TO DO 카드에는 없어야 함)
  check('TO DO 카드에는 언어 버튼이 없음',
    (await page.locator('#panel-todo .lang-switch').count()) === 0);
  await goTab(page, 'settings');
  await page.waitForTimeout(150);
  check('설정 탭에 언어 전환이 있음', (await page.locator('#panel-settings #lang-switch').count()) === 1);
  check('기본 언어 한국어', (await page.getAttribute('.lang-btn[data-lang="ko"]', 'aria-pressed')) === 'true');
  const langBox = await page.locator('.lang-btn[data-lang="ko"]').boundingBox();
  check('언어 버튼이 충분히 큼 (최소 높이 36px)', langBox.height >= 36, `실제 ${Math.round(langBox.height)}px`);
  await goTab(page, 'todo');
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
  await openMore(page);
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
  ]) {
    check(`영어 전환 — ${expected}`, (await page.textContent(sel)).trim() === expected,
      `실제: ${(await page.textContent(sel)).trim()}`);
  }
  check('영어 전환 — 패널 lang 속성', (await page.getAttribute('#panel-todo', 'lang')) === 'en',
    `실제: ${await page.getAttribute('#panel-todo', 'lang')}`);
  check('사용자 입력 영역은 lang 고정', (await page.getAttribute('#todo-list', 'lang')) === 'ko');
  check('이월 버튼에 설명 title', (await page.getAttribute('#todo-carry', 'title')).includes('previous period'),
    await page.getAttribute('#todo-carry', 'title'));
  check('분류 편집 버튼이 영어로', (await page.getAttribute('[data-cat-edit]', 'aria-label')) === 'Edit categories',
    await page.getAttribute('[data-cat-edit]', 'aria-label'));

  // 한국어로 되돌리기 (역방향 전환)
  await setLanguage('ko');
  check('한국어 복귀 — 단위 라벨', (await page.textContent('.scope-tab[data-scope="day"]')) === '일간');
  check('한국어 복귀 — 패널 lang', (await page.getAttribute('#panel-todo', 'lang')) === 'ko');
  await goTab(page, 'settings');
  await page.waitForTimeout(150);
  check('한국어 복귀 — 이전 버튼 눌림 해제',
    (await page.getAttribute('.lang-btn[data-lang="en"]', 'aria-pressed')) === 'false');
  await goTab(page, 'todo');
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
  await openMore(page);
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
    const before = await page.locator('#todo-list .todo-item').count();
    if (sc === 'week') {
      // 주간은 그 주에 적힌 주간 목표뿐 아니라 그 주 7일의 일간 계획도 함께 보여 줍니다.
      check('주간은 그 주의 일간 계획도 함께 보여 줌', before >= 1, `${before}건`);
    } else {
      check(`${sc} 단위는 빈 목록에서 시작`, before === 0, `${before}건`);
    }
    await addPlan(text);
    check(`${sc} 계획 추가`,
      (await page.locator('#todo-list .todo-item').count()) === before + 1,
      `${before} -> ${await page.locator('#todo-list .todo-item').count()}`);
  }

  // 단위를 바꿔도 '오늘'이 든 기간을 보고 있었다면 오늘로 돌아와야 합니다.
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(150);
  check('오늘이 든 기간에서 단위를 바꾸면 오늘로',
    await page.evaluate(() => document.querySelector('#period-label').classList.contains('is-current')),
    await page.textContent('#period-label'));

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
  await goTab(page, 'weather');
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
  await goTab(page, 'todo');
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(120);
  for (const text of ['오늘 A', '오늘 B', '오늘 C', '오늘 D',
    '월말 정산 자료 취합하고 팀 전체에 공유하기 — 줄바꿈 없는 아주 긴 제목으로 가로 넘침을 확인합니다']) {
    await page.fill('#todo-input', text);
    await page.press('#todo-input', 'Enter');
  }

  // 새로고침 뒤 유지되는지 확인할 때 쓸 기준값입니다. (고정 숫자를 박으면 검사 추가마다 깨집니다)
  const dayPlanCount = await page.locator('#todo-list .todo-item').count();

  await goTab(page, 'today');
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
  await goTab(page, 'today');
  await page.click('#today-weather-card');
  // 오늘(0번째)에서 날씨(2번째)까지 부드럽게 스크롤합니다. 200ms 로는 느린 CI 에서 모자랍니다.
  await settlePagerOf(page);
  check('날씨 카드 클릭 -> 날씨 탭으로 이동',
    (await page.getAttribute('.tab[data-tab="weather"]', 'aria-selected')) === 'true',
    `실제 활성 탭: ${await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]')?.dataset.tab)}`);

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
  await goTab(sp, 'settings');
  const lastLeft = await settlePager();
  const urlBeforeLastEdge = sp.url();
  await swipe(-W * 0.7);
  // 픽셀이 아니라 '몇 번째 장인가'로 봅니다. 스냅 위치가 1~2px 어긋나도 의미는 같습니다.
  const lastIndex = Math.round(lastLeft / W);
  check('마지막 장에서 더 쓸어도 제자리이고 앱을 벗어나지 않음',
    Math.round((await pagerLeft()) / W) === lastIndex && sp.url() === urlBeforeLastEdge,
    `${lastIndex}번째 장 유지 여부: scrollLeft ${lastLeft} -> ${await pagerLeft()}, url ${sp.url().slice(-20)}`);

  // 탭 버튼으로도 같은 자리로 가야 합니다.
  await goTab(sp, 'today');
  await settlePager();
  await goTab(sp, 'settings');
  const settingsLeft = await settlePager();
  // 탭 개수는 바뀔 수 있으므로(음악 제거 등) 고정 숫자 대신 실제 목록에서 자리를 셉니다.
  const settingsIndex = await sp.evaluate(() => (
    [...document.querySelectorAll('#tabs .tab')].findIndex((b) => b.dataset.tab === 'settings')));
  check('탭 버튼을 누르면 그 장으로 스크롤', Math.round(settingsLeft / W) === settingsIndex,
    `기대 ${settingsIndex}번째 장(${W * settingsIndex}), 실제 ${settingsLeft}`);

  // 낙서판 위에서는 페이저가 움직이면 안 됩니다 (그림이 끊깁니다).
  await goTab(sp, 'memo');
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
  await goTab(page, 'time');
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
  await goTab(page, 'memo');
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
  await goTab(page, 'quote');
  const firstQuote = await page.textContent('#quote-text');
  check('기본 격언 표시', firstQuote.length > 3, `"${firstQuote.slice(0, 20)}…"`);
  await page.fill('#quote-input', '오늘의 집중이 내일을 만든다');
  await page.fill('#quote-author-input', '나');
  await page.click('#quote-form button[type="submit"]');
  check('내 글귀 등록', (await page.locator('#quote-list .memo-item').count()) === 1);
  check('등록 후 내 글귀가 표시됨', (await page.textContent('#quote-text')).includes('오늘의 집중'),
    `실제: ${await page.textContent('#quote-text')}`);

  // ---------- 8. AI (키 없는 상태) ----------
  console.log('\n▶ AI 검색');
  await goTab(page, 'ai');
  check('키 미설정 안내 표시', (await page.textContent('#ai-mode')).includes('키 미설정'),
    `실제: ${await page.textContent('#ai-mode')}`);
  await page.fill('#ai-input', '테스트 질문');
  await page.click('#ai-send');
  await page.waitForTimeout(400);
  check('키 없이 전송 시 안내 메시지', (await page.locator('.msg-err').count()) >= 1);

  // ---------- 9. 설정 ----------
  console.log('\n▶ 설정');
  await goTab(page, 'settings');
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
  await goTab(page, 'todo');
  await page.waitForTimeout(200);
  check('새로고침 후 Planner 단위/기간 복원',
    (await page.getAttribute('.scope-tab[data-scope="day"]', 'aria-selected')) === 'true');
  const dayPlansAfterReload = await page.locator('#todo-list .todo-item').count();
  check('새로고침 후 Day 계획 유지', dayPlansAfterReload === dayPlanCount,
    `새로고침 전 ${dayPlanCount}건 -> 후 ${dayPlansAfterReload}건`);
  check('새로고침 후 선택한 언어(영어) 유지',
    (await page.textContent('.scope-tab[data-scope="day"]')) === 'Day',
    await page.textContent('.scope-tab[data-scope="day"]'));
  await goTab(page, 'settings');
  await page.waitForTimeout(150);
  check('새로고침 후 설정 탭 버튼 상태도 복원',
    (await page.getAttribute('.lang-btn[data-lang="en"]', 'aria-pressed')) === 'true');
  await goTab(page, 'todo');
  await goTab(page, 'memo');
  await page.waitForTimeout(400);
  check('새로고침 후 메모 유지', (await page.locator('#memo-list .memo-item').count()) === 1);
  await goTab(page, 'todo');
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
  await goTab(page, 'calc');
  await page.fill('#calc-expr', '(1250+890)*1.1');
  await page.press('#calc-expr', 'Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: IS_FILE ? shot('screenshot-standalone.png') : shot('screenshot-desktop.png'), fullPage: false });

  await goTab(page, 'weather');
  await page.waitForTimeout(500);
  await page.screenshot({ path: IS_FILE ? shot('screenshot-standalone-weather.png') : shot('screenshot-weather.png'), fullPage: false });

  // 모바일 뷰포트
  const mobile = await context.newPage();
  await mobile.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('body[data-ready="true"]');
  await goTab(mobile, 'calc');
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: IS_FILE ? shot('screenshot-standalone-mobile.png') : shot('screenshot-mobile.png'), fullPage: false });

  // 모바일에서 가로 스크롤이 생기지 않아야 함.
  // 탭 하나만 보면 놓칩니다. 실제로 '오늘' 탭의 긴 할 일 제목이 그리드 칼럼을 밀어
  // 화면 전체에 가로 스크롤을 만든 적이 있는데, 계산기 탭만 보던 검사는 통과했습니다.
  // 본문이 가로 페이저가 된 뒤로 document 의 scrollWidth 는 페이저 전체 폭을 담습니다.
  // 그래서 문서가 아니라 '패널 하나하나가 제 폭을 넘기는지'를 봅니다.
  // 원래 잡으려던 문제(긴 할 일 제목이 그리드 칼럼을 벌리는 것)가 바로 이 형태입니다.
  const findOverflow = () => mobile.evaluate(() => [...document.querySelectorAll('.panel')]
    .map((p) => ({ id: p.id, over: p.scrollWidth - p.clientWidth, node: p }))
    .filter((r) => r.over > 1)
    .map((r) => {
      // 어느 요소가 밀고 있는지까지 알려 줘야 고칠 수 있습니다. 숫자만으로는 찾는 데 한참 걸립니다.
      const right = r.node.getBoundingClientRect().right;
      const blame = [...r.node.querySelectorAll('*')]
        .filter((n) => { const b = n.getBoundingClientRect(); return b.width && b.right > right + 0.5; })
        .slice(0, 3)
        .map((n) => `${n.tagName.toLowerCase()}.${(n.className || n.id || '?').toString().split(' ')[0]}`);
      return `${r.id}(+${r.over}px${blame.length ? ` ← ${blame.join(', ')}` : ''})`;
    }));

  /*
   * 폭을 하나만 보면 놓칩니다.
   * 실제로 390px 은 멀쩡한데 320px 에서만 달력 카드가 화면을 넘긴 적이 있습니다.
   * (세로 flex 배치에서 .grid 의 align-items:start 가 가로축에 걸려 카드가 내용 폭만큼 부풀었습니다)
   */
  for (const w of [320, 360, 390]) {
    await mobile.setViewportSize({ width: w, height: 844 });
    await mobile.waitForTimeout(250);
    const over = await findOverflow();
    check(`모바일(${w}px) 모든 탭에서 가로 넘침 없음`, over.length === 0,
      over.length ? `넘친 패널: ${over.join(', ')}` : '전부 정상');
  }
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.waitForTimeout(200);
  await mobile.close();

  // ---------- 10-a. 앱 업데이트 ----------
  console.log('\n▶ 앱 업데이트');
  await goTab(page, 'settings');
  await page.waitForSelector('#update-body');
  check('업데이트 카드가 그려짐', (await page.locator('#update-action').count()) === 1);
  check('업데이트 카드가 설정 탭 맨 아래에 있음',
    await page.evaluate(() => {
      const last = document.querySelector('#panel-settings')?.lastElementChild;
      return last?.dataset?.card === 'settings.update';
    }),
    await page.evaluate(() => document.querySelector('#panel-settings')?.lastElementChild?.dataset?.card));
  check('현재 버전 표시', ((await page.textContent('#update-body')) || '').includes('dev'),
    (await page.textContent('#update-body'))?.slice(0, 60));

  if (IS_FILE) {
    // 단일 파일은 서비스 워커를 쓸 수 없으므로 '확인할 수 없음' 이라고 정확히 말해야 합니다.
    await page.click('#update-action');
    await page.waitForTimeout(300);
    check('단일 파일에서는 확인 불가라고 안내',
      (await page.getAttribute('#update-msg', 'data-state')) === 'none',
      await page.getAttribute('#update-msg', 'data-state'));
  } else {
    await page.click('#update-action');
    // 서비스 워커에 물어보는 동안 '확인 중' 을 거쳐 결론이 나야 합니다.
    await page.waitForFunction(
      () => ['latest', 'ready', 'error', 'none'].includes(
        document.querySelector('#update-msg')?.dataset.state),
      null, { timeout: 15000 },
    );
    const updState = await page.getAttribute('#update-msg', 'data-state');
    // sw.js 가 그대로이므로 새 버전은 없습니다. 있다고 나오면 잘못 판정한 것입니다.
    check('바뀐 것이 없으면 최신이라고 답함', updState === 'latest',
      `상태: ${updState} / ${await page.textContent('#update-msg')}`);
    check('업데이트 버튼이 다시 눌리는 상태로 돌아옴',
      (await page.isDisabled('#update-action')) === false);
  }

  /*
   * 앱(안드로이드) 경로는 실기가 없어도 검증할 수 있습니다.
   * Capacitor 전역을 심어 네이티브로 인식시키고, version.js 를 찍힌 것처럼 바꿔 치고,
   * GitHub 릴리스 응답을 흉내 냅니다. 이렇게 하지 않으면 이 경로는 한 번도 안 돌아 봅니다.
   */
  if (!IS_FILE) {
    console.log('\n▶ 앱 업데이트 (네이티브 모의)');
    const SHA_OLD = '1'.repeat(40);
    const SHA_NEW = '2'.repeat(40);

    const nativeCheck = async (releaseSha, label, expect) => {
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => {
        window.Capacitor = { isNativePlatform: () => true };
      });
      // 설치된 빌드의 커밋을 SHA_OLD 로 고정합니다.
      await ctx.route('**/js/lib/version.js', (route) => route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `export const BUILD = Object.freeze({ commit: '${'1'.repeat(40)}', builtAt: '2026-01-01T00:00:00.000Z' });
export function shortVersion() { return BUILD.commit.slice(0, 7); }
export function isStamped() { return /^[0-9a-f]{40}$/.test(BUILD.commit); }`,
      }));
      await ctx.route('**/api.github.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ target_commitish: releaseSha }),
      }));
      await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
      }));
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await goTab(np, 'settings');
      await np.waitForSelector('#update-action');
      const note = (await np.textContent('#update-body')) || '';
      await np.click('#update-action');
      await np.waitForFunction(
        () => ['latest', 'ready', 'error', 'none'].includes(
          document.querySelector('#update-msg')?.dataset.state),
        null, { timeout: 15000 },
      );
      const got = await np.getAttribute('#update-msg', 'data-state');
      const btn = (await np.textContent('#update-action')) || '';
      await ctx.close();
      return { got, btn, note };
    };

    /*
     * 앱에서는 서비스 워커를 등록하면 안 됩니다.
     *
     * 웹 자산이 APK 안에 들어 있어 캐시할 이유가 없는데,
     * 캐시가 남으면 APK 를 새로 깔아도 워커가 옛 파일을 계속 내놓습니다.
     * 실제로 그 상태가 되어, 앱을 지우고 다시 까는 것 말고는 빠져나올 방법이 없었습니다.
     */
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await np.waitForTimeout(700);   // 등록은 load 이벤트 뒤에 일어납니다
      const regs = await np.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
      check('앱: 서비스 워커를 등록하지 않음', regs === 0, `${regs}개 등록됨`);
      await ctx.close();
    }

    const same = await nativeCheck(SHA_OLD, '같은 커밋');
    check('앱: 릴리스가 같은 커밋이면 최신이라고 답함', same.got === 'latest', `상태: ${same.got}`);
    check('앱: 자동 설치가 안 된다는 안내가 항상 보임',
      same.note.includes('자동으로 설치되지 않습니다') || same.note.includes('cannot install itself'),
      same.note.slice(-70));

    const newer = await nativeCheck(SHA_NEW, '다른 커밋');
    check('앱: 릴리스가 다른 커밋이면 새 버전이 있다고 답함', newer.got === 'ready',
      `상태: ${newer.got}`);
    // 앱에서는 '적용' 이 아니라 '내려받기' 여야 합니다. 앱은 스스로 설치할 수 없습니다.
    check('앱: 버튼이 내려받기로 바뀜',
      newer.btn.includes('내려받기') || newer.btn.includes('Download'), newer.btn);

    /*
     * 자동 감지.
     * 버튼을 누르지 않아도 새 버전을 찾아내고, 설정 탭까지 들어가지 않아도
     * 알 수 있게 표시가 떠야 합니다. 표시가 없으면 맨 아래 카드는 아무도 못 봅니다.
     */
    {
      const ctx = await browser.newContext();
      let apiCalls = 0;
      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      await ctx.route('**/js/lib/version.js', (route) => route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `export const BUILD = Object.freeze({ commit: '${'1'.repeat(40)}', builtAt: '' });
export function shortVersion() { return BUILD.commit.slice(0, 7); }
export function isStamped() { return true; }`,
      }));
      await ctx.route('**/api.github.com/**', (route) => {
        apiCalls += 1;
        return route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ target_commitish: '2'.repeat(40) }),
        });
      });
      await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
      }));
      const ap = await ctx.newPage();
      await ap.goto(BASE, { waitUntil: 'networkidle' });
      await ap.waitForSelector('body[data-ready="true"]');

      // 시작 3초 뒤에 도는 확인입니다. 버튼은 누르지 않습니다.
      const found = await ap.waitForFunction(
        () => document.body.dataset.hasUpdate === 'true', null, { timeout: 12000 },
      ).then(() => true).catch(() => false);
      check('앱: 버튼을 누르지 않아도 새 버전을 감지함', found === true,
        `body[data-has-update]=${await ap.evaluate(() => document.body.dataset.hasUpdate)}`);

      // 표시가 실제로 눈에 보이는 자리에 찍혀야 합니다.
      const dot = await ap.evaluate(() => {
        const after = getComputedStyle(document.querySelector('#menu-open'), '::after');
        return { content: after.content, w: after.width };
      });
      check('앱: 메뉴 버튼에 새 버전 표시가 찍힘', dot.content !== 'none' && dot.w !== 'auto',
        `content=${dot.content} width=${dot.w}`);

      const callsAfterBoot = apiCalls;
      // 설정 탭을 여러 번 오가도 간격 제한 안에서는 다시 두드리지 않아야 합니다.
      await goTab(ap, 'settings');
      await goTab(ap, 'today');
      await goTab(ap, 'settings');
      await ap.waitForTimeout(500);
      check('앱: 간격 제한이 있어 열 때마다 서버를 두드리지 않음', apiCalls === callsAfterBoot,
        `부팅 후 ${callsAfterBoot}회 -> 탭 왕복 뒤 ${apiCalls}회`);
      await ctx.close();
    }

    /* 조용한 확인이 실패해도 에러를 띄우면 안 됩니다. 묻지도 않았는데 빨간 글씨가 뜹니다. */
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      await ctx.route('**/js/lib/version.js', (route) => route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: `export const BUILD = Object.freeze({ commit: '${'1'.repeat(40)}', builtAt: '' });
export function shortVersion() { return BUILD.commit.slice(0, 7); }
export function isStamped() { return true; }`,
      }));
      await ctx.route('**/api.github.com/**', (route) => route.abort('failed'));
      await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
      }));
      const ep = await ctx.newPage();
      await ep.goto(BASE, { waitUntil: 'networkidle' });
      await ep.waitForSelector('body[data-ready="true"]');
      await ep.waitForTimeout(5000);   // 자동 확인(3초)이 지나갈 시간
      await goTab(ep, 'settings');
      await ep.waitForSelector('#update-msg');
      const quietState = await ep.getAttribute('#update-msg', 'data-state');
      check('앱: 자동 확인이 실패해도 에러를 띄우지 않음',
        quietState !== 'error',
        `상태: ${quietState}`);
      check('앱: 자동 확인 실패 시 표시도 찍히지 않음',
        (await ep.evaluate(() => document.body.dataset.hasUpdate)) === undefined);
      await ctx.close();
    }
  }

  // ---------- 10-b. 메뉴 사이드바 ----------
  console.log('\n▶ 메뉴 사이드바');
  const barHidden = () => page.locator('#sidebar').isHidden();
  check('처음에는 서랍이 닫혀 있음', await barHidden());
  check('탭 막대가 헤더에 남아 있지 않음',
    await page.evaluate(() => !document.querySelector('.app-header #tabs')));
  await page.click('#menu-open');
  check('••• 버튼으로 열림', !(await barHidden()));
  check('열리면 aria-expanded 가 true',
    (await page.getAttribute('#menu-open', 'aria-expanded')) === 'true');
  check('열리면 보고 있던 탭에 포커스',
    await page.evaluate(() => document.activeElement?.classList.contains('tab') === true));
  await page.keyboard.press('Escape');
  check('Esc 로 닫힘', await barHidden());
  check('닫히면 포커스가 ••• 버튼으로 돌아옴',
    await page.evaluate(() => document.activeElement?.id === 'menu-open'));
  await page.click('#menu-open');
  await page.click('#sidebar-scrim');
  check('바깥을 눌러도 닫힘', await barHidden());
  await page.click('#menu-open');
  await page.click('#menu-close');
  check('✕ 로도 닫힘', await barHidden());
  await goTab(page, 'todo');
  check('탭을 고르면 서랍이 자동으로 닫힘', await barHidden());
  check('헤더에 현재 화면 이름 표시',
    ((await page.textContent('#header-now')) || '').length > 0,
    await page.textContent('#header-now'));
  check('헤더 이름이 지금 보고 있는 탭과 같음',
    (await page.textContent('#header-now-name')).trim() === 'TO DO',
    await page.textContent('#header-now-name'));
  check('헤더에 탭 이모지도 함께 표시',
    ((await page.textContent('#header-now-icon')) || '').trim().length > 0,
    await page.textContent('#header-now-icon'));
  // 구석의 흐린 글씨로는 넘기는 중에 눈에 들어오지 않아 크기를 키웠습니다.
  const nowFont = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#header-now'));
    return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
  });
  check('헤더 이름이 읽을 만한 크기 (15px 이상, 굵게)',
    nowFont.size >= 15 && nowFont.weight >= 600,
    `${nowFont.size}px / ${nowFont.weight}`);

  /*
   * 핵심: 넘기는 '도중'에 이름이 바뀌어야 합니다.
   * 예전에는 스크롤이 멈춘 뒤(120ms 디바운스)에만 바뀌어서 넘기는 내내 알 수가 없었습니다.
   * aria-selected 는 정착 처리에서만 옮겨지므로, 이름이 먼저 바뀌고
   * aria-selected 는 아직 예전 탭에 있으면 '정착 전에 바뀌었다'는 증거가 됩니다.
   */
  const live = await page.evaluate(async () => {
    const main = document.querySelector('#main');
    const btns = [...document.querySelectorAll('#tabs .tab')];
    const before = document.querySelector('.tab[aria-selected="true"]')?.dataset.tab;
    // 버튼으로 옮긴 직후에는 목적지 이름을 붙들고 있습니다. 손을 대면 풀리므로 그대로 흉내 냅니다.
    main.dispatchEvent(new Event('pointerdown'));
    // 지금 탭과 다른 곳으로, 스냅 지점에 정확히 맞춰 옮깁니다(스냅이 되돌리지 않도록).
    const from = btns.findIndex((b) => b.dataset.tab === before);
    // 0번으로 옮기면 뒤따르는 위치 막대 검사가 '0 == 0' 이 되어 아무것도 걸러내지 못합니다.
    const to = from === 2 ? 4 : 2;
    const t0 = performance.now();
    main.scrollLeft = main.clientWidth * to;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const label = btns[to].querySelector('[data-i18n]');
    return {
      before,
      want: (label ? label.textContent : btns[to].textContent).trim(),
      got: (document.querySelector('#header-now-name').textContent || '').trim(),
      selected: document.querySelector('.tab[aria-selected="true"]')?.dataset.tab,
      ms: performance.now() - t0,
    };
  });
  /*
   * 세 가지를 한 번에 봅니다. 따로 두면 '정착 전이었다'만으로는 늘 통과해 쓸모가 없습니다.
   *  - 이름이 넘어간 쪽으로 바뀌었는가
   *  - 정착(120ms)이 돌기 전에 쟀는가
   *  - 정착이 아직 안 돌았는가 (aria-selected 가 그대로인지로 확인)
   */
  check('쓸어 넘기면 멈추기 전에 헤더 이름이 따라 바뀜',
    live.got === live.want && live.ms < 120 && live.selected === live.before,
    `기대 "${live.want}" / 실제 "${live.got}" · ${Math.round(live.ms)}ms · 활성 탭 ${live.before} -> ${live.selected}`);

  // 위치 막대: 몇 번째 화면인지, 넘기는 중에는 어디쯤인지 보여 줍니다.
  const rail = await page.evaluate(() => {
    const thumb = document.querySelector('#pager-thumb');
    const count = document.querySelectorAll('#tabs .tab').length;
    const main = document.querySelector('#main');
    return {
      count,
      width: thumb.getBoundingClientRect().width,
      railWidth: document.querySelector('#pager-rail').getBoundingClientRect().width,
      left: thumb.getBoundingClientRect().left - document.querySelector('#pager-rail').getBoundingClientRect().left,
      at: main.scrollLeft / main.clientWidth,
      height: thumb.getBoundingClientRect().height,
    };
  });
  check('위치 막대 폭이 탭 개수에 맞음',
    Math.abs(rail.width - rail.railWidth / rail.count) < 0.5,
    `${rail.width.toFixed(1)}px (기대 ${(rail.railWidth / rail.count).toFixed(1)}px, 탭 ${rail.count}개)`);
  check('위치 막대가 지금 화면 자리에 있음',
    Math.abs(rail.left - rail.at * rail.width) < 0.5,
    `${rail.left.toFixed(1)}px (기대 ${(rail.at * rail.width).toFixed(1)}px)`);
  /*
   * 자리와 크기.
   * 헤더 맨 아래(배너 밑)에 두면 파란 배너에 묻혀 보이지 않았습니다. 이름 바로 밑이어야 합니다.
   * 그리고 헤더가 높아지는 만큼 본문이 줄어드니, 차지하는 높이도 같이 묶어 둡니다.
   */
  const railPlace = await page.evaluate(() => {
    const top = document.querySelector('.header-top').getBoundingClientRect();
    const rail = document.querySelector('#pager-rail').getBoundingClientRect();
    const banner = document.querySelector('#banner').getBoundingClientRect();
    return { nameBottom: top.bottom, railTop: rail.top, railBottom: rail.bottom, bannerTop: banner.top };
  });
  check('위치 막대가 탭 이름과 배너 사이에 있음',
    railPlace.railTop >= railPlace.nameBottom && railPlace.railBottom <= railPlace.bannerTop + 0.5,
    `이름 ${railPlace.nameBottom} / 막대 ${railPlace.railTop}~${railPlace.railBottom} / 배너 ${railPlace.bannerTop}`);
  // 막대가 생기기 전 이 간격은 10px 이었습니다. 막대 몫으로 6px 넘게 더 쓰지 않아야 합니다.
  check('위치 막대가 차지하는 높이가 16px 이하',
    railPlace.bannerTop - railPlace.nameBottom <= 16,
    `${(railPlace.bannerTop - railPlace.nameBottom).toFixed(1)}px`);

  // 넘긴 뒤 상태를 원래대로 돌려 놓습니다. 뒤 검사들이 todo 탭을 기준으로 이어집니다.
  await settlePagerOf(page);
  await goTab(page, 'todo');
  check('음악 탭은 사라짐',
    await page.evaluate(() => !document.querySelector('.tab[data-tab="music"]')
      && !document.querySelector('#panel-music')));

  /*
   * 주 시작일을 월요일(ISO)에서 일요일로 바꿨습니다.
   * 같은 '2026-W38' 글자가 가리키는 7일이 달라지므로, 저장해 둔 주간 계획을 옮겨 줘야 합니다.
   * 옮기지 않으면 적어 둔 주간 목표가 한 주 밀려 보입니다.
   */
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      // 예전 버전이 저장해 둔 모습 그대로: ISO 키이고, 이사했다는 표시가 없습니다.
      localStorage.setItem('daily-kit:todo.items', JSON.stringify([
        { id: 'shift', text: '한 주 밀리는 것', done: false, scope: 'week', period: '2027-W10', category: 'etc' },
        { id: 'yearEnd', text: '연말에 걸친 것', done: false, scope: 'week', period: '2025-W53', category: 'etc' },
        { id: 'same', text: '번호가 그대로인 것', done: false, scope: 'week', period: '2026-W38', category: 'etc' },
        { id: 'notWeek', text: '옛 월간 목표', done: false, scope: 'month', period: '2026-09', category: 'etc' },
      ]));
      localStorage.removeItem('daily-kit:todo.weekBase');
    });
    const mp = await ctx.newPage();
    await mp.goto(BASE, { waitUntil: 'networkidle' });
    await mp.waitForSelector('body[data-ready="true"]');
    await mp.waitForTimeout(400);
    const after = await mp.evaluate(() => ({
      items: JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]'),
      flag: JSON.parse(localStorage.getItem('daily-kit:todo.weekBase') || 'null'),
    }));
    const at = (id) => after.items.find((x) => x.id === id)?.period;
    check('주 시작일 이사: 주간 계획이 남아 있음', after.items.length === 4,
      JSON.stringify(after.items.map((x) => `${x.id}:${x.period}`)));
    check('주 시작일 이사: 표시가 남음', after.flag === 'sun', String(after.flag));
    /*
     * 기대값은 구현이 아니라 규칙에서 나옵니다.
     * ISO 2027-W10 의 월요일은 3/8 이고, 그 날이 든 일요일 시작 주는 3/7~3/13 = 2027-W11 입니다.
     * ISO 2025-W53 의 월요일은 12/29 이고, 그 주(12/27~1/2)는 1월 1일을 품어 2026-W01 입니다.
     */
    check('주 시작일 이사: 주 번호가 밀리는 계획을 옮김', at('shift') === '2027-W11', at('shift'));
    check('주 시작일 이사: 연말에 걸친 계획도 옳은 해로 옮김', at('yearEnd') === '2026-W01', at('yearEnd'));
    // ISO 2026-W38(9/14 월) 이 든 새 주도 2026-W38(9/13~9/19) 이라 번호가 그대로입니다. 괜히 건드리면 안 됩니다.
    check('주 시작일 이사: 번호가 같은 계획은 그대로 둠', at('same') === '2026-W38', at('same'));
    check('주 시작일 이사: 주간이 아닌 계획은 건드리지 않음', at('notWeek') === '2026-09', at('notWeek'));

    // 두 번 돌면 한 주씩 계속 밀립니다. 새로고침해도 그대로여야 합니다.
    await mp.reload({ waitUntil: 'networkidle' });
    await mp.waitForSelector('body[data-ready="true"]');
    await mp.waitForTimeout(300);
    const again = await mp.evaluate(() => JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]'));
    const at2 = (id) => again.find((x) => x.id === id)?.period;
    check('주 시작일 이사: 새로고침해도 또 옮기지 않음',
      at2('shift') === '2027-W11' && at2('yearEnd') === '2026-W01' && at2('same') === '2026-W38',
      `${at2('shift')} / ${at2('yearEnd')} / ${at2('same')}`);
    await ctx.close();
  }

  // ---------- 10-c. TO DO 달력 ----------
  console.log('\n▶ 달력');
  const todayKey = await page.evaluate(() => {
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  });
  /*
   * 기간을 오늘로 맞추고 시작합니다.
   *
   * 아래 검사들은 '오늘 칸'에 이모지가 붙는지를 봅니다. 그런데 계획은 '지금 보고 있는 기간'에
   * 들어가므로, 앞선 검사가 기간을 옮겨 두면 엉뚱한 날짜에 들어가 전부 깨집니다.
   * 앞 검사 중에는 '오늘' 탭에서 돌아가는 목록을 눌러 revealItem 으로 기간이 바뀌는 것이 있어서,
   * 어느 항목이 눌리느냐(=타이밍)에 따라 기간이 달라집니다. 실제로 CI 에서만 세 건이 깨졌습니다.
   * 가정하지 말고 여기서 못박습니다.
   */
  await page.click('#period-today');
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(250);
  check('달력 검사 시작 전 기간이 오늘',
    await page.evaluate(() => document.querySelector('#period-label').classList.contains('is-current')),
    await page.textContent('#period-label'));
  check('달력이 그려짐', (await page.locator('#cal-grid .cal-day').count()) >= 28,
    `${await page.locator('#cal-grid .cal-day').count()}칸`);
  check('요일 머리글 7개', (await page.locator('#cal-grid .cal-wd').count()) === 7);
  // 달력 한 줄과 계획표의 '주간' 단위가 겹쳐야 '이번 주'를 한 줄로 강조할 수 있습니다.
  // 이 시점의 언어는 앞선 검사에 따라 달라집니다. 두 표기를 모두 받습니다.
  const firstWd = (await page.locator('#cal-grid .cal-wd').first().textContent()).trim();
  check('요일이 일요일에서 시작', firstWd === '일' || firstWd === 'Sun', firstWd);
  check('달력이 목록보다 위에 있음',
    await page.evaluate(() => {
      const cal = document.querySelector('.cal-card').getBoundingClientRect();
      const plan = document.querySelector('[data-card="todo.plan"]').getBoundingClientRect();
      return cal.top <= plan.top;
    }));
  check('오늘 칸이 표시됨',
    (await page.locator(`.cal-day[data-day="${todayKey}"].is-today`).count()) === 1);

  // 분류를 골라 등록하면 그 날 칸에 이모지가 붙어야 합니다.
  await page.click('.cat-chip[data-cat="health"]');
  check('고른 분류만 켜짐',
    (await page.locator('#todo-cats .cat-chip.is-on').count()) === 1
    && (await page.getAttribute('.cat-chip[data-cat="health"]', 'aria-pressed')) === 'true',
    `켜진 칩 ${await page.locator('#todo-cats .cat-chip.is-on').count()}개`);
  await page.fill('#todo-input', '달력 확인용 운동');
  await page.press('#todo-input', 'Enter');
  await page.waitForTimeout(250);
  const todayCell = page.locator(`.cal-day[data-day="${todayKey}"]`);
  const marks = (await todayCell.locator('.cal-mark').allTextContents()).join('');
  check('고른 분류의 이모지가 달력에 표시됨', marks.includes('🏃'), `표시: ${marks || '(없음)'}`);
  check('목록에도 분류 이모지가 붙음',
    (await page.locator('#todo-list .todo-cat').count()) >= 1);

  // ---------- 날짜를 눌러 그 날로 옮겨 가고, 그 날짜에 바로 추가 ----------
  const otherDay = await page.evaluate(() => {
    // 이번 달 안에서 오늘이 아닌 날을 하나 고릅니다. (달을 넘기면 검사가 복잡해집니다)
    const cells = [...document.querySelectorAll('.cal-day:not(.is-outside):not(.is-today)')];
    return cells[Math.min(3, cells.length - 1)]?.dataset.day;
  });
  await page.click(`.cal-day[data-day="${otherDay}"]`);
  await page.waitForTimeout(200);
  check('날짜를 누르면 목록이 그 날로 옮겨감',
    (await page.textContent('#period-label')).includes(String(Number(otherDay.slice(8, 10)))),
    `${otherDay} -> ${await page.textContent('#period-label')}`);
  check('누른 날짜가 선택 표시됨',
    (await page.locator(`.cal-day[data-day="${otherDay}"].is-selected`).count()) === 1);
  check('누른 날짜로 옮기면 단위가 일간',
    (await page.getAttribute('.scope-tab[data-scope="day"]', 'aria-selected')) === 'true');

  await page.click('.cat-chip[data-cat="study"]');
  await page.fill('#todo-input', '그 날짜에 바로 추가');
  await page.press('#todo-input', 'Enter');
  await page.waitForTimeout(250);
  check('누른 날짜에 계획이 들어감',
    ((await page.locator(`.cal-day[data-day="${otherDay}"] .cal-marks`).textContent()) || '').includes('📚'),
    await page.locator(`.cal-day[data-day="${otherDay}"] .cal-marks`).textContent());
  check('오늘 칸에는 들어가지 않음',
    !((await todayCell.locator('.cal-marks').textContent()) || '').includes('📚'));

  // ---------- 주간: 그 날짜가 든 주가 한 줄로 강조되고, 날짜별로 묶여 보입니다 ----------
  await page.click('.scope-tab[data-scope="week"]');
  await page.waitForTimeout(250);
  const weekCells = await page.evaluate(() =>
    [...document.querySelectorAll('.cal-day.is-selected')].map((n) => n.dataset.day));
  check('주간에서 7일이 강조됨', weekCells.length === 7, `${weekCells.length}일`);
  check('강조된 주에 방금 고른 날짜가 들어 있음', weekCells.includes(otherDay),
    `${otherDay} / ${weekCells.join(',')}`);
  check('주간 목록이 날짜별로 묶임',
    (await page.locator('#todo-list .todo-group-head').count()) >= 1,
    `${await page.locator('#todo-list .todo-group-head').count()}묶음`);
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(200);

  // ---------- 달력 접기 ----------
  const monthCells = await page.locator('#cal-grid .cal-day').count();
  await page.click('#cal-fold');
  await page.waitForTimeout(250);
  check('접으면 한 주만 남음', (await page.locator('#cal-grid .cal-day').count()) === 7,
    `${await page.locator('#cal-grid .cal-day').count()}칸`);
  check('접으면 목록 공간이 넓어짐',
    await page.evaluate(() => {
      const plan = document.querySelector('[data-card="todo.plan"]');
      return plan.clientHeight > 0;
    }));
  await page.click('#cal-next');
  await page.waitForTimeout(200);
  check('접힌 상태에서 ›는 한 주씩 움직임',
    (await page.locator('#cal-grid .cal-day').count()) === 7
    && !(await page.locator('#cal-grid .cal-day').first().getAttribute('data-day')).endsWith(otherDay.slice(8)),
    await page.locator('#cal-grid .cal-day').first().getAttribute('data-day'));
  // 주를 넘기면 다른 달로 넘어갈 수 있으므로, 펼치기 전에 원래 달로 되돌립니다.
  await page.click('#cal-prev');
  await page.waitForTimeout(150);
  await page.click('#cal-fold');
  await page.waitForTimeout(250);
  check('다시 펼치면 한 달이 돌아옴',
    (await page.locator('#cal-grid .cal-day').count()) === monthCells,
    `${await page.locator('#cal-grid .cal-day').count()} / ${monthCells}`);
  await page.click('#cal-today');
  await page.waitForTimeout(200);

  // ---------- 분류 커스터마이징 ----------
  // 앞의 검사에서 다른 날짜/주로 옮겨 다녔습니다. 오늘 칸을 보려면 오늘로 돌아와야 합니다.
  await page.click('#period-today');
  await page.waitForTimeout(250);
  check('오늘 버튼을 누르면 달력도 오늘 달로 따라옴',
    (await page.locator(`.cal-day[data-day="${todayKey}"]`).count()) === 1);
  const beforeChips = await page.locator('#todo-cats .cat-chip').count();
  await page.click('[data-cat-edit]');
  await page.waitForTimeout(200);
  check('분류 편집이 펼쳐짐', await page.locator('#cat-edit-body').isVisible());
  await page.fill('#cat-new-name', '취미');
  await page.click('.cat-edit-new .cat-pick-summary');
  await page.click('.cat-edit-new .emoji-opt[data-emoji="🎵"]');
  await page.click('#cat-new-add');
  await page.waitForTimeout(250);
  check('내 분류가 늘어남',
    (await page.locator('#todo-cats .cat-chip').count()) === beforeChips + 1,
    `${beforeChips} -> ${await page.locator('#todo-cats .cat-chip').count()}`);
  check('만든 분류가 바로 선택됨',
    ((await page.locator('#todo-cats .cat-chip.is-on').first().textContent()) || '').includes('🎵'),
    await page.locator('#todo-cats .cat-chip.is-on').first().textContent());

  await page.fill('#todo-input', '기타 연습');
  await page.press('#todo-input', 'Enter');
  await page.waitForTimeout(250);
  check('내 분류 이모지가 달력에 나타남',
    ((await todayCell.locator('.cal-marks').textContent()) || '').includes('🎵'),
    await todayCell.locator('.cal-marks').textContent());

  // 기본 분류의 이모지도 바꿀 수 있어야 합니다.
  await page.click('[data-cat-row="health"] .cat-pick-summary');
  await page.click('[data-cat-row="health"] .emoji-opt[data-emoji="🏋️"]');
  await page.waitForTimeout(250);
  check('기본 분류 이모지 변경이 달력까지 반영됨',
    ((await todayCell.locator('.cal-marks').textContent()) || '').includes('🏋️'),
    await todayCell.locator('.cal-marks').textContent());
  check('기본 분류 숨김 버튼은 잠긴 분류에서 막혀 있음',
    await page.evaluate(() => document.querySelector('[data-cat-toggle="etc"]')?.disabled === true));

  // 새로고침해도 남아 있어야 합니다. (localStorage 에 저장되는지)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await goTab(page, 'todo');
  await page.waitForTimeout(300);
  await page.click('#period-today');
  await page.waitForTimeout(250);
  check('새로고침 후에도 내 분류가 남아 있음',
    (await page.locator('#todo-cats .cat-chip').count()) === beforeChips + 1,
    `${await page.locator('#todo-cats .cat-chip').count()}개`);
  check('새로고침 후에도 바꾼 이모지가 남아 있음',
    ((await page.locator(`.cal-day[data-day="${todayKey}"] .cal-marks`).textContent()) || '').includes('🏋️'));

  // 빈 날짜에는 이모지가 없어야 합니다. (모든 칸에 다 찍히는 버그를 잡습니다)
  const emptyDayMarks = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.cal-day:not(.has-items)')];
    return cells.reduce((n, c) => n + c.querySelectorAll('.cal-mark').length, 0);
  });
  check('일정 없는 날에는 이모지가 없음', emptyDayMarks === 0, `${emptyDayMarks}개`);

  // 상세에서 항목을 누르면 계획표가 그 날짜로 이동해야 합니다.
  await page.click('#cal-prev');
  await page.waitForTimeout(150);
  const prevLabel = await page.textContent('#cal-label');
  await page.click('#cal-next');
  await page.waitForTimeout(150);
  check('달 이동이 동작함', prevLabel !== (await page.textContent('#cal-label')),
    `이전: ${prevLabel} / 지금: ${await page.textContent('#cal-label')}`);

  // ---------- 11-a. 커스터마이즈 (테마 · 탭 · 위젯 · 카드 크기) ----------
  console.log('\n▶ 커스터마이즈');

  await goTab(page, 'settings');
  await page.waitForSelector('#customize .cz-section');

  const rootAttr = (name) => page.evaluate((n) => document.documentElement.getAttribute(n), name);
  const cssVar = (name) => page.evaluate((n) => (
    getComputedStyle(document.documentElement).getPropertyValue(n).trim()), name);

  // 편집 UI 가 실제로 그려졌는지부터 확인합니다. 빈 상자면 아래 검사가 전부 무의미합니다.
  check('커스터마이즈 UI 렌더링', (await page.locator('#customize .cz-section').count()) === 6,
    `${await page.locator('#customize .cz-section').count()}개 구역`);

  /*
   * 접기/펼치기.
   * 구역이 전부 펼쳐져 있으면 카드 크기 하나 고치려고 한참 내려야 했습니다.
   * 기본은 전부 접혀 있고, 접힌 줄에 지금 값이 같이 보여야 열지 않고도 압니다.
   */
  check('구역이 기본으로 접혀 있음',
    (await page.locator('#customize .cz-section[open]').count()) === 0,
    `${await page.locator('#customize .cz-section[open]').count()}개가 열려 있습니다`);
  const czHeight = () => page.evaluate(() =>
    Math.round(document.querySelector('#customize').getBoundingClientRect().height));
  const foldedHeight = await czHeight();
  check('접힌 커스터마이즈가 한 화면에 들어옴', foldedHeight <= 520, `${foldedHeight}px`);
  check('접힌 줄에 현재 값이 보임',
    ((await page.textContent('#customize [data-section="accent"] .cz-summary-now')) || '').trim().length > 0,
    await page.textContent('#customize [data-section="accent"] .cz-summary-now'));
  await page.click('#customize [data-section="accent"] .cz-summary');
  await page.waitForTimeout(200);
  check('제목을 누르면 펼쳐짐',
    (await page.locator('#customize [data-section="accent"]').getAttribute('open')) !== null);
  const openHeight = await czHeight();
  check('펼치면 실제로 내용이 늘어남', openHeight > foldedHeight, `${foldedHeight} -> ${openHeight}px`);
  // 색을 하나 고를 때마다 이 화면을 다시 그립니다. 그때 구역이 닫히면 쓸 수가 없습니다.
  await page.click('#customize [data-accent-opt="teal"]');
  await page.waitForTimeout(250);
  check('값을 골라 다시 그려도 펼친 상태가 유지됨',
    (await page.locator('#customize [data-section="accent"]').getAttribute('open')) !== null);

  /*
   * 아래 검사들은 구역 안의 버튼을 직접 누릅니다.
   * 접혀 있으면 화면에 없어서 누를 수 없으므로 여기서 전부 펼쳐 둡니다.
   */
  const openAllCz = async () => {
    await page.evaluate(() => {
      document.querySelectorAll('#customize .cz-section').forEach((d) => { d.open = true; });
    });
    await page.waitForTimeout(150);
  };
  await openAllCz();

  // ---------- 바탕색 (스킨과 다른 축) ----------
  await page.click('#customize [data-base-opt="warm"]');
  await page.waitForTimeout(250);
  check('바탕색 선택이 문서에 반영됨', (await rootAttr('data-base')) === 'warm',
    String(await rootAttr('data-base')));
  const warmBg = await cssVar('--bg');
  check('바탕색이 실제 배경을 바꿈', warmBg === '#faf6ef', warmBg);
  // 축이 다릅니다. 스킨은 모서리/그림자를, 바탕색은 배경을 담당합니다.
  await page.click('#customize [data-skin-opt="cute"]');
  await page.waitForTimeout(250);
  check('스킨을 바꿔도 고른 바탕색이 유지됨', (await cssVar('--bg')) === warmBg,
    `${warmBg} -> ${await cssVar('--bg')}`);
  check('바탕색을 써도 스킨의 모서리는 그대로',
    (await cssVar('--radius')) === '22px', await cssVar('--radius'));
  await page.click('#customize [data-skin-opt="default"]');
  await page.click('#customize [data-base-opt="default"]');
  await page.waitForTimeout(250);
  check('바탕색 기본은 속성을 지움', (await rootAttr('data-base')) === null,
    String(await rootAttr('data-base')));

  /*
   * 색을 고를 때 보고 있던 자리가 유지돼야 합니다.
   *
   * 예전에는 색만 바꿔도 applyTabLayout 이 모든 패널을 DOM 에서 다시 붙였고,
   * appendChild 는 같은 자리로 옮겨도 그 요소의 스크롤을 0 으로 되돌립니다.
   * 커스터마이즈는 설정 탭 아래쪽에 있어서, 색 하나 고를 때마다 맨 위로 튀었습니다.
   */
  const settingsTop = () => page.evaluate(() =>
    Math.round(document.querySelector('#panel-settings').scrollTop));
  /*
   * 아래로 한참 내려간 상태에서 재야 의미가 있습니다.
   * 맨 위에서는 잃을 위치가 없어 무엇을 해도 통과합니다.
   *
   * page.click 은 버튼이 화면 밖이면 보이도록 먼저 스크롤합니다. 그러면 깊이 내려간 상태를
   * 유지할 수 없으므로, 스크롤을 건드리지 않는 element.click() 으로 누릅니다.
   */
  const scrollKeeps = async (sel) => {
    await page.evaluate(() => { document.querySelector('#panel-settings').scrollTop = 700; });
    await page.waitForTimeout(150);
    const before = await settingsTop();
    await page.$eval(`#customize ${sel}`, (node) => node.click());
    await page.waitForTimeout(350);
    return { before, after: await settingsTop() };
  };
  for (const [sel, what] of [
    ['[data-base-opt="cool"]', '바탕색'],
    ['[data-skin-opt="refined"]', '스킨'],
    ['[data-accent-opt="green"]', '강조색'],
    ['[data-card-row="calc.pad"] [data-size-opt="compact"]', '카드 크기'],
  ]) {
    const moved = await scrollKeeps(sel);
    check(`${what}를 바꿔도 보고 있던 자리가 그대로`,
      moved.before > 300 && moved.before === moved.after,
      `${moved.before}px -> ${moved.after}px`);
  }
  /*
   * 색만 바꿨는데 '탭을 옮겼다'는 신호가 돌면 안 됩니다.
   * 그 신호를 듣는 쪽이 실제로 일을 합니다. update.js 는 설정 탭이 열릴 때마다 업데이트를
   * 확인하러 나가고, today.js 는 화면을 다시 그립니다. 색 한 번에 한 번씩 돌면 낭비입니다.
   * 단일 파일 빌드는 모듈이 문서 안에 인라인돼 있어 이 길로 잡을 수 없어 건너뜁니다.
   */
  if (!IS_FILE) {
    const hooked = await page.evaluate(async () => {
      const nav = await import('./js/lib/nav.js');
      window.__tabFires = [];
      nav.onTabChange((name) => window.__tabFires.push(name));
      return typeof nav.onTabChange === 'function';
    }).catch(() => false);
    if (hooked) {
      await page.$eval('#customize [data-base-opt="cool"]', (n) => n.click());
      await page.waitForTimeout(300);
      await page.$eval('#customize [data-accent-opt="green"]', (n) => n.click());
      await page.waitForTimeout(300);
      const fires = await page.evaluate(() => window.__tabFires);
      check('색을 바꿔도 탭 전환 신호는 돌지 않음', fires.length === 0,
        fires.length ? fires.join(',') : '0회');
      await page.$eval('#customize [data-base-opt="default"]', (n) => n.click());
      await page.waitForTimeout(200);
    } else {
      check('색을 바꿔도 탭 전환 신호는 돌지 않음', false, 'nav 모듈을 가져오지 못했습니다');
    }
  }

  await page.$eval('#customize [data-card-row="calc.pad"] [data-size-opt="normal"]', (n) => n.click());
  await page.waitForTimeout(200);
  await page.click('#customize [data-skin-opt="default"]');
  await page.click('#customize [data-base-opt="default"]');
  await page.waitForTimeout(250);

  /*
   * 카드 경계가 실제로 보이는지.
   * '미래' 스킨의 테두리가 rgba(255,255,255,.8) 이라 흰 카드 위의 흰 선이었고,
   * 화면에서 박스 경계가 아예 보이지 않았습니다. 색 이름만 봐서는 못 잡습니다.
   * 반투명이므로 배경에 얹은 뒤의 실제 색으로 비교합니다.
   */
  const borderGap = (skin, theme) => page.evaluate(([sk, th]) => {
    const root = document.documentElement;
    const keepSkin = root.getAttribute('data-skin');
    const keepTheme = root.getAttribute('data-theme');
    if (sk === 'default') root.removeAttribute('data-skin'); else root.setAttribute('data-skin', sk);
    root.setAttribute('data-theme', th);

    const cs = getComputedStyle(root);
    const parse = (v) => {
      const m = /rgba?\(([^)]+)\)/.exec(v);
      if (m) {
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      const h = v.trim().replace('#', '');
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      return {
        r: parseInt(full.slice(0, 2), 16),
        g: parseInt(full.slice(2, 4), 16),
        b: parseInt(full.slice(4, 6), 16),
        a: 1,
      };
    };
    // 반투명 색을 불투명 배경 위에 얹었을 때의 실제 색
    const over = (fg, bg) => ({
      r: bg.r * (1 - fg.a) + fg.r * fg.a,
      g: bg.g * (1 - fg.a) + fg.g * fg.a,
      b: bg.b * (1 - fg.a) + fg.b * fg.a,
    });
    const bg = parse(cs.getPropertyValue('--bg'));
    const surface = over(parse(cs.getPropertyValue('--surface')), bg);
    const border = over(parse(cs.getPropertyValue('--border')), surface);

    if (keepSkin === null) root.removeAttribute('data-skin'); else root.setAttribute('data-skin', keepSkin);
    if (keepTheme === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', keepTheme);

    return Math.round(Math.max(
      Math.abs(border.r - surface.r), Math.abs(border.g - surface.g), Math.abs(border.b - surface.b)));
  }, [skin, theme]);

  for (const skin of ['default', 'refined', 'cute', 'future', 'retro', 'nature']) {
    for (const theme of ['light', 'dark']) {
      // 레트로는 그림자가 없는 대신 테두리가 두꺼워서 기준을 똑같이 둬도 됩니다.
      const gap = await borderGap(skin, theme);
      check(`카드 경계가 보임 — ${skin}/${theme}`, gap >= 10, `카드색과 테두리색 차이 ${gap}`);
    }
  }

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

  /*
   * 파스텔 계열은 칠하는 색(--accent-fill)과 글자/테두리 색(--accent)을 갈라 씁니다.
   * 파스텔을 글자색으로 그대로 쓰면 읽히지 않기 때문입니다.
   * 둘이 같아지면 그 분리가 깨진 것이므로 여기서 잡습니다.
   */
  await page.click('#customize [data-accent-opt="pastellilac"]');
  await page.waitForTimeout(120);
  const pAccent = await cssVar('--accent');
  const pFill = await cssVar('--accent-fill');
  check('파스텔 강조색 적용', (await rootAttr('data-accent')) === 'pastellilac');
  check('파스텔은 칠하는 색과 글자색이 다름', pAccent !== pFill && pFill.length > 0,
    `글자 ${pAccent} / 칠 ${pFill}`);
  // 일반 강조색은 둘이 같아야 합니다. (--accent-fill 기본값이 --accent)
  await page.click('#customize [data-accent-opt="teal"]');
  await page.waitForTimeout(120);
  check('일반 강조색은 칠하는 색이 글자색과 같음',
    (await cssVar('--accent')) === (await cssVar('--accent-fill')),
    `${await cssVar('--accent')} / ${await cssVar('--accent-fill')}`);
  await page.click('#customize [data-accent-opt="pink"]');
  await page.waitForTimeout(120);

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
  await page.click('#customize [data-section="widgets"] .cz-row[data-row="clock"] .cz-toggle');
  await page.waitForTimeout(150);
  check('위젯을 켜면 오늘 탭에 추가됨', (await widgetNames()).includes('clock'),
    (await widgetNames()).join(', '));

  await page.click('#customize [data-section="widgets"] .cz-row[data-row="weather"] .cz-toggle');
  await page.waitForTimeout(150);
  check('위젯을 끄면 사라짐', !(await widgetNames()).includes('weather'),
    (await widgetNames()).join(', '));

  // 시계 위젯이 실제로 시간을 보여주는지 (껍데기만 그리고 끝나는 경우를 잡습니다)
  await goTab(page, 'today');
  await settlePagerOf(page);
  const widgetClock = (await page.textContent('#today-clock')) || '';
  check('시계 위젯이 시각을 표시함', /^\d{2}:\d{2}:\d{2}$/.test(widgetClock.trim()), widgetClock);

  // 위젯을 누르면 해당 탭으로 이동해야 합니다.
  await page.click('#today-clock');
  await settlePagerOf(page);
  const czActiveTab = await page.evaluate(() => (
    document.querySelector('.tab[aria-selected="true"]')?.dataset.tab ?? '(없음)'));
  check('위젯을 누르면 해당 탭으로 이동', czActiveTab === 'time', `실제: ${czActiveTab}`);

  // --- 탭 순서와 숨김 ---
  const tabOrder = () => page.evaluate(() => (
    [...document.querySelectorAll('#tabs .tab')].map((b) => b.dataset.tab)));
  const panelOrder = () => page.evaluate(() => (
    [...document.querySelectorAll('#main .panel')].map((p2) => p2.id.replace('panel-', ''))));

  await goTab(page, 'settings');
  await page.waitForTimeout(150);
  const orderBefore = await tabOrder();
  /*
   * 여기서는 배치가 '정말로' 바뀝니다. 패널을 다시 붙일 수밖에 없고,
   * appendChild 는 옮긴 요소의 스크롤을 0 으로 되돌립니다.
   * 순서를 손보는 동안에도 설정 화면은 계속 보고 있는 화면이라, 자리를 지켜 줘야 합니다.
   * (아래로 내려간 상태에서 재야 의미가 있어 먼저 700px 로 내려 둡니다)
   */
  await page.evaluate(() => { document.querySelector('#panel-settings').scrollTop = 700; });
  await page.waitForTimeout(150);
  const orderTopBefore = await settingsTop();
  // page.click 은 버튼을 보이게 하려고 먼저 스크롤합니다. 스크롤을 건드리지 않는 쪽으로 누릅니다.
  await page.$eval('#customize [data-section="tabs"] .cz-row[data-row="calc"] [data-move="up"]',
    (node) => node.click());
  await page.waitForTimeout(300);
  const orderTopAfter = await settingsTop();
  const orderAfter = await tabOrder();
  check('탭 순서를 위로 옮김', orderAfter[0] === 'calc' && orderBefore[0] === 'today',
    `${orderBefore.slice(0, 3).join(',')} -> ${orderAfter.slice(0, 3).join(',')}`);
  check('탭 순서를 바꿔도 보고 있던 자리가 그대로',
    orderTopBefore > 300 && orderTopBefore === orderTopAfter,
    `${orderTopBefore}px -> ${orderTopAfter}px`);
  // 버튼만 옮기고 패널을 안 옮기면 스와이프했을 때 엉뚱한 화면이 나옵니다.
  check('패널 순서도 함께 바뀜',
    JSON.stringify(await panelOrder()) === JSON.stringify(orderAfter),
    (await panelOrder()).slice(0, 3).join(','));

  await page.click('#customize [data-section="tabs"] .cz-row[data-row="quote"] .cz-toggle');
  await page.waitForTimeout(200);
  check('숨긴 탭은 버튼과 패널에서 모두 빠짐',
    !(await tabOrder()).includes('quote') && !(await panelOrder()).includes('quote'),
    (await tabOrder()).join(','));

  const lockedDisabled = await page.evaluate(() => (
    document.querySelector('#customize [data-section="tabs"] .cz-row[data-row="settings"] .cz-toggle')?.disabled === true));
  check('설정 탭은 숨길 수 없음 (되돌릴 길이 사라지므로)', lockedDisabled === true);

  // --- 새로고침 후에도 유지 ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(250);
  check('새로고침 후 강조색 유지', (await rootAttr('data-accent')) === 'pink');
  check('새로고침 후 탭 순서 유지', (await tabOrder())[0] === 'calc',
    (await tabOrder()).slice(0, 3).join(','));
  check('새로고침 후 숨김 유지', !(await tabOrder()).includes('quote'));
  check('새로고침 후 카드 크기 유지',
    (await page.getAttribute('[data-card="calc.hist"]', 'data-size')) === 'large');
  check('새로고침 후 위젯 구성 유지', (await widgetNames()).includes('clock'),
    (await widgetNames()).join(', '));

  // --- 초기화 ---
  await goTab(page, 'settings');
  await page.waitForSelector('#customize .cz-section');
  await openAllCz();
  page.once('dialog', (d) => d.accept());
  await page.click('#cz-reset');
  await page.waitForTimeout(250);
  check('초기화: 강조색이 기본으로', (await rootAttr('data-accent')) === null,
    String(await rootAttr('data-accent')));
  check('초기화: 탭 순서가 기본으로', (await tabOrder())[0] === 'today',
    (await tabOrder()).slice(0, 3).join(','));
  check('초기화: 숨긴 탭이 돌아옴', (await tabOrder()).includes('quote'));
  check('초기화: 카드 크기가 기본으로',
    (await page.getAttribute('[data-card="calc.hist"]', 'data-size')) === null);

  // 스와이프 인덱스가 새 순서로 다시 계산되는지. 탭 개수가 바뀐 뒤 가장 깨지기 쉬운 부분입니다.
  await goTab(page, 'weather');
  // 부드러운 스크롤이 끝날 때까지 기다립니다. 고정 대기는 느린 CI 에서 흔들립니다.
  await settlePagerOf(page);
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

  // ---------- 11-c. 기기 안전 영역 (상태바 · 내비게이션바) ----------
  /*
   * targetSdk 35 이상이면 안드로이드가 edge-to-edge 를 강제해, 화면이 상태바와
   * 내비게이션바 밑까지 깔립니다. 그대로 두면 헤더의 '•••' 버튼과 테마 버튼이
   * 시계·배터리 표시에 가려 눌리지 않습니다. 실제로 그 상태로 배포됐습니다.
   *
   * 헤드리스 브라우저에는 안전 영역이 없어 env() 가 항상 0 입니다.
   * 그래서 CSS 가 변수를 거치게 해 두고, 여기서 값을 넣어 실제로 밀리는지 봅니다.
   */
  const safe = await browser.newPage();
  await safe.route('**/api.open-meteo.com/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
  }));
  await safe.setViewportSize({ width: 430, height: 860 });
  await safe.goto(BASE, { waitUntil: 'networkidle' });
  await safe.waitForSelector('body[data-ready="true"]');

  const px = (v) => Math.round(parseFloat(v) || 0);
  const safePad = (sel) => safe.evaluate((s2) => {
    const cs = getComputedStyle(document.querySelector(s2));
    return { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft };
  }, sel);

  const beforePad = await safePad('.app-header');
  /*
   * Capacitor 가 하는 것과 똑같이 넣습니다.
   * (SystemBars.injectSafeAreaCSS 가 documentElement 에 인라인으로 심습니다)
   * 변수 이름이 어긋나면 폰에서만 조용히 안 먹으므로, 실제 이름 그대로 써야 의미가 있습니다.
   */
  await safe.evaluate(() => {
    const r = document.documentElement.style;
    r.setProperty('--safe-area-inset-top', '44px');
    r.setProperty('--safe-area-inset-right', '12px');
    r.setProperty('--safe-area-inset-bottom', '28px');
    r.setProperty('--safe-area-inset-left', '12px');
  });
  await safe.waitForTimeout(150);
  const afterPad = await safePad('.app-header');

  check('안전 영역: 헤더가 상태바만큼 아래로 밀림',
    px(afterPad.top) === px(beforePad.top) + 44,
    `${beforePad.top} -> ${afterPad.top}`);
  check('안전 영역: 헤더 좌우도 노치를 피함',
    px(afterPad.left) === px(beforePad.left) + 12 && px(afterPad.right) === px(beforePad.right) + 12,
    `좌 ${afterPad.left} / 우 ${afterPad.right}`);

  const panelPad = await safePad('.panel:not([inert])');
  check('안전 영역: 본문 아래가 내비게이션바를 피함', px(panelPad.bottom) >= 32 + 28,
    panelPad.bottom);

  /*
   * 값만 맞아도 실제로 버튼이 내려가지 않으면 의미가 없습니다.
   * 사용자가 겪은 문제는 '버튼이 상태바에 가려 안 눌린다' 였으므로 위치를 직접 봅니다.
   */
  const menuTop = await safe.evaluate(() => (
    document.querySelector('#menu-open').getBoundingClientRect().top));
  check('안전 영역: 메뉴 버튼이 상태바 아래에 놓임', menuTop >= 44,
    `버튼 위쪽 ${Math.round(menuTop)}px (상태바 44px)`);

  const themeTop = await safe.evaluate(() => (
    document.querySelector('#theme-toggle').getBoundingClientRect().top));
  check('안전 영역: 테마 버튼도 상태바 아래에 놓임', themeTop >= 44,
    `버튼 위쪽 ${Math.round(themeTop)}px`);
  await safe.close();

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
