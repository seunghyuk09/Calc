/**
 * 음악 모듈
 *
 * [중요] 멜론/지니/유튜브뮤직은 외부 앱에서 계정 연결 후 재생하는 공식 API 를 제공하지 않습니다.
 * Spotify 는 API 가 있으나 2026-02 정책 변경으로 개발 모드 앱은 소유자 Premium 필수 + 테스터 5명 제한,
 * 확장 쿼터는 법인/MAU 25만 이상만 신청 가능하여 개인 앱에서는 사실상 사용할 수 없습니다.
 * 따라서 실제 재생은 공식 임베드가 허용된 YouTube 만 지원하고, 나머지는 검색 딥링크로 처리합니다.
 */
import { $, el, toast } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

const LAST_KEY = 'music.last';

// 각 서비스의 웹 검색 URL (공개된 검색 페이지 주소)
const SERVICES = [
  { id: 'melon', name: '멜론', icon: '🍈', url: (q) => `https://www.melon.com/search/total/index.htm?q=${encodeURIComponent(q)}` },
  { id: 'genie', name: '지니', icon: '🧞', url: (q) => `https://www.genie.co.kr/search/searchMain?query=${encodeURIComponent(q)}` },
  { id: 'ytmusic', name: 'YouTube Music', icon: '▶️', url: (q) => `https://music.youtube.com/search?q=${encodeURIComponent(q)}` },
  { id: 'spotify', name: 'Spotify', icon: '🟢', url: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}` },
  { id: 'bugs', name: '벅스', icon: '🐞', url: (q) => `https://music.bugs.co.kr/search/integrated?q=${encodeURIComponent(q)}` },
  { id: 'flo', name: 'FLO', icon: '🌊', url: (q) => `https://www.music-flo.com/search/all?keyword=${encodeURIComponent(q)}` },
];

/**
 * YouTube URL 또는 ID 를 파싱해 임베드 정보를 만듭니다.
 * @returns {{type:'video'|'playlist', id:string}|null}
 */
export function parseYouTube(input) {
  const text = String(input || '').trim();
  if (!text) return null;

  // 재생목록 URL (list= 파라미터)
  const listMatch = text.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
  // 영상 URL 의 여러 형태: watch?v=, youtu.be/, /embed/, /shorts/, /live/
  const videoMatch = text.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);

  if (videoMatch) return { type: 'video', id: videoMatch[1] };
  if (listMatch) return { type: 'playlist', id: listMatch[1] };

  // URL 이 아닌 순수 ID 입력
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return { type: 'video', id: text };
  if (/^(PL|UU|LL|OL|RD)[A-Za-z0-9_-]{10,}$/.test(text)) return { type: 'playlist', id: text };

  return null;
}

function embedUrl(parsed) {
  return parsed.type === 'playlist'
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${parsed.id}`
    : `https://www.youtube-nocookie.com/embed/${parsed.id}`;
}

function mount(parsed) {
  $('#yt-holder').replaceChildren(el('iframe', {
    class: 'yt-frame',
    src: embedUrl(parsed),
    title: 'YouTube 플레이어',
    allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
    allowfullscreen: true,
    referrerpolicy: 'strict-origin-when-cross-origin',
    loading: 'lazy',
  }));
  save(LAST_KEY, parsed);
}

function renderServices() {
  const grid = $('#svc-grid');
  grid.replaceChildren();
  SERVICES.forEach((svc) => {
    grid.append(el('a', {
      class: 'svc-btn',
      href: '#',
      target: '_blank',
      rel: 'noopener noreferrer',
      onclick: (e) => {
        e.preventDefault();
        const query = $('#svc-query').value.trim();
        if (!query) { toast('검색할 곡이나 아티스트를 입력해 주세요', 'error'); return; }
        window.open(svc.url(query), '_blank', 'noopener');
      },
    }, el('span', {}, svc.icon), el('span', {}, svc.name)));
  });
}

export function initMusic() {
  renderServices();

  const last = load(LAST_KEY, null);
  if (last && last.id && (last.type === 'video' || last.type === 'playlist')) mount(last);

  $('#yt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const parsed = parseYouTube($('#yt-input').value);
    if (!parsed) {
      toast('YouTube 영상/재생목록 주소를 확인해 주세요', 'error');
      return;
    }
    mount(parsed);
    $('#yt-input').value = '';
  });

  $('#yt-search-btn').addEventListener('click', () => {
    const query = $('#yt-search').value.trim();
    if (!query) { toast('검색어를 입력해 주세요', 'error'); return; }
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank', 'noopener');
  });
}
