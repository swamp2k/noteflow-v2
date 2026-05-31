function getCFToken() {
  const match = document.cookie.match(/CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}
function authHeaders(extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  const token = getCFToken();
  if (token) h['Authorization'] = 'Bearer ' + token;
  return h;
}

async function apiGet(path) {
  const r = await fetch(API_BASE + path, {
    credentials: 'omit',
    headers: authHeaders()
  });
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
  return r.json();
}
async function apiPatch(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'PATCH', credentials: 'omit',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('PATCH ' + r.status);
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST', credentials: 'omit',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('POST ' + r.status);
  return r.json();
}
async function apiDelete(path) {
  const r = await fetch(API_BASE + path, {
    method: 'DELETE', credentials: 'omit',
    headers: authHeaders()
  });
  if (!r.ok) throw new Error('DELETE ' + r.status);
  return r.json();
}
async function uploadAttachment(file, noteId) {
  const token = getCFToken();
  const headers = { 'Content-Type': file.type || 'application/octet-stream' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const params = new URLSearchParams({ note_id: noteId, filename: file.name });
  const r = await fetch(API_BASE + '/attachments?' + params, {
    method: 'POST',
    credentials: 'omit',
    headers,
    body: file,
  });
  if (!r.ok) throw new Error('POST ' + r.status);
  return r.json();
}
