import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  due_at: number | null;
  priority: 'high' | 'medium' | 'low';
  category: string;
  status: string;
}

export async function fetchTasks(): Promise<Task[]> {
  const url = await AsyncStorage.getItem('noteflow_url');
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

export function priorityDot(priority: string): string {
  return ({ high: '🔴', medium: '🟡', low: '🟢' } as Record<string, string>)[priority] ?? '⚪';
}
