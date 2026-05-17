import { json, err } from "../lib/utils.js";

export async function emailHandler(request, env, ctx, url, path, method, userId, origin) {
  if(path==="/api/email/send"&&method==="POST"){
    if(!env.RESEND_KEY) return err("Email not configured (no RESEND_KEY)",503,origin);
    const{note_id,tracker_id,to,make_public=false}=await request.json();
    if(!to?.trim()) return err("Recipient address required",400,origin);

    // ── Simple markdown → HTML ────────────────────────────────────────────
    function mdToHtml(md){
      if(!md) return '';
      let html=md
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/^#{3}\s+(.+)$/gm,'<h3 style="margin:16px 0 6px;font-size:15px">$1</h3>')
        .replace(/^#{2}\s+(.+)$/gm,'<h2 style="margin:18px 0 8px;font-size:17px">$1</h2>')
        .replace(/^#{1}\s+(.+)$/gm,'<h1 style="margin:20px 0 10px;font-size:20px">$1</h1>')
        .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,'<em>$1</em>')
        .replace(/`([^`]+)`/g,'<code style="background:#f0f0f0;padding:1px 5px;border-radius:3px;font-size:0.88em">$1</code>')
        .replace(/^[-*]\s+(.+)$/gm,'<li>$1</li>')
        .replace(/^\d+\.\s+(.+)$/gm,'<li>$1</li>')
        .replace(/(<li>.*<\/li>\n?)+/g,(m)=>`<ul style="padding-left:20px;margin:8px 0">${m}</ul>`)
        .replace(/^&gt;\s*(.+)$/gm,'<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#666;margin:8px 0">$1</blockquote>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" style="color:#5b6af0">$1</a>')
        .replace(/\n\n/g,'</p><p style="margin:0 0 12px">');
      return '<p style="margin:0 0 12px">'+html+'</p>';
    }

    let subject,bodyHtml,viewLink='';
    const now=new Date().toLocaleDateString('da-DK',{day:'numeric',month:'short',year:'numeric'});

    if(note_id){
      const note=await env.DB.prepare("SELECT * FROM notes WHERE id=? AND user_id=?").bind(note_id,userId).first();
      if(!note) return err("Note not found",404,origin);
      if(make_public&&note.visibility!=='PUBLIC'){
        await env.DB.prepare("UPDATE notes SET visibility='PUBLIC',updated_at=? WHERE id=?").bind(Math.floor(Date.now()/1e3),note_id).run();
        viewLink=`https://notes.jeppesen.cc/api/public/notes/${note_id}`;
      } else if(note.visibility==='PUBLIC'){
        viewLink=`https://notes.jeppesen.cc/api/public/notes/${note_id}`;
      }
      const preview=(note.content||'').slice(0,60).replace(/\n/g,' ');
      subject=`NoteFlow: ${preview}…`;
      const contentHtml=mdToHtml(note.content||'');
      const linkSection=viewLink?`<p style="margin:16px 0 0"><a href="${viewLink}" style="color:#5b6af0;font-size:13px">View note →</a></p>`:'';
      bodyHtml=`<div style="font-family:'DM Sans',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff">
        <div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#a89f94;margin-bottom:12px">NoteFlow · ${now}</div>
        <div style="font-size:15px;line-height:1.7;color:#2c2825">${contentHtml}</div>
        ${linkSection}
      </div>`;
    } else if(tracker_id){
      const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=? AND user_id=?").bind(tracker_id,userId).first();
      if(!tracker) return err("Tracker not found",404,origin);
      const{results:notes}=await env.DB.prepare("SELECT content,created_at FROM tracker_notes WHERE tracker_id=? AND user_id=? ORDER BY created_at DESC LIMIT 30").bind(tracker_id,userId).all();
      subject=`NoteFlow Tracker: ${tracker.name} (${now})`;
      const rows=notes.map(n=>{
        const d=new Date(n.created_at*1000).toLocaleDateString('da-DK',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        return `<div style="border-left:3px solid #e8e2d9;padding:8px 12px;margin-bottom:12px;font-size:14px;color:#2c2825;line-height:1.6">
          <div style="font-size:11px;color:#a89f94;margin-bottom:4px">${d}</div>
          ${mdToHtml(n.content)}
        </div>`;
      }).join('');
      bodyHtml=`<div style="font-family:'DM Sans',sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff">
        <div style="font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#a89f94;margin-bottom:4px">NoteFlow Tracker</div>
        <h2 style="margin:0 0 20px;font-size:20px;color:#2c2825">${tracker.name}</h2>
        ${rows||'<p style="color:#a89f94">No entries yet.</p>'}
      </div>`;
    } else {
      return err("note_id or tracker_id required",400,origin);
    }

    const res=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{"Authorization":`Bearer ${env.RESEND_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        from: env.RESEND_FROM || "NoteFlow <noteflow@jeppesen.cc>",
        to:[to.trim()],
        subject,
        html:bodyHtml,
      })
    });
    if(!res.ok){const e=await res.text();return err(`Email failed: ${e.slice(0,300)}`,502,origin);}
    return json({ok:true},200,origin);
  }

  return null;
}
