import { json, err, nanoid } from "../lib/utils.js";
import { buildProjectContext } from "../lib/ai.js";
import { resolveModel } from "../lib/auth.js";

export async function projectAIHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path === "/api/projects/ai/conversation" && method === "GET") {
    const tag = url.searchParams.get("tag");
    if (!tag || !tag.startsWith("project:")) return err("Invalid tag", 400, origin);
    const { results } = await env.DB.prepare(
      "SELECT role,content,created_at FROM project_ai_conversations WHERE user_id=? AND project_tag=? ORDER BY created_at ASC LIMIT 60"
    ).bind(userId, tag).all();
    return json({ conversation: results }, 200, origin);
  }

  if (path === "/api/projects/ai/conversation" && method === "DELETE") {
    const tag = url.searchParams.get("tag");
    if (!tag || !tag.startsWith("project:")) return err("Invalid tag", 400, origin);
    await env.DB.prepare(
      "DELETE FROM project_ai_conversations WHERE user_id=? AND project_tag=?"
    ).bind(userId, tag).run();
    return json({ ok: true }, 200, origin);
  }

  if (path === "/api/projects/ai" && method === "POST") {
    if (!env.ANTHROPIC_KEY) return err("AI not configured", 503, origin);
    const { tag, message } = await request.json();
    if (!tag || !tag.startsWith("project:")) return err("Invalid tag", 400, origin);
    if (!message?.trim()) return err("Message required", 400, origin);

    const projectName = tag.replace("project:", "");

    const { results: history } = await env.DB.prepare(
      "SELECT role,content FROM project_ai_conversations WHERE user_id=? AND project_tag=? ORDER BY created_at DESC LIMIT 20"
    ).bind(userId, tag).all();

    const contextText = await buildProjectContext(env, userId, tag);

    const systemBlocks = [
      {
        type: "text",
        text: `You are a project assistant for the project "${projectName}". ` +
              `You have access to all notes and file attachments in this project. ` +
              `Help the user understand, summarise, find patterns, and work with their project content. ` +
              `Respond in the same language the user writes in (Danish or English).`
      },
      {
        type: "text",
        text: `[PROJECT NOTES AND ATTACHMENTS]\n\n${contextText}`,
        cache_control: { type: "ephemeral" }
      }
    ];

    const messages = [
      ...history.reverse().map(c => ({ role: c.role, content: c.content })),
      { role: "user", content: message.trim() }
    ];

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31"
      },
      body: JSON.stringify({
        model: resolveModel("sonnet"),
        max_tokens: 1024,
        system: systemBlocks,
        messages
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "AI call failed");
    const reply = data.content?.[0]?.text || "";

    const now = Math.floor(Date.now() / 1e3);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO project_ai_conversations (id,user_id,project_tag,role,content,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(nanoid("pac_"), userId, tag, "user", message.trim(), now),
      env.DB.prepare(
        "INSERT INTO project_ai_conversations (id,user_id,project_tag,role,content,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(nanoid("pac_"), userId, tag, "assistant", reply, now + 1)
    ]);

    return json({ reply }, 200, origin);
  }

  return null;
}
