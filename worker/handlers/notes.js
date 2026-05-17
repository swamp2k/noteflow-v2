import { json, err, nanoid, extractTags } from "../lib/utils.js";

export async function notesHandler(request, env, ctx, url, path, method, userId, origin) {
  if (path === "/api/notes/version" && method === "GET") { const row = await env.DB.prepare("SELECT MAX(updated_at) as v FROM notes WHERE user_id=? AND archived=0").bind(userId).first(); return json({ version: row?.v || 0 }, 200, origin); }

  if (path === "/api/notes" && method === "GET") {
    const pageSize=Math.min(parseInt(url.searchParams.get("pageSize")||"20"),100); const cursor=url.searchParams.get("cursor"); const filter=url.searchParams.get("filter"); const tag=url.searchParams.get("tag"); const pinned=url.searchParams.get("pinned");
    let where="n.user_id=?"; const params=[userId];
    if(filter==="archived") where+=" AND n.archived=1";
    else if(filter==="starred") where+=" AND n.archived=0 AND EXISTS(SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id AND nt.tag='starred')";
    else if(filter==="hidden") where+=" AND n.archived=0 AND EXISTS(SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id AND nt.tag='hidden')";
    else if(filter==="shared") where+=" AND n.archived=0 AND n.visibility='PUBLIC'";
    else { where+=" AND n.archived=0 AND NOT EXISTS(SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id AND nt.tag='hidden')"; }
    if(tag){where+=" AND EXISTS(SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id AND nt.tag=?)";params.push(tag);}
    if(pinned==="1") where+=" AND n.pinned=1";
    if(cursor){where+=" AND n.created_at<?";params.push(parseInt(cursor));}
    params.push(pageSize+1);
    const{results:notes}=await env.DB.prepare(`SELECT n.*,GROUP_CONCAT(nt.tag) as tags_csv FROM notes n LEFT JOIN note_tags nt ON nt.note_id=n.id WHERE ${where} GROUP BY n.id ORDER BY n.pinned DESC,n.created_at DESC LIMIT ?`).bind(...params).all();
    const hasMore=notes.length>pageSize; if(hasMore) notes.pop();
    const noteIds=notes.map(n=>n.id); let attMap={};
    if(noteIds.length>0){const ph=noteIds.map(()=>"?").join(",");const{results:atts}=await env.DB.prepare(`SELECT * FROM attachments WHERE note_id IN (${ph})`).bind(...noteIds).all();for(const a of atts){if(!attMap[a.note_id])attMap[a.note_id]=[];attMap[a.note_id].push(a);}}
    return json({notes:notes.map(n=>({...n,tags:n.tags_csv?n.tags_csv.split(","):[],tags_csv:void 0,attachments:attMap[n.id]||[]})),nextCursor:hasMore?notes[notes.length-1].created_at:null},200,origin);
  }
  if (path === "/api/notes" && method === "POST") {
    const body=await request.json(); const{content="",visibility="PRIVATE",created_at,updated_at,tags:bodyTags}=body;
    const id=nanoid("n_"); const ca=created_at?parseInt(created_at):Math.floor(Date.now()/1e3); const ua=updated_at?parseInt(updated_at):ca;
    await env.DB.prepare("INSERT INTO notes (id,user_id,content,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,userId,content,visibility,ca,ua).run();
    const tags=Array.isArray(bodyTags)&&bodyTags.length>0?bodyTags.map(t=>String(t).toLowerCase().trim()).filter(Boolean):extractTags(content);
    if(tags.length>0) await env.DB.prepare(`INSERT OR IGNORE INTO note_tags (note_id,tag,user_id) VALUES ${tags.map(()=>"(?,?,?)").join(",")}`).bind(...tags.flatMap(t=>[id,t,userId])).run();
    const note=await env.DB.prepare("SELECT * FROM notes WHERE id=?").bind(id).first();
    return json({note:{...note,tags}},201,origin);
  }
  const noteMatch=path.match(/^\/api\/notes\/([^/]+)$/);
  if(noteMatch){const noteId=noteMatch[1];if(method==="GET"){const note=await env.DB.prepare("SELECT * FROM notes WHERE id=? AND user_id=?").bind(noteId,userId).first();if(!note)return err("Not found",404,origin);const{results:tags}=await env.DB.prepare("SELECT tag FROM note_tags WHERE note_id=?").bind(noteId).all();const{results:attachments}=await env.DB.prepare("SELECT * FROM attachments WHERE note_id=?").bind(noteId).all();return json({note:{...note,tags:tags.map(t=>t.tag),attachments}},200,origin);}if(method==="PATCH"){const note=await env.DB.prepare("SELECT * FROM notes WHERE id=? AND user_id=?").bind(noteId,userId).first();if(!note)return err("Not found",404,origin);const body=await request.json();const content=body.content!==void 0?body.content:note.content;const visibility=body.visibility!==void 0?body.visibility:note.visibility;const pinned=body.pinned!==void 0?(body.pinned?1:0):note.pinned;const archived=body.archived!==void 0?(body.archived?1:0):note.archived;await env.DB.prepare("UPDATE notes SET content=?,visibility=?,pinned=?,archived=?,updated_at=? WHERE id=?").bind(content,visibility,pinned,archived,Math.floor(Date.now()/1e3),noteId).run();if(body.content!==void 0||Array.isArray(body.tags)){await env.DB.prepare("DELETE FROM note_tags WHERE note_id=?").bind(noteId).run();const tags2=Array.isArray(body.tags)&&body.tags.length>0?body.tags.map(t=>String(t).toLowerCase().trim()).filter(Boolean):extractTags(content);if(tags2.length>0) await env.DB.prepare(`INSERT OR IGNORE INTO note_tags (note_id,tag,user_id) VALUES ${tags2.map(()=>"(?,?,?)").join(",")}`).bind(...tags2.flatMap(t=>[noteId,t,userId])).run();}const updated=await env.DB.prepare("SELECT * FROM notes WHERE id=?").bind(noteId).first();const{results:tags}=await env.DB.prepare("SELECT tag FROM note_tags WHERE note_id=?").bind(noteId).all();return json({note:{...updated,tags:tags.map(t=>t.tag)}},200,origin);}if(method==="DELETE"){const note=await env.DB.prepare("SELECT * FROM notes WHERE id=? AND user_id=?").bind(noteId,userId).first();if(!note)return err("Not found",404,origin);const{results:atts}=await env.DB.prepare("SELECT r2_key FROM attachments WHERE note_id=?").bind(noteId).all();await Promise.all(atts.map(a=>env.ATTACHMENTS.delete(a.r2_key)));await env.DB.prepare("DELETE FROM notes WHERE id=?").bind(noteId).run();return json({deleted:true},200,origin);}}

  if(path==="/api/notes/tag-contexts"&&method==="POST"){const{ids}=await request.json();if(!Array.isArray(ids)||!ids.length)return json({},200,origin);const safe=ids.slice(0,90);const ph=safe.map(()=>"?").join(",");const{results:notes}=await env.DB.prepare(`SELECT id,content FROM notes WHERE id IN (${ph}) AND user_id=?`).bind(...safe,userId).all();const{results:indexed}=await env.DB.prepare(`SELECT a.note_id,di.text_content FROM attachments a JOIN document_index di ON di.attachment_id=a.id WHERE a.note_id IN (${ph}) AND a.user_id=?`).bind(...safe,userId).all();const im={};for(const r of indexed){if(!im[r.note_id])im[r.note_id]=[];im[r.note_id].push(r.text_content||"");}const contexts={};for(const n of notes){const p=[n.content||"",...im[n.id]||[]].filter(s=>s.trim());contexts[n.id]=p.join("\n\n").slice(0,4e3);}return json(contexts,200,origin);}

  return null;
}
