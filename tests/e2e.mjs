/**
 * e2e.mjs — 실제 Chromium 으로 앱 전체를 검증합니다.
 * 실행: node tests/e2e.mjs  (public/ 를 http 로 서빙한 상태여야 함)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8099';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
// 단일 파일(file://) 빌드에서는 서비스 워커와 manifest 를 쓸 수 없으므로 해당 검증을 건너뜁니다.
const IS_FILE = BASE.startsWith('file:');

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
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: [],
  });
  const page = await context.newPage();

  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
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

  // ---------- 1. 계산기 ----------
  console.log('\n▶ 계산기');
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

  // ---------- 2. 할 일 ----------
  console.log('\n▶ 할 일');
  await page.click('.tab[data-tab="todo"]');
  await page.fill('#todo-input', '보고서 작성');
  await page.press('#todo-input', 'Enter');
  await page.fill('#todo-input', '운동하기');
  await page.press('#todo-input', 'Enter');
  check('할 일 2개 추가', (await page.locator('#todo-list .todo-item').count()) === 2);

  await page.locator('#todo-list .todo-item input[type="checkbox"]').first().check();
  check('완료 체크 반영', (await page.locator('#todo-list .todo-item.done').count()) === 1);

  await page.click('.chip[data-filter="active"]');
  check('진행 중 필터', (await page.locator('#todo-list .todo-item').count()) === 1);
  await page.click('.chip[data-filter="all"]');

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
  check('새로고침 후 할 일 유지', (await page.locator('#todo-list .todo-item').count()) === 2);
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
  await page.screenshot({ path: IS_FILE ? 'docs/screenshot-standalone.png' : 'docs/screenshot-desktop.png', fullPage: false });

  await page.click('.tab[data-tab="weather"]');
  await page.waitForTimeout(500);
  await page.screenshot({ path: IS_FILE ? 'docs/screenshot-standalone-weather.png' : 'docs/screenshot-weather.png', fullPage: false });

  // 모바일 뷰포트
  const mobile = await context.newPage();
  await mobile.route('**/api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_FORECAST) }));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('body[data-ready="true"]');
  await mobile.click('.tab[data-tab="calc"]');
  await mobile.waitForTimeout(400);
  await mobile.screenshot({ path: IS_FILE ? 'docs/screenshot-standalone-mobile.png' : 'docs/screenshot-mobile.png', fullPage: false });

  // 모바일에서 가로 스크롤이 생기지 않아야 함
  const overflow = await mobile.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('모바일(390px) 가로 스크롤 없음', overflow <= 1, `초과 ${overflow}px`);
  await mobile.close();

  // ---------- 12. 콘솔 에러 ----------
  console.log('\n▶ 콘솔');
  const realErrors = consoleErrors.filter((e) =>
    !e.includes('favicon') && !e.includes('net::ERR_') && !e.toLowerCase().includes('manifest'));
  check('페이지 JS 예외 없음', pageErrors.length === 0, pageErrors.join(' | ') || '없음');
  check('콘솔 에러 없음', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || '없음');

  await browser.close();

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
