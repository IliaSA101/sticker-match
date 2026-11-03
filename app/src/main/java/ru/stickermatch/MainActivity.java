package ru.stickermatch;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

/**
 * Одна активити с WebView: весь интерфейс лежит в app/src/main/assets.
 * Данные хранятся в SharedPreferences через мост Android.save/Android.load,
 * поэтому списки не теряются при очистке кэша браузерного движка.
 *
 * Начиная с targetSdk 35 система не отступает от статус-бара и панели навигации сама,
 * поэтому отступы мы читаем из WindowInsets и отдаём странице в CSS-переменные.
 */
public class MainActivity extends Activity {

    private WebView web;
    private SharedPreferences prefs;
    private String pendingSharedText = "";
    private volatile int insetTop, insetRight, insetBottom, insetLeft;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences("sticker_match", Context.MODE_PRIVATE);
        pendingSharedText = extractSharedText(getIntent());

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0F1420"));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");

        setContentView(web);
        goEdgeToEdge();
    }

    /** Страница рисуется во весь экран, а высоту системных полос получает сама. */
    private void goEdgeToEdge() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            web.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.VANILLA_ICE_CREAM) {
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }

        web.setOnApplyWindowInsetsListener((view, insets) -> {
            float density = getResources().getDisplayMetrics().density;
            int top, right, bottom, left;

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime());
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
                left = bars.left;
            } else {
                top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight();
                bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft();
            }

            insetTop = Math.round(top / density);
            insetRight = Math.round(right / density);
            insetBottom = Math.round(bottom / density);
            insetLeft = Math.round(left / density);

            web.evaluateJavascript("window.applyInsets && window.applyInsets("
                    + insetTop + "," + insetRight + "," + insetBottom + "," + insetLeft + ")", null);
            return insets;
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        // уходим с экрана — просим страницу дописать списки на диск
        if (web != null) {
            web.evaluateJavascript("window.flushSave && window.flushSave()", null);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String text = extractSharedText(intent);
        if (!text.isEmpty() && web != null) {
            pendingSharedText = text;
            web.evaluateJavascript("window.onSharedText && window.onSharedText()", null);
        }
    }

    private String extractSharedText(Intent intent) {
        if (intent == null) return "";
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return "";
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        return text == null ? "" : text.toString();
    }

    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        // Экран "Обмен" — корневой: с остальных вкладок назад возвращает на него.
        web.evaluateJavascript("window.onAndroidBack ? window.onAndroidBack() : false", value -> {
            if (!"true".equals(value)) {
                finish();
            }
        });
    }

    private class Bridge {

        @JavascriptInterface
        public String load(String key) {
            return prefs.getString(key, "");
        }

        @JavascriptInterface
        public void save(String key, String value) {
            prefs.edit().putString(key, value).apply();
        }

        @JavascriptInterface
        public void remove(String key) {
            prefs.edit().remove(key).apply();
        }

        /** Синхронно дописывает отложенные изменения на диск. */
        @JavascriptInterface
        public void flush() {
            prefs.edit().commit();
        }

        @JavascriptInterface
        public void copy(String text) {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm != null) {
                cm.setPrimaryClip(ClipData.newPlainText("sticker-match", text));
            }
        }

        @JavascriptInterface
        public String paste() {
            ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cm == null) return "";
            ClipData clip = cm.getPrimaryClip();
            if (clip == null || clip.getItemCount() == 0) return "";
            CharSequence text = clip.getItemAt(0).coerceToText(MainActivity.this);
            return text == null ? "" : text.toString();
        }

        @JavascriptInterface
        public void share(String text) {
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("text/plain");
            intent.putExtra(Intent.EXTRA_TEXT, text);
            startActivity(Intent.createChooser(intent, "Отправить список"));
        }

        @JavascriptInterface
        public void toast(final String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public String takeSharedText() {
            String text = pendingSharedText;
            pendingSharedText = "";
            return text;
        }

        /** Высота системных полос в dp: "сверху,справа,снизу,слева". */
        @JavascriptInterface
        public String insets() {
            return insetTop + "," + insetRight + "," + insetBottom + "," + insetLeft;
        }

        /** Светлая тема страницы — значки в системных полосах делаем тёмными. */
        @JavascriptInterface
        public void setDarkBarIcons(final boolean dark) {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    WindowInsetsController controller = getWindow().getInsetsController();
                    if (controller == null) return;
                    int appearance = dark
                            ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                            : 0;
                    controller.setSystemBarsAppearance(appearance,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                } else {
                    int flags = web.getSystemUiVisibility();
                    int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                            | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    web.setSystemUiVisibility(dark ? (flags | light) : (flags & ~light));
                }
            });
        }
    }
}
