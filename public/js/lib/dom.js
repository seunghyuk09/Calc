/**
 * dom.js
 * DOM 조작을 짧게 쓰기 위한 최소 헬퍼 모음.
 */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** 요소를 생성합니다. el('div', {class:'x'}, '텍스트') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  });
  children.flat().forEach((child) => {
    if (child == null || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

/** 숫자를 2자리로 0 채움 */
export const pad2 = (n) => String(n).padStart(2, '0');

/** 화면 우측 하단에 잠깐 뜨는 알림 */
let toastTimer = null;
export function toast(message, type = 'info') {
  let box = $('#toast');
  if (!box) {
    box = el('div', { id: 'toast', class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  box.textContent = message;
  box.dataset.type = type;
  box.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('is-visible'), 2600);
}

/** HTML 문자열을 안전하게 텍스트로 이스케이프 */
export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * 고유 ID 를 만듭니다.
 * crypto.randomUUID 는 보안 컨텍스트에서만 동작하므로, 없으면 대체 방식을 씁니다.
 * (예: file:// 로 연 단일 파일 버전, 구형 브라우저)
 */
export function uid() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 아래 대체 방식으로 내려갑니다 */ }
  // 마지막 대체: 시각 + 증가 카운터 (같은 세션 안에서 충돌하지 않으면 충분합니다)
  uidCounter += 1;
  return `id-${Date.now().toString(36)}-${uidCounter.toString(36)}`;
}
let uidCounter = 0;
