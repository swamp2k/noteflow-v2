package cc.jeppesen.noteflow.widget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public final class DeepLinkActivity extends Activity {
    static final String EXTRA_URL = "url";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        String value = getIntent().getStringExtra(EXTRA_URL);
        if (value != null) {
            Uri uri = Uri.parse(value);
            String scheme = uri.getScheme();
            if ("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // No browser is available. The setup app remains the fallback.
                }
            }
        }
        finish();
    }
}
