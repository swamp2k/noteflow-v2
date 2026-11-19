// NoteFlow Service Worker v27
// Handles: share target, offline queue, basic shell caching
const CACHE_NAME = 'noteflow-shell-v27';
const SHARE_CACHE_NAME = 'noteflow-shares-v1';
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
          .filter(k => k !== CACHE_NAME && k !== SHARE_CACHE_NAME && k !== 'noteflow-attachments-v1')
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

  // Only intercept the root path — let other pages (tracker.html, tagcloud.html) hit the network.
  // Network-first: the shell's markup can change on deploy without service-worker.js itself
  // changing, so a stale cache-first response would silently keep serving an outdated DOM
  // (e.g. missing newly-added elements) until the SW byte-diffs and reinstalls. Only fall
  // back to the cache when the network is unavailable (offline).
  if (request.mode === 'navigate' && url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }

  // Everything else (API, attachments, etc.) — network only
});

// ── Share target handler ───────────────────────────────────────────────────────
async function handleShareTarget(event) {
  const destination = new URL('/', event.request.url);
  let content;
  try {
    const formData = await event.request.formData();
    const files = formData.getAll('files').filter(value => value instanceof File);
    content = ['title', 'text', 'url']
      .map(field => formData.get(field))
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean)
      .join('\n');

    if (files.length) {
      const shareId = crypto.randomUUID();
      const payload = new FormData();
      payload.set('content', content);
      for (const file of files) payload.append('files', file);
      const cache = await caches.open(SHARE_CACHE_NAME);
      await cache.put(new URL('/__share_pending__/' + shareId, destination), new Response(payload));
      destination.searchParams.set('share', shareId);
      return Response.redirect(destination, 303);
    }
  } catch (error) {
    console.error('Could not receive share:', error);
    destination.searchParams.set('share', 'error');
    return Response.redirect(destination, 303);
  }

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
  return Response.redirect(destination, 303);
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

// ── Push notification handler ─────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'NoteFlow Tasks', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      data:  { url: data.url || 'https://notes.jeppesen.cc/?v=tasks' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'https://notes.jeppesen.cc/?v=tasks';
  event.waitUntil(clients.openWindow(targetUrl));
});

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
