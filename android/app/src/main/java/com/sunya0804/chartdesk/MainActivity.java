package com.sunya0804.chartdesk;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.security.SecureRandom;

/** 앱 화면. 앱 안의 로컬 서버가 내주는 데스크톱과 같은 화면을 웹뷰로 띄운다. */
public class MainActivity extends Activity {
    private static final int OPEN_FILE = 1;
    private static final int SAVE_FILE = 2;
    private static final int ASK_NOTIFICATIONS = 3;
    private static final String ALERTS = "alerts";

    private WebView web;
    private LocalServer server;
    private Updater updater;
    private ValueCallback<Uri[]> openCallback;
    private byte[] pendingSave;
    private int notifyRequest;
    private int notificationId;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        byte[] random = new byte[24];
        new SecureRandom().nextBytes(random);
        String token = Base64.encodeToString(random, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        server = new LocalServer(this, token);
        int port;
        try {
            port = server.start();
        } catch (IOException error) {
            Toast.makeText(this, "앱을 시작하지 못했습니다: " + error.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        String origin = "http://127.0.0.1:" + port;
        CookieManager.getInstance().setCookie(origin, LocalServer.COOKIE + "=" + token + "; Path=/; SameSite=Strict");

        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(ALERTS, "가격 알림", NotificationManager.IMPORTANCE_HIGH));

        updater = new Updater(this);
        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.background));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportMultipleWindows(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setUserAgentString(settings.getUserAgentString() + " ChartDeskAndroid/" + BuildConfig.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "ChartDeskNative");
        web.setWebViewClient(new WebViewClient() {
            // 앱 화면이 아닌 주소(뉴스, AI 사이트, 설치 안내 등)는 휴대폰의 브라우저로 연다.
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (origin.equals(url.getScheme() + "://" + url.getHost() + ":" + url.getPort())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (RuntimeException ignored) {
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (openCallback != null) openCallback.onReceiveValue(null);
                openCallback = callback;
                try {
                    startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"), OPEN_FILE);
                } catch (RuntimeException error) {
                    openCallback = null;
                    return false;
                }
                return true;
            }
        });
        // 화면이 상태 표시줄, 내비게이션 바, 키보드 밑으로 들어가지 않게 그만큼 띄운다.
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return WindowInsets.CONSUMED;
            });
        }
        setContentView(root);
        // 뒤로 가기는 화면에 열린 창(백테스트, 팝업, AI 창)부터 닫는다.
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        web.loadUrl(origin + "/");
        handleIntent(getIntent());
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        handleBack();
    }

    /** 화면이 닫을 창이 없다고 하면 앱을 뒤로 보낸다(앱 안의 서버와 화면은 그대로 둔다). */
    private void handleBack() {
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript("window.chartdeskBack ? window.chartdeskBack() : false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (updater != null) updater.checkIfDue();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent != null && Updater.ACTION_INSTALL_STATUS.equals(intent.getAction())) updater.onInstallStatus(intent);
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (updater != null) updater.stop();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == OPEN_FILE && openCallback != null) {
            openCallback.onReceiveValue(uri == null ? null : new Uri[] { uri });
            openCallback = null;
        }
        if (requestCode == SAVE_FILE && pendingSave != null) {
            byte[] bytes = pendingSave;
            pendingSave = null;
            if (uri == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("파일을 열지 못했습니다");
                out.write(bytes);
                Toast.makeText(this, "저장했습니다", Toast.LENGTH_SHORT).show();
            } catch (IOException error) {
                Toast.makeText(this, "저장하지 못했습니다: " + error.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == ASK_NOTIFICATIONS) resolve(notifyRequest, notificationPermission());
    }

    private String notificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS) || !askedNotifications() ? "default" : "denied";
        }
        return getSystemService(NotificationManager.class).areNotificationsEnabled() ? "granted" : "denied";
    }

    private boolean askedNotifications() {
        return getPreferences(MODE_PRIVATE).getBoolean("asked-notifications", false);
    }

    /** 화면에서 기다리는 Promise(android-bridge.js)를 끝낸다. */
    private void resolve(int id, String value) {
        runOnUiThread(() -> web.evaluateJavascript("window.__chartdeskDone(" + id + "," + JSONObject.quote(value) + ")", null));
    }

    /** 화면(android-bridge.js)에서 부르는 앱 기능. 웹뷰의 별도 스레드에서 불린다. */
    private final class Bridge {
        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String updateStatus() {
            return updater.status();
        }

        @JavascriptInterface
        public void checkForUpdates(int id) {
            updater.check(text -> resolve(id, text));
        }

        /** 내보낸 설정, 차트 이미지를 저장할 곳을 고르게 한다. */
        @JavascriptInterface
        public void saveFile(String name, String type, String base64) {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            runOnUiThread(() -> {
                pendingSave = bytes;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(type.isEmpty() ? "application/octet-stream" : type).putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(intent, SAVE_FILE);
            });
        }

        @JavascriptInterface
        public String notificationPermission() {
            return MainActivity.this.notificationPermission();
        }

        @JavascriptInterface
        public void requestNotificationPermission(int id) {
            if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                resolve(id, MainActivity.this.notificationPermission());
                return;
            }
            runOnUiThread(() -> {
                notifyRequest = id;
                getPreferences(MODE_PRIVATE).edit().putBoolean("asked-notifications", true).apply();
                requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, ASK_NOTIFICATIONS);
            });
        }

        /** 가격 알림. 누르면 앱으로 돌아온다. */
        @JavascriptInterface
        public void notify(String title, String body) {
            if (!"granted".equals(MainActivity.this.notificationPermission())) return;
            Intent open = new Intent(MainActivity.this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            Notification notification = new Notification.Builder(MainActivity.this, ALERTS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(PendingIntent.getActivity(MainActivity.this, 0, open, PendingIntent.FLAG_IMMUTABLE))
                .build();
            getSystemService(NotificationManager.class).notify(++notificationId, notification);
        }
    }
}
