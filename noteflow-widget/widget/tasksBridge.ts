import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Task {
  id: string;
  title: string;
  due: string | null;       // ISO "YYYY-MM-DD" — used for relative day math
  due_at?: number | null;   // legacy ms timestamp (fallback only)
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

// Local "today" as YYYY-MM-DD (string compare avoids timezone drift).
function todayStr(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, '0');
  const d = String(n.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Whole-day difference between a due date and today (positive = future).
function dayDiff(due: string): number {
  const [ty, tm, td] = todayStr().split('-').map(Number);
  const [dy, dm, dd] = due.split('-').map(Number);
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

export function isOverdue(due: string | null): boolean {
  if (!due) return false;
  return due < todayStr();
}

// Mirrors the PWA's relativeDue() (public/js/tasks.js): Today / N days / N wks / N mo,
// with "ago" variants for overdue dates.
export function formatDue(due: string | null): string {
  if (!due) return '';
  const diff = dayDiff(due);
  if (diff === 0) return 'Today';
  if (diff > 0) {
    if (diff === 1) return '1 day';
    if (diff <= 14) return diff + ' days';
    if (diff < 90) return Math.round(diff / 7) + ' wks';
    return Math.round(diff / 30) + ' mo';
  }
  const abs = Math.abs(diff);
  if (abs === 1) return '1 day ago';
  if (abs <= 14) return abs + ' days ago';
  if (abs < 90) return Math.round(abs / 7) + ' wks ago';
  return Math.round(abs / 30) + ' mo ago';
}
