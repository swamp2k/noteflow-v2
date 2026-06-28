import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';
import { TasksWidget } from './TasksWidget';
import { fetchTasks, getTextSize, TASKS_CACHE_KEY } from './tasksBridge';

// Identifier for the background task. Must match between defineTask and
// registerTaskAsync, and must be unique within the app.
const BACKGROUND_REFRESH_TASK = 'noteflow-widget-background-refresh';

async function getWidgetData() {
  const [tasks, textSize, appUrl, legacyUrl] = await Promise.all([
    fetchTasks(),
    getTextSize(),
    AsyncStorage.getItem('noteflow_app_url'),
    AsyncStorage.getItem('noteflow_url'),
  ]);
  // Deep links open the PWA, so use the app URL (not the API URL).
  const url = appUrl ?? legacyUrl ?? '';
  return { tasks, url, textSize };
}

registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetInfo.widgetName !== 'TasksWidget') return;
  if (widgetAction === 'WIDGET_DELETED') return;

  try {
    const { tasks, url, textSize } = await getWidgetData();
    renderWidget(React.createElement(TasksWidget, { tasks, url, textSize }));
  } catch {
    // getWidgetData() itself crashed — pull whatever we have from cache so the
    // widget doesn't go blank just because of a transient error.
    try {
      const raw = await AsyncStorage.getItem(TASKS_CACHE_KEY);
      const tasks = raw ? JSON.parse(raw) : [];
      const appUrl = (await AsyncStorage.getItem('noteflow_app_url')) ?? (await AsyncStorage.getItem('noteflow_url')) ?? '';
      renderWidget(React.createElement(TasksWidget, { tasks, url: appUrl, textSize: 'medium' }));
    } catch {
      renderWidget(React.createElement(TasksWidget, { tasks: [], url: '', textSize: 'medium' }));
    }
  }
});

// Defined at module scope, per Expo's documented requirement. This file is
// imported from app/_layout.tsx (the app's root, loaded first) and
// app/index.tsx, either of which is enough to register this definition with
// the JS runtime before registerTaskAsync() is called below.
TaskManager.defineTask(BACKGROUND_REFRESH_TASK, async () => {
  try {
    const { tasks, url, textSize } = await getWidgetData();
    await requestWidgetUpdate({
      widgetName: 'TasksWidget',
      renderWidget: () => React.createElement(TasksWidget, { tasks, url, textSize }),
      // No widgets left on the home screen — stop scheduling future wakeups.
      widgetNotFound: () => {
        BackgroundTask.unregisterTaskAsync(BACKGROUND_REFRESH_TASK).catch(() => {});
      },
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (err) {
    console.error('noteflow widget background refresh failed', err);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerWidgetRefresh() {
  // Guard against double-registration (e.g. Save & Test pressed more than once).
  const already = await TaskManager.isTaskRegisteredAsync(BACKGROUND_REFRESH_TASK);
  if (already) return;
  // minimumInterval is advisory — Android's WorkManager treats anything below
  // 15 min as 15 min, and the OS may still defer further to save battery.
  await BackgroundTask.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
    minimumInterval: 30, // minutes; matches the prior updatePeriodMillis cadence
  });
}
