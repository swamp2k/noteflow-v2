// ── Push notification subscription ───────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}

async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    toast('Push notifications are not supported in this browser');
    return false;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      toast('Push notifications were denied. You can enable them in your browser settings.');
      return false;
    }
    const { publicKey } = await apiGet('/push/vapid-key');
    if (!publicKey) { toast('Push not configured on server'); return false; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    const json = sub.toJSON();
    await apiPost('/push/subscribe', {
      endpoint: json.endpoint,
      p256dh:   json.keys.p256dh,
      auth:     json.keys.auth
    });
    return true;
  } catch(e) {
    toast('Push subscription failed: ' + e.message);
    return false;
  }
}

async function unsubscribeFromPush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiDelete('/push/subscribe?endpoint=' + encodeURIComponent(sub.endpoint));
      await sub.unsubscribe();
    }
  } catch(e) {
    console.warn('[push] Unsubscribe failed:', e.message);
  }
}
