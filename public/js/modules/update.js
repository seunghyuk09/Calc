/**
 * update.js — 앱 업데이트 확인
 *
 * 배포 경로마다 업데이트되는 방식이 달라서, 환경을 먼저 가려낸 뒤 그에 맞는 방법을 씁니다.
 *
 *  web    : 서비스 워커. 새 sw.js 가 있으면 받아서 활성화하고 화면을 다시 불러옵니다.
 *  native : 안드로이드 앱. 웹 자산이 APK 안에 박혀 있어 서비스 워커로는 못 고칩니다.
 *           GitHub 릴리스의 커밋과 이 빌드의 커밋을 비교해, 다르면 내려받기를 열어 줍니다.
 *           설치는 안드로이드 설치 화면에서 사용자가 직접 눌러야 합니다.
 *           (사이드로드 앱은 시스템이 확인 대화상자를 강제합니다. 자동 설치는 불가능합니다)
 *  none   : 단일 파일(file://)이나 서비스 워커를 올리지 않은 미리보기. 확인할 방법이 없습니다.
 */
import { $, el, toast } from '../lib/dom.js';
import { t } from '../lib/i18n.js';
import { load, save } from '../lib/store.js';
import { onTabChange } from '../lib/nav.js';
import { BUILD, shortVersion, isStamped } from '../lib/version.js';

const RELEASE_API = 'https://api.github.com/repos/seunghyuk09/Calc/releases/tags/nightly';
const APK_URL = 'https://github.com/seunghyuk09/Calc/releases/download/nightly/dailykit-debug.apk';

const LAST_CHECK_KEY = 'update.lastCheck';
/* 앱에서 남은 워커를 지우고 한 번 새로고침했다는 표시. 무한 새로고침을 막습니다. */
const PURGED_KEY = 'daily-kit:sw-purged';
/*
 * 자동 확인 간격.
 * GitHub API 는 로그인 없이 시간당 60회까지라 앱을 열 때마다 두드리면 안 됩니다.
 * 하루 한 번보다는 자주, 여는 족족보다는 드물게 잡았습니다.
 */
const AUTO_INTERVAL_MS = 60 * 60 * 1000;
/*
 * 앱을 열자마자 확인하면 날씨 같은 첫 화면 요청과 겹칩니다.
 * 급한 일이 아니므로 뒤로 미룹니다.
 */
const AUTO_DELAY_MS = 3000;

let registration = null;
let reloading = false;
let state = 'idle';     // idle | checking | latest | ready | error | none
let detail = '';        // 상태 밑에 붙는 설명
let downloadUrl = '';   // native 에서 새 버전이 있을 때의 내려받기 주소

/** 안드로이드/ iOS 앱 안에서 도는지. Capacitor 가 전역을 심어 줍니다. */
export function isNative() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

/** 이 환경에서 쓸 수 있는 업데이트 방식. */
export function updateMode() {
  if (isNative()) return 'native';
  if (window.__DK_DISABLE_SW) return 'none';
  if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return 'none';
  if (!('serviceWorker' in navigator)) return 'none';
  return 'web';
}

function setState(next, text = '') {
  state = next;
  detail = text;
  syncBadge();
  render();
}

/* ---------- 웹: 서비스 워커 ---------- */

/*
 * 앱 안에 남은 서비스 워커를 지웁니다.
 *
 * 앱에서는 워커를 쓰지 않는데, 업데이트 기능이 생기기 전 버전이 등록해 둔 워커가
 * 아직 남아 있는 기기가 있습니다. 그 워커는 캐시 우선이라 APK 를 새로 깔아도
 * 옛 화면을 계속 내놓습니다.
 *
 * sw.js 안에도 스스로를 지우는 코드가 있지만, 그것은 브라우저가 워커를 갱신해 줄 때만
 * 돕니다. 앱은 register() 를 부르지 않으니 갱신이 언제 도는지는 브라우저 마음입니다.
 * (실제로 재현해 보니 sw.js 를 다시 받아 가지 않아 영영 옛 화면인 경우가 있었습니다)
 * 그래서 화면 쪽에서 직접 지웁니다. 이쪽은 브라우저 사정을 타지 않습니다.
 *
 * 한계: 이 코드는 '새 파일이 실행될 때' 도는 것이라, 이미 옛 워커가 화면 파일까지
 * 캐시에서 내놓고 있는 기기는 이 코드 자체가 실행되지 않습니다. 그런 기기는
 * 앱을 지웠다 다시 까는 수밖에 없습니다.
 */
async function purgeNativeWorkers() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    /*
     * 등록이 이미 없어도 캐시는 남아 있을 수 있어 항상 훑습니다.
     *
     * 지우는 사이에도 아직 살아 있는 옛 워커가 지나가는 요청을 캐시에 다시 넣습니다.
     * 그래서 한 번 지우고 끝내면 '등록은 0인데 캐시는 1' 인 상태가 남습니다.
     * 다음 실행 때 이 줄이 마저 치웁니다.
     */
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    if (!regs.length) return;
    /*
     * 지금 화면은 아직 옛 워커가 내준 파일로 떠 있을 수 있습니다.
     * 등록을 지웠으니 다시 불러오면 APK 안의 파일이 그대로 쓰입니다.
     * 한 번만 돕니다. 세션 표시를 남겨 두어 무한 새로고침을 막습니다.
     */
    if (!navigator.serviceWorker.controller) return;
    if (window.sessionStorage?.getItem(PURGED_KEY)) return;
    window.sessionStorage?.setItem(PURGED_KEY, '1');
    window.location.reload();
  } catch (err) {
    console.warn('[sw] 앱에 남은 워커 정리 실패', err);
  }
}

export function registerServiceWorker() {
  if (updateMode() === 'native') { purgeNativeWorkers(); return; }
  if (updateMode() !== 'web') return;
  window.addEventListener('load', async () => {
    try {
      registration = await navigator.serviceWorker.register('./sw.js');
      /*
       * 새 워커가 넘겨받으면 화면의 자바스크립트는 아직 옛 버전입니다.
       * 여기서 알려 주지 않으면 사용자는 새로고침해야 한다는 것을 알 방법이 없습니다.
       * 마음대로 새로고침하면 입력 중인 내용이 날아가므로, 버튼을 눌러 적용하게 합니다.
       */
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        setState('ready');
        toast(t('upd.ready'));
      });
    } catch (err) {
      console.warn('[sw] 등록 실패', err);
    }
  });
}

/** 새 버전이 있는지 서버에 물어봅니다. */
async function checkWeb() {
  if (!registration) {
    registration = await navigator.serviceWorker.getRegistration().catch(() => null);
  }
  if (!registration) { setState('error', t('upd.noRegistration')); return; }

  // 이미 대기 중인 워커가 있으면 더 볼 것 없이 준비된 상태입니다.
  if (registration.waiting) { setState('ready'); return; }

  await registration.update();

  // update() 가 끝나도 설치가 진행 중일 수 있습니다. 잠깐 기다렸다가 판단합니다.
  const installing = registration.installing;
  if (installing) {
    await new Promise((done) => {
      const onChange = () => {
        if (installing.state === 'installed' || installing.state === 'activated') {
          installing.removeEventListener('statechange', onChange);
          done();
        }
      };
      installing.addEventListener('statechange', onChange);
      // 네트워크가 느려도 화면이 '확인 중'에서 멈춰 있지 않게 상한을 둡니다.
      setTimeout(done, 8000);
    });
  }

  if (registration.waiting || registration.installing) setState('ready');
  else setState('latest', t('upd.version', shortVersion()));
}

/** 준비된 새 버전을 적용합니다. */
async function applyWeb() {
  reloading = true;
  try {
    registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch { /* 메시지를 못 보내도 새로고침만으로 대부분 반영됩니다 */ }
  // 새 워커가 넘겨받을 시간을 조금 준 뒤 다시 불러옵니다.
  setTimeout(() => window.location.reload(), 150);
}

/* ---------- 앱: 릴리스 비교 ---------- */

async function checkNative() {
  if (!isStamped()) {
    // 개발 빌드는 비교 기준이 없습니다. 있지도 않은 업데이트를 있다고 하면 안 됩니다.
    setState('none', t('upd.devBuild'));
    return;
  }
  let data;
  try {
    const res = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.status === 403) { setState('error', t('upd.rateLimited')); return; }
    if (!res.ok) { setState('error', t('upd.httpError', res.status)); return; }
    data = await res.json();
  } catch {
    setState('error', t('upd.offline'));
    return;
  }

  const latest = typeof data?.target_commitish === 'string' ? data.target_commitish : '';
  if (!/^[0-9a-f]{40}$/.test(latest)) { setState('error', t('upd.badResponse')); return; }

  if (latest === BUILD.commit) {
    setState('latest', t('upd.version', shortVersion()));
    return;
  }
  downloadUrl = APK_URL;
  setState('ready', t('upd.newBuild', latest.slice(0, 7)));
}

/* ---------- 공통 ---------- */

/**
 * @param {{silent?: boolean}} opts
 *   silent 이면 사용자가 누르지 않은 확인입니다.
 *   실패해도 화면에 에러를 띄우지 않습니다. 묻지도 않았는데 빨간 글씨가 뜨면 방해입니다.
 */
export async function checkForUpdate({ silent = false } = {}) {
  const mode = updateMode();
  if (mode === 'none') {
    if (!silent) setState('none', t('upd.unsupported'));
    return;
  }
  const before = state;
  if (!silent) setState('checking');
  try {
    if (mode === 'native') await checkNative();
    else await checkWeb();
  } catch (err) {
    console.warn('[update] 확인 실패', err);
    if (silent) setState(before, detail);
    else setState('error', t('upd.failed'));
    return;
  }
  // 조용한 확인이 실패로 끝났으면 원래 상태로 되돌립니다.
  if (silent && state === 'error') setState(before, detail);
}

/** 마지막 확인 이후 충분히 지났을 때만 조용히 확인합니다. */
export async function autoCheck() {
  if (updateMode() === 'none') return;
  const last = load(LAST_CHECK_KEY, 0);
  const now = Date.now();
  // 저장값이 손상돼 미래 시각이면 그대로 두고 한 번 확인합니다. 영영 안 도는 것보다 낫습니다.
  if (typeof last === 'number' && last <= now && now - last < AUTO_INTERVAL_MS) return;
  save(LAST_CHECK_KEY, now);
  await checkForUpdate({ silent: true });
}

/**
 * 새 버전이 있으면 메뉴 버튼과 사이드바의 '설정' 줄에 점을 찍습니다.
 * 설정 탭 맨 아래 카드에만 두면 끝까지 스크롤해야 알게 되어, 자동 확인이 무의미해집니다.
 */
function syncBadge() {
  const on = state === 'ready';
  if (on) document.body.dataset.hasUpdate = 'true';
  else delete document.body.dataset.hasUpdate;
}

function apply() {
  // 내려받기로 넘어가면 이 화면에서 할 일은 끝났습니다. 표시를 지웁니다.
  delete document.body.dataset.hasUpdate;
  if (updateMode() === 'native') {
    // 앱에서는 브라우저로 내려받기를 엽니다. 설치 화면은 사용자가 직접 거칩니다.
    window.open(downloadUrl || APK_URL, '_blank', 'noopener');
    return;
  }
  applyWeb();
}

function render() {
  const box = $('#update-body');
  if (!box) return;
  const mode = updateMode();

  const now = el('p', { class: 'card-sub' },
    `${t('upd.current')}: ${shortVersion()}${BUILD.builtAt ? ` · ${BUILD.builtAt.slice(0, 10)}` : ''}`);

  const btn = el('button', {
    class: state === 'ready' ? 'btn btn-primary' : 'btn',
    type: 'button',
    id: 'update-action',
  }, t(state === 'ready' ? (mode === 'native' ? 'upd.download' : 'upd.apply') : 'upd.check'));
  btn.disabled = state === 'checking';
  btn.addEventListener('click', state === 'ready' ? apply : checkForUpdate);

  const msgKey = {
    idle: 'upd.idle', checking: 'upd.checking', latest: 'upd.latest',
    ready: mode === 'native' ? 'upd.readyNative' : 'upd.readyWeb',
    error: 'upd.error', none: 'upd.none',
  }[state] || 'upd.idle';

  box.replaceChildren(
    now,
    el('div', { class: 'row', style: 'margin:10px 0' }, btn),
    el('p', {
      class: `upd-msg${state === 'error' ? ' is-error' : ''}`,
      id: 'update-msg',
      'aria-live': 'polite',
      dataset: { state },
    }, detail ? `${t(msgKey)} — ${detail}` : t(msgKey)),
    // 앱에서는 자동 설치가 불가능하다는 점을 미리 알려 둡니다. 눌렀는데 안 되면 고장으로 오해합니다.
    mode === 'native' ? el('p', { class: 'note' }, t('upd.nativeNote')) : '',
  );
}

export function initUpdate() {
  render();
  // 설정 탭을 열 때마다 (간격 제한 안에서) 다시 확인합니다.
  onTabChange((tab) => { if (tab === 'settings') autoCheck(); });
  setTimeout(() => { autoCheck(); }, AUTO_DELAY_MS);
}
