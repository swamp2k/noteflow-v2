package cc.jeppesen.noteflow.widget;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

final class NoteFlowApi {
    private static final int CONNECT_TIMEOUT_MS = 5_000;
    private static final int READ_TIMEOUT_MS = 8_000;

    private NoteFlowApi() {}

    static List<TaskItem> fetchTasks(String apiUrl, String token) throws IOException {
        String normalized = SettingsStore.normalizeUrl(apiUrl);
        int offsetMinutes = TimeZone.getDefault().getOffset(System.currentTimeMillis()) / 60000;
        String endpoint = normalized + "/api/widget/tasks?token="
                + URLEncoder.encode(token, "UTF-8")
                + "&tzoffset=" + offsetMinutes;

        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "NoteFlow-Android-Widget/2.0");
        connection.setUseCaches(false);

        try {
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String body = readBody(stream);

            if (status < 200 || status >= 300) {
                String message = "API returned " + status;
                try {
                    String apiMessage = new JSONObject(body).optString("error", "");
                    if (!isBlank(apiMessage)) message += ": " + apiMessage;
                } catch (Exception ignored) {
                    // Preserve the status-only error.
                }
                throw new ApiException(status, message);
            }

            JSONArray array = parseTasksArray(body);
            List<TaskItem> tasks = new ArrayList<>();
            if (array == null) return tasks;

            for (int i = 0; i < array.length(); i++) {
                JSONObject json = array.optJSONObject(i);
                if (json == null) continue;
                String dueLabel = json.optString("due_label", "");
                boolean overdue = json.optBoolean("overdue", false);
                if (isBlank(dueLabel)) {
                    DueInfo fallback = dueInfo(json.optString("due", ""));
                    dueLabel = fallback.label;
                    overdue = fallback.overdue;
                }
                tasks.add(new TaskItem(
                        json.optString("id", ""),
                        json.optString("title", "(no title)"),
                        dueLabel,
                        overdue,
                        json.optString("subject", "")
                ));
            }
            return tasks;
        } finally {
            connection.disconnect();
        }
    }

    private static JSONArray parseTasksArray(String body) throws IOException {
        try {
            return new JSONObject(body).optJSONArray("tasks");
        } catch (JSONException error) {
            throw new IOException("NoteFlow returned invalid JSON", error);
        }
    }

    private static String readBody(InputStream stream) throws IOException {
        if (stream == null) return "";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }

    private static DueInfo dueInfo(String due) {
        if (isBlank(due)) return new DueInfo("", false);
        try {
            long diff = ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(due));
            if (diff == 0) return new DueInfo("Today", false);
            if (diff > 0) {
                if (diff == 1) return new DueInfo("1 day", false);
                if (diff <= 14) return new DueInfo(diff + " days", false);
                if (diff < 90) return new DueInfo(Math.round(diff / 7.0) + " wks", false);
                return new DueInfo(Math.round(diff / 30.0) + " mo", false);
            }
            long absolute = Math.abs(diff);
            if (absolute == 1) return new DueInfo("1 day ago", true);
            if (absolute <= 14) return new DueInfo(absolute + " days ago", true);
            if (absolute < 90) return new DueInfo(Math.round(absolute / 7.0) + " wks ago", true);
            return new DueInfo(Math.round(absolute / 30.0) + " mo ago", true);
        } catch (Exception ignored) {
            return new DueInfo("", false);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    static final class ApiException extends IOException {
        final int statusCode;

        ApiException(int statusCode, String message) {
            super(message);
            this.statusCode = statusCode;
        }
    }

    private static final class DueInfo {
        final String label;
        final boolean overdue;

        DueInfo(String label, boolean overdue) {
            this.label = label;
            this.overdue = overdue;
        }
    }
}
