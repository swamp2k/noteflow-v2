// Daily task notification cron handler
// Called from the scheduled() export in worker/index.js

export async function runTaskNotifications(env) {
  const { results: users } = await env.DB.prepare("SELECT id FROM users").all();
  for (const user of users) {
    try {
      await notifyUser(env, user.id);
    } catch (e) {
      console.warn("[cron] notifyUser failed for", user.id, e.message);
    }
  }
}

async function notifyUser(env, userId) {
  const row = await env.DB.prepare("SELECT data FROM user_settings WHERE user_id=?").bind(userId).first();
  if (!row) return;
  let s;
  try { s = JSON.parse(row.data || "{}"); } catch { return; }
  if (!s.notif_enabled) return;

  const now = new Date();
  const today = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  // Check if current UTC hour matches notif_send_time
  const [sendHour] = (s.notif_send_time || "08:00").split(":").map(Number);
  if (now.getUTCHours() !== sendHour) return;

  const tasks = [];

  if (s.notif_trigger_due_today) {
    const { results } = await env.DB.prepare(
      "SELECT id,content,due_date,priority FROM notes WHERE user_id=? AND is_task=1 AND completed_at IS NULL AND archived=0 AND due_date=?"
    ).bind(userId, today).all();
    tasks.push(...results.map(t => ({ ...t, trigger: "due_today" })));
  }

  if (s.notif_trigger_overdue) {
    const { results } = await env.DB.prepare(
      "SELECT id,content,due_date,priority FROM notes WHERE user_id=? AND is_task=1 AND completed_at IS NULL AND archived=0 AND due_date<?"
    ).bind(userId, today).all();
    // Avoid duplicates if both triggers are set
    for (const t of results) {
      if (!tasks.find(x => x.id === t.id)) tasks.push({ ...t, trigger: "overdue" });
    }
  }

  if (s.notif_trigger_due_soon) {
    const { results } = await env.DB.prepare(
      "SELECT id,content,due_date,priority FROM notes WHERE user_id=? AND is_task=1 AND completed_at IS NULL AND archived=0 AND due_date=?"
    ).bind(userId, tomorrow).all();
    for (const t of results) {
      if (!tasks.find(x => x.id === t.id)) tasks.push({ ...t, trigger: "due_soon" });
    }
  }

  if (!tasks.length) return;

  const summary = tasks
    .map(t => `• ${(t.content || "").split("\n")[0].slice(0, 60)} (due ${t.due_date})`)
    .join("\n");
  const count = tasks.length;

  if (s.notif_discord_enabled && s.notif_discord_webhook) {
    // SSRF guard: only allow actual Discord webhook URLs
    if (!s.notif_discord_webhook.startsWith("https://discord.com/api/webhooks/")) {
      console.warn("[cron] Blocked non-Discord webhook for user", userId);
    } else {
      await fetch(s.notif_discord_webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: `**NoteFlow Tasks** — ${count} task${count > 1 ? "s" : ""} need attention:\n${summary}`
        })
      }).catch(e => console.warn("[cron] Discord failed:", e.message));
    }
  }

  if (s.notif_email_enabled) {
    const toEmail = s.notif_email_address || s.reminderEmail;
    if (toEmail && env.RESEND_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_KEY}` },
        body: JSON.stringify({
          from: env.RESEND_FROM || "NoteFlow <noteflow@jeppesen.cc>",
          to: [toEmail],
          subject: `NoteFlow: ${count} task${count > 1 ? "s" : ""} due`,
          text: `You have ${count} task${count > 1 ? "s" : ""} that need attention:\n\n${summary}\n\nOpen NoteFlow: https://notes.jeppesen.cc/?v=tasks`
        })
      }).catch(e => console.warn("[cron] Email failed:", e.message));
    }
  }

  if (s.notif_push_enabled) {
    await sendPushNotifications(env, userId, count, summary);
  }
}

async function sendPushNotifications(env, userId, count, summary) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return;

  const { results: subs } = await env.DB.prepare(
    "SELECT endpoint,p256dh,auth_key FROM push_subscriptions WHERE user_id=?"
  ).bind(userId).all();

  const payload = JSON.stringify({
    title: `NoteFlow: ${count} task${count > 1 ? "s" : ""} due`,
    body: summary.slice(0, 200),
    url: "https://notes.jeppesen.cc/?v=tasks"
  });

  for (const sub of subs) {
    try {
      await sendWebPush(env, sub, payload);
    } catch (e) {
      console.warn("[cron] Push failed for endpoint:", sub.endpoint.slice(0, 40), e.message);
    }
  }
}

// Minimal Web Push implementation using VAPID + crypto.subtle
// Compatible with Cloudflare Workers runtime
async function sendWebPush(env, sub, payloadStr) {
  const vapidJwt = await buildVapidJwt(env, sub.endpoint);
  const { ciphertext, salt, serverPublicKey } = await encryptPayload(sub.p256dh, sub.auth_key, payloadStr);

  const headers = {
    "Authorization": `vapid t=${vapidJwt},k=${env.VAPID_PUBLIC_KEY}`,
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aesgcm",
    "Encryption": `salt=${base64url(salt)}`,
    "Crypto-Key": `dh=${base64url(serverPublicKey)}`,
    "TTL": "86400"
  };

  const res = await fetch(sub.endpoint, { method: "POST", headers, body: ciphertext });
  if (!res.ok && res.status !== 201) {
    console.warn("[push] Non-success status", res.status, "for endpoint", sub.endpoint.slice(0, 40));
  }
}

async function buildVapidJwt(env, endpoint) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1e3);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: env.VAPID_SUBJECT })));
  const unsigned = header + "." + payload;

  const privKeyBytes = urlBase64ToBytes(env.VAPID_PRIVATE_KEY);
  const privKey = await crypto.subtle.importKey("pkcs8", privKeyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privKey, new TextEncoder().encode(unsigned));

  return unsigned + "." + base64url(new Uint8Array(sig));
}

async function encryptPayload(p256dhBase64, authBase64, payloadStr) {
  const recipientPublicKey = urlBase64ToBytes(p256dhBase64);
  const authSecret = urlBase64ToBytes(authBase64);

  const serverKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const recipientKey = await crypto.subtle.importKey("raw", recipientPublicKey, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: recipientKey }, serverKeyPair.privateKey, 256));

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF to derive content encryption key and nonce
  const prk = await hkdf(authSecret, sharedSecret, concat(new TextEncoder().encode("Content-Encoding: auth\0"), new Uint8Array(1)), 32);
  const context = concat(new TextEncoder().encode("P-256\0"), new Uint8Array(2), recipientPublicKey.slice(1, 65), new Uint8Array(2), serverPublicKeyRaw.slice(1, 65));
  const cek = await hkdf(salt, prk, concat(new TextEncoder().encode("Content-Encoding: aesgcm\0"), context), 16);
  const nonce = await hkdf(salt, prk, concat(new TextEncoder().encode("Content-Encoding: nonce\0"), context), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const encoded = new TextEncoder().encode(payloadStr);
  const padded = new Uint8Array(2 + encoded.length); // 2 bytes padding length (0) + content
  padded.set(encoded, 2);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  return { ciphertext, salt, serverPublicKey: serverPublicKeyRaw };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, salt));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, concat(info, new Uint8Array([1]))));
  return t.slice(0, length);
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

function base64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function urlBase64ToBytes(str) {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - base64.length % 4) % 4);
  const raw = atob(padded);
  return new Uint8Array([...raw].map(c => c.charCodeAt(0)));
}
