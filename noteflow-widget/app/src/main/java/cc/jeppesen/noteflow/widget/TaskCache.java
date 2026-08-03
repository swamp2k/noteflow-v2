package cc.jeppesen.noteflow.widget;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class TaskCache {
    private static final String PREFS = "noteflow_widget";
    private static final String KEY_TASKS = "tasks_cache";
    private static final String KEY_LAST_SYNC = "last_sync";
    private static final String KEY_LAST_ERROR = "last_error";
    private static final String KEY_SYNCING = "syncing";

    private TaskCache() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static List<TaskItem> load(Context context) {
        String raw = prefs(context).getString(KEY_TASKS, "[]");
        try {
            JSONArray array = new JSONArray(raw);
            List<TaskItem> tasks = new ArrayList<>(array.length());
            for (int i = 0; i < array.length(); i++) {
                JSONObject json = array.optJSONObject(i);
                if (json != null) tasks.add(TaskItem.fromCacheJson(json));
            }
            return tasks;
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    static void saveSuccess(Context context, List<TaskItem> tasks) {
        JSONArray array = new JSONArray();
        for (TaskItem task : tasks) {
            try {
                array.put(task.toJson());
            } catch (Exception ignored) {
                // Skip malformed cache entries rather than losing the whole list.
            }
        }
        prefs(context).edit()
                .putString(KEY_TASKS, array.toString())
                .putLong(KEY_LAST_SYNC, System.currentTimeMillis())
                .putString(KEY_LAST_ERROR, "")
                .putBoolean(KEY_SYNCING, false)
                .apply();
    }

    static void markSyncing(Context context) {
        prefs(context).edit().putBoolean(KEY_SYNCING, true).apply();
    }

    static void saveError(Context context, String message) {
        prefs(context).edit()
                .putString(KEY_LAST_ERROR, message == null ? "Sync failed" : message)
                .putBoolean(KEY_SYNCING, false)
                .apply();
    }

    static long lastSync(Context context) {
        return prefs(context).getLong(KEY_LAST_SYNC, 0L);
    }

    static String lastError(Context context) {
        return prefs(context).getString(KEY_LAST_ERROR, "");
    }

    static boolean isSyncing(Context context) {
        return prefs(context).getBoolean(KEY_SYNCING, false);
    }
}
