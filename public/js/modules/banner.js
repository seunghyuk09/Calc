/** 배너 모듈: 설정에서 등록한 문구를 6초마다 순환 표시합니다. */
import { $, el } from '../lib/dom.js';
import { load, save } from '../lib/store.js';
import { isNative, isNativeUrl } from './update.js';

export const BANNER_KEY = 'banner.items';
const ROTATE_MS = 6000;

const DEFAULTS = [
  { title: '환영합니다 👋', text: '계산기 · 날씨 · 할 일 · 타이머를 한 화면에서' },
  { title: '설정에서 바꿔보세요', text: '이 배너 문구는 설정 탭에서 직접 편집할 수 있습니다' },
];

/** 실행 위치별로 의미가 있는 안내 문구. */
const HINTS = Object.freeze({
  native: { title: '앱으로 실행 중', text: '업데이트는 설정 탭의 앱 업데이트에서 확인할 수 있습니다' },
  web: { title: '홈 화면에 추가', text: '브라우저 메뉴 → 홈 화면에 추가 하면 앱처럼 쓸 수 있어요' },
  file: { title: '오프라인으로 실행 중', text: '인터넷 없이도 계산기 · 타이머 · 메모를 쓸 수 있습니다' },
});

/**
 * 주소를 보고 실행 위치를 가릅니다.
 *
 * 프로토콜만 보면 안 됩니다. 안드로이드 앱의 주소는 `https://localhost` 라서
 * 프로토콜이 `https:` 입니다. 그래서 앱 안에서 '브라우저 메뉴 → 홈 화면에 추가' 를
 * 안내하고 있었습니다. 이미 설치된 앱에 설치하라고 말한 셈입니다.
 *
 * update.js / sw.js 와 같은 규칙(`isNativeUrl`)을 씁니다. 판정이 갈리면 또 어긋납니다.
 *
 * @param {Location | {protocol: string, hostname: string, port: string}} loc
 * @returns {'native' | 'web' | 'file'}
 */
export function hintEnv(loc) {
  if (isNativeUrl(loc)) return 'native';
  if (loc?.protocol === 'http:' || loc?.protocol === 'https:') return 'web';
  return 'file';
}

function installHint() {
  // Capacitor 전역이 있으면 그것도 앱입니다. (주소 판정보다 넓기만 하고 좁지 않습니다)
  const where = isNative() ? 'native' : hintEnv(window.location);
  return HINTS[where];
}

let items = DEFAULTS;
let index = 0;
let timer = null;

function render() {
  const item = items[index] || DEFAULTS[0];
  $('#banner-title').textContent = item.title || '';
  $('#banner-text').textContent = item.text || '';

  const dots = $('#banner-dots');
  dots.replaceChildren();
  if (items.length <= 1) return;
  items.forEach((_, i) => {
    dots.append(el('button', {
      class: 'banner-dot',
      type: 'button',
      'aria-label': `배너 ${i + 1}`,
      'aria-current': String(i === index),
      onclick: () => { index = i; render(); restart(); },
    }));
  });
}

function restart() {
  clearInterval(timer);
  if (items.length <= 1) return;
  timer = setInterval(() => { index = (index + 1) % items.length; render(); }, ROTATE_MS);
}

/**
 * 여러 줄 텍스트를 배너 항목 배열로 변환합니다.
 * "제목 | 내용" 형식이면 나누고, 아니면 전체를 내용으로 씁니다.
 */
export function parseBannerText(raw) {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const pipe = line.indexOf('|');
      if (pipe === -1) return { title: '', text: line };
      return { title: line.slice(0, pipe).trim(), text: line.slice(pipe + 1).trim() };
    });
}

export function applyBanner(list) {
  items = Array.isArray(list) && list.length ? list : [...DEFAULTS, installHint()];
  index = 0;
  render();
  restart();
}

export function initBanner() {
  applyBanner(load(BANNER_KEY, null));
}

export function saveBanner(list) {
  save(BANNER_KEY, list);
  applyBanner(list);
}
