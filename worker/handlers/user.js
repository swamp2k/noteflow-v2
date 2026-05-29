import { json } from "../lib/utils.js";

export async function userHandler(request, env, ctx, url, path, method, userId, origin, claims) {
  if (path === "/api/boot" && method === "GET") {
    // Combined boot endpoint: settings + trackers + notes version + project tags in one request
    const [settingsRow, trackersResult, versionRow, projectTagsResult, taskAlertRow] = await Promise.all([
      env.DB.prepare("SELECT data FROM user_settings WHERE user_id=?").bind(userId).first(),
      env.DB.prepare("SELECT id,name,instructions,ai_model,color,archived,created_at,updated_at FROM tracker_subjects WHERE user_id=? ORDER BY created_at ASC").bind(userId).all(),
      env.DB.prepare("SELECT MAX(updated_at) as v FROM notes WHERE user_id=? AND archived=0").bind(userId).first(),
      env.DB.prepare("SELECT DISTINCT tag FROM note_tags WHERE user_id=? AND tag LIKE 'project:%' ORDER BY tag ASC").bind(userId).all(),
      env.DB.prepare("SELECT COUNT(*) as cnt FROM notes WHERE user_id=? AND is_task=1 AND completed_at IS NULL AND archived=0 AND (priority=1 OR due_date=date('now') OR (due_date IS NOT NULL AND due_date < date('now')))").bind(userId).first(),
    ]);
    return json({
      settings: settingsRow ? JSON.parse(settingsRow.data) : {},
      trackers: trackersResult.results || [],
      version: versionRow?.v || 0,
      projectTags: (projectTagsResult.results || []).map(r => r.tag),
      taskAlertCount: taskAlertRow?.cnt || 0,
    }, 200, origin);
  }
  if (path === "/api/me" && method === "GET") { const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first(); return json({ user, jwt_email: claims.email }, 200, origin); }
  if(path==="/api/user/settings"&&method==="GET"){await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')").run();const row=await env.DB.prepare("SELECT data FROM user_settings WHERE user_id=?").bind(userId).first();return json(row?JSON.parse(row.data):{},200,origin);}
  if(path==="/api/user/settings"&&method==="PUT"){await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')").run();const body=await request.json();await env.DB.prepare("INSERT OR REPLACE INTO user_settings (user_id,data) VALUES (?,?)").bind(userId,JSON.stringify(body)).run();return json({ok:true},200,origin);}

  return null;
}
