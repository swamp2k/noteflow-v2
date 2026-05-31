import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerWidgetTaskHandler, requestWidgetUpdate } from 'react-native-android-widget';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { TasksWidget } from './TasksWidget';
import { fetchTasks } from './tasksBridge';

export const WIDGET_REFRESH_TASK = 'noteflow-widget-refresh';

async function getWidgetData() {
  const tasks = await fetchTasks();
  const url = (await AsyncStorage.getItem('noteflow_url')) ?? '';
  return { tasks, url };
}

// Handles all widget lifecycle events: added, updated, clicked, etc.
// 0.17.x API: renderWidget callback is passed in, not returned
registerWidgetTaskHandler(async ({ widgetInfo, widgetAction, renderWidget }) => {
  if (widgetInfo.widgetName !== 'TasksWidget') return;
  if (widgetAction === 'WIDGET_DELETED') return;

  const { tasks, url } = await getWidgetData();
  renderWidget(React.createElement(TasksWidget, { tasks, url }));
});

// Background task — fetches tasks and triggers widget re-render
TaskManager.defineTask(WIDGET_REFRESH_TASK, async () => {
  try {
    const { tasks, url } = await getWidgetData();
    await requestWidgetUpdate({
      widgetName: 'TasksWidget',
      renderWidget: () => React.createElement(TasksWidget, { tasks, url }),
    });
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerWidgetRefresh() {
  try {
    await BackgroundFetch.registerTaskAsync(WIDGET_REFRESH_TASK, {
      minimumInterval: 15 * 60, // 15 minutes (Android may batch to 30 min)
      stopOnTerminate: false,
      startOnBoot: true,
    });
  } catch (e) {
    console.warn('BackgroundFetch registration failed:', e);
  }
}
