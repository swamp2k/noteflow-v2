import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  due_at: number | null;
  subject: string | null;
}

export type TextSize = 'small' | 'medium' | 'large';

export async function fetchTasks(): Promise<Task[]> {
  // Tasks are fetched from the API URL (falls back to the legacy single-URL key).
  const url =
    (await AsyncStorage.getItem('noteflow_api_url')) ??
    (await AsyncStorage.getItem('noteflow_url'));
  const token = await AsyncStorage.getItem('noteflow_token');
  if (!url || !token) return [];
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(`${url}/api/widget/tasks?token=${encodeURIComponent(token)}`, {
      signal: ctrl.signal,
    }).finally(() => clearTimeout(tid));
    if (!r.ok) return [];
    const data = await r.json();
    return data.tasks ?? [];
  } catch {
    return [];
  }
}

export async function getTextSize(): Promise<TextSize> {
  const saved = await AsyncStorage.getItem('noteflow_text_size');
  if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
  return 'medium';
}

export function isOverdue(due_at: number | null): boolean {
  if (!due_at) return false;
  return due_at < new Date().setHours(0, 0, 0, 0);
}

export function formatDue(due_at: number | null): string {
  if (!due_at) return '';
  const d = new Date(due_at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff < 7) return d.toLocaleDateString('en', { weekday: 'short' }).toLowerCase();
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
