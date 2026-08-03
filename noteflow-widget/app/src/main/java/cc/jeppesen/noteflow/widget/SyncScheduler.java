package cc.jeppesen.noteflow.widget;

import android.content.Context;
import android.os.Build;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import java.util.concurrent.TimeUnit;

final class SyncScheduler {
    private static final String PERIODIC_WORK = "noteflow-widget-periodic-sync";
    private static final String IMMEDIATE_WORK = "noteflow-widget-immediate-sync";

    private SyncScheduler() {}

    private static Constraints connectedNetwork() {
        return new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
    }

    static void schedulePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                SyncWorker.class,
                6,
                TimeUnit.HOURS
        )
                .setConstraints(connectedNetwork())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build();

        WorkManager.getInstance(context.getApplicationContext()).enqueueUniquePeriodicWork(
                PERIODIC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                request
        );
    }

    static void enqueueImmediate(Context context, boolean userInitiated) {
        OneTimeWorkRequest.Builder builder = new OneTimeWorkRequest.Builder(SyncWorker.class)
                .setConstraints(connectedNetwork())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS);

        // Android 12+ can run this as a true expedited JobScheduler request without
        // waking a React Native runtime or requiring a battery-optimization exemption.
        if (userInitiated && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST);
        }

        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(
                IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                builder.build()
        );
    }

    static void cancelPeriodic(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(PERIODIC_WORK);
    }
}
