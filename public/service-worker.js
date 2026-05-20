// NoteFlow Service Worker v23
// Handles: share target, offline queue, basic shell caching
const CACHE_NAME = 'noteflow-shell-v23';
const API_BASE   = 'https://noteflow-api.jeppesen.cc/api';

// ── Install: cache only the shell HTML — no external deps ────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add('/'))
      .catch(() => { /* non-fatal — proceed without cache */ })
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== 'noteflow-attachments-v1')
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: shell from cache, everything else from network ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle share target POST (Android share sheet)
  if (url.pathname === '/share-target' && request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // Only serve cached shell for the root path — let other pages (tracker.html, tagcloud.html) hit the network
  if (request.mode === 'navigate' && url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      caches.match('/').then(cached => cached || fetch(request))
    );
    return;
  }

  // Everything else (API, attachments, etc.) — network only
});

// ── Share target handler ───────────────────────────────────────────────────────
async function handleShareTarget(event) {
  let title = '', text = '', sharedUrl = '';
  try {
    const formData = await event.request.formData();
    title     = formData.get('title')  || '';
    text      = formData.get('text')   || '';
    sharedUrl = formData.get('url')    || '';
  } catch(e) {}

  // Build note content from shared data
  const parts = [title, text, sharedUrl].map(s => s.trim()).filter(Boolean);
  const content = parts.join('\n');

  // Try to post to API — if it fails (offline), queue it
  let saved = false;
  try {
    const jwt = await getJwt();
    if (jwt && content) {
      const res = await fetch(API_BASE + '/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({ content }),
      });
      saved = res.ok;
    }
  } catch(e) { /* offline — fall through to queue */ }

  if (!saved && content) {
    await queueMemo(content);
  }

  // Redirect to app after share
  return Response.redirect('/', 303);
}

// ── Offline queue (IndexedDB) ─────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('noteflow-queue', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function queueMemo(content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ content, ts: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function flushQueue(jwt) {
  const items = await getQueue();
  if (!items.length) return 0;
  let synced = 0;
  for (const item of items) {
    try {
      const res = await fetch(API_BASE + '/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({ content: item.content }),
      });
      if (res.ok) {
        await deleteFromQueue(item.id);
        synced++;
      }
    } catch(e) { break; } // still offline — stop trying
  }
  return synced;
}

// ── JWT helper: read CF Access cookie from clients ────────────────────────────
async function getJwt() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => resolve(e.data?.jwt || null);
      client.postMessage({ type: 'GET_JWT' }, [channel.port2]);
      setTimeout(() => resolve(null), 1000);
    });
  }
  return null;
}

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', async event => {
  const { type } = event.data || {};

  if (type === 'QUEUE_MEMO') {
    const { content } = event.data;
    if (content) await queueMemo(content);
    const queue = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_SIZE', size: queue.length });
  }

  if (type === 'GET_QUEUE_SIZE') {
    const queue = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_SIZE', size: queue.length });
  }

  if (type === 'SYNC_QUEUE') {
    const jwt = await getJwt();
    if (!jwt) return;
    const synced = await flushQueue(jwt);
    const remaining = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_FLUSHED', synced, remaining: remaining.length });
  }
});
