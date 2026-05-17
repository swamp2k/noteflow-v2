import { json, err } from "../lib/utils.js";

export async function searchHandler(request, env, ctx, url, path, method, userId, origin) {
  if(path==="/api/search"&&method==="POST"){const{q}=await request.json();if(!q||q.trim().length<2)return json({notes:[]},200,origin);const term=`%${q.trim()}%`;const{results:nr}=await env.DB.prepare("SELECT n.id,n.content,n.created_at,n.updated_at,n.visibility,n.pinned,n.archived,GROUP_CONCAT(nt.tag) as tags_csv,NULL as matched_file FROM notes n LEFT JOIN note_tags nt ON nt.note_id=n.id WHERE n.user_id=? AND n.archived=0 AND n.content LIKE ? GROUP BY n.id ORDER BY n.created_at DESC LIMIT 50").bind(userId,term).all();const{results:dr}=await env.DB.prepare("SELECT n.id,n.content,n.created_at,n.updated_at,n.visibility,n.pinned,n.archived,GROUP_CONCAT(nt.tag) as tags_csv,a.filename as matched_file FROM document_index di JOIN attachments a ON a.id=di.attachment_id JOIN notes n ON n.id=a.note_id LEFT JOIN note_tags nt ON nt.note_id=n.id WHERE n.user_id=? AND n.archived=0 AND di.text_content LIKE ? GROUP BY n.id ORDER BY n.created_at DESC LIMIT 20").bind(userId,term).all();const seen=new Set();const merged=[];for(const n of[...nr,...dr]){if(!seen.has(n.id)){seen.add(n.id);merged.push({...n,tags:n.tags_csv?n.tags_csv.split(","):[],tags_csv:void 0});}}if(merged.length>0){const ids=merged.map(n=>n.id);const ph=ids.map(()=>"?").join(",");const{results:atts}=await env.DB.prepare(`SELECT * FROM attachments WHERE note_id IN (${ph})`).bind(...ids).all();const am={};for(const a of atts){if(!am[a.note_id])am[a.note_id]=[];am[a.note_id].push(a);}for(const n of merged)n.attachments=am[n.id]||[];}return json({notes:merged},200,origin);}

  if(path==="/api/notes/autotag"&&method==="POST"){
    const{content,categories=[],people=[]}=await request.json();
    if(!content?.trim()) return json({tags:[]},200,origin);
    const stripped=(content||'').replace(/#[\wÀ-ɏ-]+/g,'').replace(/<[^>]+>/g,'').trim().slice(0,2000);
    if(stripped.length<15) return json({tags:[]},200,origin);
    let hints='';
    if(categories.length) hints+=`\n- If the note fits one of these categories, include it as a tag (exact spelling, lowercase): ${categories.map(c=>c.toLowerCase()).join(', ')}`;
    if(people.length) hints+=`\n- If the note mentions or is about one of these people, include their name as a tag (lowercase): ${people.map(p=>p.toLowerCase()).join(', ')}`;
    const system=`Tagging assistant for a personal note app. Content may be Danish, English, or mixed.\nReturn 3-6 specific tags as a JSON array only. Example: ["opskrift","pasta","aftensmad"]\n- Lowercase, hyphens for spaces (e.g. "meeting-notes")\n- Specific not generic — avoid: note, misc, general, text\n- Never include: starred, hidden, archived${hints}`;
    const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:150,system,messages:[{role:"user",content:stripped}]})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error?.message||"AI call failed");
    const text=data.content?.[0]?.text?.trim()||'[]';
    try{ const tags=JSON.parse(text.replace(/```json|```/g,'').trim()); return json({tags:Array.isArray(tags)?tags:[]},200,origin); }
    catch(e){ return json({tags:[]},200,origin); }
  }

  return null;
}
