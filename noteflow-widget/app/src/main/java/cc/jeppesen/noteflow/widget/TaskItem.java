package cc.jeppesen.noteflow.widget;

import org.json.JSONException;
import org.json.JSONObject;

final class TaskItem {
    final String id;
    final String title;
    final String dueLabel;
    final boolean overdue;
    final String subject;

    TaskItem(String id, String title, String dueLabel, boolean overdue, String subject) {
        this.id = id == null ? "" : id;
        this.title = isBlank(title) ? "(no title)" : title;
        this.dueLabel = dueLabel == null ? "" : dueLabel;
        this.overdue = overdue;
        this.subject = subject == null ? "" : subject;
    }

    static TaskItem fromApiJson(JSONObject json) {
        return new TaskItem(
                json.optString("id", ""),
                json.optString("title", "(no title)"),
                json.optString("due_label", ""),
                json.optBoolean("overdue", false),
                json.optString("subject", "")
        );
    }

    static TaskItem fromCacheJson(JSONObject json) {
        return fromApiJson(json);
    }

    JSONObject toJson() throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", id);
        json.put("title", title);
        json.put("due_label", dueLabel);
        json.put("overdue", overdue);
        json.put("subject", subject);
        return json;
    }

    int stableId() {
        return id.hashCode();
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
