/**
 * AI 검색 모듈 — BYOK(Bring Your Own Key) 방식
 *
 * [보안 경고] 브라우저에서 Anthropic API 를 직접 호출하려면
 * 'anthropic-dangerous-direct-browser-access: true' 헤더가 필요합니다.
 * 이 방식은 키가 개발자 도구에 그대로 노출되므로 "본인 기기 전용"으로만 안전합니다.
 * 불특정 다수에게 배포하는 서비스라면 반드시 서버 프록시를 두고 키를 서버에 보관해야 합니다.
 */
import { $, el, toast } from '../lib/dom.js';
import { load } from '../lib/store.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
export const APIKEY_KEY = 'ai.apiKey';
export const MODEL_KEY = 'ai.model';
const DEFAULT_MODEL = 'claude-opus-5';

// effort 파라미터를 지원하지 않는 모델 (Haiku 4.5 는 400 에러)
const NO_EFFORT_MODELS = new Set(['claude-haiku-4-5']);
// 최신 web_search 도구를 지원하지 않는 모델은 구버전 도구 타입을 사용합니다.
const LEGACY_SEARCH_MODELS = new Set(['claude-haiku-4-5']);

const SYSTEM_PROMPT = [
  '당신은 한국어 사용자를 돕는 간결한 검색 도우미입니다.',
  '최신 정보나 사실 확인이 필요한 질문에는 반드시 web_search 도구를 사용하세요.',
  '추측하지 말고, 확인된 사실만 답하세요. 모르면 모른다고 말하세요.',
  '답변은 핵심부터 3~6문장으로 짧게 쓰고, 출처가 있으면 마지막에 URL 을 나열하세요.',
].join(' ');

let history = [];   // Anthropic messages 배열 (role/content)
let busy = false;

function getKey() { return load(APIKEY_KEY, ''); }
function getModel() { return load(MODEL_KEY, DEFAULT_MODEL) || DEFAULT_MODEL; }

export function refreshAiMode() {
  const badge = $('#ai-mode');
  if (!badge) return;
  const key = getKey();
  badge.textContent = key ? `${getModel()} 사용 중` : '키 미설정 — 설정 탭에서 등록';
  badge.style.color = key ? 'var(--success)' : 'var(--text-faint)';
}

function appendMessage(role, text) {
  const log = $('#ai-log');
  const node = el('div', {
    class: `msg ${role === 'user' ? 'msg-user' : role === 'error' ? 'msg-err' : 'msg-ai'}`,
  }, text);
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

/** 응답 content 배열에서 텍스트와 검색 출처를 뽑아냅니다. */
function extractAnswer(data) {
  const parts = [];
  const sources = new Map();

  (data?.content || []).forEach((block) => {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
      // 인용이 붙어 있으면 출처를 모읍니다.
      (block.citations || []).forEach((c) => {
        if (c?.url) sources.set(c.url, c.title || c.url);
      });
    } else if (block.type === 'web_search_tool_result') {
      // 성공 시 content 는 배열, 오류 시 객체입니다.
      if (Array.isArray(block.content)) {
        block.content.forEach((r) => { if (r?.url) sources.set(r.url, r.title || r.url); });
      }
    }
  });

  let text = parts.join('\n').trim();
  if (sources.size) {
    const list = [...sources.entries()].slice(0, 5).map(([url, title]) => `• ${title}\n  ${url}`);
    text += `\n\n[출처]\n${list.join('\n')}`;
  }
  return text || '(응답이 비어 있습니다)';
}

function buildRequestBody(model) {
  const searchToolType = LEGACY_SEARCH_MODELS.has(model) ? 'web_search_20250305' : 'web_search_20260209';
  const body = {
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: history,
    tools: [{ type: searchToolType, name: 'web_search', max_uses: 5 }],
  };
  // 응답 속도를 위해 낮은 effort 를 사용합니다. (지원하지 않는 모델은 생략)
  if (!NO_EFFORT_MODELS.has(model)) body.output_config = { effort: 'low' };
  return body;
}

/** 에러 응답을 사람이 읽을 수 있는 한국어 메시지로 바꿉니다. */
async function toFriendlyError(res) {
  let detail = '';
  try {
    const err = await res.json();
    detail = err?.error?.message || '';
  } catch { /* 본문이 JSON 이 아닐 수 있음 */ }

  if (res.status === 401) return 'API 키가 올바르지 않습니다. 설정 탭에서 키를 다시 확인해 주세요.';
  if (res.status === 403) return 'API 키에 이 요청을 수행할 권한이 없습니다.';
  if (res.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (res.status === 400) return `요청이 거부되었습니다: ${detail || '알 수 없는 오류'}`;
  if (res.status >= 500) return 'Anthropic 서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해 주세요.';
  return `오류가 발생했습니다 (HTTP ${res.status}) ${detail}`;
}

async function ask(question) {
  const key = getKey();
  if (!key) {
    appendMessage('error', 'API 키가 설정되지 않았습니다. 설정 탭에서 Anthropic API 키를 등록하거나, 아래 외부 검색 버튼을 이용하세요.');
    return;
  }
  if (busy) return;
  busy = true;
  $('#ai-send').disabled = true;

  history.push({ role: 'user', content: question });
  const placeholder = appendMessage('ai', '');
  placeholder.append(el('span', { class: 'spinner' }), ' 검색하고 생각하는 중…');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000); // 웹 검색 포함 시 오래 걸릴 수 있음

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        // 브라우저에서 직접 호출하기 위한 필수 헤더 (CORS 허용)
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(buildRequestBody(getModel())),
    });

    if (!res.ok) {
      placeholder.remove();
      history.pop();
      appendMessage('error', await toFriendlyError(res));
      return;
    }

    const data = await res.json();

    // 안전 분류기가 거절한 경우 content 를 읽기 전에 먼저 확인해야 합니다.
    if (data?.stop_reason === 'refusal') {
      placeholder.remove();
      history.pop();
      appendMessage('error', '모델이 이 요청에 대한 답변을 거절했습니다. 질문을 바꿔서 다시 시도해 주세요.');
      return;
    }

    const answer = extractAnswer(data);
    placeholder.textContent = answer;
    history.push({ role: 'assistant', content: answer });

    // 대화가 길어지면 앞부분을 잘라 토큰 사용량을 억제합니다.
    if (history.length > 12) history = history.slice(-12);
  } catch (err) {
    placeholder.remove();
    history.pop();
    const message = err.name === 'AbortError'
      ? '응답 시간이 초과되었습니다. 다시 시도해 주세요.'
      : '네트워크 오류입니다. 인터넷 연결 또는 브라우저 확장 프로그램(광고 차단 등)을 확인해 주세요.';
    appendMessage('error', message);
  } finally {
    clearTimeout(timer);
    busy = false;
    $('#ai-send').disabled = false;
  }
}

const EXTERNAL = {
  google: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  naver: (q) => `https://search.naver.com/search.naver?query=${encodeURIComponent(q)}`,
  perplexity: (q) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
};

export function initAi() {
  refreshAiMode();
  $('#ai-log').replaceChildren(
    el('div', { class: 'msg msg-ai' },
      '안녕하세요! 설정 탭에 Anthropic API 키를 등록하면 웹 검색을 포함한 AI 답변을 받을 수 있습니다.\n키 없이도 아래 외부 검색 버튼은 바로 쓸 수 있어요.'),
  );

  $('#ai-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#ai-input');
    const question = input.value.trim();
    if (!question) return;
    appendMessage('user', question);
    input.value = '';
    ask(question);
  });

  document.querySelectorAll('[data-ext]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const query = $('#ai-input').value.trim();
      if (!query) { toast('검색어를 입력해 주세요', 'error'); return; }
      window.open(EXTERNAL[btn.dataset.ext](query), '_blank', 'noopener');
    });
  });
}
