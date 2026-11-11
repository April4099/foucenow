package com.focusnow.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * 此刻 FocusNow · 安卓壳（极简版）
 *
 * 设计要点：
 * 1. 沉浸式全屏，无系统状态栏 —— 纯软件主体。
 * 2. 用「合成 https 域名」把本地网页(HTML/CSS/JS)内联加载，
 *    彻底规避 Android WebView 在 file:// 下 localStorage 报 SecurityError 而白屏/闪退的问题，
 *    同时让数据能正常持久化到本机。
 * 3. 关闭/退出交给安卓系统：返回键 = 网页内后退，否则退到后台；多任务上滑 = 完全关闭。
 *    （不再自绘 ✕/⏻ 按钮，安卓原生交互更顺手）
 */
public class MainActivity extends Activity {

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        hideSystemBars();

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // 启用 DOM 存储（localStorage 依赖）
        s.setDatabaseEnabled(true);                   // 兼容老版本系统
        s.setAllowFileAccess(true);                   // 内联失败时的兜底需要
        s.setMediaPlaybackRequiresUserGesture(false); // 计时结束提示音无需手动触发
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        webView.setBackgroundColor(0xFF0A0A0E);

        // WebChromeClient：让 alert / confirm 正常弹出（设置页二次确认用得到）
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());

        loadApp();
    }

    /** 内联加载本地网页，并以合成 https 源作为 origin（localStorage 可正常持久化） */
    private void loadApp() {
        try {
            String html = readAsset("index.html");
            String css = readAsset("style.css");
            String js = readAsset("app.js");

            // 把外链样式/脚本内联进同一个 HTML
            html = html.replace("<link rel=\"stylesheet\" href=\"style.css\">",
                    "<style>" + css + "</style>");
            // 防止 JS 中出现 </script> 提前闭合（本工程已确认无，仍做保险）
            js = js.replace("</script>", "<\\/script>");
            html = html.replace("<script src=\"app.js\"></script>",
                    "<script>" + js + "</script>");

            webView.loadDataWithBaseURL("https://app.focusnow.local/",
                    html, "text/html", "UTF-8", null);
        } catch (IOException e) {
            // 兜底：直接按资源文件加载
            webView.loadUrl("file:///android_asset/index.html");
        }
    }

    /** 读取 assets 下的文本文件 */
    private String readAsset(String name) throws IOException {
        StringBuilder sb = new StringBuilder();
        try (InputStream in = getAssets().open(name);
             BufferedReader r = new BufferedReader(
                     new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                sb.append(line).append('\n');
            }
        }
        return sb.toString();
    }

    /** 沉浸式全屏：隐藏状态栏，从屏幕边缘上滑可临时唤出 */
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars());
                c.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    /** 返回键：网页内能后退则后退，否则交给系统（退到后台 / 多任务） */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
