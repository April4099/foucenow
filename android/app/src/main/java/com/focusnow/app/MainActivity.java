package com.focusnow.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 此刻 FocusNow · 安卓壳
 * 沉浸式全屏 WebView：去掉状态栏，纯软件主体。
 * JS 桥 AppControl：✕ 关闭挂后台（moveTaskToBack）/ ⏻ 完全退出。
 */
public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 沉浸式全屏：去掉顶部状态栏
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage 数据本机存储
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 计时结束提示音
        webView.setBackgroundColor(0xFF0A0A0E);
        webView.setWebViewClient(new WebViewClient());
        webView.addJavascriptInterface(new AppControl(), "AppControl");
        webView.loadUrl("file:///android_asset/index.html");
    }

    /** JS 桥：window.AppControl.minimize() / .exit() */
    class AppControl {
        @JavascriptInterface
        public void minimize() {
            runOnUiThread(() -> moveTaskToBack(true));
        }

        @JavascriptInterface
        public void exit() {
            runOnUiThread(() -> {
                finishAndRemoveTask();
                android.os.Process.killProcess(android.os.Process.myPid());
            });
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
            // 返回键 = 挂后台（与 ✕ 一致）
            moveTaskToBack(true);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}
