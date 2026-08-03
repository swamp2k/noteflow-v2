package cc.jeppesen.noteflow.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;
import java.util.Locale;

final class WidgetUpdater {
    private WidgetUpdater() {}

    static void refreshAll(Context context) {
        Context appContext = context.getApplicationContext();
        AppWidgetManager manager = AppWidgetManager.getInstance(appContext);
        ComponentName provider = new ComponentName(appContext, TasksWidgetProvider.class);
        int[] widgetIds = manager.getAppWidgetIds(provider);
        for (int widgetId : widgetIds) {
            updateWidget(appContext, manager, widgetId);
        }
        if (widgetIds.length > 0) {
            manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.task_list);
        }
    }

    static void updateWidget(Context context, AppWidgetManager manager, int widgetId) {
        List<TaskItem> tasks = TaskCache.load(context);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);

        views.setTextViewText(R.id.widget_title, "✓ NoteFlow Tasks");
        views.setTextViewText(R.id.widget_status, statusText(context, tasks.size()));

        Intent serviceIntent = new Intent(context, TasksWidgetService.class);
        serviceIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        serviceIntent.setData(Uri.parse("noteflow://widget/" + widgetId));
        views.setRemoteAdapter(R.id.task_list, serviceIntent);
        views.setEmptyView(R.id.task_list, R.id.empty_view);

        Intent refreshIntent = new Intent(context, TasksWidgetProvider.class);
        refreshIntent.setAction(TasksWidgetProvider.ACTION_REFRESH);
        refreshIntent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        PendingIntent refreshPendingIntent = PendingIntent.getBroadcast(
                context,
                widgetId * 10 + 1,
                refreshIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.refresh_button, refreshPendingIntent);

        Intent itemTemplate = new Intent(context, DeepLinkActivity.class);
        PendingIntent itemTemplatePendingIntent = PendingIntent.getActivity(
                context,
                widgetId * 10 + 2,
                itemTemplate,
                mutableUpdateFlags()
        );
        views.setPendingIntentTemplate(R.id.task_list, itemTemplatePendingIntent);

        String appUrl = SettingsStore.appUrl(context);
        views.setOnClickPendingIntent(
                R.id.new_task_button,
                openUrlPendingIntent(context, widgetId * 10 + 3, appUrl + "/#/new-task")
        );
        views.setOnClickPendingIntent(
                R.id.open_app_button,
                openUrlPendingIntent(context, widgetId * 10 + 4, appUrl + "/#/tasks")
        );

        Intent setupIntent = new Intent(context, MainActivity.class);
        PendingIntent setupPendingIntent = PendingIntent.getActivity(
                context,
                widgetId * 10 + 5,
                setupIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_header, setupPendingIntent);

        manager.updateAppWidget(widgetId, views);
    }

    private static PendingIntent openUrlPendingIntent(Context context, int requestCode, String url) {
        Intent intent = new Intent(context, DeepLinkActivity.class);
        intent.putExtra(DeepLinkActivity.EXTRA_URL, url);
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static int mutableUpdateFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return flags;
    }

    private static String statusText(Context context, int taskCount) {
        if (!SettingsStore.isConfigured(context)) return "Open app to connect";
        if (TaskCache.isSyncing(context)) return "Updating…";

        long lastSync = TaskCache.lastSync(context);
        String error = TaskCache.lastError(context);
        String updated = lastSync == 0L
                ? ""
                : "Updated " + new SimpleDateFormat("HH:mm", Locale.getDefault())
                        .format(new Date(lastSync));

        if (error != null && !error.isBlank()) {
            return updated.isBlank() ? "Offline" : "Offline • " + updated;
        }
        String count = taskCount + (taskCount == 1 ? " task" : " tasks");
        return updated.isBlank() ? count : count + " • " + updated;
    }
}
