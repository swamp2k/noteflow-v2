import { resolveModel } from "./auth.js";

async function ensureTagEmbeddingsTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS tag_embeddings (user_id TEXT NOT NULL, tag TEXT NOT NULL, vector TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, tag))").run();
}

async function buildTrackerContext(env, tracker, userId) {
  const thirtyDaysAgo = Math.floor(Date.now()/1e3) - 30*24*60*60;
  const rawCutoff = Math.max(thirtyDaysAgo, tracker.summary_covers_until || 0);
  const { results: recentNotes } = await env.DB.prepare("SELECT content, created_at FROM tracker_notes WHERE tracker_id=? AND user_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 100").bind(tracker.id, userId, rawCutoff).all();
  const { results: oldNotes } = await env.DB.prepare("SELECT content, created_at FROM tracker_notes WHERE tracker_id=? AND user_id=? AND created_at<? ORDER BY created_at ASC LIMIT 200").bind(tracker.id, userId, rawCutoff).all();
  let summary = tracker.context_summary || null;
  if (oldNotes.length > 0 && (!tracker.summary_updated_at || (Math.floor(Date.now()/1e3) - tracker.summary_updated_at) > 7*24*60*60) && env.ANTHROPIC_KEY) {
    const oldText = oldNotes.map(n => `${new Date(n.created_at*1000).toLocaleDateString("da-DK")}: ${n.content}`).join("\n");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method:"POST", headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"}, body:JSON.stringify({ model:"claude-haiku-4-5-20251001", max_tokens:800, messages:[{role:"user",content:`Create a concise clinical-style summary of these tracking entries for subject "${tracker.name}". Include: date range covered, key metrics, notable events, trends, patterns. Be dense and factual.\n\n${oldText.slice(0,12000)}`}] }) });
      const d = await r.json(); summary = d.content?.[0]?.text || summary;
      const now = Math.floor(Date.now()/1e3);
      await env.DB.prepare("UPDATE tracker_subjects SET context_summary=?,summary_updated_at=?,summary_covers_until=?,updated_at=? WHERE id=?").bind(summary,now,rawCutoff,now,tracker.id).run();
    } catch(e) { console.error("Summary failed:", e.message); }
  }
  return { recentNotes, summary };
}

async function callTrackerAI(env, tracker, userId, userMessage, conversationHistory) {
  const { recentNotes, summary } = await buildTrackerContext(env, tracker, userId);
  const notesText = recentNotes.length > 0 ? recentNotes.map(n=>`${new Date(n.created_at*1000).toLocaleDateString("da-DK")}: ${n.content}`).join("\n") : "(No recent entries yet)";
  const model = resolveModel(tracker.ai_model);

  // Use system array format to enable prompt caching on the large context block
  // The journal entries + summary are the expensive part — cache them for 5 min
  const systemBlocks = [
    { type: "text", text: `You are a personal tracking assistant for the subject: "${tracker.name}".\n${tracker.instructions ? `\nUser instructions:\n${tracker.instructions}\n` : ""}\nHelp the user identify patterns, ask follow-up questions, summarize. Respond in the same language (Danish or English).` },
    { type: "text", text: `${summary ? `[HISTORICAL SUMMARY]\n${summary}\n\n` : ""}[RECENT ENTRIES]\n${notesText}`, cache_control: { type: "ephemeral" } }
  ];

  const messages = [...conversationHistory.map(c=>({role:c.role,content:c.content})), {role:"user",content:userMessage}];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31" },
    body: JSON.stringify({ model, max_tokens: 1024, system: systemBlocks, messages })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "AI call failed");
  return data.content?.[0]?.text || "";
}

async function callPartnerAI(env, tracker, tokenRow, userId, userMessage, partnerHistory) {
  const { recentNotes, summary } = await buildTrackerContext(env, tracker, userId);
  const noteCount = recentNotes.length;
  const dateRange = noteCount > 0
    ? `${new Date(recentNotes[recentNotes.length-1].created_at*1000).toLocaleDateString("da-DK")} - ${new Date(recentNotes[0].created_at*1000).toLocaleDateString("da-DK")}`
    : "no entries yet";
  const internalContext = recentNotes.map(n=>`${new Date(n.created_at*1000).toLocaleDateString("da-DK")}: ${n.content}`).join("\n");
  const langMap = { da:"Danish", en:"English", de:"German", sv:"Swedish", no:"Norwegian" };
  const langName = langMap[tokenRow.partner_language] || tokenRow.partner_language || "Danish";
  const system = `You are a compassionate AI interpreter helping ${tokenRow.partner_name || "a partner"} understand someone they care about.\n\nThe person being understood has been journaling about: "${tracker.name}".\nThere are ${noteCount} recent entries (${dateRange}).\n\n${summary ? `Background context (summary of older entries):\n${summary}\n` : ""}Internal journal entries (for your context ONLY - never quote or reveal these directly):\n---\n${internalContext || "(No entries yet)"}\n---\n\n${tokenRow.partner_instructions ? `Special guidance from the journal owner:\n${tokenRow.partner_instructions}\n\n` : ""}YOUR ROLE:\n- Help ${tokenRow.partner_name || "the partner"} understand what the journal owner is going through\n- Speak about the journal owner in third person\n- Interpret and explain patterns, feelings, and needs - do NOT quote journal entries directly\n- Be warm, empathetic, and thoughtful\n- ALWAYS respond in ${langName}, regardless of what language the journal entries are written in\n- Never reveal that you have access to specific journal text`;
  const messages = [...partnerHistory.map(c=>({role:c.role,content:c.content})), {role:"user",content:userMessage}];
  const model = resolveModel(tracker.ai_model);
  // Partner AI also uses prompt caching for the large context block
  const systemBlocks = [
    { type: "text", text: system.split("\n---\n")[0] || system },
    { type: "text", text: "---\n" + (system.split("\n---\n")[1] || ""), cache_control: { type: "ephemeral" } }
  ];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31" },
    body: JSON.stringify({ model, max_tokens: 1024, system: systemBlocks, messages })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "AI call failed");
  return data.content?.[0]?.text || "";
}

function shouldIndex(mimeType,filename){if(mimeType&&mimeType.startsWith("image/"))return true;const ext=filename.split(".").pop().toLowerCase();return["pdf","docx","doc","xlsx","xls","odt","ods","odp","txt","md","csv","json","xml"].includes(ext);}
async function indexDocument(env,attId,filename,mimeType,b64content){const ext=filename.split(".").pop().toLowerCase();let text="";if(["txt","md","csv","json","xml"].includes(ext)||(mimeType&&mimeType.startsWith("text/"))){text=new TextDecoder().decode(Uint8Array.from(atob(b64content),c=>c.charCodeAt(0))).slice(0,5e4);}else if(["docx","doc"].includes(ext)){const r=await extractDocxText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(["xlsx","xls"].includes(ext)){const r=await extractXlsxText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(["odt","ods","odp"].includes(ext)){const r=await extractOdfText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(ext==="pdf"||mimeType==="application/pdf"){if(env.ANTHROPIC_KEY)text=await extractViaAnthropic(env,filename,"application/pdf",b64content);}else if(mimeType&&mimeType.startsWith("image/")){if(env.ANTHROPIC_KEY)text=await extractViaAnthropic(env,filename,mimeType,b64content);}if(text.trim())await env.DB.prepare("INSERT OR REPLACE INTO document_index (attachment_id,text_content,indexed_at) VALUES (?,?,?)").bind(attId,text.slice(0,5e4),Math.floor(Date.now()/1e3)).run();}
function arr2str(arr,from,to){let s="";const end=Math.min(to,arr.length);for(let i=from;i<end;i++){const c=arr[i];s+=(c>=32&&c<128)||c===9||c===10||c===13?String.fromCharCode(c):" ";}return s;}
async function extractZipEntry(arr,entryName){let pos=0;while(pos<arr.length-30){if(arr[pos]!==80||arr[pos+1]!==75||arr[pos+2]!==3||arr[pos+3]!==4){pos++;continue;}const compression=arr[pos+8]|arr[pos+9]<<8;const compSize=arr[pos+18]|arr[pos+19]<<8|arr[pos+20]<<16|arr[pos+21]<<24;const fnLen=arr[pos+26]|arr[pos+27]<<8;const extraLen=arr[pos+28]|arr[pos+29]<<8;const fnStart=pos+30;const dataStart=fnStart+fnLen+extraLen;const fn=arr2str(arr,fnStart,fnStart+fnLen);if(fn===entryName||fn.endsWith("/"+entryName)){const data=arr.slice(dataStart,dataStart+compSize);if(compression===0)return new TextDecoder().decode(data);if(compression===8){try{const ds=new DecompressionStream("raw");const w=ds.writable.getWriter();w.write(data);w.close();return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());}catch(e){try{const ds2=new DecompressionStream("deflate-raw");const w2=ds2.writable.getWriter();w2.write(data);w2.close();return new TextDecoder().decode(await new Response(ds2.readable).arrayBuffer());}catch(e2){return "";}}}}pos=dataStart+(compSize>0?compSize:0);if(pos<=fnStart)pos=fnStart+1;}return "";}
async function extractDocxText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);const xml=await extractZipEntry(arr,"word/document.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractXlsxText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);let xml=await extractZipEntry(arr,"xl/sharedStrings.xml");if(xml){const t=(xml.match(/<t[^>]*>([^<]+)<\/t>/g)||[]).map(m=>m.replace(/<[^>]+>/g,"")).join(" ").trim();if(t)return t;}xml=await extractZipEntry(arr,"xl/worksheets/sheet1.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractOdfText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);const xml=await extractZipEntry(arr,"content.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractTextViaAnthropic(env,rawText){try{const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1e3,messages:[{role:"user",content:"Clean up this raw text extracted from an Office document. Remove XML artifacts, fix spacing, return just readable content. May be Danish or English.\n\n"+rawText.slice(0,8e3)}]})});const data=await res.json();return data.content?.[0]?.text||rawText;}catch(e){return rawText;}}
async function extractViaAnthropic(env,filename,mimeType,b64content){try{const isImage=mimeType&&mimeType.startsWith("image/");const cb=isImage?{type:"image",source:{type:"base64",media_type:mimeType,data:b64content}}:{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64content}};const prompt=isImage?"Describe what is in this image and extract any visible text. Be thorough but concise. Content may be in Danish or English.":"Extract all text content from this document. Return only the raw text, no commentary.";const headers={"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"};if(!isImage)headers["anthropic-beta"]="pdfs-2024-09-25";const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers,body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1e3,messages:[{role:"user",content:[cb,{type:"text",text:prompt}]}]})});const data=await res.json();if(!res.ok){console.error("extractViaAnthropic error",res.status,filename,JSON.stringify(data).slice(0,300));return "";}return data.content?.[0]?.text||"";}catch(e){console.error("extractViaAnthropic exception",filename,e.message);return "";}}

export { ensureTagEmbeddingsTable, buildTrackerContext, callTrackerAI, callPartnerAI, shouldIndex, indexDocument, arr2str, extractZipEntry, extractDocxText, extractXlsxText, extractOdfText, extractTextViaAnthropic, extractViaAnthropic };
