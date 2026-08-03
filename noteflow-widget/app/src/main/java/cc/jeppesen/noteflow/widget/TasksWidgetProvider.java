package cc.jeppesen.noteflow.widget;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;

public final class TasksWidgetProvider extends AppWidgetProvider {
    static final String ACTION_REFRESH = "cc.jeppesen.noteflow.widget.ACTION_REFRESH";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (ACTION_REFRESH.equals(intent.getAction())) {
            // The worker marks the cache as syncing only when Android actually starts it.
            // This prevents an offline, network-constrained request from leaving the
            // widget stuck on "Updating…" while it waits in WorkManager's queue.
            SyncScheduler.enqueueImmediate(context, true);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] widgetIds) {
        for (int widgetId : widgetIds) {
            WidgetUpdater.updateWidget(context, manager, widgetId);
        }
        manager.notifyAppWidgetViewDataChanged(widgetIds, R.id.task_list);
        if (SettingsStore.isConfigured(context) && TaskCache.load(context).isEmpty()) {
            SyncScheduler.enqueueImmediate(context, false);
        }
    }

    @Override
    public void onEnabled(Context context) {
        SyncScheduler.schedulePeriodic(context);
        if (SettingsStore.isConfigured(context)) {
            SyncScheduler.enqueueImmediate(context, false);
        }
    }

    @Override
    public void onDisabled(Context context) {
        SyncScheduler.cancelPeriodic(context);
    }
}
