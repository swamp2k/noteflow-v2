import { json, err } from "../lib/utils.js";
import { ensureTagEmbeddingsTable } from "../lib/ai.js";

export async function tagsHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path === "/api/tags" && method === "GET") { const { results } = await env.DB.prepare("SELECT tag,COUNT(*) as count FROM note_tags WHERE user_id=? GROUP BY tag ORDER BY count DESC").bind(userId).all(); return json({ tags: results.map(r=>r.tag) }, 200, origin); }
  if (path === "/api/tags/graph" && method === "GET") { const { results: tags } = await env.DB.prepare("SELECT tag,COUNT(DISTINCT note_id) as count FROM note_tags WHERE user_id=? GROUP BY tag ORDER BY count DESC").bind(userId).all(); const { results: edges } = await env.DB.prepare("SELECT a.tag as source,b.tag as target,COUNT(*) as weight FROM note_tags a JOIN note_tags b ON a.note_id=b.note_id AND a.tag<b.tag WHERE a.user_id=? GROUP BY a.tag,b.tag HAVING weight>=2 ORDER BY weight DESC LIMIT 500").bind(userId).all(); return json({ tags, edges }, 200, origin); }
  if (path === "/api/tags/contexts" && method === "POST") { const { tags } = await request.json(); if (!Array.isArray(tags)||!tags.length) return json({},200,origin); const contextMap={}; for(let i=0;i<tags.length;i+=80){const batch=tags.slice(i,i+80);const ph=batch.map(()=>"?").join(",");const{results}=await env.DB.prepare(`SELECT nt.tag,SUBSTR(n.content,1,200) as snippet FROM note_tags nt JOIN notes n ON nt.note_id=n.id WHERE nt.user_id=? AND nt.tag IN (${ph}) AND n.content IS NOT NULL AND LENGTH(n.content)>15 ORDER BY n.created_at DESC`).bind(userId,...batch).all();for(const row of results){if(!contextMap[row.tag])contextMap[row.tag]=[];if(contextMap[row.tag].length<3){const s=row.snippet.replace(/[#*`\[\]]/g,"").replace(/\s+/g," ").trim();if(s.length>15)contextMap[row.tag].push(s);}}} return json(contextMap,200,origin); }
  if (path === "/api/tags/embeddings/status" && method === "GET") { await ensureTagEmbeddingsTable(env.DB); const{results:allTags}=await env.DB.prepare("SELECT DISTINCT tag FROM note_tags WHERE user_id=?").bind(userId).all(); const{results:indexed}=await env.DB.prepare("SELECT tag FROM tag_embeddings WHERE user_id=?").bind(userId).all(); const indexedSet=new Set(indexed.map(r=>r.tag)); return json({total:allTags.length,indexed:indexed.length,missing:allTags.map(r=>r.tag).filter(t=>!indexedSet.has(t))},200,origin); }
  if (path === "/api/tags/embeddings" && method === "GET") { await ensureTagEmbeddingsTable(env.DB); const{results}=await env.DB.prepare("SELECT tag,vector FROM tag_embeddings WHERE user_id=?").bind(userId).all(); return json({embeddings:results},200,origin); }
  if (path === "/api/tags/voyage-embed" && method === "POST") {
    if (!env.VOYAGE_KEY) return err("Voyage AI not configured (no VOYAGE_KEY secret)", 503, origin);
    const { texts, input_type = "document" } = await request.json();
    if (!Array.isArray(texts) || !texts.length) return err("texts array required", 400, origin);
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.VOYAGE_KEY}` },
      body: JSON.stringify({ input: texts, model: "voyage-4", input_type })
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); return err(`Voyage ${r.status}: ${e?.detail || "error"}`, 502, origin); }
    const d = await r.json();
    return json({ embeddings: d.data.map(item => item.embedding) }, 200, origin);
  }
  if (path === "/api/tags/embeddings" && method === "PUT") { await ensureTagEmbeddingsTable(env.DB); const{embeddings}=await request.json(); if(!Array.isArray(embeddings)||!embeddings.length) return json({ok:true,count:0},200,origin); const now=Math.floor(Date.now()/1e3); for(let i=0;i<embeddings.length;i+=50){await env.DB.batch(embeddings.slice(i,i+50).map(({tag,vector})=>env.DB.prepare("INSERT OR REPLACE INTO tag_embeddings (user_id,tag,vector,created_at) VALUES (?,?,?,?)").bind(userId,tag,typeof vector==="string"?vector:JSON.stringify(vector),now)));} return json({ok:true,count:embeddings.length},200,origin); }
  if (path === "/api/tags/embeddings" && method === "DELETE") { await ensureTagEmbeddingsTable(env.DB); await env.DB.prepare("DELETE FROM tag_embeddings WHERE user_id=?").bind(userId).run(); return json({ok:true},200,origin); }
  if(path==="/api/tags/semantic-map"&&method==="POST"){
    const{tags}=await request.json();
    if(!Array.isArray(tags)||tags.length<3) return err("Need at least 3 tags",400,origin);
    const tagList=tags.slice(0,80).join(', ');
    const prompt=`You are a semantic positioning engine for a personal note-taking app.\nTags may be Danish, English, or mixed — group by meaning, not language.\nAssign each tag [x, y] coordinates between -1 and 1. Place semantically similar tags close together.\nAlso identify 4–7 thematic clusters.\n\nTags: ${tagList}\n\nRespond with ONLY this raw JSON (no markdown fences, no explanation):\n{\n  "coords": {"tagname": [x, y], ...},\n  "clusters": [{"label": "Name", "cx": 0.0, "cy": 0.0}, ...]\n}`;
    const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:8192,messages:[{role:"user",content:prompt}]})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error?.message||"AI call failed");
    const text=data.content?.[0]?.text||"";
    // Extract JSON from response
    const match=text.match(/\{[\s\S]*\}/);
    if(!match) return err("Could not parse AI response",500,origin);
    try { const parsed=JSON.parse(match[0]); return json(parsed,200,origin); }
    catch(e) { return err("Invalid JSON from AI",500,origin); }
  }

  return null;
}
