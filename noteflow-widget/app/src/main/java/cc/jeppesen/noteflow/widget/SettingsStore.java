package cc.jeppesen.noteflow.widget;

import android.content.Context;
import android.content.SharedPreferences;

final class SettingsStore {
    private static final String PREFS = "noteflow_widget";
    private static final String KEY_API_URL = "api_url";
    private static final String KEY_APP_URL = "app_url";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_TEXT_SIZE = "text_size";

    static final String DEFAULT_API_URL = "https://noteflow-api.jeppesen.cc";
    static final String DEFAULT_APP_URL = "https://notes.jeppesen.cc";

    private SettingsStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String apiUrl(Context context) {
        return prefs(context).getString(KEY_API_URL, DEFAULT_API_URL);
    }

    static String appUrl(Context context) {
        return prefs(context).getString(KEY_APP_URL, DEFAULT_APP_URL);
    }

    static String token(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    static String textSize(Context context) {
        String value = prefs(context).getString(KEY_TEXT_SIZE, "medium");
        if (!"small".equals(value) && !"large".equals(value)) return "medium";
        return value;
    }

    static boolean isConfigured(Context context) {
        return !token(context).isBlank() && !apiUrl(context).isBlank() && !appUrl(context).isBlank();
    }

    static void save(Context context, String apiUrl, String appUrl, String token, String textSize) {
        prefs(context).edit()
                .putString(KEY_API_URL, normalizeUrl(apiUrl))
                .putString(KEY_APP_URL, normalizeUrl(appUrl))
                .putString(KEY_TOKEN, token.trim())
                .putString(KEY_TEXT_SIZE, textSize)
                .apply();
    }

    static String normalizeUrl(String value) {
        String normalized = value == null ? "" : value.trim();
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }
}
