package com.sunya0804.chartdesk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * 켜진 가격 알림이 있는 동안 띄워 두는 포그라운드 서비스. 하는 일은 없고, 상단에 "가격 알림 확인 중"을 보여 주면서
 * 앱을 내려도 시스템이 앱(과 그 안의 화면, 알림 확인)을 정리하지 않게 붙잡아 둔다.
 * 최근 앱 목록에서 앱을 밀어 닫으면 화면이 사라지므로 이 서비스도 함께 멈춘다.
 */
public class AlertService extends Service {
    private static final String CHANNEL = "watching";
    private static final int ID = 1001;

    static void start(Context context) {
        context.startForegroundService(new Intent(context, AlertService.class));
    }

    static void stop(Context context) {
        context.stopService(new Intent(context, AlertService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        // 소리 없이 조용히 떠 있는 알림. 실제 가격 알림은 MainActivity의 "가격 알림" 채널로 따로 온다.
        notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "알림 확인 중 표시", NotificationManager.IMPORTANCE_LOW));
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Notification notification = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("ChartDesk 가격 알림 확인 중")
            .setContentText("켜 둔 알림을 앱을 내린 뒤에도 계속 확인합니다. 최근 앱에서 밀어 닫으면 멈춥니다.")
            .setOngoing(true)
            .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE))
            .build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(ID, notification);
        // 프로세스가 죽으면 화면도 없으니 다시 살리지 않는다.
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
