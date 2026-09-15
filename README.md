# Daily Kit — 계산기 중심 종합 유틸리티 PWA

계산기 · 날씨 · 할 일 · 시계/타이머/알람 · 메모/낙서판 · 글귀 · 음악 · AI 검색을
한 화면에 모은 웹 앱입니다. **빌드 도구·외부 라이브러리 의존성 0** 으로 만들어졌고,
PWA 로 동작해 모바일 홈 화면에 설치할 수 있습니다.

## 실행

```bash
npm start          # http://127.0.0.1:8099
npm run build            # 단일 파일(dist/) + 미리보기 페이지 생성
npm run test:unit        # 단위 테스트 (계산 엔진 9종 + 기간 계산 10종)
npm run test:assets      # 정적 파일 참조 무결성 검사 (sw.js / manifest / index.html)
npm run test:e2e         # 실제 Chromium E2E 테스트 (47종, http 모드)
npm run test:standalone  # 단일 파일을 file:// 로 열어 같은 47종 실행
npm test                 # 전부
```

> `file://` 로 직접 열면 ES 모듈과 서비스 워커가 동작하지 않습니다. 반드시 HTTP 로 띄우세요.

## 기능별 구현 상태

| 기능 | 상태 | 비고 |
|---|---|---|
| 계산기 | ✅ 완전 동작 | `eval()` 미사용. Shunting-yard 파서 직접 구현, 단위 테스트 9종 |
| 시계 / 세계시계 | ✅ 완전 동작 | `Intl.DateTimeFormat` 기반 |
| 타이머 / 뽀모도로 | ✅ 완전 동작 | 절대시각 기준이라 `setInterval` 누적 오차 없음 |
| 알람 | ⚠️ 제한적 | **탭이 열려 있을 때만** 울림 ([아래 참고](#알려진-제약)) |
| TO DO (계획표) | ✅ 완전 동작 | 일/주/월/연 4단위, 기간 이동, 진행률, 이월. 문구 한/영 전환(설정 탭) |
| 날씨 / 주간예보 | ✅ 완전 동작 | Open-Meteo (키 불필요) |
| 메모 / 낙서판 | ✅ 완전 동작 | Pointer Events — 마우스·터치·펜 |
| 글귀 | ✅ 완전 동작 | 사용자 등록 글귀 우선, 없으면 기본 격언 |
| 배너 | ✅ 완전 동작 | 설정 탭에서 문구 편집, 6초 순환 |
| 음악 (YouTube) | ✅ 동작 | 공식 임베드 |
| 음악 (멜론/지니/YT뮤직 등) | ❌ **계정 연결 재생 불가** | [아래 참고](#음악-서비스-연동이-불가능한-이유) |
| AI 검색 | ⚠️ BYOK 필요 | 사용자 본인 API 키를 브라우저에 저장 |

## 알려진 제약

### 알람 · 타이머
브라우저 탭이 **열려 있을 때만** 동작합니다. 브라우저를 완전히 종료하면 울리지 않습니다.
백그라운드 알람은 웹 표준으로 불가능하며, 앱으로 패키징한 뒤 네이티브 알람 API 를 붙여야 합니다.

### 음악 서비스 연동이 불가능한 이유

| 서비스 | 조사 결과 (2026-09 기준) |
|---|---|
| **멜론 / 지니** | 외부 개발자용 공식 Open API 를 제공하지 않음. 비공식 크롤링 API 만 존재하며 이용약관 위반 |
| **YouTube Music** | 공식 API 없음. 서드파티 연동은 전부 리버스 엔지니어링 + 쿠키 인증 → 계정 정지 위험 |
| **Spotify** | 2026-02 정책 변경: 개발 모드 앱도 소유자 Premium 필수 + 테스터 5명 제한. 확장 쿼터는 법인 + MAU 25만 이상만 신청 가능 (개인 신청은 2025-05 중단) |

→ 합법적으로 재생 가능한 것은 **YouTube IFrame 임베드**뿐입니다.
나머지 서비스는 **검색어를 들고 해당 서비스로 이동하는 바로가기**로 구현했습니다.

### AI 검색 (BYOK) 보안
브라우저에서 Anthropic API 를 직접 호출하려면 `anthropic-dangerous-direct-browser-access: true`
헤더가 필요합니다. 이 방식은 **개발자 도구로 API 키를 볼 수 있으므로 본인 기기 전용**입니다.
불특정 다수에게 배포한다면 반드시 서버 프록시를 두고 키를 서버에 보관하세요.

### 날씨 API
Open-Meteo 무료 티어는 **비상업 용도, 하루 1만 호출** 한도입니다.
수익화한다면 상업용 플랜으로 전환해야 합니다. 데이터 출처 표기(CC BY 4.0)는 앱 안에 포함돼 있습니다.

### 데이터 저장
모든 데이터는 **이 브라우저의 localStorage 에만** 저장됩니다.
기기 간 동기화는 되지 않으며, 브라우저 데이터를 지우면 함께 사라집니다.
설정 탭에서 JSON 백업/복원이 가능합니다 (보안상 API 키는 백업에서 제외).

## 프로젝트 구조

```
public/
  index.html              화면 구조
  manifest.webmanifest    PWA 매니페스트
  sw.js                   서비스 워커 (앱 셸 캐싱)
  css/app.css             전체 스타일 (라이트/다크)
  js/
    main.js               부트스트랩 · 탭 전환
    lib/
      calc-engine.js      수식 파서/평가기 (테스트 대상)
      period.js           일/주/월/연 기간 키 계산 (ISO 8601 주차)
      i18n.js             TO DO 기능의 한/영 문구 사전 (전환 UI 는 설정 탭)
      store.js            localStorage 래퍼 (차단 환경 대비 폴백 포함)
      dom.js              DOM 헬퍼
    modules/              기능별 모듈 9개
  assets/                 아이콘 (PNG 192/512/maskable, SVG)
tests/
  calc-engine.test.mjs    계산 엔진 단위 테스트
  period.test.mjs         기간 계산 단위 테스트
  i18n.test.mjs           다국어 사전 단위 테스트
  e2e.mjs                 Chromium E2E 테스트
  build-artifact.mjs      미리보기용 페이지 생성
  build-standalone.mjs    단일 HTML 파일 생성 (서버 없이 실행용)
  verify-assets.mjs       정적 파일 참조 무결성 검사 (CI 에서 실행)
  make-ios-icon.mjs       iOS 앱 아이콘 생성 (알파 채널 없는 PNG)
dist/
  데일리킷.html            서버 없이 더블클릭으로 여는 단일 파일 (생성물)
  데일리킷 실행.bat        위 파일을 브라우저로 여는 Windows 실행기
android/                  Capacitor 안드로이드 프로젝트 (Play 스토어용)
ios/                      Capacitor iOS 프로젝트 (App Store용)
  App/App/Info.plist      번들 설정 (UIRequiredDeviceCapabilities = arm64)
  App/App/{ko,en}.lproj/  앱 이름 현지화 (데일리킷 / Daily Kit)
  App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme
                          CI 가 -scheme App 으로 빌드하려면 공유 스킴이 필요합니다
```

## 서버 없이 실행 (Windows)

`dist/` 의 두 파일을 같은 폴더에 두고 `데일리킷 실행.bat` 을 더블클릭하면
웹서버 없이 브라우저에서 바로 열립니다. 인터넷 연결도 필요 없습니다.

```
npm run build        # dist/데일리킷.html 재생성
```

`데일리킷.html` 을 직접 더블클릭해도 동일하게 열립니다.
배치 파일은 html 을 못 찾았을 때 원인을 한국어로 알려주는 역할이 추가로 있습니다.

### 단일 파일 버전의 제약

| 항목 | 서버로 열 때 (http) | 파일로 열 때 (file://) |
|---|---|---|
| 계산기 · 할 일 · 메모 · 낙서 · 글귀 · 타이머 | ✅ | ✅ |
| 날씨 · AI 검색 | ✅ | ✅ (인터넷 필요) |
| 홈 화면에 추가 / 오프라인 캐시 (PWA) | ✅ | ❌ manifest·서비스워커 없음 |
| API 키 디스크 저장 | ✅ | ❌ **의도적으로 차단** (아래 참고) |

**API 키가 파일 모드에서 저장되지 않는 이유:** Chromium 계열은 `file://` 문서의
localStorage 를 *모든 로컬 HTML 파일이 공유하는 하나의 저장소*로 다룹니다.
즉 같은 PC 의 다른 `.html` 파일이 저장된 키를 그대로 읽을 수 있습니다.
그래서 파일 모드에서는 키를 디스크에 쓰지 않고 **현재 창의 메모리에만** 보관합니다
(창을 닫으면 사라집니다). 할 일·메모 등 민감하지 않은 데이터는 정상 저장됩니다.

### 배치 파일 설계 메모

Windows 의 `cmd.exe` 는 배치 파일을 **현재 콘솔 코드페이지**로 디코딩합니다.
따라서 배치 안에 적은 한글 파일명은 코드페이지가 949 가 아니면
(영문 Windows, "Unicode UTF-8 사용(베타)" 옵션 사용자) 실제 파일명과 달라집니다.
이를 피하려고 **파일을 찾는 부분에는 한글을 쓰지 않고**, 이름이 맞지 않으면
같은 폴더의 `*.html` 을 ASCII 경로로 탐색하도록 만들었습니다.
안내 문구의 한글은 표시 전용이라 깨져도 동작에 영향이 없으며,
영문을 병기해 어떤 환경에서도 원인을 읽을 수 있게 했습니다.

## 배포

### 1. GitHub Pages
`.github/workflows/pages.yml` 이 `main` 브랜치 푸시마다 `public/` 을 배포합니다.

**수기 작업 필요:** 저장소 → Settings → Pages → Source 를 **GitHub Actions** 로 설정해야 합니다.

### 2. Android 앱 (Capacitor)

웹 자산을 앱 안에 담아 배포합니다. `capacitor.config.json` 의 `webDir` 가 `public/` 이므로
웹과 앱이 같은 코드를 씁니다.

```bash
npm run cap:sync          # public/ 을 안드로이드 프로젝트로 복사
npm run android:debug     # 디버그 APK (Android SDK 필요)
```

| 항목 | 값 |
|---|---|
| 패키지 이름 | `io.github.seunghyuk09.dailykit` |
| 앱 이름 | Daily Kit / 데일리킷 (한국어 로캘) |
| minSdk / targetSdk | 24 / 36 |

`targetSdk 36` 은 필수입니다. **2026-08-31 부터 Google Play 는 신규 앱과 업데이트에
Android 16(API 36) 이상을 요구**합니다.

#### TWA 가 아니라 Capacitor 를 쓴 이유

TWA 는 설정이 간단하지만 실행이 Chrome 안에서 일어나 Play 의 비공개 테스트에서
"테스터 참여도" 가 집계되지 않아 반려된 사례가 보고됩니다. 또 백그라운드 알람처럼
네이티브 API 가 필요한 기능을 붙일 수 없습니다.

### 3. iOS 앱 (Capacitor)

같은 `public/` 자산을 iOS 앱에도 그대로 씁니다.

```bash
npm run cap:sync:ios      # public/ 을 iOS 프로젝트로 복사
npm run ios:build         # 서명 없는 아카이브 (macOS + Xcode 26 이상에서만)
npm run icon:ios          # 앱 아이콘 재생성 (알파 채널 없는 PNG)
```

| 항목 | 값 |
|---|---|
| 번들 ID | `io.github.seunghyuk09.dailykit` |
| 앱 이름 | Daily Kit / 데일리킷 (한국어 로캘) |
| 최소 iOS | 15.0 (arm64 전용) |
| 기기 | iPhone + iPad (`TARGETED_DEVICE_FAMILY = "1,2"`) |

**2026-04-28 부터 App Store Connect 는 Xcode 26 / iOS 26 SDK 이상으로 빌드한 앱만 받습니다.**
`.github/workflows/ios.yml` 은 `macos-latest`(2026-07 부터 macOS 26 + Xcode 26.x)를 쓰므로 조건을 만족합니다.
러너 이미지가 내려가면 이 워크플로가 먼저 깨지므로, `Xcode 버전 확인` 단계 로그를 보면 원인을 바로 알 수 있습니다.

#### 스토어가 거부하는 두 가지를 CI 가 미리 막습니다

`npm run test:assets` 가 다음을 검사합니다. 둘 다 실제로 업로드 거부 사유입니다.

| 검사 | 막는 오류 |
|---|---|
| 앱 아이콘이 1024×1024 이고 알파 채널(PNG color type 4/6, tRNS)이 없는가 | `ERROR ITMS-90717` — 앱 아이콘에 투명도가 있으면 거부 |
| `Info.plist` 의 `UIRequiredDeviceCapabilities` 가 `armv7` 이 아니라 `arm64` 인가 | `ERROR ITMS-90502` — arm64 전용 바이너리인데 `arm64` 선언이 없으면 거부 |

Capacitor 기본 템플릿은 `armv7` 을 넣어 줍니다. 배포 타깃이 iOS 15 라 armv7 슬라이스 자체가
만들어지지 않으므로 `arm64` 로 바꿨습니다. iOS 15 를 돌리는 기기는 모두 arm64 라 설치 가능 기기는 줄지 않습니다.

## 자동 배포

| 대상 | 트리거 | 결과 | 사람 손 |
|---|---|---|---|
| **웹 (GitHub Pages)** | `main` 에 머지 | 몇 분 안에 자동 반영 | 없음 |
| **디버그 APK** | `main` 에 머지 | Actions 아티팩트로 내려받기 | 없음 |
| **릴리스 AAB** | `v1.2.3` 형태 태그 푸시 | 서명된 AAB 생성 | 시크릿 등록 1회 + Play 업로드 |
| **iOS 아카이브** | `main` 에 머지 | 서명 없는 `.xcarchive` 아티팩트 | 없음 (설치는 불가) |
| **릴리스 IPA** | `v1.2.3` 형태 태그 푸시 | 서명된 IPA 생성 | 시크릿 등록 1회 |
| **TestFlight 업로드** | 위 + API 키 시크릿 | 자동 업로드 | 시크릿 등록 1회 |

```bash
# 앱 새 버전 내보내기
git tag v1.0.0 && git push origin v1.0.0
```

태그 하나로 안드로이드와 iOS 가 같이 나갑니다.
버전 이름은 태그에서, 빌드 번호는 Actions 실행 번호에서 자동으로 채워집니다.
(Play 도 App Store Connect 도 같은 빌드 번호 재업로드를 거부하므로 항상 증가해야 합니다)

### 수기 작업 — 릴리스 AAB 서명

서명 키는 저장소에 넣으면 안 되므로 GitHub 시크릿으로 등록해야 합니다. **1회만** 하면 됩니다.

```bash
# 1) 키스토어 생성 (분실하면 같은 앱으로 업데이트할 수 없습니다. 반드시 백업하세요)
keytool -genkeypair -v -keystore dailykit.keystore \
  -alias dailykit -keyalg RSA -keysize 2048 -validity 10000

# 2) base64 로 변환
base64 -w0 dailykit.keystore > keystore.b64
```

저장소 → Settings → Secrets and variables → Actions 에 4개를 등록합니다.

| 시크릿 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `keystore.b64` 의 내용 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `dailykit` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

시크릿이 없으면 릴리스 단계는 **건너뜁니다** (실패하지 않습니다). 디버그 APK 는 그대로 만들어집니다.

### 수기 작업 — Play 스토어 출시

여기부터는 자동화할 수 없습니다.

1. **개발자 등록** — $25 (1회, 평생)
2. **비공개 테스트** — 2023-11-13 이후 만든 개인 계정은 **테스터 12명이 연속 14일** 참여해야
   프로덕션 액세스를 신청할 수 있습니다
3. **개인정보처리방침 URL** — 위치·알림 권한을 쓰므로 필요합니다
4. **AAB 업로드** — Actions 아티팩트에서 내려받아 Play Console 에 올립니다

> 4번은 Play Developer API 서비스 계정을 만들면 자동화할 수 있지만, 계정 생성과 권한 부여가
> 수기 작업이고 실수 시 영향이 커서 이번에는 넣지 않았습니다. 필요하면 추가하겠습니다.

### 수기 작업 — iOS 서명

**iOS 서명은 리눅스·윈도우에서 준비할 수 없습니다.** 인증서 요청(CSR)과 `.p12` 내보내기가
macOS 키체인 기능이라, 아래 1~3번은 Mac 에서 해야 합니다. Mac 이 없으면 이 경로는 막힙니다.

1. **Apple Developer Program 가입** — **$99/년**, 매년 자동 갱신. 개인/법인 모두 $99 이고
   법인은 D-U-N-S 번호가 추가로 필요합니다.
   (무료 Apple ID 로도 Xcode 빌드는 되지만 프로비저닝이 **7일**짜리라 본인 기기 설치만 가능합니다.
   App Store 도 TestFlight 도 쓸 수 없습니다.)
2. **Apple Distribution 인증서** 생성 → 키체인 접근에서 개인 키와 함께 `.p12` 로 내보내기
3. **App Store 용 프로비저닝 프로파일** 생성 (`io.github.seunghyuk09.dailykit`) → `.mobileprovision` 내려받기

```bash
# Mac 에서 base64 로 변환 (-i 는 GNU base64 의 -w0 에 해당)
base64 -i dist.p12 | tr -d '\n' > cert.b64
base64 -i DailyKit_AppStore.mobileprovision | tr -d '\n' > profile.b64
```

저장소 → Settings → Secrets and variables → Actions 에 등록합니다.

| 시크릿 이름 | 값 | 없으면 |
|---|---|---|
| `IOS_CERTIFICATE_BASE64` | `cert.b64` 의 내용 | 서명 빌드를 건너뜀 |
| `IOS_CERTIFICATE_PASSWORD` | `.p12` 내보낼 때 정한 비밀번호 | |
| `IOS_PROVISIONING_PROFILE_BASE64` | `profile.b64` 의 내용 | 서명 빌드를 건너뜀 |
| `IOS_TEAM_ID` | 10자리 팀 ID (Developer 사이트 Membership) | 서명 빌드를 건너뜀 |
| `APPSTORE_KEY_ID` | App Store Connect API 키 ID | IPA 만 만들고 업로드는 건너뜀 |
| `APPSTORE_ISSUER_ID` | App Store Connect Issuer ID | |
| `APPSTORE_PRIVATE_KEY` | `.p8` 키 파일 내용 전체 | |

시크릿이 없으면 해당 단계는 **건너뜁니다** (실패하지 않습니다). 서명 없는 아카이브는 계속 만들어집니다.

> 이 서명 경로는 Apple 개발자 계정 없이는 CI 에서 한 번도 실행되지 않습니다.
> 제가 검증한 것은 **시크릿이 없을 때 서명 없이 빌드가 끝까지 도는 것**까지입니다.
> 시크릿을 등록한 첫 태그 빌드는 한 번에 성공하지 않을 수 있습니다.

### 수기 작업 — App Store 출시

1. **App Store Connect 에 앱 등록** — 번들 ID, 앱 이름, SKU 입력 (1회)
2. **개인정보처리방침 URL** — 위치·알림 권한을 쓰므로 필수입니다
3. **스크린샷** — iPhone 6.9" 와 6.5" 필수, iPad 는 iPad 지원 시 필수
4. **App Review** — 보통 24~48시간. 리젝 사유는 Resolution Center 로 옵니다
5. **연령 등급 · 수출 규정(암호화 사용 여부) 설문** 작성

> iOS 26 SDK 로 빌드하면 네이티브 UI 에 Liquid Glass 스타일이 기본 적용됩니다.
> 이 앱은 화면 대부분이 WebView 라 영향이 작지만, 상태바·세이프에어리어는 실제 기기에서 확인해야 합니다.

## 라이선스 / 출처
- 날씨 데이터: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- 기본 격언: 공개 속담 및 출처 표기된 인용구
