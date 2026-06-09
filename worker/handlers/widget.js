import { json, jsonOpen, err, errOpen } from "../lib/utils.js";

export async function widgetHandler(request, env, ctx, url, path, method, userId, origin) {
  // ── Public: GET /api/widget/tasks?token=<token> ──────────────────────────────
  if (path === "/api/widget/tasks" && method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return errOpen("Missing token", 400);

    const row = await env.DB.prepare(
      "SELECT user_id FROM widget_tokens WHERE token = ?"
    ).bind(token).first();
    if (!row) return errOpen("Invalid token", 401);

    const { results } = await env.DB.prepare(
      `SELECT id, content, due_date, priority FROM notes
       WHERE user_id = ? AND is_task = 1 AND completed_at IS NULL AND archived = 0
       ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC
       LIMIT 20`
    ).bind(row.user_id).all();

    const tasks = results.map(n => ({
      id: n.id,
      title: (n.content || "").split("\n")[0].replace(/^#+\s*/, "").trim() || "(no title)",
      due_at: n.due_date ? new Date(n.due_date).getTime() : null,
      subject: n.priority || null, // priority TEXT column stores subject/category name
    }));

    return jsonOpen({ tasks }, 200);
  }

  // ── Auth-required routes below — skip if no userId ───────────────────────────
  if (!userId) return null;

  // ── GET /api/widget/token — check if token exists (returns preview only) ──────
  if (path === "/api/widget/token" && method === "GET") {
    const row = await env.DB.prepare(
      "SELECT token FROM widget_tokens WHERE user_id = ?"
    ).bind(userId).first();
    if (!row) return json({ exists: false, preview: null }, 200, origin);
    const t = row.token;
    const preview = t.slice(0, 8) + "…" + t.slice(-4);
    return json({ exists: true, preview }, 200, origin);
  }

  // ── POST /api/widget/token — generate (or replace) a widget token ─────────────
  if (path === "/api/widget/token" && method === "POST") {
    const token = crypto.randomUUID().replace(/-/g, "");
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM widget_tokens WHERE user_id = ?").bind(userId),
      env.DB.prepare("INSERT INTO widget_tokens (token, user_id, created_at) VALUES (?, ?, ?)").bind(token, userId, now),
    ]);
    return json({ token }, 201, origin);
  }

  // ── DELETE /api/widget/token — revoke widget token ────────────────────────────
  if (path === "/api/widget/token" && method === "DELETE") {
    await env.DB.prepare("DELETE FROM widget_tokens WHERE user_id = ?").bind(userId).run();
    return json({ ok: true }, 200, origin);
  }

  return null;
}
