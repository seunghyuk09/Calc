/**
 * 시계 · 타이머 · 알람 모듈
 * 주의: 브라우저 탭이 열려 있을 때만 동작합니다. (백그라운드 알람은 네이티브 앱 기능 필요)
 */
import { $, el, pad2, toast } from '../lib/dom.js';
import { load, save, remove } from '../lib/store.js';

const ALARM_KEY = 'time.alarm';
const TIMER_KEY = 'time.lastPreset';

const WORLD = [
  { label: '뉴욕', tz: 'America/New_York' },
  { label: '런던', tz: 'Europe/London' },
  { label: '도쿄', tz: 'Asia/Tokyo' },
  { label: 'LA', tz: 'America/Los_Angeles' },
];

let timerTotal = 25 * 60;     // 설정된 총 시간(초)
let timerRemain = 25 * 60;    // 남은 시간(초)
let timerRunning = false;
let timerEndAt = 0;           // 실행 중일 때의 종료 시각(ms). setInterval 누적 오차를 피하려고 절대시각 기준으로 계산합니다.
let alarmAt = null;           // 'HH:MM'
let alarmFiredKey = '';       // 같은 분에 중복으로 울리지 않도록 하는 키

// --- 알림음: 외부 파일 없이 WebAudio 로 생성 ---
let audioCtx = null;
function beep(times = 3) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    for (let i = 0; i < times; i += 1) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const start = audioCtx.currentTime + i * 0.45;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    }
  } catch {
    // 자동재생 정책 등으로 실패해도 앱은 계속 동작해야 합니다.
  }
}

function notify(title, body) {
  toast(`${title} — ${body}`);
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      // 단일 파일로 배포하면 assets/ 폴더가 없으므로, 아이콘 파일이 있는 경우에만 지정합니다.
      const options = { body };
      if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        options.icon = './assets/icon-192.png';
      }
      new Notification(title, options);
    }
  } catch { /* 무시 */ }
}

// --- 시계 ---
// 세계시계 DOM 은 한 번만 만들고 이후에는 텍스트만 갱신합니다. (매초 DOM 재생성 방지)
let worldNodes = null;

function buildWorldClocks() {
  const list = $('#world-clocks');
  list.replaceChildren();
  worldNodes = WORLD.map(({ label }) => {
    const valueEl = el('span', { style: 'font-family:var(--mono)' }, '—');
    list.append(el('li', { class: 'world-item' },
      el('span', { style: 'color:var(--text-dim)' }, label), valueEl));
    return valueEl;
  });
}

function renderClock() {
  const now = new Date();
  $('#clock-time').textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  $('#clock-date').textContent = now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  if (!worldNodes) buildWorldClocks();
  WORLD.forEach(({ tz }, i) => {
    try {
      worldNodes[i].textContent = new Intl.DateTimeFormat('ko-KR', {
        timeZone: tz, hour: '2-digit', minute: '2-digit', month: 'numeric', day: 'numeric',
      }).format(now);
    } catch { /* 지원하지 않는 타임존은 건너뜁니다 */ }
  });
}

// --- 타이머 ---
function formatTimer(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

function renderTimer() {
  const display = $('#timer-display');
  display.textContent = formatTimer(timerRemain);
  display.classList.toggle('is-done', timerRemain <= 0 && timerTotal > 0);
  $('#timer-start').textContent = timerRunning ? '실행 중' : '시작';
  $('#timer-start').disabled = timerRunning;
}

function readInputSeconds() {
  const min = Math.min(Math.max(parseInt($('#timer-min').value, 10) || 0, 0), 600);
  const sec = Math.min(Math.max(parseInt($('#timer-sec').value, 10) || 0, 0), 59);
  return min * 60 + sec;
}

function startTimer() {
  if (timerRunning) return;
  // 일시정지 상태가 아니면 입력값에서 새로 읽습니다.
  if (timerRemain <= 0 || timerRemain === timerTotal) {
    const seconds = readInputSeconds();
    if (seconds <= 0) { toast('시간을 1초 이상으로 설정해 주세요', 'error'); return; }
    timerTotal = seconds;
    timerRemain = seconds;
    save(TIMER_KEY, seconds);
  }
  timerEndAt = Date.now() + timerRemain * 1000;
  timerRunning = true;
  beep(1); // 오디오 컨텍스트를 사용자 제스처 시점에 깨워 둡니다.
  renderTimer();
}

function pauseTimer() {
  if (!timerRunning) return;
  timerRemain = Math.max(0, (timerEndAt - Date.now()) / 1000);
  timerRunning = false;
  renderTimer();
}

function resetTimer() {
  timerRunning = false;
  timerTotal = readInputSeconds();
  timerRemain = timerTotal;
  renderTimer();
}

/**
 * '오늘' 탭의 타이머 위젯이 읽어 가는 현재 상태입니다.
 * 구독 대신 위젯 쪽에서 1초마다 읽어 갑니다. (탭이 보일 때만 돕니다)
 */
export function getTimerState() {
  return { running: timerRunning, remain: timerRemain, total: timerTotal, alarmAt };
}

function tickTimer() {
  if (!timerRunning) return;
  const remain = (timerEndAt - Date.now()) / 1000;
  if (remain <= 0) {
    timerRemain = 0;
    timerRunning = false;
    renderTimer();
    beep(4);
    notify('⏰ 타이머 종료', `${formatTimer(timerTotal)} 이 끝났습니다`);
    return;
  }
  timerRemain = remain;
  renderTimer();
}

// --- 알람 ---
function renderAlarm() {
  $('#alarm-status').textContent = alarmAt ? `매일 ${alarmAt} 에 알람 (탭이 열려 있을 때만)` : '설정된 알람 없음';
}

function tickAlarm() {
  if (!alarmAt) return;
  const now = new Date();
  const nowKey = `${now.toDateString()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const target = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  if (target === alarmAt && alarmFiredKey !== nowKey) {
    alarmFiredKey = nowKey;
    beep(5);
    notify('⏰ 알람', `설정하신 ${alarmAt} 입니다`);
  }
}

export function initTime() {
  // 저장된 값 복원
  const lastPreset = load(TIMER_KEY, 25 * 60);
  if (Number.isFinite(lastPreset) && lastPreset > 0) {
    timerTotal = lastPreset;
    timerRemain = lastPreset;
    $('#timer-min').value = Math.floor(lastPreset / 60);
    $('#timer-sec').value = lastPreset % 60;
  }
  alarmAt = load(ALARM_KEY, null);
  if (alarmAt) $('#alarm-time').value = alarmAt;

  renderClock();
  renderTimer();
  renderAlarm();

  // 루프는 250ms 주기로 돌립니다.
  // 타이머는 매번 갱신해 "시작을 눌렀는데 최대 1초간 숫자가 안 바뀌는" 지연을 없애고,
  // 시계와 알람은 초가 바뀔 때만 처리해 불필요한 작업을 줄입니다.
  let wasHidden = true;
  let lastSecond = -1;
  setInterval(() => {
    /*
     * 시계 탭을 숨기면 이 패널이 문서에서 빠져 null 이 됩니다.
     * 예전에는 여기서 250ms 마다 던져서 그 아래 tickAlarm() 까지 내려가지 못했고,
     * 탭을 숨긴 사람은 알람이 영영 울리지 않았습니다.
     * 문서에 없으면 '안 보이는 것' 으로 봅니다. 그리기만 건너뛰고 알람은 그대로 돕니다.
     */
    const hidden = $('#panel-time')?.hidden ?? true;
    const second = new Date().getSeconds();
    if (second !== lastSecond) {
      lastSecond = second;
      // 탭이 숨겨져 있으면 시계는 그리지 않되, 다시 보이는 순간에는 즉시 갱신합니다.
      if (!hidden || wasHidden !== hidden) renderClock();
      tickAlarm();
    } else if (wasHidden && !hidden) {
      renderClock();
    }
    wasHidden = hidden;
    tickTimer();
  }, 250);

  $('#timer-start').addEventListener('click', startTimer);
  $('#timer-pause').addEventListener('click', pauseTimer);
  $('#timer-reset').addEventListener('click', resetTimer);

  document.querySelectorAll('[data-min]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('#timer-min').value = btn.dataset.min;
      $('#timer-sec').value = 0;
      resetTimer();
    });
  });

  ['#timer-min', '#timer-sec'].forEach((sel) => {
    $(sel).addEventListener('change', () => { if (!timerRunning) resetTimer(); });
  });

  $('#alarm-set').addEventListener('click', () => {
    const value = $('#alarm-time').value;
    if (!value) { toast('알람 시각을 선택해 주세요', 'error'); return; }
    alarmAt = value;
    alarmFiredKey = '';
    save(ALARM_KEY, alarmAt);
    renderAlarm();
    beep(1);
    toast(`알람을 ${value} 로 설정했습니다`);
  });

  $('#alarm-clear').addEventListener('click', () => {
    alarmAt = null;
    remove(ALARM_KEY);
    renderAlarm();
    toast('알람을 해제했습니다');
  });

  $('#notify-enable').addEventListener('click', async () => {
    if (!('Notification' in window)) { toast('이 브라우저는 알림을 지원하지 않습니다', 'error'); return; }
    try {
      const result = await Notification.requestPermission();
      toast(result === 'granted' ? '알림이 허용되었습니다' : '알림이 차단되어 있습니다. 소리로만 알립니다.',
        result === 'granted' ? 'info' : 'error');
    } catch {
      toast('알림 권한을 요청하지 못했습니다', 'error');
    }
  });
}
