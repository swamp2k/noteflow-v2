package cc.jeppesen.noteflow.widget;

import android.content.Context;

import java.util.List;

final class SyncEngine {
    private SyncEngine() {}

    static SyncResult syncConfigured(Context context) {
        if (!SettingsStore.isConfigured(context)) {
            return SyncResult.failure(false, "Open the app to connect NoteFlow");
        }
        return sync(context, SettingsStore.apiUrl(context), SettingsStore.token(context));
    }

    static SyncResult sync(Context context, String apiUrl, String token) {
        Context appContext = context.getApplicationContext();
        TaskCache.markSyncing(appContext);
        WidgetUpdater.refreshAll(appContext);
        try {
            List<TaskItem> tasks = NoteFlowApi.fetchTasks(apiUrl, token);
            TaskCache.saveSuccess(appContext, tasks);
            WidgetUpdater.refreshAll(appContext);
            return SyncResult.success(tasks.size());
        } catch (NoteFlowApi.ApiException error) {
            String message = safeMessage(error, "NoteFlow rejected the request");
            TaskCache.saveError(appContext, message);
            WidgetUpdater.refreshAll(appContext);
            boolean retryable = error.statusCode >= 500 || error.statusCode == 429;
            return SyncResult.failure(retryable, message);
        } catch (Exception error) {
            String message = safeMessage(error, "Could not reach NoteFlow");
            TaskCache.saveError(appContext, message);
            WidgetUpdater.refreshAll(appContext);
            return SyncResult.failure(true, message);
        }
    }

    private static String safeMessage(Exception error, String fallback) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty() ? fallback : message;
    }

    static final class SyncResult {
        final boolean success;
        final boolean retryable;
        final int taskCount;
        final String message;

        private SyncResult(boolean success, boolean retryable, int taskCount, String message) {
            this.success = success;
            this.retryable = retryable;
            this.taskCount = taskCount;
            this.message = message;
        }

        static SyncResult success(int taskCount) {
            return new SyncResult(true, false, taskCount, "Connected");
        }

        static SyncResult failure(boolean retryable, String message) {
            return new SyncResult(false, retryable, 0, message);
        }
    }
}
