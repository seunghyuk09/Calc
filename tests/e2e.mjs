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
    (await page.getAttribute('#todo-list .todo-item [data-del]', 'aria-label')) === 'Delete');
  await setLanguage('ko');
  check('동적 요소 — 한국어 체크박스 이름',
    (await page.getAttribute('#todo-list .todo-item input', 'aria-label')) === '완료 표시');
  check('동적 요소 — 한국어 삭제 버튼 이름',
    (await page.getAttribute('#todo-list .todo-item [data-del]', 'aria-label')) === '삭제');
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

  /* ---------- 줄 안에서 바로 체크하고 고치기 ----------
   *
   * 예전에는 줄 전체가 버튼이라 누르면 계획표로 건너뛰는 것 말고는 할 수 있는 게 없었습니다.
   * 요약을 보다가 체크하려고 탭을 옮겨야 하면 요약을 보는 의미가 없습니다.
   */
  const rotRows = () => page.evaluate(() => (
    [...document.querySelectorAll('#today-rot .today-rot-item')].map((n) => ({
      id: n.dataset.id,
      cat: n.querySelector('.today-rot-cat')?.textContent || '',
      text: n.querySelector('.today-rot-text')?.textContent || '',
      hasCheck: !!n.querySelector('.today-rot-check'),
      hasEdit: !!n.querySelector('.today-rot-edit'),
    }))));
  const beforeRows = await rotRows();
  check('오늘 할 일 줄에 분류 이모지가 나옴',
    beforeRows.length > 0 && beforeRows.every((r) => r.cat.length > 0),
    beforeRows.map((r) => `${r.cat}${r.text}`).join(' | '));
  check('오늘 할 일 줄에 체크칸과 고치기가 있음',
    beforeRows.every((r) => r.hasCheck && r.hasEdit));

  // 체크하면 목록에서 빠지고, 탭은 넘어가지 않아야 합니다.
  const checkTarget = beforeRows[0];
  await page.$eval('#today-rot .today-rot-item .today-rot-check', (n) => n.click());
  await page.waitForTimeout(400);
  const afterCheck = await rotRows();
  check('줄에서 바로 체크하면 목록에서 빠짐',
    afterCheck.length === beforeRows.length - 1
    && !afterCheck.some((r) => r.id === checkTarget.id),
    `${beforeRows.length} -> ${afterCheck.length}`);
  check('체크가 저장까지 반영됨',
    (await page.evaluate((id) => (JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]')
      .find((x) => x.id === id) || {}).done, checkTarget.id)) === true);
  check('체크해도 탭이 넘어가지 않음',
    (await page.getAttribute('.tab[data-tab="today"]', 'aria-selected')) === 'true');

  // 되돌려 놓습니다. 뒤 검사가 이 항목을 씁니다.
  await page.evaluate((id) => {
    const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
    const hit = raw.find((x) => x.id === id);
    if (hit) { hit.done = false; hit.doneAt = null; }
    localStorage.setItem('daily-kit:todo.items', JSON.stringify(raw));
  }, checkTarget.id);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(400);

  // 그 자리에서 글자 고치기. Enter 로 저장, Esc 로 취소.
  const editRow = (await rotRows())[0];
  await page.$eval('#today-rot .today-rot-item .today-rot-edit', (n) => n.click());
  await page.waitForTimeout(250);
  check('고치기를 누르면 그 자리에 입력칸이 생김',
    (await page.locator('#today-rot .today-rot-input').count()) === 1);
  await page.fill('#today-rot .today-rot-input', '고쳐 쓴 할 일');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(450);
  check('Enter 로 고친 글이 저장됨',
    (await rotRows())[0]?.text === '고쳐 쓴 할 일', (await rotRows())[0]?.text);
  check('고친 글이 계획표 저장값에도 반영됨',
    (await page.evaluate((id) => (JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]')
      .find((x) => x.id === id) || {}).text, editRow.id)) === '고쳐 쓴 할 일');

  await page.$eval('#today-rot .today-rot-item .today-rot-edit', (n) => n.click());
  await page.waitForTimeout(250);
  await page.fill('#today-rot .today-rot-input', '버려질 글');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('Esc 로 고치기를 취소하면 원래 글이 남음',
    (await rotRows())[0]?.text === '고쳐 쓴 할 일', (await rotRows())[0]?.text);

  // 할 일의 '글'을 누르면 계획표의 그 항목으로
  const firstTaskText = await page.locator('#today-rot .today-rot-item .today-rot-text').first().textContent();
  await page.locator('#today-rot .today-rot-item .today-rot-text').first().click();
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

  /* ---------- 메모를 이미지로 만들어 낙서판에 올리기 ----------
   *
   * 회의 메모를 낙서판에 깔고 그 위에 동그라미를 치는 흐름입니다.
   * 글을 '그림'으로 바꾸는 것이므로, 판에 실제로 잉크가 찍혀야 합니다.
   */
  const canvasStats = () => page.evaluate(() => {
    const c = document.querySelector('#draw-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let paper = 0;
    // 성기게 훑습니다. 픽셀 하나하나를 다 보면 큰 판에서 너무 느립니다.
    for (let i = 0; i < d.length; i += 4 * 40) {
      if (d[i + 3] === 0) continue;
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) paper += 1;
      else ink += 1;
    }
    return { w: c.width, h: c.height, cssH: c.style.height, ink, paper };
  });

  await page.click('#draw-clear');
  await page.waitForTimeout(200);
  const beforeMemo = await canvasStats();

  // 저장해 둔 메모('회의 3시 / 장소: 2층')를 낙서판으로 보냅니다.
  check('메모 줄에 낙서판으로 보내는 버튼이 있음',
    (await page.locator('#memo-list [data-memo-draw]').count()) === 1);
  await page.$eval('#memo-list [data-memo-draw]', (n) => n.click());
  await page.waitForTimeout(600);
  const afterMemo = await canvasStats();

  check('메모를 올리면 판에 글씨가 찍힘', afterMemo.ink > beforeMemo.ink + 10,
    `잉크 ${beforeMemo.ink} -> ${afterMemo.ink}`);
  check('메모를 올리면 바탕이 흰 종이가 됨 (지우개 색과 맞아야 합니다)',
    afterMemo.paper > 100, `흰 픽셀 ${afterMemo.paper}`);
  check('올린 뒤 상태가 안내됨',
    (await page.textContent('#draw-status')).includes('메모를 올렸습니다'),
    await page.textContent('#draw-status'));
  check('원본 메모는 목록에 그대로 남음',
    (await page.locator('#memo-list .memo-item').count()) === 1);

  // 올린 그림 위에 실제로 그릴 수 있어야 합니다. 그게 이 기능의 목적입니다.
  {
    const cbox = await page.locator('#draw-canvas').boundingBox();
    await page.mouse.move(cbox.x + 30, cbox.y + cbox.height - 30);
    await page.mouse.down();
    await page.mouse.move(cbox.x + 200, cbox.y + cbox.height - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const drawnOver = await canvasStats();
    check('올린 메모 위에 그릴 수 있음', drawnOver.ink > afterMemo.ink,
      `${afterMemo.ink} -> ${drawnOver.ink}`);
  }

  // 긴 메모는 판을 길게 늘여 담습니다. 입력칸이 한 메모를 2000자로 막고 있어 그게 상한입니다.
  const longMemo = Array.from({ length: 200 }, (_, i) => (
    `${i + 1}. 아주 긴 회의록 한 줄입니다. 한국어는 띄어쓰기가 없어도 계속 이어집니다.`
  )).join('\n');
  await page.fill('#memo-input', longMemo);
  const typed = await page.evaluate(() => document.querySelector('#memo-input').value.length);
  check('입력칸이 한 메모를 2000자로 막음', typed === 2000, `${typed}자`);
  await page.click('#memo-form button[type="submit"]');
  await page.waitForTimeout(300);
  const shortBoard = await canvasStats();
  await page.$eval('#memo-list [data-memo-draw]', (n) => n.click());
  await page.waitForTimeout(700);
  const longBoard = await canvasStats();
  check('긴 메모를 올리면 판이 길어짐', longBoard.h > shortBoard.h,
    `${shortBoard.cssH} -> ${longBoard.cssH}`);
  /*
   * 입력칸이 허용하는 최대 길이(2000자)는 잘리지 않아야 합니다.
   * 회의록을 올렸는데 뒷부분이 사라지면 이 기능을 쓸 수가 없습니다.
   */
  check('최대 길이 메모는 잘리지 않음',
    !/담지 못했습니다/.test(await page.textContent('#draw-status')),
    await page.textContent('#draw-status'));

  // 되돌리기는 판 크기까지 되돌려야 합니다. 안 그러면 앞 그림이 늘어나 찌그러집니다.
  await page.click('#draw-undo');
  await page.waitForTimeout(600);
  const undoneBoard = await canvasStats();
  check('되돌리면 판 크기도 함께 돌아옴',
    undoneBoard.h === shortBoard.h && undoneBoard.w === shortBoard.w,
    `${longBoard.cssH} -> ${undoneBoard.cssH} (기대 ${shortBoard.cssH})`);

  /*
   * 그래도 넘치는 경우의 안전망.
   * 입력칸으로는 2000자를 넘길 수 없지만 저장소에는 더 긴 값이 들어 있을 수 있습니다.
   * (예전 버전이 남긴 값이거나 손으로 넣은 값) 그때 조용히 자르면 안 됩니다.
   */
  {
    const over = await context.newPage();
    await over.addInitScript(() => {
      const huge = Array.from({ length: 900 }, (_, i) => `${i + 1}. 아주 긴 줄입니다.`).join('\n');
      localStorage.setItem('daily-kit:memo.items',
        JSON.stringify([{ id: 'huge', text: huge, at: Date.now() }]));
    });
    await over.goto(BASE, { waitUntil: 'networkidle' });
    await over.waitForSelector('body[data-ready="true"]');
    await goTab(over, 'memo');
    await over.waitForTimeout(500);
    const stored = await over.evaluate(() => (
      JSON.parse(localStorage.getItem('daily-kit:memo.items'))[0].text.length));
    check('안전망: 입력칸 상한보다 긴 값이 저장에 들어 있음', stored > 2000, `${stored}자`);
    await over.$eval('#memo-list [data-memo-draw]', (n) => n.click());
    await over.waitForTimeout(700);
    check('안전망: 다 담지 못하면 몇 줄이 잘렸는지 알려 줌',
      /\d+줄은 담지 못했습니다/.test(await over.textContent('#draw-status')),
      await over.textContent('#draw-status'));
    await over.close();
  }

  /*
   * 창 크기가 바뀌어도 올려 둔 메모가 뭉개지면 안 됩니다.
   *
   * 캔버스는 창 크기가 바뀌면 다시 만들어집니다. 그때 기본 높이로 되돌리면
   * 메모 때문에 길어졌던 판이 확 줄면서 글씨가 세로로 눌립니다. (1142px -> 225px 였습니다)
   * 전화기를 돌리기만 해도 회의록이 읽을 수 없게 됩니다.
   */
  {
    const rot = await context.newPage();
    await rot.setViewportSize({ width: 390, height: 844 });
    await rot.goto(BASE, { waitUntil: 'networkidle' });
    await rot.waitForSelector('body[data-ready="true"]');
    await goTab(rot, 'memo');
    await rot.waitForTimeout(500);
    const boardOf = () => rot.evaluate(() => {
      const c = document.querySelector('#draw-canvas');
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4 * 40) {
        if (d[i + 3] && !(d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240)) ink += 1;
      }
      return { h: Math.round(parseFloat(c.style.height)), w: c.width, ink };
    });
    const many = Array.from({ length: 60 }, (_, i) => (
      `${i + 1}. 회의록 한 줄입니다. 조금 길게 적어 둡니다.`
    )).join('\n');
    await rot.fill('#memo-input', many);
    await rot.click('#memo-form button[type="submit"]');
    await rot.waitForTimeout(300);
    await rot.$eval('#memo-list [data-memo-draw]', (n) => n.click());
    await rot.waitForTimeout(700);
    const placed = await boardOf();
    check('회전 검사: 메모를 올려 판이 기본보다 길어짐', placed.h > 500, `${placed.h}px`);

    // 화면을 돌린 셈 치고 가로로 넓힙니다.
    await rot.setViewportSize({ width: 844, height: 390 });
    await rot.waitForTimeout(900);
    const turned = await boardOf();
    check('창 크기가 바뀌어도 판이 기본 높이로 줄지 않음', turned.h > 500,
      `${placed.h}px -> ${turned.h}px`);
    check('창 크기가 바뀌어도 글씨가 남아 있음', turned.ink > placed.ink * 0.7,
      `잉크 ${placed.ink} -> ${turned.ink}`);
    check('창 크기가 바뀌면 판 폭도 따라감 (늘여 붙이지 않고 다시 그립니다)',
      turned.w !== placed.w, `${placed.w} -> ${turned.w}`);
    await rot.close();
  }

  // 뒷 검사(영속성)가 메모 1개를 기대하므로 늘어난 메모를 지웁니다.
  await page.$$eval('#memo-list .memo-item button', (btns) => {
    const del = btns.filter((b) => b.textContent.trim() === '삭제');
    if (del.length > 1) del[0].click();
  });
  await page.waitForTimeout(300);
  check('정리: 메모가 하나만 남음', (await page.locator('#memo-list .memo-item').count()) === 1,
    String(await page.locator('#memo-list .memo-item').count()));

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

  /*
   * 배너 맨 끝의 환경 안내는 어디서 도는지에 따라 달라야 합니다.
   * 앱 주소(https://localhost)도 프로토콜이 https: 라, 프로토콜만 보면 앱 안에서
   * '브라우저 메뉴 → 홈 화면에 추가' 를 띄웁니다. 실제로 그렇게 나오고 있었습니다.
   * (여기서는 웹/파일만 확인할 수 있습니다. 앱 경우는 tests/banner-env.test.mjs 가 봅니다)
   */
  await page.fill('#set-banner', '');
  await page.click('#set-banner-save');
  await page.waitForTimeout(300);
  const envDots = await page.locator('#banner-dots .banner-dot').count();
  check('배너를 비우면 기본 2개 + 환경 안내 1개', envDots === 3, `실제 ${envDots}개`);
  await page.locator('#banner-dots .banner-dot').nth(2).click();
  await page.waitForTimeout(200);
  const envTitle = await page.textContent('#banner-title');
  const wantEnv = IS_FILE ? '오프라인으로 실행 중' : '홈 화면에 추가';
  check(`환경 안내가 '${wantEnv}'`, envTitle === wantEnv, `실제: ${envTitle}`);

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

  /*
   * 넘치지 않는다고 멀쩡한 것이 아닙니다.
   *
   * 달력 머리줄은 ‹ › 달이름 접기 '이번 달' 다섯 개가 한 줄에 들어갑니다.
   * 320px 영어('This month')에서 달 이름이 통째로 잘려 ▾ 만 남은 적이 있습니다.
   * 넘침 검사는 통과합니다. 줄인 것이지 넘친 것이 아니니까요.
   * 어느 달인지 안 보이면 달력을 쓸 수 없으므로 '글자가 온전한지'를 따로 봅니다.
   */
  // 언어 전환은 설정 탭에 있습니다. 바꾸고 TO DO 로 돌아옵니다.
  const setMobileLang = async (lang) => {
    await goTab(mobile, 'settings');
    await mobile.waitForSelector('#lang-switch', { timeout: 5000 });
    await mobile.click(`.lang-btn[data-lang="${lang}"]`);
    await mobile.waitForTimeout(150);
    await goTab(mobile, 'todo');
    await mobile.waitForTimeout(250);
  };
  for (const w of [320, 360, 390]) {
    for (const lang of ['ko', 'en']) {
      await mobile.setViewportSize({ width: w, height: 844 });
      await setMobileLang(lang);
      const lab = await mobile.evaluate(() => {
        const n = document.querySelector('#cal-label');
        return { text: n.textContent, visible: Math.round(n.getBoundingClientRect().width), needed: n.scrollWidth };
      });
      check(`달 이름이 온전히 보임 (${w}px ${lang})`, lab.needed - lab.visible <= 1,
        `"${lab.text}" 보임 ${lab.visible}px / 필요 ${lab.needed}px`);
    }
  }
  await setMobileLang('ko');
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

    /*
     * 앱에 이미 남아 있는 워커를 화면 쪽에서 직접 지웁니다.
     *
     * 등록을 안 하는 것만으로는 부족합니다. 업데이트 기능이 생기기 전 버전이 등록해 둔
     * 워커가 남아 있는 기기가 있고, 그 워커는 캐시 우선이라 APK 를 새로 깔아도
     * 옛 화면을 계속 내놓습니다.
     *
     * sw.js 안에도 스스로를 지우는 코드가 있지만 그것은 브라우저가 워커를 갱신해 줄 때만
     * 돕니다. 실제로 재현해 보니 sw.js 를 다시 받아 가지 않아 영영 그대로인 경우가 있었습니다.
     * 그래서 화면 쪽에서도 지웁니다. 여기서는 그 동작만 봅니다.
     *
     * 먼저 웹으로 열어 워커를 등록해 두고(= 옛 버전이 남긴 상태),
     * 그다음 앱인 척하고 다시 열어 지워지는지 봅니다.
     */
    {
      const ctx = await browser.newContext();
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await np.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 })
        .catch(() => null);
      const before = await np.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).length,
      }));
      // 여기가 0 이면 아래 검사가 헛돕니다. 지울 것이 있어야 지웠는지 볼 수 있습니다.
      check('앱 정리 준비: 웹으로 열면 워커와 캐시가 남음',
        before.regs > 0 && before.caches > 0, JSON.stringify(before));

      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      await np.reload({ waitUntil: 'networkidle' });
      // 정리 코드가 화면을 한 번 다시 불러옵니다. 그것까지 끝나기를 기다립니다.
      await np.waitForTimeout(1800);
      await np.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      /*
       * 한 번 더 엽니다.
       * 캐시를 지우는 사이에도 아직 살아 있던 옛 워커가 지나가는 요청을 다시 캐시에 넣어,
       * 첫 정리만으로는 '등록 0 · 캐시 1' 이 남을 수 있습니다. 다음 실행에서 마저 치웁니다.
       * 앱에서도 똑같이 앱을 다시 켜면 정리되는 흐름입니다.
       */
      await np.reload({ waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]', { timeout: 15000 });
      await np.waitForTimeout(900);
      const after = await np.evaluate(async () => ({
        regs: (await navigator.serviceWorker.getRegistrations()).length,
        caches: (await caches.keys()).length,
      }));
      check('앱: 남아 있던 서비스 워커와 캐시를 지움',
        after.regs === 0 && after.caches === 0, JSON.stringify(after));
      await ctx.close();
    }

    /*
     * 앱에서 백업을 글로도 꺼낼 수 있어야 합니다.
     *
     * 안드로이드 WebView 는 DownloadListener 없이 blob: 내려받기를 처리하지 않는데,
     * Capacitor 에도 이 프로젝트에도 그것이 없습니다. 그래서 앱에서 '백업 내려받기' 를 눌러도
     * 파일이 안 나올 수 있습니다. 백업을 못 꺼내면 앱을 다시 깔 때 데이터를 통째로 잃습니다.
     * (복원 쪽 input[type=file] 은 Capacitor 가 처리하므로 문제가 없습니다)
     */
    {
      const ctx = await browser.newContext({ acceptDownloads: true });
      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await goTab(np, 'todo');
      await np.waitForTimeout(400);
      await np.fill('#todo-input', '백업 대체경로 검사');
      await np.$eval('#todo-form button[type="submit"]', (n) => n.click());
      await np.waitForTimeout(300);
      await goTab(np, 'settings');
      await np.waitForTimeout(500);
      check('앱: 평소에는 백업 글 칸이 숨어 있음',
        (await np.$eval('#backup-out', (n) => n.hidden)) === true);
      await np.$eval('#set-export', (n) => n.click());
      await np.waitForTimeout(600);
      const shown = await np.$eval('#backup-out', (n) => n.hidden) === false;
      const text = await np.$eval('#backup-text', (n) => n.value);
      check('앱: 백업을 누르면 글로 꺼낼 칸이 열림', shown === true);
      check('앱: 그 칸에 실제 데이터가 들어 있음', text.includes('백업 대체경로 검사'),
        `${text.length}자`);
      // 복원이 읽을 수 있는 형식이어야 의미가 있습니다.
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      check('앱: 그 글이 복원에 그대로 쓸 수 있는 JSON 임',
        !!parsed && typeof parsed === 'object' && !Array.isArray(parsed));
      await ctx.close();
    }

    /*
     * 메뉴에 지금 도는 빌드가 적혀야 합니다.
     *
     * 새 APK 를 덮어썼는데 화면이 그대로일 때, '설치가 안 된 것' 인지 '설치는 됐는데
     * 화면이 안 바뀐 것' 인지 가릴 방법이 없었습니다. 설정 탭 맨 아래까지 내려가야
     * 버전을 볼 수 있었기 때문입니다. 메뉴를 열면 바로 보이게 둡니다.
     */
    {
      const ctx = await browser.newContext();
      await ctx.addInitScript(() => { window.Capacitor = { isNativePlatform: () => true }; });
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await np.waitForTimeout(400);
      await np.$eval('#menu-open', (n) => n.click());
      await np.waitForTimeout(300);
      const line = await np.$eval('#sidebar-build', (n) => n.textContent.trim());
      check('앱: 메뉴에 빌드와 실행 위치가 적힘', line.includes('앱') && line.length > 2, line);
      await ctx.close();
    }
    {
      const ctx = await browser.newContext();
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await np.waitForTimeout(400);
      await np.$eval('#menu-open', (n) => n.click());
      await np.waitForTimeout(300);
      const line = await np.$eval('#sidebar-build', (n) => n.textContent.trim());
      check('웹: 메뉴의 빌드 줄이 실행 위치를 웹으로 적음', line.includes('웹'), line);
      await ctx.close();
    }

    /* 웹에서는 이 칸이 뜨면 안 됩니다. 내려받기가 정상 동작하는데 군더더기가 붙습니다. */
    {
      const ctx = await browser.newContext({ acceptDownloads: true });
      const np = await ctx.newPage();
      await np.goto(BASE, { waitUntil: 'networkidle' });
      await np.waitForSelector('body[data-ready="true"]');
      await goTab(np, 'settings');
      await np.waitForTimeout(500);
      await np.$eval('#set-export', (n) => n.click());
      await np.waitForTimeout(600);
      check('웹: 백업 글 칸은 뜨지 않음 (앱에서만 필요합니다)',
        (await np.$eval('#backup-out', (n) => n.hidden)) === true);
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

      /*
       * 표시가 실제로 눈에 보이는 자리에 찍혀야 합니다.
       *
       * 있는지만 보면 자리가 틀려도 통과합니다. 실제로 그랬습니다.
       * 점을 버튼 '안쪽'(top/right 5px)에 두었더니 ••• 바로 옆에 붙어서,
       * 알림이 아니라 점 세 개의 네 번째 점처럼 보였습니다.
       * 그래서 '모서리를 넘어가는지'와 '잘리지 않는지'까지 같이 봅니다.
       */
      const dot = await ap.evaluate(() => {
        const btn = document.querySelector('#menu-open');
        const after = getComputedStyle(btn, '::after');
        const b = btn.getBoundingClientRect();
        const app = document.querySelector('.app').getBoundingClientRect();
        // ::after 는 직접 잴 수 없어, 버튼 자리에 선언값을 얹어 화면 위치를 구합니다.
        const top = b.top + parseFloat(after.top);
        const right = b.right - parseFloat(after.right);
        const ring = parseFloat(after.boxShadow.match(/(\d+(?:\.\d+)?)px\s*$/)?.[1] || '0');
        return {
          content: after.content,
          w: after.width,
          위로_넘어간_양: Math.round(b.top - top),
          오른쪽으로_넘어간_양: Math.round(right - b.right),
          잘린_양: Math.round(app.top - (top - ring)),
        };
      });
      check('앱: 메뉴 버튼에 새 버전 표시가 찍힘', dot.content !== 'none' && dot.w !== 'auto',
        `content=${dot.content} width=${dot.w}`);
      check('앱: 새 버전 표시가 버튼 모서리를 넘어가 배지로 보임 (안쪽이면 ••• 의 네 번째 점처럼 보입니다)',
        dot.위로_넘어간_양 > 0 && dot.오른쪽으로_넘어간_양 > 0,
        `위로 ${dot.위로_넘어간_양}px / 오른쪽으로 ${dot.오른쪽으로_넘어간_양}px 넘어감`);
      check('앱: 새 버전 표시가 화면 밖으로 잘리지 않음', dot.잘린_양 <= 0,
        dot.잘린_양 > 0 ? `${dot.잘린_양}px 잘림` : '잘리지 않음');

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

  // ---------- 하루 안의 시각 ----------
  /*
   * 일간 계획에만 시각이 붙습니다. 비우면 '종일' 입니다.
   * 종일이 먼저, 그 아래 시각이 있는 것이 이른 시각부터.
   * (Google 캘린더와 Todoist 의 하루 보기와 같은 차례입니다)
   */
  await page.click('.scope-tab[data-scope="day"]');
  await page.click('#period-today');
  await page.waitForTimeout(300);
  check('일간에서는 시각 칸이 보임',
    (await page.evaluate(() => !document.querySelector('#todo-time').hidden)) === true);
  await page.click('.scope-tab[data-scope="week"]');
  await page.waitForTimeout(250);
  check('주간에서는 시각 칸이 숨겨짐 (하루 안의 시각이라는 게 없습니다)',
    (await page.evaluate(() => document.querySelector('#todo-time').hidden)) === true);
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(250);

  const addAt = async (text, time) => {
    await page.fill('#todo-input', text);
    await page.fill('#todo-time', time);
    await page.click('#todo-form button[type="submit"]');
    await page.waitForTimeout(250);
  };
  // 일부러 뒤죽박죽 넣습니다. 넣은 차례가 아니라 시간순으로 놓여야 합니다.
  await addAt('시각검사 저녁', '18:30');
  await addAt('시각검사 종일', '');
  await addAt('시각검사 아침', '07:00');

  const timedRows = () => page.evaluate(() => (
    [...document.querySelectorAll('#todo-list .todo-item')]
      .map((n) => `${n.querySelector('.todo-time')?.textContent ?? '-'}|${n.querySelector('.todo-text')?.textContent ?? ''}`)
      .filter((x) => x.includes('시각검사'))));
  const ordered = await timedRows();
  check('시각이 있는 항목이 시간순으로 놓임',
    ordered.length === 3 && ordered[1].startsWith('07:00') && ordered[2].startsWith('18:30'),
    ordered.join('  '));
  check('종일 항목이 시각 있는 것보다 먼저 옴',
    ordered[0].includes('종일') && !/^\d\d:/.test(ordered[0]), ordered[0]);
  check('종일 묶음 머리글이 붙음',
    (await page.evaluate(() => [...document.querySelectorAll('#todo-list .todo-group-head')]
      .some((n) => n.textContent.includes('종일') || n.textContent.includes('All day')))) === true);
  check('시각이 저장까지 반영됨',
    (await page.evaluate(() => (JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]')
      .find((x) => x.text === '시각검사 아침') || {}).time)) === '07:00');
  check('종일 항목에는 시각 키가 없음',
    (await page.evaluate(() => 'time' in (JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]')
      .find((x) => x.text === '시각검사 종일') || {}))) === false);

  // 시각 칸을 눌러 그 자리에서 고치기
  await page.$eval('#todo-list .todo-item .todo-time.is-empty', (n) => n.click());
  await page.waitForTimeout(250);
  check('시각 칸을 누르면 그 자리에 시각 입력칸이 생김',
    (await page.locator('#todo-list .todo-time-edit').count()) === 1);
  await page.fill('#todo-list .todo-time-edit', '06:15');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const afterEdit = await timedRows();
  check('그 자리에서 정한 시각이 반영되고 자리도 옮겨감',
    afterEdit[0].startsWith('06:15') && afterEdit[0].includes('종일'), afterEdit.join('  '));

  /* ---------- 시간대별 보기 ----------
   *
   * '일간을 고르면 시간대별로 일정을 고를 수 있으면 좋겠다' 는 요청에 따른 화면입니다.
   * 할 일에 시각을 붙일 수만 있고 하루를 시간 단위로 보는 화면이 없어,
   * 몇 시가 비었는지 알 수도, 빈 시간을 눌러 넣을 수도 없었습니다.
   */
  check('일간에서 보기 전환(목록/시간대)이 보임',
    (await page.evaluate(() => !document.querySelector('#todo-dayviews').hidden)) === true);

  await page.click('#todo-view-hours');
  await page.waitForTimeout(400);
  check('시간대 보기로 바뀌면 목록은 숨음',
    (await page.evaluate(() => document.querySelector('#todo-list').hidden
      && !document.querySelector('#todo-hours').hidden)) === true);

  const hourRows = () => page.evaluate(() => [...document.querySelectorAll('.todo-hour')].map((h) => ({
    t: h.querySelector('.todo-hour-time').textContent.trim(),
    n: h.querySelectorAll('.todo-item').length,
  })));
  const rows1 = await hourRows();
  check('종일 줄이 맨 위에 있고 시각 없는 항목이 거기 들어감',
    rows1[0] && /종일|All day/.test(rows1[0].t) && rows1[0].n >= 1,
    rows1[0] ? `${rows1[0].t}(${rows1[0].n})` : '(줄 없음)');
  check('07:00 항목이 7시 줄에 놓임',
    rows1.some((h) => h.t === '07:00' && h.n >= 1));
  check('18:30 항목은 18시 줄에 놓임 (분은 시 줄에 묶입니다)',
    rows1.some((h) => h.t === '18:00' && h.n >= 1));

  // 빈 시간을 누르면 그 시각으로 넣을 수 있어야 합니다. 시각을 손으로 찍게 하면 의미가 없습니다.
  await page.evaluate(() => document.querySelector('.todo-hour[data-hour="15"] .todo-hour-add')?.click());
  await page.waitForTimeout(300);
  check('빈 시간을 누르면 그 시각이 입력칸에 채워짐',
    (await page.$eval('#todo-time', (n) => n.value)) === '15:00');
  await page.fill('#todo-input', '시각검사 오후');
  await page.click('#todo-form button[type="submit"]');
  await page.waitForTimeout(400);
  check('그 시각으로 실제 추가됨',
    (await page.evaluate(() => document.querySelectorAll('.todo-hour[data-hour="15"] .todo-item').length)) === 1);

  /*
   * 추가한 뒤 시각 칸은 비워져야 합니다.
   * 예전에는 남겨 두어, 글자만 치고 넣은 다음 할 일이 앞의 시각을 조용히 물려받았습니다.
   */
  check('추가한 뒤 시각 칸이 비워짐',
    (await page.$eval('#todo-time', (n) => n.value)) === '');
  await page.fill('#todo-input', '시각검사 종일이어야');
  await page.click('#todo-form button[type="submit"]');
  await page.waitForTimeout(400);
  check('시각 없이 넣은 할 일이 앞의 시각을 물려받지 않음',
    (await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
      return !raw.find((x) => x.text === '시각검사 종일이어야')?.time;
    })) === true);

  // 체크가 시간대 보기에서도 저장돼야 합니다. 보기만 바뀌고 동작이 죽으면 안 됩니다.
  await page.evaluate(() => document.querySelector('.todo-hour[data-hour="7"] .todo-item input[type="checkbox"]')?.click());
  await page.waitForTimeout(400);
  check('시간대 보기에서도 체크가 저장됨',
    (await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
      return raw.find((x) => x.text === '시각검사 아침')?.done === true;
    })) === true);

  const before = (await hourRows()).length;
  await page.click('#todo-hours-more');
  await page.waitForTimeout(400);
  const after = (await hourRows()).length;
  check('이른·늦은 시간까지 펼칠 수 있음', after > before, `${before}줄 -> ${after}줄`);
  await page.click('#todo-hours-more');
  await page.waitForTimeout(300);

  // 주/월/연에는 하루 안의 시각이라는 게 없으므로 전환이 숨어야 합니다.
  await page.click('.scope-tab[data-scope="week"]');
  await page.waitForTimeout(400);
  check('주간에서는 보기 전환이 숨고 목록으로 돌아감',
    (await page.evaluate(() => document.querySelector('#todo-dayviews').hidden
      && document.querySelector('#todo-hours').hidden
      && !document.querySelector('#todo-list').hidden)) === true);
  await page.click('.scope-tab[data-scope="day"]');
  await page.waitForTimeout(400);
  check('일간으로 돌아오면 고른 보기가 기억됨',
    (await page.evaluate(() => !document.querySelector('#todo-hours').hidden)) === true);
  await page.click('#todo-view-list');
  await page.waitForTimeout(300);

  // 정리: 시각 검사용 항목을 지웁니다.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
    localStorage.setItem('daily-kit:todo.items',
      JSON.stringify(raw.filter((x) => !String(x.text).includes('시각검사'))));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await goTab(page, 'todo');
  await page.waitForTimeout(400);

  // ---------- 일정(Schedule) 보기 ----------
  /*
   * Google 캘린더의 '일정' 보기와 같은 꼴입니다.
   * 격자를 버리고 앞으로 올 일을 날짜별로 묶어 시간순으로 늘어놓습니다.
   */
  check('처음에는 달력 격자를 봄',
    (await page.getAttribute('#cal-view-grid', 'aria-selected')) === 'true');

  /*
   * 순서를 볼 수 있게 섞인 자료를 심습니다.
   * 전부 종일이면 '종일이 먼저' 검사가 깨질 수가 없어 헛돕니다.
   * 일부러 늦은 시각을 먼저 넣습니다. 넣은 차례가 아니라 시간순으로 놓여야 합니다.
   */
  await page.evaluate(() => {
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
    // 주/월 계획도 같이 심습니다. 이것들이 목록에 섞이면 어느 날인지 거짓으로 알려주게 됩니다.
    const wk = new Date(now); wk.setDate(wk.getDate() - wk.getDay());
    const week = `${wk.getFullYear()}-W${String(1 + Math.round((wk - new Date(wk.getFullYear(), 0, 1)) / (7 * 864e5))).padStart(2, '0')}`;
    raw.push(
      { id: 'ag-late', text: '일정검사 저녁', done: false, scope: 'day', period: key, time: '21:00', category: 'etc', at: 1 },
      { id: 'ag-early', text: '일정검사 아침', done: false, scope: 'day', period: key, time: '06:30', category: 'etc', at: 2 },
      { id: 'ag-allday', text: '일정검사 종일', done: false, scope: 'day', period: key, category: 'etc', at: 3 },
      { id: 'ag-week', text: '일정검사 주간계획', done: false, scope: 'week', period: week, category: 'etc', at: 4 },
      { id: 'ag-month', text: '일정검사 월간계획', done: false, scope: 'month', period: key.slice(0, 7), category: 'etc', at: 5 },
    );
    localStorage.setItem('daily-kit:todo.items', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await goTab(page, 'todo');
  await page.waitForTimeout(400);
  await page.click('#cal-view-agenda');
  await page.waitForTimeout(400);
  check('일정으로 바꾸면 격자가 숨고 목록이 나옴',
    (await page.evaluate(() => document.querySelector('#cal-grid').hidden)) === true
    && (await page.evaluate(() => !document.querySelector('#cal-agenda').hidden)) === true);
  check('일정 보기에서는 달 이동 줄이 숨겨짐 (달 단위가 의미 없습니다)',
    (await page.evaluate(() => document.querySelector('.cal-nav').hidden)) === true);

  const agenda = await page.evaluate(() => (
    [...document.querySelectorAll('#cal-agenda .cal-agenda-day')].map((day) => ({
      head: day.querySelector('.cal-agenda-date')?.textContent || '',
      today: !!day.querySelector('.cal-agenda-mark'),
      rows: [...day.querySelectorAll('.cal-agenda-row')].map((r) => ({
        time: r.querySelector('.cal-agenda-time')?.textContent || '',
        cat: r.querySelector('.cal-agenda-cat')?.textContent || '',
        text: r.querySelector('.cal-agenda-text')?.textContent || '',
      })),
    }))));
  check('일정 목록이 날짜별로 묶임', agenda.length > 0 && agenda.every((d) => d.head && d.rows.length),
    `${agenda.length}일: ${agenda.map((d) => d.head).slice(0, 3).join(' / ')}`);
  check('오늘 줄에 표가 붙음 (지금 어디인지 알 수 있어야 합니다)',
    agenda.filter((d) => d.today).length === 1,
    `표 ${agenda.filter((d) => d.today).length}개`);
  check('일정 줄마다 시각과 분류 이모지가 나옴',
    agenda.every((d) => d.rows.every((r) => r.time && r.cat)),
    JSON.stringify(agenda[0]?.rows?.[0] || {}));
  /*
   * 하루 안의 차례.
   * 종일이 먼저, 그 아래가 이른 시각부터입니다.
   * (Google 캘린더와 Todoist 모두 종일을 맨 위에 놓습니다)
   * 여기는 일간 보기와 달리 묶음 없이 한 줄로 늘어놓으므로, 정렬 자체가 드러납니다.
   */
  const agendaOrderOk = agenda.every((d) => {
    const mins = d.rows.map((r) => (/^(\d\d):(\d\d)$/.test(r.time)
      ? Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)) : -1));
    return mins.every((v, i) => i === 0 || mins[i - 1] <= v);
  });
  // 섞인 날이 실제로 있어야 이 검사가 의미가 있습니다.
  const mixedDay = agenda.find((d) => (
    d.rows.some((r) => /^\d\d:\d\d$/.test(r.time)) && d.rows.some((r) => !/^\d\d:\d\d$/.test(r.time))));
  check('일정 목록에 종일과 시각이 섞인 날이 있음 (없으면 아래 검사가 헛돕니다)',
    !!mixedDay, agenda.map((d) => d.rows.map((r) => r.time).join('>')).join(' | '));
  check('일정 목록도 하루 안에서 종일 먼저, 그다음 시간순',
    agendaOrderOk,
    agenda.map((d) => d.rows.map((r) => r.time).join('>')).join(' | '));
  /*
   * 주/월 계획은 특정 하루에 속하지 않습니다.
   * 날짜별 목록에 올리면 '그 날의 일' 인 것처럼 거짓으로 알려주게 됩니다.
   * (달력 격자가 일간만 표시하는 것과 같은 이유입니다)
   */
  const agendaTexts = agenda.flatMap((d) => d.rows.map((r) => r.text));
  check('심어 둔 주/월 계획이 저장에는 있음 (없으면 아래 검사가 헛돕니다)',
    (await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
      return raw.some((x) => x.id === 'ag-week') && raw.some((x) => x.id === 'ag-month');
    })) === true);
  check('일간 계획은 일정 목록에 나옴',
    agendaTexts.includes('일정검사 아침') && agendaTexts.includes('일정검사 종일'),
    agendaTexts.filter((x) => x.includes('일정검사')).join(', '));
  check('주간/월간 계획은 일정 목록에 섞이지 않음 (어느 날인지 거짓이 됩니다)',
    !agendaTexts.includes('일정검사 주간계획') && !agendaTexts.includes('일정검사 월간계획'),
    agendaTexts.filter((x) => x.includes('일정검사')).join(', '));

  // 줄을 누르면 계획표가 그 날짜로 옮겨 가고 그 항목을 강조해야 합니다.
  const firstAgendaText = agenda[0]?.rows?.[0]?.text;
  await page.$eval('#cal-agenda .cal-agenda-row', (n) => n.click());
  await page.waitForTimeout(500);
  check('일정 줄을 누르면 그 항목이 계획표에서 강조됨',
    (await page.evaluate(() => document.querySelector('#todo-list .todo-item.is-revealed .todo-text')?.textContent))
      === firstAgendaText,
    `기대: ${firstAgendaText}`);

  // 고른 보기는 새로고침해도 남아야 합니다.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await goTab(page, 'todo');
  await page.waitForTimeout(500);
  check('새로고침해도 고른 보기가 남음',
    (await page.evaluate(() => !document.querySelector('#cal-agenda').hidden)) === true);

  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('daily-kit:todo.items') || '[]');
    localStorage.setItem('daily-kit:todo.items',
      JSON.stringify(raw.filter((x) => !String(x.text).includes('일정검사'))));
  });
  await page.click('#cal-view-grid');
  await page.waitForTimeout(350);
  check('달력으로 되돌리면 격자가 돌아옴',
    (await page.evaluate(() => !document.querySelector('#cal-grid').hidden)) === true
    && (await page.locator('#cal-grid .cal-day').count()) > 7);

  // ---------- 년·월 고르기 판 ----------
  /*
   * ‹ › 만으로는 한 해 전으로 가려면 열두 번을 눌러야 합니다.
   * 달 이름을 누르면 판이 열리고, 판에서 연도를 누르면 연도 격자로 바뀝니다.
   */
  const pickOpen = () => page.evaluate(() => !document.querySelector('#cal-pick').hidden);
  const pickCells = () => page.evaluate(() => (
    [...document.querySelectorAll('#cal-pick-grid .cal-pick-cell')].map((n) => n.textContent)));

  check('처음에는 고르기 판이 닫혀 있음', (await pickOpen()) === false);
  await page.click('#cal-pick-open');
  await page.waitForTimeout(250);
  check('달 이름을 누르면 고르기 판이 열림', (await pickOpen()) === true);
  const months = await pickCells();
  check('판에 열두 달이 놓임', months.length === 12, `${months.length}칸: ${months.slice(0, 3).join(' ')}…`);
  check('지금 보고 있는 달이 표시됨',
    (await page.evaluate(() => document.querySelectorAll('#cal-pick-grid .is-on').length)) === 1);

  // 연도 격자로 바꿔 다른 해를 고릅니다.
  await page.click('#cal-pick-title');
  await page.waitForTimeout(250);
  const years = await pickCells();
  check('연도를 누르면 연도 격자로 바뀜',
    years.length === 12 && /^\d{4}$/.test(years[0]), years.slice(0, 3).join(' '));
  const thisYear = new Date().getFullYear();
  check('연도 격자가 올해를 품고 있음', years.includes(String(thisYear)),
    `${years[0]} – ${years[years.length - 1]} (올해 ${thisYear})`);

  // ‹ › 가 12년씩 움직이고 왕복하면 제자리로 와야 합니다.
  const yearTitle = () => page.textContent('#cal-pick-title');
  const titleBefore = await yearTitle();
  await page.click('#cal-pick-prev');
  await page.waitForTimeout(200);
  const titleBack = await yearTitle();
  await page.click('#cal-pick-next');
  await page.waitForTimeout(200);
  check('연도 격자를 ‹ › 로 옮겼다 되돌리면 제자리',
    titleBack !== titleBefore && (await yearTitle()) === titleBefore,
    `${titleBefore} -> ${titleBack} -> ${await yearTitle()}`);

  // 지난해를 골라 그 해 3월로 갑니다.
  const wantYear = String(thisYear - 1);
  await page.$eval('#cal-pick-grid', (grid, y) => {
    [...grid.querySelectorAll('.cal-pick-cell')].find((n) => n.textContent === y)?.click();
  }, wantYear);
  await page.waitForTimeout(250);
  check('연도를 고르면 달 격자로 돌아옴',
    (await page.textContent('#cal-pick-title')) === wantYear
    && (await pickCells()).length === 12 && !/^\d{4}$/.test((await pickCells())[0]),
    `제목 ${await page.textContent('#cal-pick-title')} / 첫 칸 ${(await pickCells())[0]}`);

  await page.$eval('#cal-pick-grid', (grid) => {
    // 세 번째 칸이 3월입니다. 글자는 언어마다 달라 자리로 고릅니다.
    grid.querySelectorAll('.cal-pick-cell')[2]?.click();
  });
  await page.waitForTimeout(350);
  check('달을 고르면 판이 닫힘', (await pickOpen()) === false);
  const jumped = await page.evaluate(() => (
    document.querySelector('#cal-grid .cal-day:not(.is-outside)')?.dataset.day));
  check('고른 년·월로 달력이 옮겨 감', jumped?.startsWith(`${wantYear}-03`), `첫 날짜 ${jumped}`);

  // Esc 로 닫히고, 접기 버튼은 판과 따로 움직여야 합니다.
  await page.click('#cal-pick-open');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Esc 로 고르기 판이 닫힘', (await pickOpen()) === false);

  await page.click('#cal-fold');
  await page.waitForTimeout(250);
  check('접기 버튼은 고르기 판과 따로 움직임',
    (await page.locator('#cal-grid .cal-day').count()) === 7 && (await pickOpen()) === false,
    `${await page.locator('#cal-grid .cal-day').count()}칸`);
  await page.click('#cal-fold');
  await page.waitForTimeout(250);
  await page.click('#cal-today');
  await page.waitForTimeout(250);

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

  // ---------- 11-a2. 화면 편집 (그 탭에서 직접 끌어 옮기기) ----------
  console.log('\n▶ 화면 편집');

  const cardsOf = (tab) => page.evaluate((tb) => (
    [...document.querySelectorAll(`#panel-${tb} > [data-card]`)].map((n) => n.dataset.card)), tab);
  const widgetsNow = () => page.evaluate(() => (
    [...document.querySelectorAll('#today-widgets > [data-widget]')].map((n) => n.dataset.widget)));
  const arrangingOn = () => page.evaluate(() => document.body.dataset.arranging === 'on');
  /* 서랍이 덮고 있으면 카드를 잡을 수 없습니다. 버튼만 직접 눌러 편집을 켭니다. */
  const openArrange = async () => {
    await page.$eval('#arr-start', (n) => n.click());
    await page.waitForTimeout(400);
  };
  const closeArrange = async () => {
    await page.$eval('#arr-done', (n) => n.click());
    await page.waitForTimeout(300);
  };
  const boxOf = (sel) => page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, h: r.height, bottom: r.bottom };
  }, sel);
  /*
   * 손잡이를 잡아 목표 카드의 '아래 절반'에 놓습니다. 그러면 그 뒤로 갑니다.
   *
   * 가로로도 움직여야 합니다. 이 페이지는 1280px 라 .grid-2 가 카드를 두 칸에 나란히 놓습니다.
   * 아래로만 끌면 옆 칸에 있는 목표 카드에 영영 닿지 않습니다. (좁은 화면에서만 한 줄로 쌓입니다)
   *
   * 앞선 검사가 패널을 스크롤해 둔 채로 넘어올 수 있습니다. 손잡이가 화면 밖에 있으면
   * 누르는 지점이 헤더 위가 되어 드래그가 아예 시작되지 않습니다. 먼저 맨 위로 올립니다.
   * 놓는 지점도 화면 안으로 눌러 둡니다. 화면 밖 좌표로는 이벤트가 가지 않습니다.
   */
  const dragOnto = async (panelSel, grabSel, targetSel) => {
    await page.evaluate((s) => { document.querySelector(s).scrollTop = 0; }, panelSel);
    await page.waitForTimeout(200);
    const grab = await boxOf(grabSel);
    const target = await boxOf(targetSel);
    const { width: vw, height: vh } = page.viewportSize();
    const inView = grab.y > 0 && grab.y < vh && grab.x > 0 && grab.x < vw;
    const dropX = Math.min(Math.max(target.x, 4), vw - 4);
    const dropY = Math.min(target.top + target.h * 0.8, vh - 12);
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move(grab.x, grab.y + 20, { steps: 4 });
    await page.waitForTimeout(80);
    await page.mouse.move(dropX, dropY, { steps: 14 });
    await page.waitForTimeout(200);
    const during = await page.evaluate((s) => (
      [...document.querySelectorAll(`${s} > [data-card],${s} > [data-widget]`)]
        .map((n) => n.dataset.card || n.dataset.widget)), panelSel);
    await page.mouse.up();
    await page.waitForTimeout(450);
    return {
      during, inView,
      where: `손잡이 ${Math.round(grab.x)},${Math.round(grab.y)} -> 놓은 곳 ${Math.round(dropX)},${Math.round(dropY)}`,
    };
  };

  await goTab(page, 'quote');
  await settlePagerOf(page);
  const quoteBefore = await cardsOf('quote');
  check('편집 전: 카드가 원래 순서', quoteBefore.join(',') === 'quote.today,quote.mine',
    quoteBefore.join(','));

  await openArrange();
  check('편집 막대가 뜸', (await page.evaluate(() => !document.querySelector('#arr-dock').hidden)) === true);
  check('카드마다 도구줄이 붙음',
    (await page.evaluate(() => document.querySelectorAll('#panel-quote .arr-bar').length)) === 2);
  /*
   * 편집 중에는 카드 내용이 눌리면 안 됩니다.
   * 계산기 자판 위에서 손잡이를 잡으려다 숫자가 눌리면 곤란합니다.
   */
  check('편집 중에는 카드 내용이 눌리지 않음',
    (await page.evaluate(() => {
      const body = document.querySelector('#panel-quote [data-card="quote.today"] > *:not(.arr-bar)');
      return body ? getComputedStyle(body).pointerEvents : '(없음)';
    })) === 'none');

  // 손가락으로 끌기. 두 번째 카드의 아래 절반까지 내리면 그 뒤로 갑니다.
  const dragged = await dragOnto('#panel-quote', '[data-arr-bar="quote.today"] .arr-grab',
    '[data-card="quote.mine"]');
  check('드래그 시작점이 화면 안에 있음 (밖이면 검사 자체가 헛돕니다)', dragged.inView, dragged.where);
  check('끄는 도중에 자리가 미리 바뀜', dragged.during.join(',') === 'quote.mine,quote.today',
    `${dragged.during.join(',')} (${dragged.where})`);
  const quoteAfter = await cardsOf('quote');
  check('끌어 놓으면 순서가 바뀜', quoteAfter.join(',') === 'quote.mine,quote.today',
    `${quoteAfter.join(',')} (${dragged.where})`);
  check('끝난 뒤 임시 변형이 남지 않음',
    (await page.evaluate(() => [...document.querySelectorAll('#panel-quote > [data-card]')]
      .every((n) => !n.style.transform))) === true);
  check('바꾼 순서가 저장됨',
    (await page.evaluate(() => (JSON.parse(localStorage.getItem('daily-kit:ui.prefs') || '{}')
      .cardOrder || {}).quote?.join(','))) === 'quote.mine,quote.today');

  // 키보드만 쓰는 경우. ▲▼ 로도 같은 일을 할 수 있어야 합니다.
  await page.$eval('[data-arr-bar="quote.today"] [data-arr-move="up"]', (n) => n.click());
  await page.waitForTimeout(400);
  check('▲ 로도 순서가 바뀜', (await cardsOf('quote')).join(',') === 'quote.today,quote.mine',
    (await cardsOf('quote')).join(','));
  check('맨 위 카드의 ▲ 는 꺼져 있음',
    (await page.evaluate(() => document.querySelector('[data-arr-bar="quote.today"] [data-arr-move="up"]').disabled)) === true);

  // 크기도 그 자리에서 바꿉니다.
  await page.$eval('[data-arr-bar="quote.today"] [data-arr-size="compact"]', (n) => n.click());
  await page.waitForTimeout(400);
  check('카드 크기를 그 자리에서 바꿈',
    (await page.getAttribute('[data-card="quote.today"]', 'data-size')) === 'compact',
    String(await page.getAttribute('[data-card="quote.today"]', 'data-size')));
  check('크기를 바꿔도 도구줄이 살아 있음',
    (await page.evaluate(() => document.querySelectorAll('#panel-quote .arr-bar').length)) === 2);

  await closeArrange();
  check('완료하면 도구줄이 전부 걷힘',
    (await page.evaluate(() => document.querySelectorAll('.arr-bar').length)) === 0);
  check('완료하면 편집 표시가 지워짐', (await arrangingOn()) === false);

  // 새로고침해도 바꾼 순서가 남아야 합니다.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(400);
  await goTab(page, 'quote');
  await settlePagerOf(page);
  await page.$eval('[data-arr-bar="quote.today"] [data-arr-move="down"]', (n) => n.click()).catch(() => {});
  check('새로고침 뒤에도 편집 모드는 꺼져 있음', (await arrangingOn()) === false);

  // 순서를 한 번 더 바꿔 저장한 뒤, 새로고침해서 남는지 봅니다.
  await openArrange();
  await page.$eval('[data-arr-bar="quote.today"] [data-arr-move="down"]', (n) => n.click());
  await page.waitForTimeout(400);
  await closeArrange();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(400);
  check('새로고침해도 바꾼 카드 순서가 남음',
    (await cardsOf('quote')).join(',') === 'quote.mine,quote.today',
    (await cardsOf('quote')).join(','));

  /*
   * '오늘' 탭 위젯.
   * 위젯은 통째로 <button> 이라 누르면 해당 탭으로 건너뜁니다.
   * 옮기다가 화면이 넘어가 버리면 편집이 불가능합니다.
   */
  await goTab(page, 'today');
  await settlePagerOf(page);
  const wBefore = await widgetsNow();
  await openArrange();
  /*
   * 위젯에도 크기 버튼이 있어야 합니다.
   * 예전에는 일부러 빼 두었는데('오늘 탭은 한 묶음으로 움직인다'는 생각이었습니다),
   * 그 결과 '오늘' 탭에서는 크기를 바꿀 방법이 아예 없었습니다. 실제로 그 지적을 받았습니다.
   */
  check('위젯에도 크기 버튼이 있음',
    (await page.evaluate(() => document.querySelectorAll('#today-widgets [data-arr-size]').length)) > 0);
  const wDrag = await dragOnto('#panel-today', `[data-arr-bar="${wBefore[0]}"] .arr-grab`,
    `[data-widget="${wBefore[1]}"]`);
  const wAfter = await widgetsNow();
  check('위젯도 끌어서 순서가 바뀜',
    wAfter[0] === wBefore[1] && wAfter[1] === wBefore[0],
    `${wBefore.join(',')} -> ${wAfter.join(',')} (${wDrag.where})`);
  check('위젯을 옮겨도 탭이 넘어가지 않음',
    (await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]')?.dataset.tab)) === 'today');
  check('위젯 순서가 저장됨',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('daily-kit:ui.prefs') || '{}').widgets))
      .join(',') === wAfter.join(','));
  check('위젯을 옮긴 뒤에도 도구줄이 살아 있음',
    (await page.evaluate(() => document.querySelectorAll('#today-widgets .arr-bar').length)) === wAfter.length);

  /*
   * 편집 중에 위젯 몸통을 눌러도 넘어가면 안 됩니다.
   *
   * 누르면 해당 탭으로 건너뛰는 위젯을 골라야 합니다. '오늘 할 일' 위젯은 버튼이 아니라
   * 상자라서 몸통을 눌러도 원래 아무 일이 없습니다. 그걸 누르면 무엇을 고쳐도 통과합니다.
   */
  const navWidget = wAfter.find((name) => name !== 'todo');
  check('누르면 이동하는 위젯이 화면에 있음 (없으면 아래 검사가 헛돕니다)', !!navWidget,
    wAfter.join(','));
  const goesTo = await page.evaluate((name) => (
    document.querySelector(`[data-widget="${name}"]`)?.dataset.goto), navWidget);
  {
    const body = await boxOf(`[data-widget="${navWidget}"]`);
    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(500);
    const now = await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]')?.dataset.tab);
    check('편집 중 위젯을 눌러도 탭이 넘어가지 않음', now === 'today',
      `${navWidget} 를 눌렀더니 ${now} (편집이 아니면 ${goesTo} 로 갑니다)`);
  }
  await closeArrange();

  // 편집을 끝내면 위젯은 원래대로 눌러서 이동할 수 있어야 합니다.
  {
    const body = await boxOf(`[data-widget="${navWidget}"]`);
    await page.mouse.click(body.x, body.y);
    await settlePagerOf(page);
    const went = await page.evaluate(() => document.querySelector('.tab[aria-selected="true"]')?.dataset.tab);
    check('편집을 끝내면 위젯 누르기가 되살아남', went === goesTo, `이동한 탭: ${went} (기대 ${goesTo})`);
  }

  // 딴 탭으로 넘어가면 편집이 저절로 꺼져야 합니다. 도구줄이 남으면 무엇을 고치는지 헷갈립니다.
  await goTab(page, 'quote');
  await settlePagerOf(page);
  await openArrange();
  await goTab(page, 'memo');
  await settlePagerOf(page);
  check('탭을 옮기면 편집이 저절로 꺼짐', (await arrangingOn()) === false);
  check('옮긴 뒤 도구줄도 남지 않음',
    (await page.evaluate(() => document.querySelectorAll('.arr-bar').length)) === 0);

  // 편집 중 보고 있던 자리와 페이저가 흔들리면 안 됩니다. (예전에 색만 바꿔도 위로 튀었습니다)
  await goTab(page, 'settings');
  await settlePagerOf(page);
  await page.evaluate(() => { document.querySelector('#panel-settings').scrollTop = 600; });
  await page.waitForTimeout(200);
  const arrBefore = await page.evaluate(() => ({
    top: Math.round(document.querySelector('#panel-settings').scrollTop),
    left: Math.round(document.querySelector('#main').scrollLeft),
  }));
  await openArrange();
  const arrAfter = await page.evaluate(() => ({
    top: Math.round(document.querySelector('#panel-settings').scrollTop),
    left: Math.round(document.querySelector('#main').scrollLeft),
  }));
  check('편집을 켜도 보고 있던 자리가 그대로',
    arrBefore.top > 300 && arrBefore.top === arrAfter.top, `${arrBefore.top}px -> ${arrAfter.top}px`);
  check('편집을 켜도 페이저가 제자리',
    arrBefore.left === arrAfter.left, `${arrBefore.left} -> ${arrAfter.left}`);
  await closeArrange();

  /*
   * 전화기 폭에서도 되는지.
   *
   * 이 페이지는 1280px 라 카드가 두 칸에 나란히 놓입니다. 실제로 쓰는 건 전화기이고,
   * 거기서는 카드가 한 줄로 쌓여 두 번째 카드가 화면 아래로 넘어갑니다.
   * 그 상황에서 끌려면 패널이 손가락을 따라 스크롤해 줘야 합니다. 그 길을 따로 봅니다.
   */
  {
    const phone = await context.newPage();
    await phone.route('**/api.open-meteo.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
    }));
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(BASE, { waitUntil: 'networkidle' });
    await phone.waitForSelector('body[data-ready="true"]');
    /*
     * 저장소는 창끼리 같습니다. 앞 검사가 이미 순서를 뒤집고 카드를 '작게'로 줄여 놨습니다.
     * 그대로 두면 '바뀌었는지' 보는 검사가 처음부터 목표 상태라 무엇을 해도 통과합니다.
     * 깨끗한 자리에서 다시 시작합니다.
     */
    await phone.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('daily-kit:ui.prefs') || '{}');
      delete raw.cardOrder;
      raw.cards = {};
      localStorage.setItem('daily-kit:ui.prefs', JSON.stringify(raw));
    });
    await phone.reload({ waitUntil: 'networkidle' });
    await phone.waitForSelector('body[data-ready="true"]');
    await goTab(phone, 'quote');
    await phone.waitForTimeout(500);

    const phoneCards = () => phone.evaluate(() => (
      [...document.querySelectorAll('#panel-quote > [data-card]')].map((n) => n.dataset.card)));
    check('전화기 폭: 기본 순서에서 시작 (여기가 어긋나면 아래 검사가 헛돕니다)',
      (await phoneCards()).join(',') === 'quote.today,quote.mine', (await phoneCards()).join(','));

    await phone.$eval('#arr-start', (n) => n.click());
    await phone.waitForTimeout(400);
    check('전화기 폭: 편집이 켜짐',
      (await phone.evaluate(() => document.body.dataset.arranging === 'on')) === true);

    // 좁은 폭에서 도구줄이 화면을 넘기면 버튼을 누를 수가 없습니다.
    for (const w of [320, 360, 390]) {
      await phone.setViewportSize({ width: w, height: 844 });
      await phone.waitForTimeout(250);
      const over = await phone.evaluate(() => {
        const panel = document.querySelector('.panel[data-arranging="on"]');
        const dock = document.querySelector('#arr-dock');
        const bad = [];
        if (panel.scrollWidth - panel.clientWidth > 1) bad.push(`패널 +${panel.scrollWidth - panel.clientWidth}px`);
        const d = dock.getBoundingClientRect();
        if (d.left < -1 || d.right > window.innerWidth + 1) bad.push(`막대 ${Math.round(d.left)}~${Math.round(d.right)}`);
        return bad;
      });
      check(`전화기 폭(${w}px): 편집 중에도 가로 넘침 없음`, over.length === 0,
        over.length ? over.join(', ') : '정상');
    }
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.waitForTimeout(300);

    // 두 번째 카드가 화면 밖에 있는지 확인하고, 그 상태에서 끌어 봅니다.
    const layout = await phone.evaluate(() => {
      const b = document.querySelector('[data-card="quote.mine"]').getBoundingClientRect();
      return { bottom: Math.round(b.bottom), vh: window.innerHeight };
    });
    check('전화기 폭: 두 번째 카드가 화면 아래로 넘어감 (따라 스크롤이 필요한 상황)',
      layout.bottom > layout.vh, `카드 끝 ${layout.bottom}px / 화면 ${layout.vh}px`);

    await phone.evaluate(() => { document.querySelector('#panel-quote').scrollTop = 0; });
    await phone.waitForTimeout(200);
    const before = await phoneCards();
    const g = await phone.evaluate(() => {
      const r = document.querySelector('[data-arr-bar="quote.today"] .arr-grab').getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    await phone.mouse.move(g.x, g.y);
    await phone.mouse.down();
    await phone.mouse.move(g.x, g.y + 20, { steps: 4 });
    await phone.waitForTimeout(80);
    // 화면 아래 끝 가까이로 끌면 패널이 따라 올라와 두 번째 카드가 올라옵니다.
    await phone.mouse.move(g.x, 810, { steps: 14 });
    await phone.waitForTimeout(400);
    const scrolled = await phone.evaluate(() => Math.round(document.querySelector('#panel-quote').scrollTop));
    await phone.mouse.up();
    await phone.waitForTimeout(450);
    const after = await phoneCards();
    check('전화기 폭: 화면 끝으로 끌면 패널이 따라 스크롤함', scrolled > 20, `${scrolled}px 내려감`);
    check('전화기 폭: 한 줄로 쌓인 상태에서도 순서가 바뀜',
      after.join(',') === 'quote.mine,quote.today', `${before.join(',')} -> ${after.join(',')}`);

    /* ---------- 꾹 눌러 편집 켜기 ----------
     *
     * 메뉴의 '화면 편집' 버튼은 탭 아홉 개 밑이라 좁은 화면에서 잘 보이지 않습니다.
     * 손으로 쓰는 사람은 홈 화면 아이콘처럼 '꾹 누르기'를 먼저 시도합니다.
     * 켜지는 경우만이 아니라, 켜지면 안 되는 경우(짧은 탭 · 스크롤 · 자판)도 같이 봅니다.
     */
    await phone.$eval('#arr-done', (n) => n.click());
    await phone.waitForTimeout(300);
    await goTab(phone, 'today');
    await phone.waitForTimeout(600);

    const holding = () => phone.evaluate(() => document.body.dataset.arranging === 'on');
    const phoneWidgets = () => phone.evaluate(() => (
      [...document.querySelectorAll('#today-widgets > [data-widget]')].map((n) => n.dataset.widget)));
    /** 손가락으로 누르고 ms 만큼 있다가 뗍니다. move 를 주면 누른 채 그만큼 밉니다. */
    const pressHold = async (sel, ms, move = 0) => {
      const r = await phone.evaluate((sl) => {
        const b = document.querySelector(sl).getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(b.height / 2, 28)) };
      }, sel);
      await phone.mouse.move(r.x, r.y);
      await phone.mouse.down();
      if (move) { await phone.waitForTimeout(80); await phone.mouse.move(r.x, r.y + move, { steps: 4 }); }
      await phone.waitForTimeout(ms);
      await phone.mouse.up();
      await phone.waitForTimeout(300);
      return r;
    };

    await pressHold('#today-widgets > [data-widget]', 120);
    check('꾹 누르기: 짧게 누르면 편집이 켜지지 않음', (await holding()) === false);

    await pressHold('#today-widgets > [data-widget]', 700, 60);
    check('꾹 누르기: 누른 채 밀면(스크롤) 편집이 켜지지 않음', (await holding()) === false);

    await pressHold('#today-widgets > [data-widget]', 700);
    check('꾹 누르기: 오래 누르면 편집이 켜짐', (await holding()) === true);
    check('꾹 누르기: 위젯이 버튼이지만 탭이 넘어가지 않음',
      (await phone.evaluate(() => document.querySelector('.tab[data-tab="today"]').getAttribute('aria-selected'))) === 'true');
    await phone.$eval('#arr-done', (n) => n.click());
    await phone.waitForTimeout(300);

    await goTab(phone, 'calc');
    await phone.waitForTimeout(500);
    await phone.evaluate(() => { document.querySelector('#calc-expr').value = ''; });
    await pressHold('.key[data-ins="7"]', 700);
    check('꾹 누르기: 계산기 자판을 길게 눌러도 편집이 켜지지 않음', (await holding()) === false);
    check('꾹 누르기: 길게 눌러도 숫자는 정상 입력됨',
      (await phone.$eval('#calc-expr', (n) => n.value)).includes('7'));

    await goTab(phone, 'today');
    await phone.waitForTimeout(600);
    const wBefore2 = await phoneWidgets();
    if (wBefore2.length >= 2) {
      const start = await phone.evaluate(() => {
        const b = document.querySelector('#today-widgets > [data-widget]').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 20) };
      });
      await phone.mouse.move(start.x, start.y);
      await phone.mouse.down();
      await phone.waitForTimeout(700);                  // 여기서 편집이 켜지고 그대로 잡힙니다
      check('꾹 누르기: 손을 떼지 않고 바로 잡힘',
        (await phone.evaluate(() => !!document.querySelector('[data-arr-drag="on"]'))) === true);

      /*
       * 잡고 있는 동안 '오늘' 탭이 다시 그려지게 만듭니다.
       *
       * today.js 는 replaceChildren 으로 위젯을 통째로 갈아치우는데, 날씨가 도착하거나
       * 할 일이 바뀌거나 언어가 바뀌기만 해도 그 일이 일어납니다. 막지 않으면 잡고 있던
       * 카드가 DOM 에서 사라져 드래그가 조용히 끊깁니다. 언어 전환이 같은 경로라 이걸 씁니다.
       * (편집 중인 '오늘' 패널 밖의 버튼이라 편집 모드의 클릭 차단에 걸리지 않습니다)
       */
      await phone.evaluate(() => { window.__held = document.querySelector('#today-widgets > [data-widget]'); });
      await phone.$eval('#lang-switch .lang-btn[data-lang="en"]', (n) => n.click());
      await phone.waitForTimeout(500);
      check('꾹 누르기: 끄는 도중에 화면이 갱신돼도 잡고 있던 카드가 살아 있음',
        (await phone.evaluate(() => document.contains(window.__held))) === true);

      const drop = await phone.evaluate(() => {
        const b = document.querySelectorAll('#today-widgets > [data-widget]')[1].getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.bottom - 12) };
      });
      await phone.mouse.move(drop.x, Math.min(drop.y, 820), { steps: 14 });
      await phone.waitForTimeout(250);
      await phone.mouse.up();
      await phone.waitForTimeout(600);
      const wAfter2 = await phoneWidgets();
      check('꾹 누르기: 손을 떼지 않고 끌어서 순서가 바뀜',
        wAfter2.join(',') !== wBefore2.join(','), `${wBefore2.join(',')} -> ${wAfter2.join(',')}`);
      await phone.$eval('#lang-switch .lang-btn[data-lang="ko"]', (n) => n.click());
      await phone.waitForTimeout(300);
      await phone.$eval('#arr-done', (n) => n.click());
      await phone.waitForTimeout(400);
      check('꾹 누르기: 편집을 끄고 다시 그려도 순서가 유지됨',
        (await phoneWidgets()).join(',') === wAfter2.join(','));
    } else {
      check('꾹 누르기: 위젯이 둘 이상이어야 끌기 검사 가능', false, `위젯 ${wBefore2.length}개`);
    }

    // 메뉴에 꾹 누르기 안내가 있는지 (버튼이 안 보이는 사람이 방법을 알 유일한 길입니다)
    await phone.$eval('#menu-open', (n) => n.click());
    await phone.waitForTimeout(400);
    const noteText = await phone.$eval('.sidebar-note', (n) => n.textContent.trim());
    check('메뉴에 꾹 누르기 안내가 있음', noteText.length > 0, noteText);
    await phone.$eval('#menu-close', (n) => n.click());
    await phone.waitForTimeout(200);

    await phone.close();
  }

  /* ---------- 진짜 손가락으로 끌기 ----------
   *
   * 위의 검사들은 마우스로 흉내 낸 것입니다. 마우스에는 touch-action 이 없어서
   * '끌려다 화면이 스크롤되는' 문제가 드러나지 않습니다.
   * 손잡이에는 touch-action: none 이 걸려 있지만 꾹 눌러 잡을 때는 누른 곳이 카드 본체라,
   * touchmove 를 취소해 주지 않으면 브라우저가 스크롤로 가로채 드래그가 통째로 죽습니다.
   * (실제로 그 코드를 빼 보면 카드가 손가락을 아예 따라오지 않습니다)
   * 그래서 CDP 로 진짜 터치 이벤트를 쏴서 확인합니다.
   */
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    });
    await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
    }));
    const tp = await ctx.newPage();
    await tp.goto(BASE, { waitUntil: 'networkidle' });
    await tp.waitForSelector('body[data-ready="true"]');
    await goTab(tp, 'today');
    await tp.waitForTimeout(600);

    const cdp = await ctx.newCDPSession(tp);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
    });
    const tOrder = () => tp.evaluate(() => (
      [...document.querySelectorAll('#today-widgets > [data-widget]')].map((n) => n.dataset.widget)));
    const tScroll = () => tp.evaluate(() => Math.round(document.querySelector('#panel-today').scrollTop));

    // 내용이 짧으면 스크롤이 생기지 않아 '스크롤되는지' 보는 검사가 헛돕니다. 길이를 만듭니다.
    await tp.evaluate(() => {
      const pad = document.createElement('div');
      pad.style.height = '1200px';
      document.querySelector('#panel-today').append(pad);
    });
    await tp.waitForTimeout(200);
    const room = await tp.evaluate(() => {
      const el = document.querySelector('#panel-today');
      return el.scrollHeight - el.clientHeight;
    });
    check('터치 검사 전제: 오늘 탭이 스크롤될 만큼 김', room > 200, `${room}px 여유`);

    const tBefore = await tOrder();
    if (tBefore.length >= 2) {
      const from = await tp.evaluate(() => {
        const b = document.querySelector('#today-widgets > [data-widget]').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 20) };
      });
      await touch('touchStart', from.x, from.y);
      await tp.waitForTimeout(700);
      check('터치: 꾹 누르면 편집이 켜짐',
        (await tp.evaluate(() => document.body.dataset.arranging === 'on')) === true);
      check('터치: 손을 떼지 않고 바로 잡힘',
        (await tp.evaluate(() => !!document.querySelector('[data-arr-drag="on"]'))) === true);

      const s0 = await tScroll();
      const to = await tp.evaluate(() => {
        const b = document.querySelectorAll('#today-widgets > [data-widget]')[1].getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.bottom - 12) };
      });
      for (let i = 1; i <= 12; i += 1) {
        await touch('touchMove', Math.round(from.x + (to.x - from.x) * i / 12),
          Math.round(from.y + (to.y - from.y) * i / 12));
        await tp.waitForTimeout(25);
      }
      await tp.waitForTimeout(150);
      const moved = await tp.evaluate(() => document.querySelector('[data-arr-drag="on"]')?.style.transform || '');
      const s1 = await tScroll();
      check('터치: 끄는 동안 카드가 손가락을 따라옴', moved.includes('translate'), moved || '(안 움직임)');
      check('터치: 끄는 동안 화면이 같이 스크롤되지 않음', Math.abs(s1 - s0) < 20, `${s0} -> ${s1}`);
      await touch('touchEnd', to.x, to.y);
      await tp.waitForTimeout(700);
      const tAfter = await tOrder();
      check('터치: 끌어서 순서가 바뀜', tAfter.join(',') !== tBefore.join(','),
        `${tBefore.join(',')} -> ${tAfter.join(',')}`);
      await tp.$eval('#arr-done', (n) => n.click());
      await tp.waitForTimeout(400);
    } else {
      check('터치: 위젯이 둘 이상이어야 끌기 검사 가능', false, `위젯 ${tBefore.length}개`);
    }

    /*
     * 꾹 누르고 있는 0.5초 '사이에' 화면이 다시 그려지는 경우.
     *
     * 편집 모드일 때만 다시 그리기를 막으면 늦습니다. 누르고 있는 동안에는 아직
     * 편집이 아니라, 그 사이에 위젯이 갈리면 눌린 노드가 DOM 에서 빠집니다.
     * 그 순간 브라우저가 pointercancel 을 쏘고, 한 번 취소된 손가락으로는
     * 그 뒤에 무엇을 해도 끌 수 없습니다.
     * 실제로 앱을 열자마자 날씨 응답이 도착/실패하는 시점이 여기에 자주 걸렸습니다.
     * 여기서는 같은 경로(언어 전환 -> renderAll)로 그 타이밍을 만들어 봅니다.
     */
    const midBefore = await tOrder();
    if (midBefore.length >= 2) {
      const mid = await tp.evaluate(() => {
        const b = document.querySelector('#today-widgets > [data-widget]').getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + 20) };
      });
      await tp.evaluate(() => {
        window.__gone = [];
        new MutationObserver((ms) => ms.forEach((m) => {
          if (m.removedNodes.length) window.__gone.push(m.removedNodes.length);
        })).observe(document.querySelector('#today-widgets'), { childList: true });
      });
      await touch('touchStart', mid.x, mid.y);
      await tp.waitForTimeout(200);                   // 아직 편집이 켜지기 전
      await tp.$eval('#lang-switch .lang-btn[data-lang="en"]', (n) => n.click());
      await tp.waitForTimeout(150);
      check('꾹 누르는 도중 화면 갱신: 눌린 위젯이 DOM 에 살아 있음',
        (await tp.evaluate(() => window.__gone.length)) === 0,
        `제거 ${await tp.evaluate(() => window.__gone.join(','))}`);
      await tp.waitForTimeout(500);                   // 여기서 편집이 켜집니다
      check('꾹 누르는 도중 화면 갱신: 그래도 편집이 켜지고 잡힘',
        (await tp.evaluate(() => !!document.querySelector('[data-arr-drag="on"]'))) === true);
      const midTo = await tp.evaluate(() => {
        const b = document.querySelectorAll('#today-widgets > [data-widget]')[1].getBoundingClientRect();
        return { x: Math.round(b.x + b.width / 2), y: Math.round(b.bottom - 12) };
      });
      for (let i = 1; i <= 12; i += 1) {
        await touch('touchMove', Math.round(mid.x + (midTo.x - mid.x) * i / 12),
          Math.round(mid.y + (midTo.y - mid.y) * i / 12));
        await tp.waitForTimeout(25);
      }
      const midMoved = await tp.evaluate(() => document.querySelector('[data-arr-drag="on"]')?.style.transform || '');
      check('꾹 누르는 도중 화면 갱신: 그래도 카드가 손가락을 따라옴',
        midMoved.includes('translate'), midMoved || '(안 움직임)');
      await touch('touchEnd', midTo.x, midTo.y);
      await tp.waitForTimeout(600);
      check('꾹 누르는 도중 화면 갱신: 순서가 바뀜',
        (await tOrder()).join(',') !== midBefore.join(','),
        `${midBefore.join(',')} -> ${(await tOrder()).join(',')}`);
      await tp.$eval('#arr-done', (n) => n.click());
      await tp.waitForTimeout(500);
      // 미뤄 둔 그리기가 처리되지 않으면 화면이 빈 채로 남습니다.
      check('꾹 누르는 도중 화면 갱신: 손을 뗀 뒤 위젯이 그대로 있음',
        (await tOrder()).length === midBefore.length, `${(await tOrder()).length}개`);
      await tp.$eval('#lang-switch .lang-btn[data-lang="ko"]', (n) => n.click());
      await tp.waitForTimeout(300);
    }

    // 편집이 꺼져 있을 때는 손가락으로 평소처럼 화면이 굴러가야 합니다.
    await tp.evaluate(() => { document.querySelector('#panel-today').scrollTop = 0; });
    const p0 = await tScroll();
    await touch('touchStart', 195, 620);
    for (let i = 1; i <= 10; i += 1) { await touch('touchMove', 195, 620 - i * 25); await tp.waitForTimeout(20); }
    await touch('touchEnd', 195, 370);
    await tp.waitForTimeout(500);
    const p1 = await tScroll();
    check('터치: 편집이 꺼져 있으면 화면이 정상적으로 굴러감', p1 > p0 + 20, `${p0} -> ${p1}`);
    check('터치: 굴리는 것만으로는 편집이 켜지지 않음',
      (await tp.evaluate(() => document.body.dataset.arranging === 'on')) === false);
    await tp.close();
    await ctx.close();
  }

  /* ---------- 편집 막대 · 카드 크기 ----------
   *
   * 실기기 화면을 받아 보고 찾은 것들입니다. 셋 다 데스크톱 폭에서는 멀쩡해 보였습니다.
   */
  {
    /*
     * '완료' 막대가 화면 안에 있어야 합니다.
     *
     * 예전에는 body 밑에서 position: fixed 였는데, '보이는 화면'과 '배치 기준 화면'이
     * 다른 환경(안드로이드 WebView, 모바일 에뮬레이션)에서는 fixed 의 기준이 화면보다
     * 훨씬 커집니다. 실제로 화면 높이 844px 에 막대가 3311px 위치에 놓여, 편집을 끄는
     * 길이 화면에서 사라졌습니다. isMobile 을 켠 쪽이 그 상황을 재현합니다.
     */
    for (const mobile of [false, true]) {
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: mobile,
      });
      await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
      }));
      const dp = await ctx.newPage();
      await dp.goto(BASE, { waitUntil: 'networkidle' });
      await dp.waitForSelector('body[data-ready="true"]');
      await dp.waitForTimeout(500);
      await dp.$eval('#arr-start', (n) => n.click());
      await dp.waitForTimeout(500);
      const box = await dp.evaluate(() => {
        const el = document.querySelector('#arr-dock');
        const r = el.getBoundingClientRect();
        const vh = document.documentElement.clientHeight;
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh };
      });
      check(`완료 막대가 화면 안에 있음 (isMobile=${mobile})`,
        box.top >= 0 && box.bottom <= box.vh + 1,
        `막대 ${box.top}~${box.bottom} / 화면 ${box.vh}`);
      await ctx.close();
    }

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    await ctx.route('**/api.open-meteo.com/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST),
    }));
    const sp = await ctx.newPage();
    await sp.goto(BASE, { waitUntil: 'networkidle' });
    await sp.waitForSelector('body[data-ready="true"]');
    await sp.waitForTimeout(600);

    // '오늘' 탭 위젯에도 크기 버튼이 있어야 합니다. 예전에는 카드에만 달렸습니다.
    await sp.$eval('#arr-start', (n) => n.click());
    await sp.waitForTimeout(500);
    const wBtns = await sp.evaluate(() => {
      const bar = document.querySelector('#today-widgets .arr-bar');
      return bar ? [...bar.querySelectorAll('button')].map((b) => b.textContent.trim()) : [];
    });
    check('오늘 탭 위젯에도 크기 버튼이 있음',
      wBtns.includes('작게') && wBtns.includes('크게'), wBtns.join(' '));

    /*
     * 편집 중에는 손잡이가 아니라 카드 아무 데나 잡아도 끌려야 합니다.
     * 손가락으로 34px 짜리 손잡이를 정확히 누르기는 어렵습니다.
     */
    const wOrder = () => sp.evaluate(() => (
      [...document.querySelectorAll('#today-widgets > [data-widget]')].map((n) => n.dataset.widget)));
    const wBefore = await wOrder();
    if (wBefore.length >= 2) {
      const grab = await sp.evaluate(() => {
        const r = document.querySelector('#today-widgets > [data-widget]').getBoundingClientRect();
        return { x: Math.round(r.x + r.width - 30), y: Math.round(r.bottom - 20) };   // 손잡이에서 먼 자리
      });
      const drop = await sp.evaluate(() => {
        const r = document.querySelectorAll('#today-widgets > [data-widget]')[1].getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.bottom - 12) };
      });
      await sp.mouse.move(grab.x, grab.y);
      await sp.mouse.down();
      await sp.mouse.move(grab.x, grab.y + 15, { steps: 3 });
      await sp.waitForTimeout(80);
      check('편집 중 카드 본체(손잡이 아님)로도 잡힘',
        (await sp.evaluate(() => !!document.querySelector('[data-arr-drag="on"]'))) === true);
      await sp.mouse.move(drop.x, Math.min(drop.y, 820), { steps: 14 });
      await sp.waitForTimeout(200);
      await sp.mouse.up();
      await sp.waitForTimeout(500);
      check('카드 본체를 끌어 순서가 바뀜',
        (await wOrder()).join(',') !== wBefore.join(','),
        `${wBefore.join(',')} -> ${(await wOrder()).join(',')}`);
    }
    // 도구줄 버튼은 드래그에 먹히지 않고 눌려야 합니다.
    await sp.$eval('#today-widgets .arr-bar [data-arr-size="large"]', (n) => n.click());
    await sp.waitForTimeout(500);
    check('편집 중에도 크기 버튼이 눌림',
      (await sp.evaluate(() => document.querySelector('#today-widgets > [data-widget]')?.dataset.size)) === 'large');
    await sp.$eval('#arr-done', (n) => n.click());
    await sp.waitForTimeout(300);

    /*
     * 크기를 바꾸면 실제로 눈에 띄어야 합니다.
     * 예전에는 패딩 ±5px 과 큰 숫자 몇 개만 바뀌어 '골라도 차이가 없다'는 말을 들었습니다.
     */
    await goTab(sp, 'todo');
    await sp.waitForTimeout(500);
    const fontAt = async (size) => {
      await sp.evaluate((sz) => {
        const el = document.querySelector('[data-card="todo.plan"]');
        el.dataset.size = sz === 'normal' ? '' : sz;
        if (sz === 'normal') el.removeAttribute('data-size');
      }, size);
      await sp.waitForTimeout(150);
      return sp.evaluate(() => parseFloat(
        getComputedStyle(document.querySelector('[data-card="todo.plan"]')).fontSize));
    };
    const fSmall = await fontAt('compact');
    const fLarge = await fontAt('large');
    await fontAt('normal');
    check('카드 크기를 바꾸면 글자 크기가 실제로 달라짐', fLarge - fSmall >= 3,
      `작게 ${fSmall}px -> 크게 ${fLarge}px`);

    /*
     * 모든 카드를 '크게' 로 놓아도 가로로 넘치면 안 됩니다.
     * 글자를 키우자 할 일 입력줄의 시각 칸이 잘렸습니다. 그 회귀를 여기서 잡습니다.
     */
    for (const w of [320, 360, 390]) {
      await sp.setViewportSize({ width: w, height: 844 });
      await sp.evaluate(() => {
        document.querySelectorAll('[data-card], [data-widget]').forEach((n) => { n.dataset.size = 'large'; });
      });
      await sp.waitForTimeout(400);
      const over = await sp.evaluate(() => {
        const out = [];
        document.querySelectorAll('.panel').forEach((panel) => {
          if (panel.hidden) return;
          panel.querySelectorAll('[data-card], [data-widget]').forEach((c) => {
            const d = c.scrollWidth - c.clientWidth;
            if (d > 1) out.push(`${c.dataset.card || c.dataset.widget} +${d}px`);
          });
        });
        return out;
      });
      check(`${w}px · 모든 카드를 '크게' 로 놓아도 가로 넘침 없음`, over.length === 0,
        over.join(', ') || '정상');
    }
    await sp.evaluate(() => {
      document.querySelectorAll('[data-card], [data-widget]').forEach((n) => n.removeAttribute('data-size'));
    });
    await sp.setViewportSize({ width: 390, height: 844 });
    await ctx.close();
  }

  // 뒷 검사에 영향을 주지 않도록 전부 되돌립니다.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('daily-kit:ui.prefs') || '{}');
    delete raw.cardOrder;
    raw.widgets = ['weather', 'todo'];
    raw.cards = {};
    localStorage.setItem('daily-kit:ui.prefs', JSON.stringify(raw));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('body[data-ready="true"]');
  await page.waitForTimeout(400);
  check('되돌리기: 카드 순서가 기본으로', (await cardsOf('quote')).join(',') === 'quote.today,quote.mine',
    (await cardsOf('quote')).join(','));

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
