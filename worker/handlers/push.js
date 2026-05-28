import { json, err, nanoid } from "../lib/utils.js";

export async function pushHandler(request, env, ctx, url, path, method, userId, origin) {
  // Public endpoint — returns VAPID public key (never p256dh or auth_key)
  if (path === "/api/push/vapid-key" && method === "GET") {
    if (!env.VAPID_PUBLIC_KEY) return err("Push not configured", 503, origin);
    return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, origin);
  }

  if (path === "/api/push/subscribe" && method === "POST") {
    const body = await request.json();
    const { endpoint, p256dh, auth } = body;
    if (!endpoint || !p256dh || !auth) return err("Missing fields", 400, origin);
    const id = nanoid("ps_");
    await env.DB.prepare(
      "INSERT OR REPLACE INTO push_subscriptions (id,user_id,endpoint,p256dh,auth_key,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(id, userId, endpoint, p256dh, auth, Math.floor(Date.now() / 1e3)).run();
    return json({ ok: true }, 201, origin);
  }

  if (path === "/api/push/subscribe" && method === "DELETE") {
    const endpoint = url.searchParams.get("endpoint");
    if (!endpoint) return err("Missing endpoint", 400, origin);
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?").bind(userId, endpoint).run();
    return json({ ok: true }, 200, origin);
  }

  return null;
}
