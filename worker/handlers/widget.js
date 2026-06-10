import { json, jsonOpen, err, errOpen } from "../lib/utils.js";

// Mirrors formatDue()/isOverdue() from noteflow-widget/widget/tasksBridge.ts so non-JS
// clients (e.g. KWGT) get a ready-to-display label without redoing the date math.
// A Cloudflare Worker runs in UTC; tzOffsetMin (minutes to add to UTC) shifts "today"
// to the caller's local calendar day so today/tomorrow/overdue don't slip near midnight.
function dueInfo(due_at, tzOffsetMin) {
  if (!due_at) return { due_label: "", overdue: false };
  const off = tzOffsetMin * 60000;
  const dayMs = 86400000;
  const todayMid = Math.floor((Date.now() + off) / dayMs) * dayMs; // UTC-midnight of caller's local date
  const diff = Math.floor((due_at - todayMid) / dayMs);
  const d = new Date(due_at);
  let due_label;
  if (diff < 0) due_label = "overdue";
  else if (diff === 0) due_label = "today";
  else if (diff === 1) due_label = "tomorrow";
  else if (diff < 7) due_label = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(d).toLowerCase();
  else due_label = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
  return { due_label, overdue: due_at < todayMid };
}

export async function widgetHandler(request, env, ctx, url, path, method, userId, origin) {
  // ── Public: GET /api/widget/tasks?token=<token> ──────────────────────────────
  if (path === "/api/widget/tasks" && method === "GET") {
    const token = url.searchParams.get("token");
    if (!token) return errOpen("Missing token", 400);

    const row = await env.DB.prepare(
      "SELECT user_id FROM widget_tokens WHERE token = ?"
    ).bind(token).first();
    if (!row) return errOpen("Invalid token", 401);

    // Optional: minutes to add to UTC to reach the caller's local day (default 0 = UTC).
    const tzOffsetMin = parseInt(url.searchParams.get("tzoffset") || "0", 10) || 0;

    const { results } = await env.DB.prepare(
      `SELECT id, content, due_date, priority FROM notes
       WHERE user_id = ? AND is_task = 1 AND completed_at IS NULL AND archived = 0
       ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC
       LIMIT 20`
    ).bind(row.user_id).all();

    const tasks = results.map(n => {
      const due_at = n.due_date ? new Date(n.due_date).getTime() : null;
      return {
        id: n.id,
        title: (n.content || "").split("\n")[0].replace(/^#+\s*/, "").trim() || "(no title)",
        due_at,
        subject: n.priority || null, // priority TEXT column stores subject/category name
        ...dueInfo(due_at, tzOffsetMin), // due_label (string) + overdue (bool) for header-less clients (KWGT)
      };
    });

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
