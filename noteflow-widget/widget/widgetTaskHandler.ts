import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { TasksWidget } from './TasksWidget';
import { fetchTasks, getTextSize } from './tasksBridge';

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
    // Render an empty widget on failure rather than crashing the headless task
    renderWidget(React.createElement(TasksWidget, { tasks: [], url: '', textSize: 'medium' }));
  }
});

export async function registerWidgetRefresh() {
  // No-op: widget refresh is triggered by Android via updatePeriodMillis in app.json.
  // The widget task handler above handles all update events (WIDGET_UPDATE, WIDGET_ADDED, etc.).
}
