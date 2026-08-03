# NoteFlow Android Widget

This directory contains the native Android replacement for the retired Expo / React Native widget.

## Architecture

- `AppWidgetProvider` and XML `RemoteViews` render the home-screen widget.
- Tasks are always rendered from an app-private persistent cache.
- The widget never performs network work while Android is asking it to draw.
- A user refresh becomes an expedited native WorkManager request on Android 12+.
- One native periodic WorkManager job refreshes the cache approximately every 30 minutes. Android may defer it while the device is idle.
- Failed requests keep the last successful task list visible and mark the widget as offline.
- Task taps and footer actions open the existing NoteFlow PWA.

The existing `GET /api/widget/tasks?token=...` endpoint is reused unchanged.

## Build

The GitHub Actions workflow builds and uploads a debug APK for widget pull requests, `agent/**` branches, and `main`.

From Android Studio, open `noteflow-widget` as a project and run the `app` configuration. From a shell with Gradle 9.4.1 and Android SDK 36 installed:

```bash
gradle :app:assembleDebug
```

The APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Install and configure

The native app keeps the old package id (`cc.jeppesen.noteflow.widget`). A debug build is not signed with the old EAS signing key, so uninstall the Expo version before installing this APK.

1. Install the APK.
2. Open **NoteFlow Widget**.
3. Paste the widget token generated in NoteFlow settings.
4. Press **Save & Test**.
5. Press **Add widget to home screen**, or add **NoteFlow Tasks** from the launcher widget picker.

No battery-optimization exemption is required.

## Next step: push invalidation

This version deliberately ships without Firebase configuration or secrets. Once the native baseline has been verified on a real phone, FCM can be added as an invalidation signal:

1. The app registers its FCM token with NoteFlow.
2. NoteFlow sends a small `tasks_changed` data message after task mutations.
3. The app enqueues the same native sync worker already used by manual and periodic refresh.
4. The periodic fallback can then be reduced from 30 minutes to six or twelve hours.

The cache, worker and widget rendering are already separated so FCM can be added without another widget rewrite.
