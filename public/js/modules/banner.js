/** 배너 모듈: 설정에서 등록한 문구를 6초마다 순환 표시합니다. */
import { $, el } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

export const BANNER_KEY = 'banner.items';
const ROTATE_MS = 6000;

const DEFAULTS = [
  { title: '환영합니다 👋', text: '계산기 · 날씨 · 할 일 · 타이머를 한 화면에서' },
  { title: '설정에서 바꿔보세요', text: '이 배너 문구는 설정 탭에서 직접 편집할 수 있습니다' },
];

// 웹 주소로 접속했을 때만 설치 안내가 의미가 있습니다.
// 파일을 직접 연 경우(file://)에는 매니페스트가 없어 '홈 화면에 추가' 가 동작하지 않습니다.
function installHint() {
  const isWeb = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  return isWeb
    ? { title: '홈 화면에 추가', text: '브라우저 메뉴 → 홈 화면에 추가 하면 앱처럼 쓸 수 있어요' }
    : { title: '오프라인으로 실행 중', text: '인터넷 없이도 계산기 · 타이머 · 메모를 쓸 수 있습니다' };
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
