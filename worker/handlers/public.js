import { json, err, corsHeaders } from "../lib/utils.js";

const SERVICE_WORKER_JS = `// NoteFlow Service Worker v23
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

  // Only cache-first for same-origin navigation (the shell HTML)
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
  const content = parts.join('\\n');

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
`;

export async function publicHandler(request, env, ctx, url, path, method, userId, origin) {
  if (url.pathname === "/service-worker.js") {
    return new Response(SERVICE_WORKER_JS, {
      headers:{"Content-Type":"application/javascript","Cache-Control":"no-cache","Access-Control-Allow-Origin":"*","Service-Worker-Allowed":"/"}
    });
  }
  if (url.pathname === "/icon-192.png" || url.pathname === "/pwa/icon-192.png") {
    const b = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAADdUlEQVR42u3cMW9SURjH4XtP3GF1ca6rCw5+CWdI01X4OAZcjaHfxKFdnEzs7NIVFlccOmgaCXBBwj3/51kcFXh/5z1XqW1zRuPpatPADreLYXuu36s18CQH0Rp6kmNoDT7JIbQGn+QQiuGnz46dwdbgk7wNiuEneRsUw09yBMXwkxxBMfwkR1AMP8kRFMNPcgTF8JMcQfH2kKw4/UneAsXwkxyBKxCuQE5/UreADYAN4PQndQvYANgAEB2A6w+p1yAbABsABACBWvd/bAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAcAleeAu2W84H6xpex2S2Hvg0/83/DFf58AtBAPGDLwLPAIQELgDD4XUKwFB4vQIAAYAAQAAgABAACAAEgABAACAAEAAIAAQA9fMzwR1MZuuvl/jnWs4H73w6NgDYAE5abAAQAAgABAACAAGAAEAACAAEAAIAAYAAIIJvg3bg5wFsALABUjlpbQAQAAgABAACAAGAAEAAIAAQAAiA3lhe3zymvFbfBeqg1m+D/j34y+ubx8mXzy9tAJz6NgCnPGn7MvgJW8AGcOpHbwYbINH9+1/eBBsgc/A7DH/NW0AATv3oCFyBDL4rEIY/dQsIwF0/OgJXICe+KxCGP3UL2AAG/yC1/cuwDWD4Y4ffBujr3H96/TB6c/XK4Asg0ujDj6tzRODr0MRKGH4bwBaIHXwBPP/gZ+vBcj5YO/GzuAL1fQt8e/hp+Ltrx9PVxij90cct0PUqlDz4rkDBVyGD7wq0M4Jar0KG3waI3AQGXwCVb4K7UdO8vX/+LGDwXYFyAzb8NkCSj9+ftsDTr+zDX4PiCgQCAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAHAiQO4XQxbbwOJbhfD1gbAFQgEAKkBeA4g8f5vA2ADeAsQgGsQgdcfGwAbYFsZUPvpbwNgA+wqBGo9/bduABGQMPyuQLgCHVoM1HL679wAIqDm4d/rCiQCah3+vZ8BRECNw3/QQ7AIqG34DwpABNQ2/AcHIAJqGv6maZqjhnk8XW287fRx8DtvANuAWob/6A1gG9DXwT95AEKgT4P/3wIQA5c+9GcLQBBc+rPlb2EqUvGbW/T9AAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
    return new Response(b, { headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"} });
  }
  if (url.pathname === "/icon-512.png" || url.pathname === "/pwa/icon-512.png") {
    const b = Uint8Array.from(atob("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"), c => c.charCodeAt(0));
    return new Response(b, { headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"} });
  }
  if (url.pathname === "/pwa/manifest.json") {
    const manifest = { id:"/", name:"NoteFlow", short_name:"NoteFlow", description:"Your personal note capture app", start_url:"https://notes.jeppesen.cc/", scope:"https://notes.jeppesen.cc/", display:"standalone", orientation:"portrait", background_color:"#f5f4f0", theme_color:"#5b6af0", icons:[{src:"https://noteflow-api.jeppesen.cc/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any maskable"},{src:"https://noteflow-api.jeppesen.cc/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any maskable"}], shortcuts:[{name:"New Note",short_name:"New Note",description:"Compose a new note",url:"https://notes.jeppesen.cc/#/new-note",icons:[{src:"https://noteflow-api.jeppesen.cc/icon-192.png",sizes:"192x192",type:"image/png"}]},{name:"Tasks",short_name:"Tasks",description:"Open your tasks",url:"https://notes.jeppesen.cc/#/tasks",icons:[{src:"https://noteflow-api.jeppesen.cc/icon-192.png",sizes:"192x192",type:"image/png"}]},{name:"New Task",short_name:"New Task",description:"Add a new task",url:"https://notes.jeppesen.cc/#/new-task",icons:[{src:"https://noteflow-api.jeppesen.cc/icon-192.png",sizes:"192x192",type:"image/png"}]}], share_target:{action:"https://notes.jeppesen.cc/share-target",method:"POST",enctype:"multipart/form-data",params:{title:"title",text:"text",url:"url",files:[{name:"files",accept:["*/*"]}]}}, categories:["productivity","utilities"] };
    return new Response(JSON.stringify(manifest), { headers:{"Content-Type":"application/manifest+json","Access-Control-Allow-Origin":"*","Cache-Control":"public, max-age=3600"} });
  }
  if (url.pathname.startsWith("/pwa/") || url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") return fetch("https://memos-api.jeppesen.cc" + url.pathname);
  const pubMatch = url.pathname.match(/^\/api\/public\/notes\/([^/]+)$/);
  if (pubMatch && request.method === "GET") {
    const note = await env.DB.prepare("SELECT n.id,n.content,n.created_at FROM notes n WHERE n.id=? AND n.visibility='PUBLIC'").bind(pubMatch[1]).first();
    if (!note) return err("Not found", 404, origin);
    const { results: attachments } = await env.DB.prepare("SELECT id,filename,mime_type FROM attachments WHERE note_id=?").bind(pubMatch[1]).all();
    return json({ id:note.id, content:note.content, created_at:note.created_at, attachments }, 200, origin);
  }
  const pubAttMatch = url.pathname.match(/^\/api\/public\/attachments\/([^/]+)$/);
  if (pubAttMatch && request.method === "GET") {
    const att = await env.DB.prepare("SELECT a.r2_key,a.mime_type,a.filename FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.visibility='PUBLIC'").bind(pubAttMatch[1]).first();
    if (!att) return err("Not found", 404, origin);
    const obj = await env.ATTACHMENTS.get(att.r2_key);
    if (!obj) return err("Not found", 404, origin);
    return new Response(obj.body, { headers:{"Content-Type":att.mime_type||"application/octet-stream","Cache-Control":"public, max-age=3600",...corsHeaders(origin)} });
  }

  return null;
}
