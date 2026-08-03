package cc.jeppesen.noteflow.widget;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.util.TypedValue;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import java.util.ArrayList;
import java.util.List;

public final class TasksWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TasksFactory(getApplicationContext());
    }

    private static final class TasksFactory implements RemoteViewsFactory {
        private static final String[] SUBJECT_PALETTE = {
                "#7c6fa0", "#4a9eda", "#e67e22", "#27ae60",
                "#e74c3c", "#8e44ad", "#16a085"
        };

        private final Context context;
        private List<TaskItem> tasks = new ArrayList<>();

        TasksFactory(Context context) {
            this.context = context;
        }

        @Override public void onCreate() { onDataSetChanged(); }

        @Override
        public void onDataSetChanged() {
            tasks = new ArrayList<>(TaskCache.load(context));
        }

        @Override public void onDestroy() { tasks.clear(); }
        @Override public int getCount() { return tasks.size(); }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= tasks.size()) return null;
            TaskItem task = tasks.get(position);
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task_item);

            float titleSize = textSize("small", 12f, "large", 17f, 14f);
            float dueSize = textSize("small", 10f, "large", 14f, 12f);
            views.setTextViewText(R.id.task_title, task.title);
            views.setTextViewTextSize(R.id.task_title, TypedValue.COMPLEX_UNIT_SP, titleSize);
            views.setTextColor(
                    R.id.task_title,
                    task.overdue ? Color.parseColor("#ff6b6b") : Color.parseColor("#e8e8f0")
            );

            if (task.dueLabel.isBlank()) {
                views.setViewVisibility(R.id.task_due, View.GONE);
            } else {
                views.setViewVisibility(R.id.task_due, View.VISIBLE);
                views.setTextViewText(R.id.task_due, task.dueLabel);
                views.setTextViewTextSize(R.id.task_due, TypedValue.COMPLEX_UNIT_SP, dueSize);
                views.setTextColor(
                        R.id.task_due,
                        task.overdue ? Color.parseColor("#ff6b6b") : Color.parseColor("#8888a8")
                );
            }

            views.setInt(R.id.subject_dot, "setColorFilter", subjectColor(task.subject));

            String url = SettingsStore.appUrl(context) + "/#/task/" + Uri.encode(task.id);
            Intent fillInIntent = new Intent();
            fillInIntent.putExtra(DeepLinkActivity.EXTRA_URL, url);
            views.setOnClickFillInIntent(R.id.task_row, fillInIntent);
            return views;
        }

        private float textSize(String smallName, float small, String largeName, float large, float medium) {
            String value = SettingsStore.textSize(context);
            if (smallName.equals(value)) return small;
            if (largeName.equals(value)) return large;
            return medium;
        }

        private int subjectColor(String subject) {
            if (subject == null || subject.isBlank()) return Color.parseColor("#3a3a5a");
            long hash = 0;
            for (int i = 0; i < subject.length(); i++) {
                hash = ((hash * 31) + subject.charAt(i)) & 0xffffffffL;
            }
            return Color.parseColor(SUBJECT_PALETTE[(int) (hash % SUBJECT_PALETTE.length)]);
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return tasks.get(position).stableId(); }
        @Override public boolean hasStableIds() { return true; }
    }
}
