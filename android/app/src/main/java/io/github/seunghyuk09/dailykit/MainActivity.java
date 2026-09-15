package io.github.seunghyuk09.dailykit;

import com.getcapacitor.BridgeActivity;

/*
 * 손대지 않은 기본 형태입니다.
 *
 * 한때 여기서 androidx 의 EdgeToEdge.enable(this) 를 불렀습니다.
 * (Capacitor 의 system-bars 문서가 권장하는 호출이고, 안드로이드 15 미만에서도
 *  동작을 맞추려는 목적이었습니다)
 *
 * 그런데 그 호출은 super.onCreate() 보다 먼저 실행되고,
 * BridgeActivity 는 super.onCreate() 다음에야 런치 테마를 벗깁니다.
 *   protected void onCreate(...) {
 *       super.onCreate(savedInstanceState);
 *       setTheme(R.style.AppTheme_NoActionBar);   // 스플래시 테마 해제
 *
 * 즉 스플래시 배경(@drawable/splash)이 아직 걸려 있는 상태에서 edge-to-edge 가 켜져,
 * 앱을 켠 뒤에도 화면 위쪽에 스플래시가 남는 문제가 실제로 생겼습니다.
 *
 * 안드로이드 15(API 35)부터는 시스템이 edge-to-edge 를 강제하므로 이 호출이 없어도
 * 동작에 차이가 없고, 그 미만에서는 시스템 바 밑으로 그려지지 않아 여백 자체가 필요 없습니다.
 * 안전 영역 처리는 Capacitor 의 SystemBars 가 창 인셋을 읽어 그대로 해 줍니다.
 */
public class MainActivity extends BridgeActivity {}
