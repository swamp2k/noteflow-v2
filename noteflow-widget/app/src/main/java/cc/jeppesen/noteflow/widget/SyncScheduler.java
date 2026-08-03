package cc.jeppesen.noteflow.widget;

import android.content.Context;

import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
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

    static void enqueueImmediate(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SyncWorker.class)
                .setConstraints(connectedNetwork())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 20, TimeUnit.SECONDS)
                .build();

        WorkManager.getInstance(context.getApplicationContext()).enqueueUniqueWork(
                IMMEDIATE_WORK,
                ExistingWorkPolicy.REPLACE,
                request
        );
    }

    static void cancelPeriodic(Context context) {
        WorkManager.getInstance(context.getApplicationContext()).cancelUniqueWork(PERIODIC_WORK);
    }
}
