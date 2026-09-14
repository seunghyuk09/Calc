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
