function ensureOfflineUI() {
  if (!_offlineBanner) {
    _offlineBanner = document.createElement('div');
    _offlineBanner.style.cssText = 'display:none;background:#e53935;color:#fff;text-align:center;font-size:13px;padding:8px 20px;width:calc(100% + 40px);margin-left:-20px;margin-right:-20px;margin-bottom:16px;font-family:system-ui,sans-serif;position:sticky;top:0;z-index:45;box-sizing:border-box;';
    _offlineBanner.textContent = '📵 You\'re offline — new notes will sync when reconnected';
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.prepend(_offlineBanner);
    else document.body.appendChild(_offlineBanner);
  }
  if (!_queueBadge) {
    _queueBadge = document.createElement('div');
    _queueBadge.style.cssText = 'display:none;position:fixed;bottom:24px;right:16px;background:#ff9800;color:#fff;border-radius:20px;padding:6px 12px;font-size:12px;font-weight:600;z-index:9998;box-shadow:0 2px 8px rgba(0,0,0,.2);cursor:pointer;';
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

// The share navigation identifies one payload, so simultaneous shares use different drafts.
async function checkSharePending() {
  const url = new URL(location.href);
  const shareId = url.searchParams.get('share');
  if (!shareId) return;

  try {
    if (!/^[0-9a-f-]{36}$/.test(shareId)) throw new Error('Invalid share ID');
    const cache = await caches.open('noteflow-shares-v1');
    const key = '/__share_pending__/' + shareId;
    const response = await cache.match(key);
    if (!response) throw new Error('Missing share payload');
    const payload = await response.formData();
    // Only the page that successfully claims this payload should open a draft.
    if (!await cache.delete(key)) return;
    composerShowEdit();
    composerEditor.value = payload.get('content') || '';
    for (const file of payload.getAll('files')) addFile(file);
  } catch (error) {
    console.warn('Could not open share:', error);
    toast('Could not import the share. Try sharing it again.');
  }
  const currentUrl = new URL(location.href);
  currentUrl.searchParams.delete('share');
  history.replaceState(null, '', currentUrl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkSharePending);
} else {
  checkSharePending();
}
