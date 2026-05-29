// Build the serving URL for a NoteFlow v2 attachment
// Structure: { id: "a_abc123", filename: "image.png", mime_type: "image/png" }
// Served at: /api/attachments/:id
function attachmentUrl(att) {
  if (!att) return '';
  return API_BASE + '/attachments/' + att.id;
}

// Check if an attachment is an image based on its MIME type or filename
function isImageAttachment(att) {
  if (!att) return false;
  const mime = (att.mime_type || att.type || '').toLowerCase();
  if (mime && mime.startsWith('image/')) return true;
  const fn = (att.filename || '').toLowerCase();
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)$/.test(fn);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fileIcon(mime) {
  if (mime.startsWith('image/'))  return '🖼️';
  if (mime.startsWith('video/'))  return '🎥';
  if (mime.startsWith('audio/'))  return '🎵';
  if (mime.startsWith('text/'))   return '📝';
  if (mime.includes('pdf'))       return '📄';
  if (mime.includes('wordprocessingml') || mime.includes('msword'))          return '📝';
  if (mime.includes('spreadsheetml') || mime.includes('excel'))              return '📊';
  if (mime.includes('presentationml') || mime.includes('powerpoint'))        return '📊';
  if (mime.includes('opendocument.text'))                                     return '📝';
  if (mime.includes('opendocument.spreadsheet'))                              return '📊';
  if (mime.includes('opendocument.presentation'))                             return '📊';
  if (mime.includes('zip') || mime.includes('archive') || mime.includes('compressed')) return '🗜️';
  return '📎';
}

// ── Activity Log ──────────────────────────────────────────────────────────────
function toast(msg, duration = 2200) {
  _activityLog.push({ ts: new Date(), msg: String(msg) });
  if (_activityLog.length > LOG_MAX) _activityLog.shift();
  _logUnreadCount++;
  _updateLogBadge();
}
function _updateLogBadge() {
  const badge = document.getElementById('log-badge');
  if (!badge) return;
  badge.textContent = _logUnreadCount;
  badge.style.display = _logUnreadCount > 0 ? 'inline-flex' : 'none';
}

// ── Date ──────────────────────────────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000)    return 'just now';
  if (diff < 3600000)  return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  if (diff < 604800000) return d.toLocaleDateString('da-DK', { weekday:'short', hour:'2-digit', minute:'2-digit' });
  return d.toLocaleDateString('da-DK', { day:'numeric', month:'short', year: d.getFullYear()!==now.getFullYear()?'numeric':undefined });
}
