// worker/handlers/ical.js
//
// Public iCalendar feed of the user's tasks. Auth is via the existing widget
// token (same widget_tokens table the Android widget uses) passed as ?token=...
// so no session/CF Access cookie is needed — calendar clients can't authenticate.

function escIcal(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// RFC 5545 §3.1 — fold lines longer than 75 octets
function foldLine(line) {
  if (line.length <= 75) return line;
  const out = [line.slice(0, 75)];
  let i = 75;
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 74));
    i += 74;
  }
  return out.join('\r\n');
}

// "2026-06-15" → "20260615"
function toIcalDate(isoDate) {
  return isoDate.replace(/-/g, '');
}

// Returns the calendar day after isoDate as "YYYYMMDD"
// DTEND is exclusive in iCal, so an all-day event on June 15 needs DTEND June 16
function nextIcalDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Unix seconds → "YYYYMMDDTHHmmssZ" (DTSTAMP). created_at is INTEGER Unix seconds.
function toIcalStamp(unixSeconds) {
  return new Date(unixSeconds * 1000)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+/, '');
  // toISOString() always ends in Z so the Z is preserved after replacements
}

// ISO 8601 string (completed_at) → "YYYYMMDDTHHmmssZ"
function toIcalDateTime(isoString) {
  return isoString
    .replace(/[-:]/g, '')
    .replace(/\.\d+/, '')
    .replace(/Z$/, '') + 'Z';
}

export async function icalHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path !== '/api/ical/tasks.ics' || method !== 'GET') return null;

  const token = url.searchParams.get('token');
  if (!token) return new Response('token required', { status: 401 });

  // Auth via widget token — same table the Android widget uses
  const tokenRow = await env.DB.prepare(
    'SELECT user_id FROM widget_tokens WHERE token=?'
  ).bind(token).first();
  if (!tokenRow) return new Response('invalid token', { status: 403 });

  const uid = tokenRow.user_id;

  // Read user settings to check ical_include_completed
  const settingsRow = await env.DB.prepare(
    'SELECT data FROM user_settings WHERE user_id=?'
  ).bind(uid).first();
  const userSettings = settingsRow ? JSON.parse(settingsRow.data || '{}') : {};
  const includeCompleted = !!userSettings.ical_include_completed;

  // Fetch tasks that have a due_date (tasks without one have no place in a calendar)
  let sql = `
    SELECT id, content, due_date, priority, created_at, completed_at
    FROM notes
    WHERE user_id=? AND is_task=1 AND archived=0 AND due_date IS NOT NULL
  `;
  if (!includeCompleted) sql += ' AND completed_at IS NULL';
  sql += ' ORDER BY due_date ASC';

  const { results } = await env.DB.prepare(sql).bind(uid).all();

  const calLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NoteFlow//Tasks//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:NoteFlow Tasks',
    'X-WR-CALDESC:Tasks from NoteFlow',
  ];

  for (const task of results) {
    const firstLine = (task.content || '').split('\n')[0].replace(/^#+\s*/, '').trim();
    const title = firstLine || 'Task';

    const event = [
      'BEGIN:VEVENT',
      foldLine(`UID:task-${task.id}@noteflow.jeppesen.cc`),
      `DTSTAMP:${toIcalStamp(task.created_at)}`,
      `DTSTART;VALUE=DATE:${toIcalDate(task.due_date)}`,
      `DTEND;VALUE=DATE:${nextIcalDate(task.due_date)}`,
      foldLine(`SUMMARY:${escIcal(title)}`),
      `STATUS:${task.completed_at ? 'COMPLETED' : 'CONFIRMED'}`,
    ];

    // priority is repurposed as a TEXT subject/category label in this schema
    // (not a numeric priority) — expose it as CATEGORIES so calendar apps can
    // colour/group by it.
    if (task.priority) {
      event.push(foldLine(`CATEGORIES:${escIcal(task.priority)}`));
    }
    if (task.completed_at) {
      event.push(`COMPLETED:${toIcalDateTime(task.completed_at)}`);
    }

    event.push('END:VEVENT');
    calLines.push(...event);
  }

  calLines.push('END:VCALENDAR');

  return new Response(calLines.join('\r\n') + '\r\n', {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="noteflow-tasks.ics"',
      // No CDN caching — calendar clients manage their own poll schedule (every 12–24h)
      'Cache-Control': 'no-cache, no-store',
    }
  });
}
