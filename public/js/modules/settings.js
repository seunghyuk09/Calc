/** 설정 모듈: 테마, 배너 편집, API 키 관리, 데이터 백업/복원/초기화 */
import { $, toast } from '../lib/dom.js';
import { load, save, remove, clearAll, exportAll, importAll, isPersistent,
  saveSecret, loadSecret, removeSecret, isSharedStorage } from '../lib/store.js';
import { BANNER_KEY, parseBannerText, saveBanner } from './banner.js';
import { APIKEY_KEY, MODEL_KEY, refreshAiMode } from './ai.js';

export const THEME_KEY = 'ui.theme';

/** 테마를 문서에 적용합니다. 'auto' 는 data-theme 속성을 제거해 시스템 설정을 따릅니다. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    const dark = theme === 'dark'
      || (theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#0f1216' : '#3b6ef6');
  }
}

export function initTheme() {
  applyTheme(load(THEME_KEY, 'auto'));
  $('#theme-toggle').addEventListener('click', () => {
    // 토글은 라이트 -> 다크 -> 시스템 순으로 순환합니다.
    const order = ['auto', 'light', 'dark'];
    const current = load(THEME_KEY, 'auto');
    const next = order[(order.indexOf(current) + 1) % order.length];
    save(THEME_KEY, next);
    applyTheme(next);
    const label = { auto: '시스템 설정', light: '라이트', dark: '다크' }[next];
    const select = $('#set-theme');
    if (select) select.value = next;
    toast(`테마: ${label}`);
  });
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initSettings() {
  // --- 테마 선택 ---
  const themeSelect = $('#set-theme');
  themeSelect.value = load(THEME_KEY, 'auto');
  themeSelect.addEventListener('change', () => {
    save(THEME_KEY, themeSelect.value);
    applyTheme(themeSelect.value);
  });

  // --- 배너 ---
  const bannerBox = $('#set-banner');
  const savedBanner = load(BANNER_KEY, null);
  if (Array.isArray(savedBanner)) {
    bannerBox.value = savedBanner
      .map((b) => (b.title ? `${b.title} | ${b.text}` : b.text))
      .join('\n');
  }
  $('#set-banner-save').addEventListener('click', () => {
    const list = parseBannerText(bannerBox.value);
    saveBanner(list);
    toast(list.length ? `배너 ${list.length}개를 저장했습니다` : '기본 배너로 되돌렸습니다');
  });

  // --- API 키 ---
  const keyInput = $('#set-apikey');
  const savedKey = loadSecret(APIKEY_KEY, '');
  if (savedKey) keyInput.placeholder = `저장됨 (${savedKey.slice(0, 7)}…${savedKey.slice(-4)})`;

  $('#set-apikey-save').addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (!value) { toast('키를 입력해 주세요', 'error'); return; }
    if (!value.startsWith('sk-ant-')) {
      toast('Anthropic 키는 보통 sk-ant- 로 시작합니다. 다시 확인해 주세요.', 'error');
      return;
    }
    saveSecret(APIKEY_KEY, value);
    keyInput.value = '';
    keyInput.placeholder = `저장됨 (${value.slice(0, 7)}…${value.slice(-4)})`;
    refreshAiMode();
    toast(isSharedStorage()
      ? 'API 키를 이 창에만 보관합니다 (창을 닫으면 지워집니다)'
      : 'API 키를 저장했습니다 (이 기기에만 저장됨)');
  });

  $('#set-apikey-clear').addEventListener('click', () => {
    removeSecret(APIKEY_KEY);
    keyInput.value = '';
    keyInput.placeholder = 'sk-ant-...';
    refreshAiMode();
    toast('API 키를 삭제했습니다');
  });

  const modelSelect = $('#set-model');
  modelSelect.value = load(MODEL_KEY, 'claude-opus-5');
  modelSelect.addEventListener('change', () => {
    save(MODEL_KEY, modelSelect.value);
    refreshAiMode();
  });

  // --- 데이터 백업 / 복원 / 초기화 ---
  $('#set-export').addEventListener('click', () => {
    const data = exportAll();
    // 백업 파일에 API 키가 그대로 들어가면 위험하므로 제외합니다.
    delete data[APIKEY_KEY];
    downloadJson(`데일리킷_백업_${new Date().toISOString().slice(0, 10)}.json`, data);
    toast('백업 파일을 내려받았습니다 (API 키는 제외)');
  });

  $('#set-import').addEventListener('click', () => $('#set-import-file').click());
  $('#set-import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('형식 오류');
      importAll(parsed);
      toast('복원했습니다. 새로고침합니다…');
      setTimeout(() => window.location.reload(), 900);
    } catch {
      toast('백업 파일을 읽지 못했습니다', 'error');
    } finally {
      e.target.value = '';
    }
  });

  $('#set-reset').addEventListener('click', () => {
    // 되돌릴 수 없는 작업이므로 두 번 확인합니다.
    if (!window.confirm('저장된 모든 데이터(할 일, 메모, 그림, 글귀, 설정, API 키)를 삭제합니다. 계속할까요?')) return;
    if (!window.confirm('정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    clearAll();
    toast('초기화했습니다. 새로고침합니다…');
    setTimeout(() => window.location.reload(), 900);
  });

  if (!isPersistent()) {
    $('#set-storage-note').textContent = '⚠️ 이 브라우저는 저장소가 차단되어 있습니다. 새로고침하면 데이터가 사라집니다.';
  } else if (isSharedStorage()) {
    // file:// 로 연 경우 Chromium 은 모든 로컬 html 이 같은 저장소를 쓰게 합니다.
    $('#set-storage-note').textContent = '⚠️ 파일로 직접 연 상태입니다. 저장 공간이 이 컴퓨터의 다른 로컬 HTML 파일과 공유되므로, '
      + 'API 키는 디스크에 저장하지 않고 이 창에만 보관합니다(창을 닫으면 지워집니다). '
      + '할 일·메모 등 나머지 데이터는 정상 저장됩니다.';
  } else {
    $('#set-storage-note').textContent = '데이터는 이 브라우저(localStorage)에만 저장됩니다. 기기 간 동기화는 되지 않습니다.';
  }
}
