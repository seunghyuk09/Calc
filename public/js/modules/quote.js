/** 글귀 모듈: 사용자가 등록한 글귀를 우선 표시하고, 없으면 기본 격언을 보여줍니다. */
import { $, el, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

const KEY = 'quote.items';

// 저작권 문제가 없는 공개 격언 (출처 표기 포함)
const DEFAULTS = [
  { text: '시작이 반이다.', author: '한국 속담' },
  { text: '천 리 길도 한 걸음부터.', author: '한국 속담' },
  { text: '오늘 할 수 있는 일에 전력을 다하라.', author: '아이작 뉴턴' },
  { text: '아는 것을 안다고 하고, 모르는 것을 모른다고 하는 것이 곧 아는 것이다.', author: '공자' },
  { text: '실패란 넘어지는 것이 아니라, 넘어진 자리에 머무는 것이다.', author: '서양 격언' },
  { text: '가장 어두운 밤도 끝나고 해는 떠오른다.', author: '빅토르 위고' },
  { text: '작은 일에 최선을 다하면 큰 일도 이루어진다.', author: '서양 격언' },
  { text: '급할수록 돌아가라.', author: '한국 속담' },
];

let items = [];
let lastIndex = -1;

function pool() {
  return items.length ? items : DEFAULTS;
}

function showRandom() {
  const list = pool();
  let index = Math.floor(Math.random() * list.length);
  // 항목이 2개 이상이면 직전과 다른 글귀를 고릅니다.
  if (list.length > 1 && index === lastIndex) index = (index + 1) % list.length;
  lastIndex = index;
  const quote = list[index];
  $('#quote-text').textContent = quote.text;
  $('#quote-author').textContent = quote.author ? `— ${quote.author}` : '';
}

function render() {
  const list = $('#quote-list');
  $('#quote-count').textContent = items.length ? `${items.length}개` : '기본 격언 사용 중';
  list.replaceChildren();
  if (!items.length) {
    list.append(el('li', { class: 'empty' }, '내 글귀를 등록하면 여기에 표시됩니다.'));
    return;
  }
  items.forEach((quote) => {
    list.append(el('li', { class: 'memo-item' },
      el('div', { class: 'memo-body' }, quote.text),
      el('div', { class: 'row', style: 'margin-top:4px' },
        el('span', { class: 'memo-time grow' }, quote.author ? `— ${quote.author}` : ''),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          onclick: () => { items = items.filter((q) => q.id !== quote.id); save(KEY, items); render(); showRandom(); },
        }, '삭제'),
      ),
    ));
  });
}

export function initQuote() {
  items = load(KEY, []);
  if (!Array.isArray(items)) items = [];
  render();
  showRandom();

  $('#quote-next').addEventListener('click', showRandom);

  $('#quote-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const textEl = $('#quote-input');
    const authorEl = $('#quote-author-input');
    const text = textEl.value.trim();
    if (!text) return;
    items.unshift({ id: crypto.randomUUID(), text, author: authorEl.value.trim(), at: Date.now() });
    textEl.value = '';
    authorEl.value = '';
    save(KEY, items);
    render();
    showRandom();
    toast('글귀를 등록했습니다');
  });
}
