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
import { BUILD, shortVersion, isStamped } from '../lib/version.js';

const RELEASE_API = 'https://api.github.com/repos/seunghyuk09/Calc/releases/tags/nightly';
const APK_URL = 'https://github.com/seunghyuk09/Calc/releases/download/nightly/dailykit-debug.apk';

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
  render();
}

/* ---------- 웹: 서비스 워커 ---------- */

export function registerServiceWorker() {
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

export async function checkForUpdate() {
  const mode = updateMode();
  if (mode === 'none') { setState('none', t('upd.unsupported')); return; }
  setState('checking');
  try {
    if (mode === 'native') await checkNative();
    else await checkWeb();
  } catch (err) {
    console.warn('[update] 확인 실패', err);
    setState('error', t('upd.failed'));
  }
}

function apply() {
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
}
