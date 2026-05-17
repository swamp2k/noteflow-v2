function ensureOfflineUI() {
  if (!_offlineBanner) {
    _offlineBanner = document.createElement('div');
    _offlineBanner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#e53935;color:#fff;text-align:center;font-size:13px;padding:8px;z-index:9999;font-family:system-ui,sans-serif;';
    _offlineBanner.textContent = '📵 You\'re offline — new notes will sync when reconnected';
    document.body.appendChild(_offlineBanner);
  }
  if (!_queueBadge) {
    _queueBadge = document.createElement('div');
    _queueBadge.style.cssText = 'display:none;position:fixed;bottom:48px;right:16px;background:#ff9800;color:#fff;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:600;z-index:9998;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer;';
    _queueBadge.innerHTML = '⏳ <span id="queue-count">0</span> pending';
    _queueBadge.addEventListener('click', () => {
      if (navigator.serviceWorker.controller)
        navigator.serviceWorker.controller.postMessage({ type: 'SYNC_QUEUE' });
      toast('Retrying sync…');
    });
    document.body.appendChild(_queueBadge);
  }
}

function setOffline(offline) {
  if (_isOffline === offline) return;
  _isOffline = offline;
  if (offline) {
    ensureOfflineUI();
    _offlineBanner.style.display = 'block';
  } else {
    if (_offlineBanner) _offlineBanner.style.display = 'none';
    if (navigator.serviceWorker.controller)
      navigator.serviceWorker.controller.postMessage({ type: 'SYNC_QUEUE' });
  }
}

function updateQueueBadge(size) {
  if (size > 0) {
    ensureOfflineUI();
    document.getElementById('queue-count').textContent = size;
    _queueBadge.style.display = 'block';
    // If we're online, try to sync immediately rather than waiting for user action
    if (navigator.onLine && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SYNC_QUEUE' });
    }
  } else if (_queueBadge) {
    _queueBadge.style.display = 'none';
  }
}

// Only trust actual browser events — never check on load
window.addEventListener('online',  () => setOffline(false));
window.addEventListener('offline', () => setOffline(true));

// ── Share target: check for pending share on load ────────────────────────────
async function checkSharePending() {
  try {
    const cache = await caches.open('noteflow-v2');
    const res = await cache.match('/__share_pending__');
    if (!res) return;
    const { content, fileCount = 0 } = await res.json();
    await cache.delete('/__share_pending__');

    switchView('all');
    if (content) openComposerWithContent(content);

    // Load shared files into the composer's pending attachments
    for (let i = 0; i < fileCount; i++) {
      const fileRes = await cache.match(`/__share_file_${i}__`);
      if (fileRes) {
        await cache.delete(`/__share_file_${i}__`);
        const blob = await fileRes.blob();
        const name = decodeURIComponent(fileRes.headers.get('X-File-Name') || `file_${i}`);
        const file = new File([blob], name, { type: blob.type });
        await addFile(file);
      }
    }
  } catch(e) { /* no cache, no problem */ }
}

// Also check sessionStorage fallback (for when SW wasn't ready)
const _ssPending = sessionStorage.getItem('__share_pending__');
if (_ssPending) {
  try {
    const { content } = JSON.parse(_ssPending);
    sessionStorage.removeItem('__share_pending__');
    if (content) setTimeout(() => openComposerWithContent(content), 500);
  } catch(e) {}
}

function openComposerWithContent(content) {
  switchView('all');
  if (composerEditor) {
    composerEditor.value = content;
    composerEditor.focus();
    document.getElementById('composer').classList.add('expanded');
  } else {
    // Composer not ready yet — store for deferred apply
    _pendingShareContent = content;
  }
}

// Check for share payload after SW is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkSharePending);
} else {
  checkSharePending();
}
