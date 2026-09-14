/**
 * 날씨 모듈 — Open-Meteo (API 키 불필요, CORS 허용)
 * 현재 날씨 + 7일 예보. 데이터 출처 표기 필요 (CC BY 4.0)
 */
import { $, el } from '../lib/dom.js';
import { load, save } from '../lib/store.js';

const PLACE_KEY = 'weather.place';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const DEFAULT_PLACE = { name: '서울', country: '대한민국', latitude: 37.5665, longitude: 126.978 };

// WMO 날씨 해석 코드 -> 한국어 설명 + 이모지
const WMO = {
  0: ['맑음', '☀️'],
  1: ['대체로 맑음', '🌤️'], 2: ['부분적으로 흐림', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['서리 안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['강한 이슬비', '🌧️'],
  56: ['약한 어는 이슬비', '🌧️'], 57: ['어는 이슬비', '🌧️'],
  61: ['약한 비', '🌦️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'],
  66: ['약한 어는 비', '🌧️'], 67: ['어는 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '❄️'], 75: ['강한 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['약한 소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'],
  85: ['약한 소낙눈', '🌨️'], 86: ['소낙눈', '❄️'],
  95: ['뇌우', '⛈️'], 96: ['우박 동반 뇌우', '⛈️'], 99: ['강한 우박 뇌우', '⛈️'],
};
const describe = (code) => WMO[code] || ['정보 없음', '🌡️'];

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

// 숫자를 안전하게 표시 (null/undefined 방어)
const num = (value, unit = '', digits = 0) => (
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : '—'
);

/** 타임아웃이 걸린 fetch. 네트워크가 죽었을 때 무한 대기하지 않도록 합니다. */
async function fetchJson(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`서버 응답 오류 (HTTP ${res.status})`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('요청 시간이 초과되었습니다');
    throw new Error(err.message || '네트워크에 연결할 수 없습니다');
  } finally {
    clearTimeout(timer);
  }
}

function showError(message) {
  $('#wx-now').replaceChildren(
    el('p', { class: 'empty' }, `날씨를 불러오지 못했습니다. ${message}`),
    el('div', { class: 'row', style: 'justify-content:center' },
      el('button', { class: 'btn btn-sm', onclick: () => loadWeather(load(PLACE_KEY, DEFAULT_PLACE)) }, '다시 시도')),
  );
  $('#wx-week').replaceChildren(el('li', { class: 'empty' }, '—'));
}

function renderCurrent(place, data) {
  const cur = data?.current || {};
  const [desc, icon] = describe(cur.weather_code);
  $('#wx-place').textContent = place.admin1 && place.admin1 !== place.name
    ? `${place.name}, ${place.admin1}`
    : `${place.name}${place.country ? `, ${place.country}` : ''}`;

  $('#wx-now').replaceChildren(
    el('div', { class: 'wx-now' },
      el('div', { class: 'wx-icon' }, icon),
      el('div', {},
        el('div', { class: 'wx-temp' }, num(cur.temperature_2m, '°', 1)),
        el('div', { class: 'wx-desc' }, `${desc} · 체감 ${num(cur.apparent_temperature, '°', 1)}`),
      ),
    ),
    el('dl', { class: 'wx-meta' },
      el('div', {}, el('dt', {}, '습도'), el('dd', {}, num(cur.relative_humidity_2m, '%'))),
      el('div', {}, el('dt', {}, '강수'), el('dd', {}, num(cur.precipitation, 'mm', 1))),
      el('div', {}, el('dt', {}, '바람'), el('dd', {}, num(cur.wind_speed_10m, ' km/h', 1))),
      el('div', {}, el('dt', {}, '기준 시각'), el('dd', {}, (cur.time || '—').replace('T', ' '))),
    ),
  );
}

function renderWeek(data) {
  const daily = data?.daily;
  const weekEl = $('#wx-week');
  if (!daily || !Array.isArray(daily.time) || !daily.time.length) {
    weekEl.replaceChildren(el('li', { class: 'empty' }, '주간 예보 데이터가 없습니다.'));
    return;
  }

  // 주간 최저/최고를 모아 막대 길이 계산에 사용
  const mins = (daily.temperature_2m_min || []).filter(Number.isFinite);
  const maxs = (daily.temperature_2m_max || []).filter(Number.isFinite);
  const weekMin = mins.length ? Math.min(...mins) : 0;
  const weekMax = maxs.length ? Math.max(...maxs) : 1;
  const span = Math.max(weekMax - weekMin, 1); // 0 division 방지

  weekEl.replaceChildren();
  daily.time.forEach((iso, i) => {
    const date = new Date(`${iso}T00:00:00`);
    const isToday = i === 0;
    const lo = daily.temperature_2m_min?.[i];
    const hi = daily.temperature_2m_max?.[i];
    const [, icon] = describe(daily.weather_code?.[i]);
    const pop = daily.precipitation_probability_max?.[i];

    // 막대의 좌측 여백과 길이를 주간 온도 범위에 맞춰 비율로 계산
    const left = Number.isFinite(lo) ? ((lo - weekMin) / span) * 100 : 0;
    const width = Number.isFinite(lo) && Number.isFinite(hi) ? Math.max(((hi - lo) / span) * 100, 6) : 6;

    weekEl.append(el('li', { class: 'wx-day' },
      el('span', { class: 'wx-day-name', style: isToday ? 'color:var(--accent);font-weight:700' : '' },
        isToday ? '오늘' : `${date.getMonth() + 1}/${date.getDate()} ${WEEKDAY[date.getDay()]}`),
      el('span', { title: describe(daily.weather_code?.[i])[0] }, icon),
      el('span', { style: 'position:relative;height:5px' },
        el('span', { class: 'wx-bar', style: `position:absolute;left:${left}%;width:${width}%` })),
      el('span', { class: 'wx-range' },
        el('span', { class: 'lo' }, num(lo, '°')), ' / ', num(hi, '°'),
        Number.isFinite(pop) && pop > 0 ? el('span', { class: 'lo' }, `  ☂${pop}%`) : null),
    ));
  });
}

async function loadWeather(place) {
  $('#wx-now').replaceChildren(el('p', { class: 'empty' }, el('span', { class: 'spinner' }), ' 불러오는 중…'));
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  });
  try {
    const data = await fetchJson(`${FORECAST_URL}?${params}`);
    renderCurrent(place, data);
    renderWeek(data);
    save(PLACE_KEY, place);
  } catch (err) {
    showError(err.message);
  }
}

async function searchPlace(query) {
  const params = new URLSearchParams({ name: query, count: '1', language: 'ko', format: 'json' });
  const data = await fetchJson(`${GEOCODE_URL}?${params}`);
  const hit = data?.results?.[0];
  if (!hit) throw new Error('해당 지역을 찾지 못했습니다');
  return {
    name: hit.name,
    country: hit.country || '',
    admin1: hit.admin1 || '',
    latitude: hit.latitude,
    longitude: hit.longitude,
  };
}

export function initWeather() {
  const saved = load(PLACE_KEY, DEFAULT_PLACE);
  loadWeather(saved && Number.isFinite(saved.latitude) ? saved : DEFAULT_PLACE);

  $('#wx-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = $('#wx-query').value.trim();
    if (!query) return;
    $('#wx-now').replaceChildren(el('p', { class: 'empty' }, el('span', { class: 'spinner' }), ' 검색 중…'));
    try {
      const place = await searchPlace(query);
      $('#wx-query').value = '';
      await loadWeather(place);
    } catch (err) {
      showError(err.message);
    }
  });

  $('#wx-locate').addEventListener('click', () => {
    if (!navigator.geolocation) { showError('이 브라우저는 위치 기능을 지원하지 않습니다.'); return; }
    $('#wx-now').replaceChildren(el('p', { class: 'empty' }, el('span', { class: 'spinner' }), ' 위치 확인 중…'));
    navigator.geolocation.getCurrentPosition(
      (pos) => loadWeather({
        name: '내 위치', country: '',
        latitude: Number(pos.coords.latitude.toFixed(4)),
        longitude: Number(pos.coords.longitude.toFixed(4)),
      }),
      (err) => showError(
        err.code === 1 ? '위치 권한이 거부되었습니다. 도시 이름으로 검색해 주세요.' : '위치를 확인하지 못했습니다.',
      ),
      { timeout: 10000, maximumAge: 300000 },
    );
  });
}
