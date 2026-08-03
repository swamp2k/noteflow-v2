package cc.jeppesen.noteflow.widget;

import android.content.Context;

import androidx.work.Worker;
import androidx.work.WorkerParameters;

public final class SyncWorker extends Worker {
    public SyncWorker(Context context, WorkerParameters parameters) {
        super(context, parameters);
    }

    @Override
    public Result doWork() {
        SyncEngine.SyncResult result = SyncEngine.syncConfigured(getApplicationContext());
        if (result.success) return Result.success();
        return result.retryable ? Result.retry() : Result.failure();
    }
}
