/**
 * intro.js — 처음 켰을 때 한 번 보여 주는 사용 안내
 *
 * 이 앱에는 탭 막대가 없습니다. 좌우로 쓸어 넘기거나 ••• 을 눌러야 다른 화면으로 갑니다.
 * 카드를 꾹 눌러 옮기는 것도, 데이터가 이 기기에만 남는다는 것도 화면만 봐서는 알 수 없습니다.
 * 그 '안 보이는 것' 들만 다섯 장으로 짚어 줍니다.
 *
 * 왜 손가락으로 가리키지 않고 슬라이드인가
 *   이 앱은 탭을 숨기고 순서를 바꿀 수 있고 카드도 옮길 수 있습니다.
 *   특정 요소를 가리키는 안내는 그 요소가 없으면 그대로 깨집니다.
 *   '다시 보기' 로 나중에 열 때는 구성이 또 달라져 있습니다.
 *   슬라이드는 화면 구성과 무관하게 언제 열어도 같습니다.
 *
 * 쓰던 사람에게는 띄우지 않습니다
 *   '첫 접속' 은 기록이 아예 없는 상태입니다. 업데이트를 받았다고 해서
 *   쓰던 사람에게 안내가 튀어나오면 그건 방해입니다. (§shouldShowIntro)
 */
import { $, el } from '../lib/dom.js';
import { t, onLangChange } from '../lib/i18n.js';
import { load, save } from '../lib/store.js';

const KEY = 'ui.intro';

/**
 * 안내 판의 판 번호.
 * 내용을 크게 바꿔 다시 보여 주고 싶으면 이 수를 올립니다.
 * 예전 판을 본 사람은 saved.v 가 작아서 다시 한 번 보게 됩니다.
 */
export const INTRO_VERSION = 1;

/**
 * 보여 줄 장들.
 *
 * 사전 키를 문자열 그대로 적어 둡니다. i18n 검사가 html 과 js 를 통째로 훑어
 * '쓰이지 않는 키' 를 잡는데, 여기 적혀 있으면 쓰이는 것으로 읽힙니다.
 */
export const INTRO_STEPS = Object.freeze([
  { icon: '↔', title: 'intro.move.title', text: 'intro.move.text' },
  { icon: '🗓️', title: 'intro.today.title', text: 'intro.today.text' },
  { icon: '✅', title: 'intro.plan.title', text: 'intro.plan.text' },
  { icon: '⠿', title: 'intro.arrange.title', text: 'intro.arrange.text' },
  { icon: '💾', title: 'intro.data.title', text: 'intro.data.text' },
]);

/**
 * 안내를 띄울 때인가.
 *
 * 브라우저 없이 검사할 수 있도록 순수 함수로 둡니다.
 *
 * @param {boolean} hadData 부팅 전에 이미 이 앱이 저장한 것이 있었는지
 * @param {*} saved 저장된 ui.intro 값 (없으면 null)
 * @returns {boolean}
 */
export function shouldShowIntro(hadData, saved) {
  // 이미 본 판이면 다시 띄우지 않습니다.
  if (saved && Number(saved.v) >= INTRO_VERSION) return false;
  /*
   * 쓰던 사람입니다.
   * 기록이 있다는 건 이미 앱을 써 봤다는 뜻이라 '첫 접속' 이 아닙니다.
   * 업데이트를 받았다고 안내가 튀어나오면 방해가 됩니다.
   */
  if (hadData) return false;
  return true;
}

/** 지금 보고 있는 장. 열려 있지 않으면 -1 입니다. */
let step = -1;
/** 안내를 열기 직전에 초점이 있던 곳. 닫을 때 돌려줍니다. */
let lastTrigger = null;

const isOpen = () => step >= 0;

/** 본 것으로 기록합니다. 화면에 띄우지 않고 기록만 할 때도 씁니다. */
export function markIntroSeen() {
  save(KEY, { v: INTRO_VERSION, at: Date.now() });
}

function paint() {
  const spec = INTRO_STEPS[step];
  if (!spec) return;
  const icon = $('#intro-icon');
  if (icon) icon.textContent = spec.icon;
  const title = $('#intro-title');
  if (title) title.textContent = t(spec.title);
  const text = $('#intro-text');
  if (text) text.textContent = t(spec.text);

  // 몇 번째 장인지. 점은 보여 주기만 하고 누르는 곳은 아닙니다.
  const dots = $('#intro-dots');
  if (dots) {
    dots.replaceChildren(...INTRO_STEPS.map((_, i) => el('span', {
      class: `intro-dot${i === step ? ' is-on' : ''}`,
    })));
    dots.setAttribute('aria-label', t('intro.progress', step + 1, INTRO_STEPS.length));
  }

  const prev = $('#intro-prev');
  // 첫 장에서는 '이전' 이 할 일이 없습니다. 눌러도 아무 일 없는 버튼은 혼란만 줍니다.
  if (prev) prev.hidden = step === 0;
  const next = $('#intro-next');
  const last = step === INTRO_STEPS.length - 1;
  if (next) next.textContent = t(last ? 'intro.start' : 'intro.next');
  const skip = $('#intro-skip');
  // 마지막 장에서는 건너뛸 것이 없습니다.
  if (skip) skip.hidden = last;
}

/** 안내를 엽니다. 설정 탭의 '사용법 다시 보기' 도 이 함수를 부릅니다. */
export function openIntro() {
  const panel = $('#intro');
  const scrim = $('#intro-scrim');
  if (!panel || !scrim) return false;
  lastTrigger = document.activeElement;
  step = 0;
  panel.hidden = false;
  scrim.hidden = false;
  document.body.dataset.intro = 'open';
  paint();
  /*
   * 초점은 카드가 받습니다.
   * 버튼에 주면 열자마자 두꺼운 초점 링이 걸려 그리다 만 것처럼 보입니다.
   * 카드가 받아도 화면 읽기 프로그램은 제목부터 읽고, Tab 한 번이면 버튼입니다.
   */
  ($('#intro-card') || panel).focus?.();
  return true;
}

/**
 * 안내를 닫습니다.
 * 끝까지 봤든 건너뛰었든 '봤다' 로 기록합니다. 다시 보고 싶으면 설정 탭에서 엽니다.
 */
export function closeIntro() {
  const panel = $('#intro');
  const scrim = $('#intro-scrim');
  if (!isOpen()) return;
  step = -1;
  if (panel) panel.hidden = true;
  if (scrim) scrim.hidden = true;
  delete document.body.dataset.intro;
  markIntroSeen();
  const back = lastTrigger && document.contains(lastTrigger) ? lastTrigger : null;
  back?.focus();
  lastTrigger = null;
}

/** 다음 장으로. 마지막 장에서 누르면 닫힙니다. */
function next() {
  if (!isOpen()) return;
  if (step >= INTRO_STEPS.length - 1) { closeIntro(); return; }
  step += 1;
  paint();
}

function prev() {
  if (!isOpen() || step <= 0) return;
  step -= 1;
  paint();
}

/** 지금 몇 번째 장인지. 테스트와 다른 모듈이 상태를 볼 때 씁니다. */
export function introStep() {
  return step;
}

/**
 * @param {{firstRun: boolean}} opts firstRun 은 main.js 가 부팅 전에 재어 둔 값입니다.
 *   부팅이 시작되면 모듈들이 저장을 시작해서, 그 뒤에 재면 언제나 '쓰던 사람' 이 됩니다.
 */
export function initIntro({ firstRun } = {}) {
  const panel = $('#intro');
  if (!panel) return;

  $('#intro-next')?.addEventListener('click', next);
  $('#intro-prev')?.addEventListener('click', prev);
  $('#intro-skip')?.addEventListener('click', closeIntro);
  // 바깥을 누르면 닫습니다. 갇힌 느낌이 들지 않게 나갈 길을 늘 열어 둡니다.
  $('#intro-scrim')?.addEventListener('click', closeIntro);
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.key === 'Escape') { e.preventDefault(); closeIntro(); return; }
    // 좌우 키로도 넘깁니다. 슬라이드니까 그게 자연스럽습니다.
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  });
  // 언어를 바꾸면 열려 있는 장도 따라가야 합니다.
  onLangChange(() => { if (isOpen()) paint(); });

  const saved = load(KEY, null);
  // firstRun 은 '기록이 하나도 없었다' 는 뜻입니다. 그 반대가 '쓰던 사람' 입니다.
  const hadData = !firstRun;
  if (!shouldShowIntro(hadData, saved)) {
    /*
     * 안 띄우는 경우에도 기록은 남깁니다.
     * 그래야 나중에 키를 하나 지웠다고 해서 안내가 불쑥 뜨지 않습니다.
     */
    if (!saved || Number(saved.v) < INTRO_VERSION) markIntroSeen();
    return;
  }
  openIntro();
}
