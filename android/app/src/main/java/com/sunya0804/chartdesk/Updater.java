package com.sunya0804.chartdesk;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * 자동 업데이트. GitHub의 최신 릴리스에 더 높은 버전의 APK가 있으면 내려받아 두고 설치할지 묻는다.
 * 앱을 열 때, 그리고 6시간마다(앱으로 돌아올 때) 확인한다. 설정 창의 "업데이트 확인"으로도 확인한다.
 * 같은 서명 키로 만든 APK만 설치되므로, 다른 곳에서 받은 파일로 바뀔 걱정은 없다.
 */
final class Updater {
    static final String ACTION_INSTALL_STATUS = "com.sunya0804.chartdesk.INSTALL_STATUS";
    private static final String LATEST = "https://api.github.com/repos/Sunya0804/chartdesk-public/releases/latest";
    private static final long CHECK_EVERY_MS = 6 * 60 * 60 * 1000L;

    private final Activity activity;
    private final File folder;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile String status = "";
    private long lastCheck;
    private boolean busy;
    // 내려받아 둔 새 버전. 설치를 미뤘으면 다음에 다시 묻는다.
    private File ready;
    private String readyVersion;
    // 설치 권한을 주러 설정에 다녀오는 중.
    private boolean waitingForPermission;

    Updater(Activity activity) {
        this.activity = activity;
        this.folder = new File(activity.getCacheDir(), "updates");
        // 이미 설치된 버전 이하의 파일은 지운다.
        File[] old = folder.listFiles();
        for (int i = 0; old != null && i < old.length; i++) {
            String name = old[i].getName().replaceFirst("^ChartDesk-", "").replaceFirst("\\.apk(\\.part)?$", "");
            if (!newer(name, BuildConfig.VERSION_NAME)) old[i].delete();
        }
    }

    String status() {
        return status.isEmpty() ? "ChartDesk " + BuildConfig.VERSION_NAME : status;
    }

    /** 앱을 열거나 앱으로 돌아왔을 때. 마지막 확인에서 6시간이 지났으면 확인한다. */
    void checkIfDue() {
        if (waitingForPermission && activity.getPackageManager().canRequestPackageInstalls()) {
            waitingForPermission = false;
            install();
            return;
        }
        if (System.currentTimeMillis() - lastCheck >= CHECK_EVERY_MS) check(null);
    }

    /** 지금 확인한다. 끝나면 상태 문구를 넘긴다. */
    void check(Consumer<String> done) {
        worker.execute(() -> {
            if (!busy) {
                busy = true;
                lastCheck = System.currentTimeMillis();
                try {
                    run();
                } catch (Exception error) {
                    setStatus("업데이트 확인 실패: " + error.getMessage());
                }
                busy = false;
            }
            if (done != null) done.accept(status());
        });
    }

    private void run() throws Exception {
        setStatus("업데이트 확인 중…");
        HttpURLConnection connection = (HttpURLConnection) new URL(LATEST).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "ChartDesk-Android");
        JSONObject release;
        try {
            if (connection.getResponseCode() != 200) throw new IOException("GitHub 응답 " + connection.getResponseCode());
            try (InputStream in = connection.getInputStream()) {
                release = new JSONObject(new String(LocalServer.readAll(in), StandardCharsets.UTF_8));
            }
        } finally {
            connection.disconnect();
        }
        String version = release.getString("tag_name").replaceFirst("^v", "");
        if (!newer(version, BuildConfig.VERSION_NAME)) {
            setStatus("최신 버전입니다 (" + BuildConfig.VERSION_NAME + ")");
            return;
        }
        JSONObject asset = null;
        JSONArray assets = release.getJSONArray("assets");
        for (int i = 0; i < assets.length(); i++) {
            if (assets.getJSONObject(i).getString("name").endsWith(".apk")) asset = assets.getJSONObject(i);
        }
        if (asset == null) {
            setStatus("새 버전 " + version + "이 나왔지만 안드로이드용 파일이 아직 없습니다");
            return;
        }
        File file = new File(folder, "ChartDesk-" + version + ".apk");
        long size = asset.getLong("size");
        if (!file.exists() || file.length() != size) {
            setStatus("새 버전 " + version + " 내려받는 중…");
            download(asset.getString("browser_download_url"), file, size);
        }
        ready = file;
        readyVersion = version;
        setStatus("새 버전 " + version + " 설치 준비됨");
        activity.runOnUiThread(this::ask);
    }

    private void download(String address, File file, long size) throws IOException {
        folder.mkdirs();
        File part = new File(folder, file.getName() + ".part");
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(60000);
        connection.setRequestProperty("User-Agent", "ChartDesk-Android");
        try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buffer = new byte[65536];
            int n;
            while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
        } finally {
            connection.disconnect();
        }
        if (part.length() != size) {
            part.delete();
            throw new IOException("내려받은 파일 크기가 맞지 않습니다");
        }
        if (!part.renameTo(file)) throw new IOException("파일을 저장하지 못했습니다");
    }

    private void ask() {
        if (activity.isFinishing() || ready == null) return;
        new AlertDialog.Builder(activity)
            .setTitle("ChartDesk 업데이트")
            .setMessage("새 버전 " + readyVersion + "을 내려받았습니다. 지금 설치할까요?\n(설치하면 앱이 닫힙니다. 다시 열면 새 버전입니다.)")
            .setPositiveButton("설치", (dialog, which) -> install())
            .setNegativeButton("나중에", null)
            .show();
    }

    private void install() {
        if (ready == null) return;
        // 처음 한 번은 "이 출처의 앱 설치 허용"을 켜야 한다.
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            waitingForPermission = true;
            Toast.makeText(activity, "ChartDesk가 업데이트를 설치할 수 있게 허용한 뒤 돌아오세요", Toast.LENGTH_LONG).show();
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        File file = ready;
        worker.execute(() -> {
            try {
                PackageInstaller installer = activity.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                params.setAppPackageName(activity.getPackageName());
                int id = installer.createSession(params);
                try (PackageInstaller.Session session = installer.openSession(id)) {
                    try (InputStream in = new FileInputStream(file); OutputStream out = session.openWrite("ChartDesk.apk", 0, file.length())) {
                        byte[] buffer = new byte[65536];
                        int n;
                        while ((n = in.read(buffer)) >= 0) out.write(buffer, 0, n);
                        session.fsync(out);
                    }
                    // 결과(사용자 확인 필요, 실패)는 MainActivity로 돌아온다.
                    Intent result = new Intent(activity, MainActivity.class).setAction(ACTION_INSTALL_STATUS);
                    PendingIntent pending = PendingIntent.getActivity(activity, id, result, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
                    session.commit(pending.getIntentSender());
                }
            } catch (IOException | RuntimeException error) {
                setStatus("설치 실패: " + error.getMessage());
                activity.runOnUiThread(() -> Toast.makeText(activity, status(), Toast.LENGTH_LONG).show());
            }
        });
    }

    /** 설치 과정에서 돌아온 결과. 시스템이 확인 창을 띄우라고 하면 띄운다. */
    void onInstallStatus(Intent intent) {
        int result = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (result == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @SuppressWarnings("deprecation")
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) activity.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } else if (result != PackageInstaller.STATUS_SUCCESS) {
            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            setStatus(result == PackageInstaller.STATUS_FAILURE_ABORTED ? "설치를 취소했습니다" : "설치 실패: " + message);
            Toast.makeText(activity, status(), Toast.LENGTH_LONG).show();
        }
    }

    private void setStatus(String text) {
        status = text;
    }

    /** a가 b보다 높은 버전인가. 1.2.10 > 1.2.9 */
    static boolean newer(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int left = i < x.length ? parse(x[i]) : 0;
            int right = i < y.length ? parse(y[i]) : 0;
            if (left != right) return left > right;
        }
        return false;
    }

    private static int parse(String part) {
        try {
            return Integer.parseInt(part.replaceAll("\\D.*$", ""));
        } catch (NumberFormatException bad) {
            return 0;
        }
    }

    void stop() {
        worker.shutdownNow();
    }
}
