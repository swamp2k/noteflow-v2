import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { TasksWidget } from './TasksWidget';
import { fetchTasks } from './tasksBridge';

async function getWidgetData() {
  const tasks = await fetchTasks();
  // Deep links open the PWA, so use the app URL (not the API URL).
  const url =
    (await AsyncStorage.getItem('noteflow_app_url')) ??
    (await AsyncStorage.getItem('noteflow_url')) ??
    '';
  return { tasks, url };
}

registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetInfo.widgetName !== 'TasksWidget') return;
  if (widgetAction === 'WIDGET_DELETED') return;

  const { tasks, url } = await getWidgetData();
  renderWidget(React.createElement(TasksWidget, { tasks, url }));
});

export async function registerWidgetRefresh() {
  // No-op: widget refresh handled by Android via updatePeriodMillis in app.json
}
