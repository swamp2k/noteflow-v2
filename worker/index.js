import { corsHeaders, openCors, err } from "./lib/utils.js";
import { verifyJWT, ensureUser } from "./lib/auth.js";
import { publicHandler } from "./handlers/public.js";
import { partnerHandler } from "./handlers/partner.js";
import { widgetHandler } from "./handlers/widget.js";
import { icalHandler } from "./handlers/ical.js";
import { userHandler } from "./handlers/user.js";
import { notesHandler } from "./handlers/notes.js";
import { tagsHandler } from "./handlers/tags.js";
import { attachmentsHandler } from "./handlers/attachments.js";
import { trackerHandler } from "./handlers/tracker.js";
import { searchHandler } from "./handlers/search.js";
import { projectAIHandler } from "./handlers/project-ai.js";
import { emailHandler } from "./handlers/email.js";
import { pushHandler } from "./handlers/push.js";
import { runTaskNotifications } from "./lib/notifications.js";
import { handleInboundEmail } from "./handlers/email-inbound.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...openCors(), ...cors } });

    const path = url.pathname.replace(/\/$/, "");
    const method = request.method;

    let res;
    res = await publicHandler(request, env, ctx, url, path, method, null, origin);
    if (res) return res;

    res = await partnerHandler(request, env, ctx, url, path, method, null, origin);
    if (res) return res;

    res = await widgetHandler(request, env, ctx, url, path, method, null, origin);
    if (res) return res;

    // ICS calendar feed — carries its own widget-token auth, so it runs pre-auth
    res = await icalHandler(request, env, ctx, url, path, method, null, origin);
    if (res) return res;

    if (!path.startsWith("/api/")) return new Response("NoteFlow API v2", { headers: cors });

    let claims;
    const authHeader = request.headers.get("Authorization") || "";
    if (env.MIGRATION_KEY && authHeader === `Bearer ${env.MIGRATION_KEY}`) {
      claims = { email: request.headers.get("X-Migration-User") || "martin@jeppesen.cc", name: "Migration" };
    } else {
      claims = await verifyJWT(request, env);
      if (!claims) return err("Unauthorized", 401, origin);
    }
    const userId = await ensureUser(env.DB, claims);

    try {
      res = await userHandler(request, env, ctx, url, path, method, userId, origin, claims);
      if (res) return res;

      res = await notesHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await tagsHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await attachmentsHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await trackerHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await partnerHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await searchHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await projectAIHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await emailHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await pushHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      res = await widgetHandler(request, env, ctx, url, path, method, userId, origin);
      if (res) return res;

      return err("Not found", 404, origin);
    } catch(e) {
      console.error("API error:", e.message, e.stack);
      return err("Internal server error", 500, origin);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runTaskNotifications(env));
  },

  async email(message, env, ctx) {
    ctx.waitUntil(handleInboundEmail(message, env));
  }
};
