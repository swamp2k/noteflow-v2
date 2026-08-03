package cc.jeppesen.noteflow.widget;

import android.app.Activity;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private EditText apiUrlInput;
    private EditText appUrlInput;
    private EditText tokenInput;
    private Spinner textSizeSpinner;
    private TextView statusView;
    private Button saveButton;
    private Button refreshButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        apiUrlInput = findViewById(R.id.api_url);
        appUrlInput = findViewById(R.id.app_url);
        tokenInput = findViewById(R.id.widget_token);
        textSizeSpinner = findViewById(R.id.text_size);
        statusView = findViewById(R.id.status);
        saveButton = findViewById(R.id.save_test_button);
        refreshButton = findViewById(R.id.refresh_now_button);
        Button addWidgetButton = findViewById(R.id.add_widget_button);

        ArrayAdapter<CharSequence> adapter = ArrayAdapter.createFromResource(
                this,
                R.array.text_sizes,
                android.R.layout.simple_spinner_item
        );
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        textSizeSpinner.setAdapter(adapter);

        loadSettings();
        saveButton.setOnClickListener(view -> saveAndTest());
        refreshButton.setOnClickListener(view -> refreshStoredConfiguration());
        addWidgetButton.setOnClickListener(view -> requestWidgetPin());
    }

    private void loadSettings() {
        apiUrlInput.setText(SettingsStore.apiUrl(this));
        appUrlInput.setText(SettingsStore.appUrl(this));
        tokenInput.setText(SettingsStore.token(this));
        textSizeSpinner.setSelection(switch (SettingsStore.textSize(this)) {
            case "small" -> 0;
            case "large" -> 2;
            default -> 1;
        });

        if (TaskCache.lastSync(this) > 0) {
            setStatus("Connected. " + TaskCache.load(this).size() + " pending tasks cached.", true);
        }
    }

    private void saveAndTest() {
        String apiUrl = SettingsStore.normalizeUrl(apiUrlInput.getText().toString());
        String appUrl = SettingsStore.normalizeUrl(appUrlInput.getText().toString());
        String token = tokenInput.getText().toString().trim();
        String textSize = selectedTextSize();

        if (!isHttpUrl(apiUrl) || !isHttpUrl(appUrl) || token.isBlank()) {
            setStatus("Enter valid API/App URLs and a widget token.", false);
            return;
        }

        runConnectionTest(apiUrl, appUrl, token, textSize, true);
    }

    private void refreshStoredConfiguration() {
        if (!SettingsStore.isConfigured(this)) {
            setStatus("Save and test the connection first.", false);
            return;
        }
        runConnectionTest(
                SettingsStore.apiUrl(this),
                SettingsStore.appUrl(this),
                SettingsStore.token(this),
                SettingsStore.textSize(this),
                false
        );
    }

    private void runConnectionTest(
            String apiUrl,
            String appUrl,
            String token,
            String textSize,
            boolean saveSettings
    ) {
        setBusy(true);
        setStatus("Connecting to NoteFlow…", true);
        executor.execute(() -> {
            try {
                List<TaskItem> tasks = NoteFlowApi.fetchTasks(apiUrl, token);
                if (saveSettings) {
                    SettingsStore.save(this, apiUrl, appUrl, token, textSize);
                }
                TaskCache.saveSuccess(this, tasks);
                SyncScheduler.schedulePeriodic(this);
                WidgetUpdater.refreshAll(this);
                runOnUiThread(() -> {
                    setBusy(false);
                    setStatus(
                            "Connected. " + tasks.size() + " pending task"
                                    + (tasks.size() == 1 ? "" : "s") + " found.",
                            true
                    );
                });
            } catch (Exception error) {
                String message = error.getMessage();
                if (message == null || message.isBlank()) message = "Connection failed";
                String finalMessage = message;
                runOnUiThread(() -> {
                    setBusy(false);
                    setStatus(finalMessage, false);
                });
            }
        });
    }

    private void requestWidgetPin() {
        AppWidgetManager manager = AppWidgetManager.getInstance(this);
        ComponentName provider = new ComponentName(this, TasksWidgetProvider.class);
        if (manager.isRequestPinAppWidgetSupported()) {
            Intent callbackIntent = new Intent(this, MainActivity.class);
            PendingIntent callback = PendingIntent.getActivity(
                    this,
                    7001,
                    callbackIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            manager.requestPinAppWidget(provider, null, callback);
        } else {
            setStatus("Long-press the home screen, open Widgets, and choose NoteFlow Tasks.", true);
        }
    }

    private String selectedTextSize() {
        return switch (textSizeSpinner.getSelectedItemPosition()) {
            case 0 -> "small";
            case 2 -> "large";
            default -> "medium";
        };
    }

    private boolean isHttpUrl(String value) {
        return value.startsWith("https://") || value.startsWith("http://");
    }

    private void setBusy(boolean busy) {
        saveButton.setEnabled(!busy);
        refreshButton.setEnabled(!busy);
    }

    private void setStatus(String message, boolean ok) {
        statusView.setText(message);
        statusView.setTextColor(Color.parseColor(ok ? "#9bd59b" : "#ff8a8a"));
        statusView.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }
}
