package com.sunya0804.chartdesk;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
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
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;

/** 앱 화면. 앱 안의 로컬 서버가 내주는 데스크톱과 같은 화면을 웹뷰로 띄운다. */
public class MainActivity extends Activity {
    private static final int OPEN_FILE = 1;
    private static final int SAVE_FILE = 2;
    private static final int ASK_NOTIFICATIONS = 3;
    private static final String ALERTS = "alerts";

    private WebView web;
    private FrameLayout root;
    private String origin;
    // 웹뷰 렌더러가 죽으면 새 웹뷰로 다시 띄운다. 계속 죽으면(1분에 3번) 멈춘다.
    private final java.util.ArrayDeque<Long> rendererDeaths = new java.util.ArrayDeque<>();
    private LocalServer server;
    private Updater updater;
    private ValueCallback<Uri[]> openCallback;
    private byte[] pendingSave;
    private int notifyRequest;
    private int notificationId;
    // 켜진 가격 알림이 있으면 AlertService를 띄워 앱을 내려도 확인을 이어 간다. 1분마다 다시 본다.
    private static final String ACTIVE_ALERTS = "(JSON.parse(localStorage.getItem('chartdesk.workspace.v1') || 'null')?.alerts || []).some(a => a.active)";
    private static final long WATCH_EVERY_MS = 60_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable watchTick = () -> {
        syncAlertService();
        backupSettings();
        handler.postDelayed(this.watchTick, WATCH_EVERY_MS);
    };
    // 앱이 뒤에 있으면 웹뷰의 setInterval이 1분에 한 번 정도로 늦춰진다. 알림을 지켜보는 동안에는 앱이 10초마다 화면 스크립트를 불러
    // 알림에 필요한 시세·조건 확인(window.chartdeskBackgroundTick)을 돌리게 한다. 함수가 없으면 아무 일도 하지 않는다.
    private static final long BACKGROUND_TICK_MS = 10_000L;
    private final Runnable backgroundTick = () -> {
        if (this.web != null && this.watching && !this.visible) this.web.evaluateJavascript("window.chartdeskBackgroundTick && window.chartdeskBackgroundTick()", null);
        handler.postDelayed(this.backgroundTick, BACKGROUND_TICK_MS);
    };
    private boolean watching;
    private boolean visible;
    // 설정 백업(android-bridge.js). 웹뷰 저장소는 포트마다 따로라서, 서버가 지난번과 다른 포트로 뜨면 이 백업으로 되돌린다.
    private static final String SETTINGS_BACKUP = "settings-backup.json";
    private int port;
    private boolean restoreChecked;
    private String lastBackup;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        byte[] random = new byte[24];
        new SecureRandom().nextBytes(random);
        String token = Base64.encodeToString(random, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        server = new LocalServer(this, token);
        try {
            port = server.start();
        } catch (IOException error) {
            Toast.makeText(this, "앱을 시작하지 못했습니다: " + error.getMessage(), Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        origin = "http://127.0.0.1:" + port;
        CookieManager.getInstance().setCookie(origin, LocalServer.COOKIE + "=" + token + "; Path=/; SameSite=Strict");

        NotificationManager notifications = getSystemService(NotificationManager.class);
        notifications.createNotificationChannel(new NotificationChannel(ALERTS, "가격 알림", NotificationManager.IMPORTANCE_HIGH));

        updater = new Updater(this);
        web = createWebView();
        // 화면이 상태 표시줄, 내비게이션 바, 키보드 밑으로 들어가지 않게 그만큼 띄운다.
        root = new FrameLayout(this);
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

    /** 앱 화면을 띄우는 웹뷰. 렌더러가 죽어 다시 만들 때도 쓴다. */
    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView web = new WebView(this);
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

            // 휴대폰 메모리가 모자라거나 웹뷰가 업데이트되면 시스템이 렌더러를 끈다. 처리하지 않으면 앱 전체가 함께 꺼져
            // 앱을 내려 둔 동안 가격 알림 확인도 소리 없이 멈춘다. 새 웹뷰로 화면을 다시 띄운다.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recoverRenderer(view);
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
        return web;
    }

    private void recoverRenderer(WebView dead) {
        if (dead != web) return;
        long now = System.currentTimeMillis();
        while (!rendererDeaths.isEmpty() && now - rendererDeaths.peekFirst() > 60_000L) rendererDeaths.pollFirst();
        rendererDeaths.addLast(now);
        root.removeView(dead);
        dead.destroy();
        web = null;
        if (rendererDeaths.size() > 3) {
            // 계속 죽으면 다시 띄워도 소용이 없다. 알림 확인 표시를 내리고 앱을 열 때 다시 시도한다.
            AlertService.stop(this);
            watching = false;
            finish();
            return;
        }
        web = createWebView();
        root.addView(web);
        web.loadUrl(origin + "/");
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
        visible = true;
        if (updater != null) updater.checkIfDue();
        handler.removeCallbacks(watchTick);
        handler.post(watchTick);
        handler.removeCallbacks(backgroundTick);
        handler.postDelayed(backgroundTick, BACKGROUND_TICK_MS);
    }

    @Override
    protected void onPause() {
        // 화면이 아직 앞에 있을 때 마지막으로 확인한다(뒤로 간 앱은 포그라운드 서비스를 새로 시작할 수 없다).
        syncAlertService();
        backupSettings();
        visible = false;
        super.onPause();
    }

    /** 화면에 지금 설정을 백업하게 한다(android-bridge.js의 __chartdeskBackup). */
    private void backupSettings() {
        if (web != null) web.evaluateJavascript("window.__chartdeskBackup && window.__chartdeskBackup()", null);
    }

    private AtomicFile backupFile() {
        return new AtomicFile(new File(getFilesDir(), SETTINGS_BACKUP));
    }

    /** 백업한 설정과 그때의 포트. 없거나 깨졌으면 null. */
    private JSONObject readBackup() {
        try {
            return new JSONObject(new String(backupFile().readFully(), StandardCharsets.UTF_8));
        } catch (IOException | JSONException missing) {
            return null;
        }
    }

    private void writeBackup(String storage) {
        AtomicFile file = backupFile();
        FileOutputStream out = null;
        try {
            byte[] bytes = new JSONObject().put("port", port).put("storage", storage).toString().getBytes(StandardCharsets.UTF_8);
            out = file.startWrite();
            out.write(bytes);
            file.finishWrite(out);
            lastBackup = storage;
        } catch (IOException | JSONException error) {
            if (out != null) file.failWrite(out);
        }
    }

    /**
     * 절전(Doze) 중에는 배터리 최적화 대상 앱의 네트워크와 예약 작업이 막혀 알림이 늦거나 오지 않는다.
     * 알림 확인을 처음 켤 때 한 번만, ChartDesk를 최적화에서 빼도록 묻는다.
     */
    private void askBatteryExemption() {
        PowerManager power = getSystemService(PowerManager.class);
        if (power == null || power.isIgnoringBatteryOptimizations(getPackageName())) return;
        if (getPreferences(MODE_PRIVATE).getBoolean("asked-battery", false) || isFinishing()) return;
        getPreferences(MODE_PRIVATE).edit().putBoolean("asked-battery", true).apply();
        new AlertDialog.Builder(this)
            .setTitle("가격 알림을 놓치지 않게")
            .setMessage("휴대폰이 절전 중일 때도 켜 둔 알림을 확인하려면 ChartDesk를 배터리 최적화에서 빼야 합니다. "
                + "빼지 않으면 화면이 꺼진 동안 알림이 늦거나 오지 않을 수 있습니다.\n\n"
                + "삼성 휴대폰은 설정 → 배터리 → 백그라운드 사용 제한에서 ChartDesk를 '절전 예외 앱'에 넣어 주세요.")
            .setPositiveButton("최적화에서 빼기", (dialog, which) -> {
                try {
                    startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
                } catch (RuntimeException unsupported) {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                }
            })
            .setNegativeButton("나중에", null)
            .show();
    }

    /** 화면에 켜진 알림이 있는지 보고 AlertService를 켜거나 끈다. */
    private void syncAlertService() {
        if (web == null) return;
        boolean canStart = visible;
        web.evaluateJavascript(ACTIVE_ALERTS, value -> {
            boolean active = "true".equals(value);
            if (active && !watching && canStart) {
                try {
                    AlertService.start(this);
                    watching = true;
                    askBatteryExemption();
                } catch (RuntimeException notAllowed) {
                    // 뒤로 간 뒤라 시작이 막히면 다음에 앱을 열 때 다시 시도한다.
                }
            } else if (!active && watching) {
                AlertService.stop(this);
                watching = false;
            }
        });
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
        handler.removeCallbacks(watchTick);
        handler.removeCallbacks(backgroundTick);
        AlertService.stop(this);
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

        /** 화면 스크립트보다 먼저 불린다. 지난번과 포트가 다르면 백업한 설정(키→값 JSON)을, 아니면 빈 문자열을 준다. 앱을 켠 뒤 한 번만 준다. */
        @JavascriptInterface
        public String restoreSettings() {
            synchronized (MainActivity.this) {
                if (restoreChecked) return "";
                restoreChecked = true;
                JSONObject backup = readBackup();
                if (backup == null || backup.optInt("port") == port) return "";
                String storage = backup.optString("storage");
                // 이제 이 포트의 저장소에 같은 설정이 들어가므로 다음 실행에서 다시 되돌리지 않게 포트를 바꿔 둔다.
                writeBackup(storage);
                return storage;
            }
        }

        @JavascriptInterface
        public void backupSettings(String storage) {
            synchronized (MainActivity.this) {
                if (!storage.equals(lastBackup)) writeBackup(storage);
            }
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
