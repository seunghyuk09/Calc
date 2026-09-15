import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 가 window 를 참조하므로 import 전에 동작하는 가짜 저장소를 만들어 둡니다.
const bag = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (bag.has(k) ? bag.get(k) : null),
    setItem: (k, v) => bag.set(k, String(v)),
    removeItem: (k) => bag.delete(k),
  },
  location: { protocol: 'http:' },
};

const prefs = await import('../public/js/lib/prefs.js');
const {
  ALL_TABS, ALL_WIDGETS, LOCKED_TABS,
  getPrefs, setPrefs, setCardPref, resetPrefs, visibleTabs, cardPref, moveItem,
  orderedCards, setCardOrder,
} = prefs;

// store.js 는 모든 키에 접두사를 붙입니다. 가짜 저장소에 직접 심을 때도 맞춰야 합니다.
const PREFS_KEY = 'daily-kit:ui.prefs';
const seed = (value) => bag.set(PREFS_KEY, JSON.stringify(value));
const wipe = () => bag.clear();

test('기본값: 저장된 게 없으면 전체 탭이 기본 순서로', () => {
  wipe();
  const p = getPrefs();
  assert.equal(p.skin, 'default');
  assert.equal(p.accent, 'blue');
  assert.deepEqual(p.tabOrder, ALL_TABS);
  assert.deepEqual(p.widgets, ['weather', 'todo']);
  assert.deepEqual(visibleTabs(p), ALL_TABS);
});

test('저장과 복원: 스킨과 강조색이 그대로 돌아온다', () => {
  wipe();
  setPrefs({ skin: 'future', accent: 'violet' });
  const p = getPrefs();
  assert.equal(p.skin, 'future');
  assert.equal(p.accent, 'violet');
});

test('모르는 값은 기본값으로 떨어진다', () => {
  wipe();
  seed({ skin: '해킹된값', accent: 42 });
  const p = getPrefs();
  assert.equal(p.skin, 'default');
  assert.equal(p.accent, 'blue');
});

test('탭 순서: 저장된 순서를 지키되 빠진 탭은 뒤에 붙는다', () => {
  wipe();
  // 예전 버전에 'quote' 가 없었다고 가정합니다. 앱이 업데이트돼도 사라지면 안 됩니다.
  seed({ tabOrder: ['settings', 'calc'] });
  const p = getPrefs();
  assert.deepEqual(p.tabOrder.slice(0, 2), ['settings', 'calc']);
  assert.equal(p.tabOrder.length, ALL_TABS.length);
  ALL_TABS.forEach((name) => assert.ok(p.tabOrder.includes(name), `${name} 이 빠졌습니다`));
});

test('탭 순서: 중복과 모르는 이름을 걸러낸다', () => {
  wipe();
  seed({ tabOrder: ['calc', 'calc', 'nope', null, 'weather'] });
  const p = getPrefs();
  assert.deepEqual(p.tabOrder.slice(0, 2), ['calc', 'weather']);
  assert.equal(new Set(p.tabOrder).size, p.tabOrder.length, '중복이 남아 있습니다');
});

test('숨김: 잠긴 탭은 숨길 수 없다', () => {
  wipe();
  seed({ tabHidden: LOCKED_TABS.concat('quote') });
  const p = getPrefs();
  assert.deepEqual(p.tabHidden, ['quote']);
  LOCKED_TABS.forEach((name) => assert.ok(visibleTabs(p).includes(name), `${name} 이 사라졌습니다`));
});

test('숨김: 모두 숨겨지는 상황이 와도 빈 화면이 되지 않는다', () => {
  wipe();
  // 정규화를 뚫고 들어온 것처럼 직접 만든 상태입니다.
  const broken = { ...getPrefs(), tabHidden: ALL_TABS.slice() };
  assert.ok(visibleTabs(broken).length > 0, '표시할 탭이 하나도 없습니다');
});

test('위젯: 빈 목록도 허용된다 (전부 끄기)', () => {
  wipe();
  setPrefs({ widgets: [] });
  assert.deepEqual(getPrefs().widgets, []);
});

test('위젯: 모르는 이름과 중복을 걸러낸다', () => {
  wipe();
  seed({ widgets: ['clock', 'clock', '없는위젯', 'weather'] });
  assert.deepEqual(getPrefs().widgets, ['clock', 'weather']);
});

test('위젯: 배열이 아니면 기본값으로', () => {
  wipe();
  seed({ widgets: '망가짐' });
  assert.deepEqual(getPrefs().widgets, ['weather', 'todo']);
});

test('카드: 크기와 폭이 저장되고 이상한 값은 정상값으로 떨어진다', () => {
  wipe();
  setCardPref('calc.pad', { size: 'large' });
  assert.deepEqual(cardPref('calc.pad'), { size: 'large', span: 'auto' });

  seed({ cards: { 'calc.hist': { size: 'HUGE', span: 'diagonal' } } });
  assert.deepEqual(cardPref('calc.hist'), { size: 'normal', span: 'auto' });
});

test('카드: 저장된 게 없으면 그 카드의 기본값을 쓴다', () => {
  wipe();
  // 커스터마이즈 카드는 항목이 많아 기본이 가로 전체입니다.
  assert.equal(cardPref('settings.customize').span, 'full');
  assert.equal(cardPref('아무카드').span, 'auto');
});

test('카드: 기본값으로 되돌린 선택도 저장된다', () => {
  wipe();
  setCardPref('settings.customize', { span: 'auto' });
  assert.equal(cardPref('settings.customize').span, 'auto',
    '기본값과 같다고 버리면 사용자가 좁게 바꾼 선택이 사라집니다');
});

test('초기화: 전부 기본값으로 돌아온다', () => {
  wipe();
  setPrefs({ skin: 'retro', accent: 'pink', tabHidden: ['quote'], widgets: ['calc'] });
  setCardPref('calc.pad', { size: 'compact' });
  resetPrefs();
  const p = getPrefs();
  assert.equal(p.skin, 'default');
  assert.equal(p.accent, 'blue');
  assert.deepEqual(p.tabHidden, []);
  assert.deepEqual(p.widgets, ['weather', 'todo']);
  assert.deepEqual(p.cards, {});
});

test('저장 자체가 망가져 있어도 던지지 않는다', () => {
  wipe();
  bag.set(PREFS_KEY, '{이건 JSON 이 아닙니다');
  assert.doesNotThrow(() => getPrefs());
  assert.equal(getPrefs().skin, 'default');
});

test('moveItem: 위아래로 한 칸씩 옮긴다', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 'c', -1), ['a', 'c', 'b']);
  assert.deepEqual(moveItem(['a', 'b', 'c'], 'a', 1), ['b', 'a', 'c']);
});

test('moveItem: 양 끝에서 더 밀어도 그대로', () => {
  assert.deepEqual(moveItem(['a', 'b'], 'a', -1), ['a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], 'b', 1), ['a', 'b']);
  assert.deepEqual(moveItem(['a', 'b'], '없음', 1), ['a', 'b']);
});

test('모든 위젯 이름이 정규화를 통과한다 (목록과 검사 로직이 어긋나지 않게)', () => {
  wipe();
  setPrefs({ widgets: ALL_WIDGETS.slice() });
  assert.deepEqual(getPrefs().widgets, ALL_WIDGETS);
});


/* =========================================================
   카드 순서 (화면 편집에서 끌어 옮긴 결과)

   저장된 순서가 진실이되, 저장에 없는 카드는 버리면 안 됩니다.
   버리면 새 카드를 추가했을 때 기존 사용자 화면에서 조용히 사라집니다.
   ========================================================= */

test('카드 순서: 저장된 게 없으면 화면에 있던 순서 그대로', () => {
  wipe();
  assert.deepEqual(orderedCards('calc', ['calc.pad', 'calc.hist']), ['calc.pad', 'calc.hist']);
});

test('카드 순서: 저장하고 되읽기', () => {
  wipe();
  setCardOrder('calc', ['calc.hist', 'calc.pad']);
  assert.deepEqual(getPrefs().cardOrder.calc, ['calc.hist', 'calc.pad']);
  assert.deepEqual(orderedCards('calc', ['calc.pad', 'calc.hist']), ['calc.hist', 'calc.pad']);
});

test('카드 순서: 저장에 없는 카드는 뒤에 붙는다 (새 카드가 사라지면 안 됩니다)', () => {
  wipe();
  setCardOrder('calc', ['calc.hist', 'calc.pad']);
  assert.deepEqual(
    orderedCards('calc', ['calc.pad', 'calc.hist', 'calc.new']),
    ['calc.hist', 'calc.pad', 'calc.new'],
  );
});

test('카드 순서: 화면에서 없어진 카드는 조용히 빠진다', () => {
  wipe();
  setCardOrder('calc', ['calc.hist', 'calc.gone', 'calc.pad']);
  assert.deepEqual(orderedCards('calc', ['calc.pad', 'calc.hist']), ['calc.hist', 'calc.pad']);
});

test('카드 순서: 다른 탭의 카드가 섞여 들어오면 버린다', () => {
  wipe();
  // 'calc' 목록에 'memo.note' 가 들어가면 그 탭 배치가 엉킵니다.
  seed({ cardOrder: { calc: ['calc.hist', 'memo.note', 'calc.pad'] } });
  assert.deepEqual(getPrefs().cardOrder.calc, ['calc.hist', 'calc.pad']);
});

test('카드 순서: 모르는 탭과 이상한 값은 버린다', () => {
  wipe();
  seed({
    cardOrder: {
      calc: ['calc.pad'],
      없는탭: ['없는탭.a'],
      memo: '배열이 아님',
      quote: [],
      time: [null, 42, 'time.clock', 'time.clock'],
    },
  });
  const got = getPrefs().cardOrder;
  assert.deepEqual(Object.keys(got).sort(), ['calc', 'time']);
  assert.deepEqual(got.time, ['time.clock'], '중복과 쓰레기가 남았습니다');
});

test('카드 순서: 저장값이 통째로 망가져도 던지지 않는다', () => {
  wipe();
  seed({ cardOrder: '문자열' });
  assert.doesNotThrow(() => getPrefs());
  assert.deepEqual(getPrefs().cardOrder, {});
  seed({ cardOrder: ['배열'] });
  assert.deepEqual(getPrefs().cardOrder, {});
});

test('카드 순서: 다른 설정을 바꿔도 살아남는다', () => {
  wipe();
  setCardOrder('calc', ['calc.hist', 'calc.pad']);
  setCardPref('calc.pad', { size: 'large' });
  setPrefs({ accent: 'green' });
  assert.deepEqual(getPrefs().cardOrder.calc, ['calc.hist', 'calc.pad'],
    '다른 설정을 저장하면서 카드 순서가 날아갔습니다');
  assert.equal(cardPref('calc.pad').size, 'large');
});

test('카드 순서: 초기화하면 기본으로 돌아온다', () => {
  wipe();
  setCardOrder('calc', ['calc.hist', 'calc.pad']);
  resetPrefs();
  assert.deepEqual(getPrefs().cardOrder, {});
  assert.deepEqual(orderedCards('calc', ['calc.pad', 'calc.hist']), ['calc.pad', 'calc.hist']);
});
