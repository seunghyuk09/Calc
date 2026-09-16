/**
 * i18n.js
 * TO DO(계획표) 기능의 표시 언어를 한국어/영어 중에서 고를 수 있게 합니다.
 *
 * 범위: TO DO(계획표) 탭과 '오늘' 탭, 그리고 날씨 설명(WMO)까지 다룹니다.
 * 나머지 화면은 한국어 고정이며, 필요하면 같은 구조로 사전만 늘리면 됩니다.
 */
import { load, save } from './store.js';

const LANG_KEY = 'ui.lang';
export const LANGS = ['ko', 'en'];
const DEFAULT_LANG = 'ko';

// 값이 함수인 항목은 인자를 받아 문장을 만듭니다. (복수형 처리 등)
const DICT = {
  ko: {
    'today.weather.title': '현재 날씨',
    'today.weather.loading': '날씨를 불러오는 중…',
    'today.weather.error': '날씨를 불러오지 못했습니다',
    'today.weather.hint': '눌러서 주간 예보 보기',
    'today.todo.title': '오늘 할 일',
    'today.todo.remaining': (n) => `${n}개 남음`,
    'today.todo.empty': '등록된 할 일이 없습니다. 눌러서 계획표를 여세요.',
    'today.todo.allDone': '오늘 할 일을 모두 마쳤습니다 🎉',
    'today.todo.hint': '눌러서 계획표로 이동',
    'today.rotate.pause': '순환 멈춤',
    'today.rotate.play': '순환 시작',
    'today.aria.rotation': '미완료 할 일 순환',
    'today.aria.position': (i, n) => `${n}개 중 ${i}번째`,
    'today.todo.check': (text) => `${text} 완료로 표시`,
    'today.todo.edit': (text) => `${text} 고치기`,
    'today.todo.editHint': '고치고 Enter, 취소는 Esc',
    'today.todo.open': (text) => `${text} — 계획표에서 보기`,
    // ---- 탭 이름 (커스터마이즈 목록에서 씁니다) ----
    'tab.today': '오늘', 'tab.calc': '계산기', 'tab.weather': '날씨', 'tab.todo': 'TO DO',
    'tab.time': '시계·타이머', 'tab.memo': '메모·낙서', 'tab.quote': '글귀',
    'tab.ai': 'AI 검색', 'tab.settings': '설정',
    // ---- '오늘' 위젯 ----
    'today.clock.title': '지금 시각',
    'today.timer.title': '타이머',
    'today.timer.idle': '실행 중인 타이머가 없습니다',
    'today.timer.running': '진행 중',
    'today.quote.title': '오늘의 글귀',
    'today.quote.empty': '등록된 글귀가 없습니다',
    'today.memo.title': '최근 메모',
    'today.memo.empty': '저장된 메모가 없습니다',
    'today.memo.more': (n) => `외 ${n}건`,
    'today.calc.title': '최근 계산',
    'today.calc.empty': '계산 기록이 없습니다',
    'today.widget.hint': '눌러서 해당 탭으로 이동',
    'today.empty': '표시할 위젯이 없습니다. 설정 탭에서 골라 주세요.',
    // ---- 커스터마이즈 ----
    'cz.title': '화면 커스터마이즈',
    'cz.skin.title': '테마 스타일',
    'cz.skin.hint': '라이트/다크와 별개로 분위기를 고릅니다. 두 모드 모두 지원합니다.',
    'cz.skin.default': '기본', 'cz.skin.refined': '세련', 'cz.skin.cute': '귀여움',
    'cz.skin.future': '미래', 'cz.skin.retro': '레트로', 'cz.skin.nature': '자연',
    'cz.base.title': '바탕색',
    'cz.base.hint': '배경과 카드 색 계열만 바꿉니다. 모서리·그림자 같은 모양은 테마 스타일이 그대로 담당합니다.',
    'cz.base.default': '스타일 기본', 'cz.base.gray': '회색', 'cz.base.warm': '크림',
    'cz.base.cool': '블루그레이', 'cz.base.mono': '고대비', 'cz.base.rose': '연분홍',
    'cz.base.mint': '연민트',
    'cz.accent.title': '강조색',
    'cz.accent.hint': '버튼과 선택 표시에 쓰이는 색입니다.',
    'cz.accent.blue': '파랑', 'cz.accent.violet': '보라', 'cz.accent.teal': '청록',
    'cz.accent.green': '초록', 'cz.accent.amber': '호박', 'cz.accent.rose': '로즈',
    'cz.accent.slate': '슬레이트', 'cz.accent.pink': '핑크',
    'cz.accent.pastelrose': '파스텔 로즈', 'cz.accent.pastelsky': '파스텔 스카이',
    'cz.accent.pastelmint': '파스텔 민트', 'cz.accent.pastellilac': '파스텔 라일락',
    'cz.accent.pastelpeach': '파스텔 피치',
    'cz.tabs.title': '탭 순서와 표시',
    'cz.tabs.hint': '위아래로 옮겨 순서를 바꾸고, 안 쓰는 탭은 숨길 수 있습니다.',
    'cz.widgets.title': "'오늘' 탭 위젯",
    'cz.widgets.hint': '첫 화면에 올릴 요약 카드와 순서를 고릅니다.',
    'cz.widget.weather': '현재 날씨', 'cz.widget.todo': '오늘 할 일',
    'cz.widget.clock': '시계', 'cz.widget.timer': '타이머',
    'cz.widget.quote': '오늘의 글귀', 'cz.widget.memo': '최근 메모',
    'cz.widget.calc': '최근 계산',
    'cz.cards.title': '카드 크기',
    'cz.cards.hint': '여백, 목록 스크롤 높이, 큰 숫자 표시 크기가 함께 바뀝니다. 폭은 화면이 넓을 때만 적용됩니다.',
    'cz.cards.none': '조절할 수 있는 카드가 없습니다.',
    'cz.card.calc.pad': '계산기 자판', 'cz.card.calc.hist': '계산 기록',
    'cz.card.weather.now': '현재 날씨', 'cz.card.weather.week': '주간 예보',
    'cz.card.todo.plan': '계획표',
    // ---- 화면 편집 (카드를 끌어 옮기기) ----
    'upd.where.app': '앱',
    'upd.where.web': '웹',
    'upd.where.file': '파일',
    'todo.view.list': '목록',
    'todo.view.hours': '시간대',
    'todo.aria.dayView': '하루 보기 방식',
    'todo.hours.allDay': '종일',
    'todo.hours.addAt': (time) => `${time} 에 추가`,
    'todo.hours.empty': '이 시간은 비어 있습니다',
    'todo.hours.showAll': '이른 시간 · 늦은 시간도 보기',
    'todo.hours.showLess': '낮 시간만 보기',
    'todo.hours.now': '지금',
    'arr.open': '화면 편집',
    'arr.done': '완료',
    'arr.hint': '카드를 끌어 옮기고, 크기를 고르세요.',
    'arr.hintTouch': '카드를 꾹 눌러도 켜집니다.',
    'arr.held': '편집을 켰습니다. 손을 떼지 말고 그대로 끌어 옮기세요.',
    'arr.grab': (name) => `${name} 옮기기`,
    'arr.moved': (name, i, n) => `${n}개 중 ${i}번째로 옮겼습니다 — ${name}`,
    'arr.none': '이 화면에는 옮길 카드가 없습니다.',
    'arr.size.compact': '작게', 'arr.size.normal': '보통', 'arr.size.large': '크게',
    'arr.span.auto': '반폭', 'arr.span.full': '전체폭',
    'arr.aria.size': '카드 크기', 'arr.aria.span': '카드 폭',
    // ---- 활동 분류 ----
    'cat.work': '업무', 'cat.personal': '개인', 'cat.study': '학습',
    'cat.health': '운동·건강', 'cat.meet': '약속', 'cat.money': '금전', 'cat.etc': '기타',
    'todo.aria.category': '활동 분류',
    'todo.aria.more': '더보기',
    'todo.week.goals': '이번 주 목표',
    // ---- 시각 ----
    'todo.time.label': '시각 (비우면 종일)',
    'todo.time.allDay': '종일',
    'todo.time.clear': '시각 지우기',
    'todo.time.set': (text) => `${text} 시각 정하기`,
    // ---- 분류 편집 ----
    'cat.edit': '분류 편집',
    'cat.hint': '이모지는 달력 칸에 그대로 나타납니다. 기본 분류는 지우는 대신 숨길 수 있습니다.',
    'cat.newPlaceholder': '새 분류 이름',
    'cat.add': '추가',
    'cat.needName': '이름과 이모지를 모두 정해 주세요',
    'cat.lockedHint': '이 분류는 숨길 수 없습니다',
    'cat.changeEmoji': (name) => `${name} 이모지 바꾸기`,
    'cat.remove': (name) => `${name} 분류 삭제`,
    // ---- 달력 ----
    'cal.title': '달력',
    'cal.today': '이번 달',
    'cal.prev': '이전 달',
    'cal.next': '다음 달',
    'cal.fold': '달력 접기 (한 주만 보기)',
    'cal.prevWeek': '이전 주',
    'cal.nextWeek': '다음 주',
    'cal.thisWeek': '이번 주',
    'cal.unfold': '달력 펼치기 (한 달 보기)',
    'cal.empty': '이 날은 등록된 일이 없습니다.',
    'cal.count': (n) => `${n}건`,
    'cal.undone': (n) => `미완료 ${n}건`,
    'cal.goHint': '눌러서 계획표에서 보기',
    'cal.aria.grid': '월 달력',
    'cal.wd.sun': '일', 'cal.wd.mon': '월', 'cal.wd.tue': '화', 'cal.wd.wed': '수',
    'cal.wd.thu': '목', 'cal.wd.fri': '금', 'cal.wd.sat': '토',
    // ---- 년·월 고르기 ----
    'cal.pick.open': '년·월 고르기',
    'cal.pick.close': '닫기',
    'cal.pick.month': (y) => `${y}년 · 달 고르기`,
    'cal.pick.year': '연도 고르기',
    'cal.pick.prevYear': '이전 해', 'cal.pick.nextYear': '다음 해',
    'cal.pick.prevYears': '이전 12년', 'cal.pick.nextYears': '다음 12년',
    'cal.pick.toYears': '연도 목록 열기',
    'cal.pick.monthName': (m) => `${m}월`,
    // ---- 보기 전환: 달력 격자 / 일정 목록 ----
    'cal.view.grid': '달력',
    'cal.view.agenda': '일정',
    'cal.view.label': '보기 방식',
    'cal.agenda.empty': '앞으로 두 달 안에 등록된 일이 없습니다.',
    'cal.agenda.today': '오늘',
    'cal.agenda.allDay': '종일',
    'cal.agenda.range': (n) => `앞으로 ${n}일`,
    'cz.card.todo.cal': '달력',
    'cz.card.time.clock': '시계', 'cz.card.time.timer': '타이머·알람',
    'cz.card.memo.draw': '낙서판', 'cz.card.memo.note': '간단 메모',
    'cz.card.quote.today': '오늘의 글귀', 'cz.card.quote.mine': '내 글귀',
    'cz.card.ai.chat': 'AI 검색',
    'cz.card.settings.display': '표시 설정', 'cz.card.settings.ai': 'AI 연동',
    'cz.card.settings.customize': '화면 커스터마이즈',
    // ---- 앱 업데이트 ----
    'upd.title': '앱 업데이트',
    'upd.current': '현재 버전',
    'upd.check': '업데이트 확인',
    'upd.apply': '지금 적용',
    'upd.download': '새 버전 내려받기',
    'upd.idle': '버튼을 눌러 새 버전이 있는지 확인합니다.',
    'upd.checking': '확인 중…',
    'upd.latest': '최신 버전입니다.',
    'upd.readyWeb': '새 버전이 준비됐습니다. 적용하면 화면을 다시 불러옵니다.',
    'upd.readyNative': '새 버전이 있습니다.',
    'upd.ready': '새 버전이 준비됐습니다',
    'upd.error': '확인하지 못했습니다.',
    'upd.none': '이 환경에서는 업데이트를 확인할 수 없습니다.',
    'upd.unsupported': '단일 파일로 열었거나 서비스 워커를 쓸 수 없는 환경입니다.',
    'upd.devBuild': '개발 빌드라 비교할 기준이 없습니다.',
    'upd.noRegistration': '서비스 워커가 등록돼 있지 않습니다.',
    'upd.rateLimited': 'GitHub 요청 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.',
    'upd.offline': '네트워크에 연결할 수 없습니다.',
    'upd.badResponse': '릴리스 정보를 읽지 못했습니다.',
    'upd.failed': '알 수 없는 오류입니다.',
    'upd.httpError': (code) => `서버 응답 ${code}`,
    'upd.version': (v) => `버전 ${v}`,
    'upd.newBuild': (v) => `새 버전 ${v}`,
    'upd.nativeNote': '앱은 자동으로 설치되지 않습니다. 내려받은 뒤 안드로이드 설치 화면에서 직접 설치해 주세요. (사이드로드 앱은 시스템이 확인을 요구합니다)',
    'cz.card.settings.update': '앱 업데이트',
    'cz.size.compact': '작게', 'cz.size.normal': '보통', 'cz.size.large': '크게',
    'cz.span.auto': '기본 폭', 'cz.span.full': '가로 전체',
    'cz.shown': '표시', 'cz.hidden': '숨김',
    'cz.lockedHint': '이 탭은 숨길 수 없습니다',
    'cz.moveUp': (label) => `${label} 위로`,
    'cz.moveDown': (label) => `${label} 아래로`,
    'cz.nowCount': (on, total) => `${on}/${total} 표시`,
    'cz.nowCards': (n) => `${n}개`,
    'cz.reset': '커스터마이즈 초기화',
    'cz.resetConfirm': '테마, 탭 순서, 위젯, 카드 크기를 모두 기본값으로 되돌립니다. 계속할까요?',
    'todo.title': '계획표',
    'todo.scope.day': '일간',
    'todo.scope.week': '주간',
    'todo.scope.month': '월간',
    'todo.scope.year': '연간',
    'todo.nav.prev': '이전 기간',
    'todo.nav.next': '다음 기간',
    'todo.nav.today': '오늘',
    'todo.input.placeholder': '계획을 입력하고 Enter',
    'todo.btn.add': '추가',
    'todo.filter.all': '전체',
    'todo.filter.active': '진행 중',
    'todo.filter.done': '완료',
    'todo.btn.carry': '이월',
    'todo.btn.carryHint': '직전 기간의 미완료 항목을 이 기간으로 가져옵니다',
    'todo.btn.clearDone': '완료 삭제',
    'todo.empty.none': '이 기간에 등록된 계획이 없습니다.',
    'todo.empty.filter': '해당하는 항목이 없습니다.',
    'todo.aria.done': '완료 표시',
    'todo.aria.delete': '삭제',
    'todo.aria.scopeTabs': '계획 단위',
    'todo.count.total': (n) => `누적 ${n}건`,
    'todo.toast.nothingToCarry': '직전 기간에 이월할 항목이 없습니다',
    'todo.toast.carried': (n) => `미완료 ${n}건을 이 기간으로 옮겼습니다`,
    'todo.toast.nothingToClear': '이 기간에 완료된 항목이 없습니다',
    'todo.toast.cleared': (n) => `완료 항목 ${n}건을 삭제했습니다`,
  },
  en: {
    'today.weather.title': 'Current weather',
    'today.weather.loading': 'Loading weather…',
    'today.weather.error': "Couldn't load the weather",
    'today.weather.hint': 'Tap for the weekly forecast',
    'today.todo.title': "Today's tasks",
    'today.todo.remaining': (n) => `${n} left`,
    'today.todo.empty': 'Nothing here yet. Tap to open the planner.',
    'today.todo.allDone': 'All done for today 🎉',
    'today.todo.hint': 'Tap to open the planner',
    'today.rotate.pause': 'Pause rotation',
    'today.rotate.play': 'Start rotation',
    'today.aria.rotation': 'Unfinished task carousel',
    'today.aria.position': (i, n) => `Item ${i} of ${n}`,
    'today.todo.check': (text) => `Mark ${text} done`,
    'today.todo.edit': (text) => `Edit ${text}`,
    'today.todo.editHint': 'Enter to save, Esc to cancel',
    'today.todo.open': (text) => `${text} — open in the planner`,
    // ---- Tab names ----
    'tab.today': 'Today', 'tab.calc': 'Calculator', 'tab.weather': 'Weather', 'tab.todo': 'TO DO',
    'tab.time': 'Clock & timer', 'tab.memo': 'Notes', 'tab.quote': 'Quotes',
    'tab.ai': 'AI search', 'tab.settings': 'Settings',
    // ---- Today widgets ----
    'today.clock.title': 'Time now',
    'today.timer.title': 'Timer',
    'today.timer.idle': 'No timer running',
    'today.timer.running': 'Running',
    'today.quote.title': 'Quote of the day',
    'today.quote.empty': 'No quotes saved yet',
    'today.memo.title': 'Latest note',
    'today.memo.empty': 'No notes saved yet',
    'today.memo.more': (n) => `+${n} more`,
    'today.calc.title': 'Recent calculation',
    'today.calc.empty': 'No calculations yet',
    'today.widget.hint': 'Tap to open that tab',
    'today.empty': 'No widgets selected. Pick some in Settings.',
    // ---- Customize ----
    'cz.title': 'Customize',
    'cz.skin.title': 'Theme style',
    'cz.skin.hint': 'Sets the mood, separate from light/dark. Both modes are supported.',
    'cz.skin.default': 'Default', 'cz.skin.refined': 'Refined', 'cz.skin.cute': 'Cute',
    'cz.skin.future': 'Future', 'cz.skin.retro': 'Retro', 'cz.skin.nature': 'Nature',
    'cz.base.title': 'Base color',
    'cz.base.hint': 'Changes the background and card colors only. Corners and shadows stay with the theme style.',
    'cz.base.default': 'Style default', 'cz.base.gray': 'Gray', 'cz.base.warm': 'Cream',
    'cz.base.cool': 'Blue gray', 'cz.base.mono': 'High contrast', 'cz.base.rose': 'Blush',
    'cz.base.mint': 'Mint',
    'cz.accent.title': 'Accent color',
    'cz.accent.hint': 'Used for buttons and selection highlights.',
    'cz.accent.blue': 'Blue', 'cz.accent.violet': 'Violet', 'cz.accent.teal': 'Teal',
    'cz.accent.green': 'Green', 'cz.accent.amber': 'Amber', 'cz.accent.rose': 'Rose',
    'cz.accent.slate': 'Slate', 'cz.accent.pink': 'Pink',
    'cz.accent.pastelrose': 'Pastel rose', 'cz.accent.pastelsky': 'Pastel sky',
    'cz.accent.pastelmint': 'Pastel mint', 'cz.accent.pastellilac': 'Pastel lilac',
    'cz.accent.pastelpeach': 'Pastel peach',
    'cz.tabs.title': 'Tab order and visibility',
    'cz.tabs.hint': 'Move tabs up or down, and hide the ones you never use.',
    'cz.widgets.title': 'Today widgets',
    'cz.widgets.hint': 'Choose which summary cards appear first, and in what order.',
    'cz.widget.weather': 'Current weather', 'cz.widget.todo': "Today's tasks",
    'cz.widget.clock': 'Clock', 'cz.widget.timer': 'Timer',
    'cz.widget.quote': 'Quote of the day', 'cz.widget.memo': 'Latest note',
    'cz.widget.calc': 'Recent calculation',
    'cz.cards.title': 'Card size',
    'cz.cards.hint': 'Changes padding, list scroll height and the large number display. Width only applies on wide screens.',
    'cz.cards.none': 'No adjustable cards.',
    'cz.card.calc.pad': 'Keypad', 'cz.card.calc.hist': 'History',
    'cz.card.weather.now': 'Current weather', 'cz.card.weather.week': 'Weekly forecast',
    'cz.card.todo.plan': 'Planner',
    // ---- Arrange mode (drag cards around) ----
    'upd.where.app': 'App',
    'upd.where.web': 'Web',
    'upd.where.file': 'File',
    'todo.view.list': 'List',
    'todo.view.hours': 'By hour',
    'todo.aria.dayView': 'Day view mode',
    'todo.hours.allDay': 'All day',
    'todo.hours.addAt': (time) => `Add at ${time}`,
    'todo.hours.empty': 'Nothing at this hour',
    'todo.hours.showAll': 'Show early and late hours',
    'todo.hours.showLess': 'Daytime hours only',
    'todo.hours.now': 'Now',
    'arr.open': 'Arrange screen',
    'arr.done': 'Done',
    'arr.hint': 'Drag cards to reorder, and pick a size.',
    'arr.hintTouch': 'Press and hold a card to start.',
    'arr.held': 'Arrange mode on — keep holding and drag to move.',
    'arr.grab': (name) => `Move ${name}`,
    'arr.moved': (name, i, n) => `Moved ${name} to position ${i} of ${n}`,
    'arr.none': 'Nothing to rearrange on this screen.',
    'arr.size.compact': 'Small', 'arr.size.normal': 'Normal', 'arr.size.large': 'Large',
    'arr.span.auto': 'Half', 'arr.span.full': 'Full',
    'arr.aria.size': 'Card size', 'arr.aria.span': 'Card width',
    // ---- Categories ----
    'cat.work': 'Work', 'cat.personal': 'Personal', 'cat.study': 'Study',
    'cat.health': 'Health', 'cat.meet': 'Meeting', 'cat.money': 'Money', 'cat.etc': 'Other',
    'todo.aria.category': 'Activity category',
    'todo.aria.more': 'More',
    'todo.week.goals': 'Goals for this week',
    // ---- Time of day ----
    'todo.time.label': 'Time (leave empty for all day)',
    'todo.time.allDay': 'All day',
    'todo.time.clear': 'Clear the time',
    'todo.time.set': (text) => `Set a time for ${text}`,
    // ---- Category editing ----
    'cat.edit': 'Edit categories',
    'cat.hint': 'The emoji is what shows up on the calendar. Built-in categories can be hidden instead of deleted.',
    'cat.newPlaceholder': 'New category name',
    'cat.add': 'Add',
    'cat.needName': 'Pick both a name and an emoji',
    'cat.lockedHint': 'This category cannot be hidden',
    'cat.changeEmoji': (name) => `Change the ${name} emoji`,
    'cat.remove': (name) => `Delete the ${name} category`,
    // ---- Calendar ----
    'cal.title': 'Calendar',
    'cal.today': 'This month',
    'cal.prev': 'Previous month',
    'cal.next': 'Next month',
    'cal.fold': 'Collapse to one week',
    'cal.prevWeek': 'Previous week',
    'cal.nextWeek': 'Next week',
    'cal.thisWeek': 'This week',
    'cal.unfold': 'Expand to the full month',
    'cal.empty': 'Nothing planned for this day.',
    'cal.count': (n) => `${n} item${n === 1 ? '' : 's'}`,
    'cal.undone': (n) => `${n} unfinished`,
    'cal.goHint': 'Tap to open it in the planner',
    'cal.aria.grid': 'Month calendar',
    'cal.wd.sun': 'Sun', 'cal.wd.mon': 'Mon', 'cal.wd.tue': 'Tue', 'cal.wd.wed': 'Wed',
    'cal.wd.thu': 'Thu', 'cal.wd.fri': 'Fri', 'cal.wd.sat': 'Sat',
    // ---- Year / month picker ----
    'cal.pick.open': 'Pick year and month',
    'cal.pick.close': 'Close',
    'cal.pick.month': (y) => `${y} · pick a month`,
    'cal.pick.year': 'Pick a year',
    'cal.pick.prevYear': 'Previous year', 'cal.pick.nextYear': 'Next year',
    'cal.pick.prevYears': 'Previous 12 years', 'cal.pick.nextYears': 'Next 12 years',
    'cal.pick.toYears': 'Open the year list',
    'cal.pick.monthName': (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1],
    // ---- View switch: month grid / schedule list ----
    'cal.view.grid': 'Month',
    'cal.view.agenda': 'Schedule',
    'cal.view.label': 'View',
    'cal.agenda.empty': 'Nothing scheduled in the next two months.',
    'cal.agenda.today': 'Today',
    'cal.agenda.allDay': 'All day',
    'cal.agenda.range': (n) => `Next ${n} days`,
    'cz.card.todo.cal': 'Calendar',
    'cz.card.time.clock': 'Clock', 'cz.card.time.timer': 'Timer & alarm',
    'cz.card.memo.draw': 'Scratchpad', 'cz.card.memo.note': 'Quick notes',
    'cz.card.quote.today': 'Quote of the day', 'cz.card.quote.mine': 'My quotes',
    'cz.card.ai.chat': 'AI search',
    'cz.card.settings.display': 'Display', 'cz.card.settings.ai': 'AI integration',
    'cz.card.settings.customize': 'Customize',
    // ---- App update ----
    'upd.title': 'App update',
    'upd.current': 'Current version',
    'upd.check': 'Check for updates',
    'upd.apply': 'Apply now',
    'upd.download': 'Download new version',
    'upd.idle': 'Tap the button to check for a new version.',
    'upd.checking': 'Checking…',
    'upd.latest': 'You are on the latest version.',
    'upd.readyWeb': 'A new version is ready. Applying it reloads the page.',
    'upd.readyNative': 'A new version is available.',
    'upd.ready': 'A new version is ready',
    'upd.error': 'Could not check.',
    'upd.none': 'Updates cannot be checked in this environment.',
    'upd.unsupported': 'Opened as a single file, or service workers are unavailable.',
    'upd.devBuild': 'This is a dev build, so there is nothing to compare against.',
    'upd.noRegistration': 'No service worker is registered.',
    'upd.rateLimited': 'GitHub rate limit reached. Please try again shortly.',
    'upd.offline': 'Cannot reach the network.',
    'upd.badResponse': 'Could not read the release information.',
    'upd.failed': 'Unknown error.',
    'upd.httpError': (code) => `Server responded ${code}`,
    'upd.version': (v) => `version ${v}`,
    'upd.newBuild': (v) => `new version ${v}`,
    'upd.nativeNote': 'The app cannot install itself. After downloading, install it from the Android installer screen. (Sideloaded apps always require that confirmation.)',
    'cz.card.settings.update': 'App update',
    'cz.size.compact': 'Small', 'cz.size.normal': 'Normal', 'cz.size.large': 'Large',
    'cz.span.auto': 'Default', 'cz.span.full': 'Full width',
    'cz.shown': 'Shown', 'cz.hidden': 'Hidden',
    'cz.lockedHint': 'This tab cannot be hidden',
    'cz.moveUp': (label) => `Move ${label} up`,
    'cz.moveDown': (label) => `Move ${label} down`,
    'cz.nowCount': (on, total) => `${on}/${total} shown`,
    'cz.nowCards': (n) => `${n} cards`,
    'cz.reset': 'Reset customization',
    'cz.resetConfirm': 'This resets theme, tab order, widgets and card sizes to their defaults. Continue?',
    'todo.title': 'Planner',
    'todo.scope.day': 'Day',
    'todo.scope.week': 'Week',
    'todo.scope.month': 'Month',
    'todo.scope.year': 'Year',
    'todo.nav.prev': 'Previous period',
    'todo.nav.next': 'Next period',
    'todo.nav.today': 'Today',
    'todo.input.placeholder': 'Add a plan and press Enter',
    'todo.btn.add': 'Add',
    'todo.filter.all': 'All',
    'todo.filter.active': 'Active',
    'todo.filter.done': 'Done',
    'todo.btn.carry': 'Carry over',
    'todo.btn.carryHint': 'Move unfinished items from the previous period here',
    'todo.btn.clearDone': 'Clear done',
    'todo.empty.none': 'No plans for this period yet.',
    'todo.empty.filter': 'Nothing matches this filter.',
    'todo.aria.done': 'Mark as done',
    'todo.aria.delete': 'Delete',
    'todo.aria.scopeTabs': 'Planning scope',
    'todo.count.total': (n) => `${n} plan${n === 1 ? '' : 's'} all-time`,
    'todo.toast.nothingToCarry': 'Nothing to carry over from the previous period',
    'todo.toast.carried': (n) => `Moved ${n} unfinished item${n === 1 ? '' : 's'} here`,
    'todo.toast.nothingToClear': 'No completed items in this period',
    'todo.toast.cleared': (n) => `Cleared ${n} completed item${n === 1 ? '' : 's'}`,
  },
};

let current = DEFAULT_LANG;
const listeners = new Set();

/** 현재 언어 코드 */
export function getLang() { return current; }

/** 언어를 바꾸고 저장한 뒤, 등록된 구독자에게 알립니다. */
export function setLang(lang) {
  if (!LANGS.includes(lang) || lang === current) return;
  current = lang;
  save(LANG_KEY, lang);
  listeners.forEach((fn) => {
    try { fn(lang); } catch (err) { console.error('[i18n] 갱신 실패', err); }
  });
}

/** 언어가 바뀔 때 호출할 함수를 등록합니다. 해제 함수를 돌려줍니다. */
export function onLangChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * 문구를 찾습니다. 사전에 없으면 키를 그대로 돌려줘 화면이 비지 않게 합니다.
 * @param {string} key
 * @param {...any} args 함수형 항목에 넘길 값
 */
export function t(key, ...args) {
  const entry = DICT[current]?.[key] ?? DICT[DEFAULT_LANG]?.[key];
  if (entry == null) {
    console.warn('[i18n] 없는 문구 키:', key);
    return key;
  }
  return typeof entry === 'function' ? entry(...args) : entry;
}

/** 저장된 언어를 불러옵니다. 앱 시작 시 한 번 호출합니다. */
export function initLang() {
  const saved = load(LANG_KEY, null);
  current = LANGS.includes(saved) ? saved : DEFAULT_LANG;
  return current;
}

/**
 * data-i18n 속성이 붙은 정적 요소의 문구를 현재 언어로 채웁니다.
 *   data-i18n           -> textContent
 *   data-i18n-placeholder -> placeholder 속성
 *   data-i18n-aria      -> aria-label 속성
 *   data-i18n-title     -> title 속성
 */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  });
}

/** 사전에 빠진 키가 없는지 확인합니다. (테스트용) */
export function dictKeys(lang) { return Object.keys(DICT[lang] || {}); }
