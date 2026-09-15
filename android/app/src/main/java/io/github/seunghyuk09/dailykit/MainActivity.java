package io.github.seunghyuk09.dailykit;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 안드로이드 15(API 35)부터는 시스템이 edge-to-edge 를 강제합니다.
        // 여기서 직접 켜 두면 그 이전 버전에서도 동작이 같아져,
        // Capacitor 의 SystemBars 가 어느 기기에서나 같은 방식으로 인셋을 넘겨줍니다.
        // (@capacitor/core 의 system-bars 문서가 권장하는 호출입니다.
        //  Capacitor 9 부터는 자동으로 불립니다)
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
