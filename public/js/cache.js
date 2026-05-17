function getCachedVersion() {
  try { return parseInt(localStorage.getItem(NOTES_CACHE_VERSION) || '0', 10); } catch(e) { return 0; }
}
function setCachedVersion(v) {
  try { localStorage.setItem(NOTES_CACHE_VERSION, String(v)); } catch(e) {}
}
function clearNotesCache() {
  try { localStorage.removeItem(NOTES_CACHE_KEY); localStorage.removeItem(NOTES_CACHE_VERSION); } catch(e) {}
}
// Run in background after boot — if server version differs, wipe stale cache
async function checkCacheVersion() {
  try {
    const data = await apiGet('/notes/version');
    const serverVersion = data.version || 0;
    const localVersion  = getCachedVersion();
    if (serverVersion !== localVersion) {
      clearNotesCache();
      setCachedVersion(serverVersion);
    }
  } catch(e) { /* silent — version check is best-effort */ }
}

function saveNotesCache(notes, serverVersion) {
  try {
    localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(notes));
    if (serverVersion !== undefined) setCachedVersion(serverVersion);
  } catch(e) {}
}
function loadNotesCache() {
  try { return JSON.parse(localStorage.getItem(NOTES_CACHE_KEY)) || []; } catch(e) { return []; }
}

// Fetch image blob — checks offline cache first, then network (and caches if setting enabled)
async function getAttachmentBlob(att, url) {
  const cacheKey = new Request('/offline-att/' + att.id);
  try {
    const cache = await caches.open(ATT_CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) return cached.blob();
    const res = await fetch(url, { credentials: 'omit', headers: authHeaders() });
    if (!res.ok) throw new Error(res.status);
    if (settings.offlineCacheAttachments) cache.put(cacheKey, res.clone());
    return res.blob();
  } catch(e) {
    throw e;
  }
}

// Background: fetch all notes within offlineDays window and optionally pre-cache attachments
async function prefetchOfflineCache() {
  if (_prefetchRunning || !settings.offlineDays || !navigator.onLine) return;
  _prefetchRunning = true;

  // Show progress indicator
  toast('Syncing offline cache...', null);

  try {
    const cutoffSecs = settings.offlineDays === -1 ? 0 : Math.floor(Date.now() / 1000) - settings.offlineDays * 86400;
    let allNotes = [];
    let cursor = null;
    let done = false;

    // 1. Fetch by date interval
    while (!done) {
      const qs = new URLSearchParams({ pageSize: 100 });
      if (cursor) qs.set('cursor', cursor);
      const data = await apiGet('/notes?' + qs);
      const notes = data.notes || [];
      if (notes.length === 0) { done = true; break; }

      for (const note of notes) {
        if (cutoffSecs > 0 && (note.created_at || 0) < cutoffSecs) { done = true; break; }
        allNotes.push(note);
      }
      cursor = data.nextCursor || null;
      if (!cursor) done = true;
      if (allNotes.length > 0) {
        toast('Syncing offline cache: ' + allNotes.length + ' notes...', null);
      }
    }

    // 2. Fetch specific 'keep-offline' notes if we weren't already fetching 'All'
    if (settings.offlineDays !== -1) {
      cursor = null; done = false;
      while (!done) {
        const qs = new URLSearchParams({ pageSize: 100, tag: 'keep-offline' });
        if (cursor) qs.set('cursor', cursor);
        const data = await apiGet('/notes?' + qs);
        const notes = data.notes || [];
        if (notes.length === 0) { done = true; break; }

        const existingIds = new Set(allNotes.map(n => n.id));
        for (const note of notes) {
          if (!existingIds.has(note.id)) allNotes.push(note);
        }
        cursor = data.nextCursor || null;
        if (!cursor) done = true;
      }
    }

    saveNotesCache(allNotes);
    // Record the max updated_at so checkCacheVersion knows this cache is fresh
    if (allNotes.length > 0) {
      const maxVersion = Math.max(...allNotes.map(n => n.updated_at || 0));
      setCachedVersion(maxVersion);
    }

    if (settings.offlineCacheAttachments) {
      const cache = await caches.open(ATT_CACHE_NAME);
      let attCount = 0;
      for (const note of allNotes) {
        for (const att of (note.attachments || [])) {
          if (!att.id || !isImageAttachment(att)) continue;
          const cacheKey = new Request('/offline-att/' + att.id);
          if (await cache.match(cacheKey)) continue; // already cached
          try {
            const res = await fetch(attachmentUrl(att), { credentials: 'omit', headers: authHeaders() });
            if (res.ok) {
              await cache.put(cacheKey, res);
              attCount++;
              if (attCount % 5 === 0) {
                toast('Syncing offline cache: ' + allNotes.length + ' notes, ' + attCount + ' images...', null);
              }
            }
          } catch(e) {}
        }
      }
    }
    toast('Offline cache synced: ' + allNotes.length + ' notes ✓');
  } catch(e) {
    console.warn('Offline prefetch failed:', e);
    toast('Offline sync failed');
  } finally {
    _prefetchRunning = false;
  }
}
