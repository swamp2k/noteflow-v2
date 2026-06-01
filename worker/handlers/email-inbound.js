import PostalMime from 'postal-mime';
import { nanoid } from '../lib/utils.js';

export async function handleInboundEmail(message, env) {
  const rawEmail = new Response(message.raw);
  const parser = new PostalMime();
  const email = await parser.parse(await rawEmail.arrayBuffer());

  const from = message.from || '';
  const subject = email.subject || '(No subject)';

  const { results: allSettings } = await env.DB.prepare(
    'SELECT user_id, data FROM user_settings'
  ).all();

  let userId = null;
  for (const row of allSettings) {
    try {
      const s = JSON.parse(row.data || '{}');
      const approved = (s.emailTaskApprovedSenders || '')
        .split(/[\n,]/)
        .map(e => e.trim().toLowerCase())
        .filter(Boolean);
      if (approved.includes(from.toLowerCase())) {
        userId = row.user_id;
        break;
      }
    } catch {}
  }

  if (!userId) {
    message.setReject('Not authorized');
    return;
  }

  const body = email.text
    ? email.text.trim()
    : email.html
      ? email.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : '';

  const content = [
    `# ${subject}`,
    '',
    body,
    '',
    `> Forwarded from: ${from}`,
  ].filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();

  const noteId = nanoid('n_');
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    'INSERT INTO notes (id, user_id, content, visibility, is_task, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(noteId, userId, content, 'PRIVATE', 1, now, now).run();

  await env.DB.prepare(
    'INSERT OR IGNORE INTO note_tags (note_id, tag, user_id) VALUES (?, ?, ?)'
  ).bind(noteId, 'email-task', userId).run();

  for (const att of email.attachments || []) {
    if (!att.content || !att.filename) continue;
    try {
      const attId = nanoid('a_');
      const mimeType = att.mimeType || 'application/octet-stream';
      const r2Key = `${userId}/${noteId}/${attId}/${att.filename}`;
      const bytes = att.content instanceof Uint8Array
        ? att.content
        : new Uint8Array(att.content);

      await env.ATTACHMENTS.put(r2Key, bytes, {
        httpMetadata: { contentType: mimeType },
        customMetadata: { filename: att.filename, userId, noteId },
      });

      await env.DB.prepare(
        'INSERT INTO attachments (id, note_id, user_id, filename, mime_type, size_bytes, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(attId, noteId, userId, att.filename, mimeType, bytes.length, r2Key).run();
    } catch (e) {
      console.error('email-inbound: attachment upload failed', att.filename, e.message);
    }
  }
}
