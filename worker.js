function nanoid(prefix = "") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix; const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}
function extractTags(content) {
  const matches = content.match(/#([a-zA-Z0-9_\-\u00e6\u00f8\u00e5\u00c6\u00d8\u00c5]+)/g) || [];
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
}
function corsHeaders(origin) {
  const allowed = [
    "https://notes.jeppesen.cc",
    "https://noteflow-v2.pages.dev", // New git connected page
    "https://noteflow.pages.dev",
    "https://noteflow-frontend-dge.pages.dev",
    "https://notepreview.noteflow-frontend-dge.pages.dev",
  ];
  const o = allowed.includes(origin) ? origin : allowed[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Cf-Access-Jwt-Assertion" };
}
function openCors() {
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Partner-Password" };
}
function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } });
}
function jsonOpen(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...openCors() } });
}
function err(msg, status = 400, origin = "") { return json({ error: msg }, status, origin); }
function errOpen(msg, status = 400) { return jsonOpen({ error: msg }, status); }

async function sha256hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function checkPartnerPassword(tokenRow, request) {
  if (!tokenRow.password_hash) return true;
  const provided = request.headers.get("X-Partner-Password") || "";
  if (!provided) return false;
  return (await sha256hex(provided)) === tokenRow.password_hash;
}

// ── AI model helper ───────────────────────────────────────────────────────────

// ai_model field stores "haiku" or "sonnet" (or legacy formats)
function resolveModel(aiModel) {
  if (!aiModel || aiModel === "claude" || aiModel === "sonnet" || aiModel.includes("sonnet")) return "claude-sonnet-4-6";
  if (aiModel === "haiku" || aiModel.includes("haiku")) return "claude-haiku-4-5-20251001";
  // Legacy "anthropic:model" format
  if (aiModel.includes(":")) return aiModel.split(":")[1];
  return "claude-sonnet-4-6";
}

async function verifyJWT(request, env) {
  let token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) { const a = request.headers.get("Authorization") || ""; if (a.startsWith("Bearer ")) token = a.slice(7); }
  if (!token) { const c = request.headers.get("Cookie") || ""; const m = c.match(/CF_Authorization=([^;]+)/); if (m) token = m[1]; }
  if (!token) return null;
  try {
    const { keys } = await (await fetch(`${env.TEAM_DOMAIN}/cdn-cgi/access/certs`)).json();
    const [hB] = token.split(".");
    const header = JSON.parse(atob(hB.replace(/-/g,"+").replace(/_/,"/")));
    const key = keys.find(k => k.kid === header.kid);
    if (!key) return null;
    const ck = await crypto.subtle.importKey("jwk", key, { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["verify"]);
    const [hdr, payload, sig] = token.split(".");
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", ck, Uint8Array.from(atob(sig.replace(/-/g,"+").replace(/_/g,"/")), c=>c.charCodeAt(0)), new TextEncoder().encode(`${hdr}.${payload}`));
    if (!valid) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g,"+").replace(/_/g,"/")));
    if (claims.exp < Math.floor(Date.now()/1e3)) return null;
    const validAuds = env.POLICY_AUD ? env.POLICY_AUD.split(',').map(a => a.trim()) : [];
    if (validAuds.length > 0) {
      const claimAuds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!claimAuds.some(a => validAuds.includes(a))) return null;
    }
    return claims;
  } catch(e) { console.error("JWT verify error:", e.message); return null; }
}

async function ensureUser(db, claims) {
  const alias = await db.prepare("SELECT user_id FROM identity_aliases WHERE jwt_email = ?").bind(claims.email).first();
  const id = alias ? alias.user_id : claims.email;
  await db.prepare("INSERT OR IGNORE INTO users (id, display_name) VALUES (?, ?)").bind(id, claims.name || id).run();
  return id;
}

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

function partnerPage(tokenRow, trackerName) {
  const pwRequired = !!(tokenRow && tokenRow.password_hash);
  const safeTrackerName = trackerName.replace(/`/g, "'");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${safeTrackerName} \u2014 Partner View</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Lora:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f7f4ef;--surface:#fff;--border:#e8e2d9;--text:#2c2825;--text-soft:#6b6560;--muted:#a89f94;--accent:#7c6f9e;--accent-bg:#f0ecf8;--font:'DM Sans',sans-serif;--serif:'Lora',serif}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:0}
#app{width:100%;max-width:680px;min-height:100vh;display:flex;flex-direction:column}
header{padding:20px 24px 16px;border-bottom:1px solid var(--border);background:var(--surface)}
.header-label{font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.header-title{font-family:var(--serif);font-size:20px;font-weight:500}
.header-sub{font-size:13px;color:var(--muted);margin-top:3px}
#chat-area{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:82%;padding:10px 14px;border-radius:14px;font-size:14px;line-height:1.6;animation:fadeIn .2s ease}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.msg.user{background:var(--accent-bg);color:var(--accent);align-self:flex-end;border-bottom-right-radius:4px}
.msg.assistant{background:var(--surface);color:var(--text);align-self:flex-start;border:1px solid var(--border);border-bottom-left-radius:4px}
.msg.assistant p{margin:0 0 8px}.msg.assistant p:last-child{margin:0}
.msg.assistant ul,.msg.assistant ol{padding-left:18px;margin:4px 0}
.msg.assistant strong{font-weight:600}.msg.assistant em{font-style:italic}
.msg.thinking{background:var(--bg);color:var(--muted);align-self:flex-start;font-style:italic;border:1px solid var(--border);border-bottom-left-radius:4px}
.welcome{text-align:center;padding:40px 20px;color:var(--muted)}
.welcome-icon{font-size:48px;margin-bottom:16px}
.welcome h2{font-family:var(--serif);font-size:18px;color:var(--text);margin-bottom:8px}
.welcome p{font-size:14px;line-height:1.6;max-width:360px;margin:0 auto 16px}
.quick-btns{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px}
.quick-btn{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:7px 14px;font-size:13px;color:var(--text-soft);cursor:pointer;font-family:var(--font);transition:all .15s}
.quick-btn:hover{background:var(--accent-bg);color:var(--accent);border-color:var(--accent)}
#input-area{padding:16px 24px 24px;border-top:1px solid var(--border);background:var(--surface)}
.input-row{display:flex;gap:10px;align-items:flex-end}
#msg-input{flex:1;border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:14px;font-family:var(--font);background:var(--bg);color:var(--text);outline:none;resize:none;min-height:42px;max-height:120px;line-height:1.5;transition:border-color .15s}
#msg-input:focus{border-color:var(--accent)}
#send-btn{background:var(--accent);color:#fff;border:none;border-radius:10px;padding:10px 18px;font-size:14px;font-family:var(--font);font-weight:500;cursor:pointer;white-space:nowrap}
#send-btn:disabled{opacity:.5;cursor:not-allowed}
#pw-screen{display:none;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:40px 24px;text-align:center;gap:12px}
#pw-screen h2{font-family:var(--serif);font-size:18px;color:var(--text)}
#pw-screen p{font-size:13px;color:var(--muted);max-width:300px;line-height:1.6}
#pw-input{width:100%;max-width:260px;border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:16px;font-family:var(--font);background:var(--bg);color:var(--text);outline:none;text-align:center;letter-spacing:2px}
#pw-input:focus{border-color:var(--accent)}
#pw-btn{background:var(--accent);color:#fff;border:none;border-radius:10px;padding:10px 28px;font-size:14px;font-family:var(--font);font-weight:500;cursor:pointer}
#pw-btn:disabled{opacity:.5;cursor:not-allowed}
#pw-error{font-size:12px;color:#c0392b;min-height:16px}
#error-state{display:none;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:40px;text-align:center;color:var(--muted)}
#error-state h2{font-family:var(--serif);font-size:18px;color:var(--text);margin:16px 0 8px}
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="header-label">Partner View</div>
    <div class="header-title" id="tracker-title">Loading&#8230;</div>
    <div class="header-sub" id="partner-sub"></div>
  </header>
  <div id="pw-screen">
    <div style="font-size:48px">&#128274;</div>
    <h2 id="pw-title">Set your password</h2>
    <p id="pw-desc">Choose a password to protect this conversation. The person who shared this link cannot see it or reset it.</p>
    <input type="password" id="pw-input" placeholder="Password" autocomplete="new-password">
    <div id="pw-error"></div>
    <button id="pw-btn">Set password</button>
  </div>
  <div id="chat-area">
    <div class="welcome" id="welcome">
      <div class="welcome-icon">&#128156;</div>
      <h2 id="welcome-title">Understanding someone you care about</h2>
      <p id="welcome-desc">Ask me anything.</p>
      <div class="quick-btns">
        <button class="quick-btn" data-q="How have they been doing lately?">How have they been doing lately?</button>
        <button class="quick-btn" data-q="What have they been struggling with?">What have they been struggling with?</button>
        <button class="quick-btn" data-q="How can I best support them right now?">How can I best support them?</button>
        <button class="quick-btn" data-q="What do they need from me?">What do they need from me?</button>
      </div>
    </div>
  </div>
  <div id="error-state">
    <div style="font-size:48px">&#128274;</div>
    <h2>Link not found</h2>
    <p>This partner link may have been revoked or is invalid.</p>
  </div>
  <div id="input-area" style="display:none">
    <div class="input-row">
      <textarea id="msg-input" placeholder="Ask something&#8230;" rows="1"></textarea>
      <button id="send-btn">Send</button>
    </div>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"></script>
<script>
const API = "https://noteflow-api.jeppesen.cc/api";
const params = new URLSearchParams(location.search);
const TOKEN = params.get("token") || "";
const PW_KEY = "partner_pw_" + TOKEN;
let tokenData = null;
let sending = false;
let sessionPw = sessionStorage.getItem(PW_KEY) || "";

marked.use({ breaks: true, gfm: true });

function pwHeaders(extra) {
  const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
  if (sessionPw) h["X-Partner-Password"] = sessionPw;
  return h;
}

function showPwScreen(isFirstTime) {
  document.getElementById("pw-screen").style.display = "flex";
  document.getElementById("chat-area").style.display = "none";
  document.getElementById("input-area").style.display = "none";
  document.getElementById("pw-title").textContent = isFirstTime ? "Set your private password" : "Enter your password";
  document.getElementById("pw-desc").textContent = isFirstTime
    ? "Choose a password. The person who shared this link cannot see it or reset it."
    : "Your conversation is password protected.";
  document.getElementById("pw-btn").textContent = isFirstTime ? "Set password" : "Unlock";
  document.getElementById("pw-btn").onclick = isFirstTime ? doSetPw : doUnlock;
  document.getElementById("pw-input").onkeydown = function(e) { if (e.key === "Enter") document.getElementById("pw-btn").click(); };
  setTimeout(function() { document.getElementById("pw-input").focus(); }, 100);
}

function showChat() {
  document.getElementById("pw-screen").style.display = "none";
  document.getElementById("chat-area").style.display = "flex";
  document.getElementById("input-area").style.display = "block";
}

async function doSetPw() {
  const pw = document.getElementById("pw-input").value.trim();
  if (pw.length < 4) { document.getElementById("pw-error").textContent = "At least 4 characters please"; return; }
  document.getElementById("pw-btn").disabled = true;
  document.getElementById("pw-error").textContent = "";
  try {
    const r = await fetch(API + "/partner/" + TOKEN + "/set-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (!r.ok) throw new Error();
    sessionPw = pw; sessionStorage.setItem(PW_KEY, pw);
    showChat(); await loadConversation();
  } catch(e) {
    document.getElementById("pw-error").textContent = "Something went wrong, try again";
    document.getElementById("pw-btn").disabled = false;
  }
}

async function doUnlock() {
  const pw = document.getElementById("pw-input").value.trim();
  if (!pw) return;
  document.getElementById("pw-btn").disabled = true;
  document.getElementById("pw-error").textContent = "";
  try {
    const r = await fetch(API + "/partner/" + TOKEN + "/check-password", { method: "POST", headers: { "Content-Type": "application/json", "X-Partner-Password": pw } });
    const d = await r.json();
    if (!d.ok) { document.getElementById("pw-error").textContent = "Wrong password"; document.getElementById("pw-btn").disabled = false; return; }
    sessionPw = pw; sessionStorage.setItem(PW_KEY, pw);
    showChat(); await loadConversation();
  } catch(e) {
    document.getElementById("pw-error").textContent = "Something went wrong";
    document.getElementById("pw-btn").disabled = false;
  }
}

async function loadConversation() {
  try {
    const r = await fetch(API + "/partner/" + TOKEN + "/conversation", { headers: pwHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    if (d.conversation && d.conversation.length > 0) {
      document.getElementById("welcome").style.display = "none";
      d.conversation.forEach(function(m) { addMsg(m.role, m.content, false); });
    }
  } catch(e) {}
}

async function init() {
  if (!TOKEN) { showError(); return; }
  try {
    const r = await fetch(API + "/partner/" + TOKEN);
    if (!r.ok) { showError(); return; }
    tokenData = await r.json();
    document.getElementById("tracker-title").textContent = tokenData.tracker_name;
    document.getElementById("partner-sub").textContent = "Hi " + tokenData.partner_name + " \u2014 ask me anything";
    document.getElementById("welcome-title").textContent = "Understanding " + tokenData.owner_display_name;
    document.getElementById("welcome-desc").textContent = tokenData.partner_name + ", I\u2019m here to help you understand what\u2019s been going on. Ask me anything.";
    document.title = tokenData.tracker_name + " \u2014 Partner View";
    if (tokenData.password_required) {
      if (sessionPw) {
        const chk = await fetch(API + "/partner/" + TOKEN + "/check-password", { method: "POST", headers: { "Content-Type": "application/json", "X-Partner-Password": sessionPw } });
        const cd = await chk.json();
        if (cd.ok) { showChat(); await loadConversation(); }
        else { sessionPw = ""; sessionStorage.removeItem(PW_KEY); showPwScreen(false); }
      } else { showPwScreen(false); }
    } else {
      showPwScreen(true);
    }
  } catch(e) { showError(); }
}

function showError() {
  document.getElementById("input-area").style.display = "none";
  document.getElementById("chat-area").innerHTML = "";
  document.getElementById("pw-screen").style.display = "none";
  document.getElementById("error-state").style.display = "flex";
}

function addMsg(role, content, animate) {
  if (animate === undefined) animate = true;
  var welcome = document.getElementById("welcome");
  if (welcome) welcome.style.display = "none";
  var chat = document.getElementById("chat-area");
  var el = document.createElement("div");
  el.className = "msg " + role;
  if (!animate) el.style.animation = "none";
  if (role === "assistant") { el.innerHTML = marked.parse(content); }
  else { el.textContent = content; }
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
  return el;
}

async function send(message) {
  if (!message.trim() || sending || !tokenData) return;
  sending = true;
  document.getElementById("send-btn").disabled = true;
  document.getElementById("msg-input").value = "";
  document.getElementById("msg-input").style.height = "auto";
  addMsg("user", message);
  var thinking = addMsg("thinking", "\ud83d\udc9c Thinking\u2026");
  try {
    var r = await fetch(API + "/partner/" + TOKEN + "/ai", { method: "POST", headers: pwHeaders(), body: JSON.stringify({ message: message }) });
    if (!r.ok) throw new Error("Failed");
    var d = await r.json();
    thinking.remove();
    addMsg("assistant", d.reply);
  } catch(e) {
    thinking.remove();
    addMsg("assistant", "Sorry, something went wrong. Please try again.");
  }
  sending = false;
  document.getElementById("send-btn").disabled = false;
  document.getElementById("msg-input").focus();
}

document.getElementById("send-btn").addEventListener("click", function() { send(document.getElementById("msg-input").value); });
document.getElementById("msg-input").addEventListener("keydown", function(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e.target.value); } });
document.getElementById("msg-input").addEventListener("input", function() { this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 120) + "px"; });
document.querySelectorAll(".quick-btn").forEach(function(btn) { btn.addEventListener("click", function() { send(btn.dataset.q); }); });

init();
</script>
</body>
</html>`;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...openCors(), ...cors } });

    if (url.pathname === "/partner") {
      const token = url.searchParams.get("token") || "";
      const tokenRow = token ? await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(token).first() : null;
      let trackerName = "Partner View";
      if (tokenRow) {
        const tr = await env.DB.prepare("SELECT name FROM tracker_subjects WHERE id=?").bind(tokenRow.tracker_id).first();
        if (tr) trackerName = tr.name;
        await env.DB.prepare("UPDATE tracker_share_tokens SET last_used_at=? WHERE id=?").bind(Math.floor(Date.now()/1e3), tokenRow.id).run();
      }
      return new Response(partnerPage(tokenRow, trackerName), { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" } });
    }

    // ── Partner: set password (recipient sets on first visit) ─────────────────
    const setPwMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/set-password$/);
    if (setPwMatch && request.method === "POST") {
      const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(setPwMatch[1]).first();
      if (!tokenRow) return errOpen("Invalid link", 404);
      const { password } = await request.json();
      if (!password || password.length < 4) return errOpen("Password too short", 400);
      await env.DB.prepare("UPDATE tracker_share_tokens SET password_hash=? WHERE id=?").bind(await sha256hex(password), tokenRow.id).run();
      return jsonOpen({ ok: true });
    }

    // ── Partner: verify password ──────────────────────────────────────────────
    const checkPwMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/check-password$/);
    if (checkPwMatch && request.method === "POST") {
      const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(checkPwMatch[1]).first();
      if (!tokenRow) return errOpen("Invalid link", 404);
      return jsonOpen({ ok: await checkPartnerPassword(tokenRow, request) });
    }

    // ── Partner: metadata ─────────────────────────────────────────────────────
    const partnerValidate = url.pathname.match(/^\/api\/partner\/([^/]+)$/);
    if (partnerValidate && request.method === "GET") {
      const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(partnerValidate[1]).first();
      if (!tokenRow) return errOpen("Invalid or revoked link", 404);
      const tracker = await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(tokenRow.tracker_id).first();
      if (!tracker) return errOpen("Tracker not found", 404);
      const owner = await env.DB.prepare("SELECT display_name FROM users WHERE id=?").bind(tracker.user_id).first();
      await env.DB.prepare("UPDATE tracker_share_tokens SET last_used_at=? WHERE id=?").bind(Math.floor(Date.now()/1e3), tokenRow.id).run();
      return jsonOpen({ tracker_name: tracker.name, partner_name: tokenRow.partner_name, owner_display_name: owner?.display_name || "them", password_required: !!tokenRow.password_hash });
    }

    // ── Partner: conversation (password-gated) ────────────────────────────────
    const partnerConvMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/conversation$/);
    if (partnerConvMatch && request.method === "GET") {
      const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(partnerConvMatch[1]).first();
      if (!tokenRow) return errOpen("Invalid link", 404);
      if (!(await checkPartnerPassword(tokenRow, request))) return errOpen("Password required", 401);
      const { results } = await env.DB.prepare("SELECT role, content, created_at FROM tracker_partner_conversations WHERE token_id=? ORDER BY created_at ASC").bind(tokenRow.id).all();
      return jsonOpen({ conversation: results });
    }

    // ── Partner: AI (password-gated) ──────────────────────────────────────────
    const partnerAIMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/ai$/);
    if (partnerAIMatch && request.method === "POST") {
      const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(partnerAIMatch[1]).first();
      if (!tokenRow) return errOpen("Invalid link", 404);
      if (!(await checkPartnerPassword(tokenRow, request))) return errOpen("Password required", 401);
      const tracker = await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(tokenRow.tracker_id).first();
      if (!tracker) return errOpen("Tracker not found", 404);
      if (!env.ANTHROPIC_KEY) return errOpen("AI not configured", 503);
      const { message } = await request.json();
      if (!message?.trim()) return errOpen("Message required", 400);
      const { results: history } = await env.DB.prepare("SELECT role, content FROM tracker_partner_conversations WHERE token_id=? ORDER BY created_at DESC LIMIT 20").bind(tokenRow.id).all();
      const reply = await callPartnerAI(env, tracker, tokenRow, tracker.user_id, message.trim(), history.reverse());
      const now = Math.floor(Date.now()/1e3);
      await env.DB.batch([
        env.DB.prepare("INSERT INTO tracker_partner_conversations (id,token_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tp_"), tokenRow.id, "user", message.trim(), now),
        env.DB.prepare("INSERT INTO tracker_partner_conversations (id,token_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tp_"), tokenRow.id, "assistant", reply, now+1),
      ]);
      await env.DB.prepare("UPDATE tracker_share_tokens SET last_used_at=? WHERE id=?").bind(now, tokenRow.id).run();
      return jsonOpen({ reply });
    }

    if (url.pathname === "/service-worker.js") {
      return new Response(`// NoteFlow Service Worker v22
// Handles: share target, offline queue, basic shell caching
const CACHE_NAME = 'noteflow-shell-v23';
const API_BASE   = 'https://noteflow-api.jeppesen.cc/api';

// ── Install: cache only the shell HTML — no external deps ────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add('/'))
      .catch(() => { /* non-fatal — proceed without cache */ })
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== 'noteflow-attachments-v1')
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: shell from cache, everything else from network ─────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle share target POST (Android share sheet)
  if (url.pathname === '/share-target' && request.method === 'POST') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // Only cache-first for same-origin navigation (the shell HTML)
  // Only serve cached shell for the root path — let other pages (tracker.html, tagcloud.html) hit the network
  if (request.mode === 'navigate' && url.origin === self.location.origin && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(
      caches.match('/').then(cached => cached || fetch(request))
    );
    return;
  }

  // Everything else (API, attachments, etc.) — network only
});

// ── Share target handler ───────────────────────────────────────────────────────
async function handleShareTarget(event) {
  let title = '', text = '', sharedUrl = '';
  try {
    const formData = await event.request.formData();
    title     = formData.get('title')  || '';
    text      = formData.get('text')   || '';
    sharedUrl = formData.get('url')    || '';
  } catch(e) {}

  // Build note content from shared data
  const parts = [title, text, sharedUrl].map(s => s.trim()).filter(Boolean);
  const content = parts.join('\\n');

  // Try to post to API — if it fails (offline), queue it
  let saved = false;
  try {
    const jwt = await getJwt();
    if (jwt && content) {
      const res = await fetch(API_BASE + '/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({ content }),
      });
      saved = res.ok;
    }
  } catch(e) { /* offline — fall through to queue */ }

  if (!saved && content) {
    await queueMemo(content);
  }

  // Redirect to app after share
  return Response.redirect('/', 303);
}

// ── Offline queue (IndexedDB) ─────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('noteflow-queue', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

async function queueMemo(content) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ content, ts: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function getQueue() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteFromQueue(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('queue', 'readwrite');
    tx.objectStore('queue').delete(id);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

async function flushQueue(jwt) {
  const items = await getQueue();
  if (!items.length) return 0;
  let synced = 0;
  for (const item of items) {
    try {
      const res = await fetch(API_BASE + '/notes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Jwt-Assertion': jwt,
        },
        body: JSON.stringify({ content: item.content }),
      });
      if (res.ok) {
        await deleteFromQueue(item.id);
        synced++;
      }
    } catch(e) { break; } // still offline — stop trying
  }
  return synced;
}

// ── JWT helper: read CF Access cookie from clients ────────────────────────────
async function getJwt() {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => resolve(e.data?.jwt || null);
      client.postMessage({ type: 'GET_JWT' }, [channel.port2]);
      setTimeout(() => resolve(null), 1000);
    });
  }
  return null;
}

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', async event => {
  const { type } = event.data || {};

  if (type === 'QUEUE_MEMO') {
    const { content } = event.data;
    if (content) await queueMemo(content);
    const queue = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_SIZE', size: queue.length });
  }

  if (type === 'GET_QUEUE_SIZE') {
    const queue = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_SIZE', size: queue.length });
  }

  if (type === 'SYNC_QUEUE') {
    const jwt = await getJwt();
    if (!jwt) return;
    const synced = await flushQueue(jwt);
    const remaining = await getQueue();
    event.source?.postMessage({ type: 'QUEUE_FLUSHED', synced, remaining: remaining.length });
  }
});
`, {
        headers:{"Content-Type":"application/javascript","Cache-Control":"no-cache","Access-Control-Allow-Origin":"*","Service-Worker-Allowed":"/"}
      });
    }
        if (url.pathname === "/icon-192.png" || url.pathname === "/pwa/icon-192.png") {
      const b = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAADdUlEQVR42u3cMW9SURjH4XtP3GF1ca6rCw5+CWdI01X4OAZcjaHfxKFdnEzs7NIVFlccOmgaCXBBwj3/51kcFXh/5z1XqW1zRuPpatPADreLYXuu36s18CQH0Rp6kmNoDT7JIbQGn+QQiuGnz46dwdbgk7wNiuEneRsUw09yBMXwkxxBMfwkR1AMP8kRFMNPcgTF8JMcQfH2kKw4/UneAsXwkxyBKxCuQE5/UreADYAN4PQndQvYANgAEB2A6w+p1yAbABsABACBWvd/bAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAcAleeAu2W84H6xpex2S2Hvg0/83/DFf58AtBAPGDLwLPAIQELgDD4XUKwFB4vQIAAYAAQAAgABAACAAEgABAACAAEAAIAAQA9fMzwR1MZuuvl/jnWs4H73w6NgDYAE5abAAQAAgABAACAAGAAEAACAAEAAIAAYAAIIJvg3bg5wFsALABUjlpbQAQAAgABAACAAGAAEAAIAAQAAiA3lhe3zymvFbfBeqg1m+D/j34y+ubx8mXzy9tAJz6NgCnPGn7MvgJW8AGcOpHbwYbINH9+1/eBBsgc/A7DH/NW0AATv3oCFyBDL4rEIY/dQsIwF0/OgJXICe+KxCGP3UL2AAG/yC1/cuwDWD4Y4ffBujr3H96/TB6c/XK4Asg0ujDj6tzRODr0MRKGH4bwBaIHXwBPP/gZ+vBcj5YO/GzuAL1fQt8e/hp+Ltrx9PVxij90cct0PUqlDz4rkDBVyGD7wq0M4Jar0KG3waI3AQGXwCVb4K7UdO8vX/+LGDwXYFyAzb8NkCSj9+ftsDTr+zDX4PiCgQCAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAGAAEAAIAAQAAgABAACAAHAiQO4XQxbbwOJbhfD1gbAFQgEAKkBeA4g8f5vA2ADeAsQgGsQgdcfGwAbYFsZUPvpbwNgA+wqBGo9/bduABGQMPyuQLgCHVoM1HL679wAIqDm4d/rCiQCah3+vZ8BRECNw3/QQ7AIqG34DwpABNQ2/AcHIAJqGv6maZqjhnk8XW287fRx8DtvANuAWob/6A1gG9DXwT95AEKgT4P/3wIQA5c+9GcLQBBc+rPlb2EqUvGbW/T9AAAAAElFTkSuQmCC"), c => c.charCodeAt(0));
      return new Response(b, { headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"} });
    }
    if (url.pathname === "/icon-512.png" || url.pathname === "/pwa/icon-512.png") {
      const b = Uint8Array.from(atob("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"), c => c.charCodeAt(0));
      return new Response(b, { headers:{"Content-Type":"image/png","Cache-Control":"public, max-age=86400","Access-Control-Allow-Origin":"*"} });
    }
        if (url.pathname === "/pwa/manifest.json") {
      const manifest = { id:"/", name:"NoteFlow", short_name:"NoteFlow", description:"Your personal note capture app", start_url:"https://notes.jeppesen.cc/", scope:"https://notes.jeppesen.cc/", display:"standalone", orientation:"portrait", background_color:"#f5f4f0", theme_color:"#5b6af0", icons:[{src:"https://noteflow-api.jeppesen.cc/icon-192.png",sizes:"192x192",type:"image/png",purpose:"any maskable"},{src:"https://noteflow-api.jeppesen.cc/icon-512.png",sizes:"512x512",type:"image/png",purpose:"any maskable"}], share_target:{action:"https://notes.jeppesen.cc/share-target",method:"POST",enctype:"multipart/form-data",params:{title:"title",text:"text",url:"url",files:[{name:"files",accept:["*/*"]}]}}, categories:["productivity","utilities"] };
      return new Response(JSON.stringify(manifest), { headers:{"Content-Type":"application/manifest+json","Access-Control-Allow-Origin":"*","Cache-Control":"public, max-age=3600"} });
    }
    if (url.pathname.startsWith("/pwa/") || url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") return fetch("https://memos-api.jeppesen.cc" + url.pathname);
    const pubMatch = url.pathname.match(/^\/api\/public\/notes\/([^/]+)$/);
    if (pubMatch && request.method === "GET") {
      const note = await env.DB.prepare("SELECT n.id,n.content,n.created_at FROM notes n WHERE n.id=? AND n.visibility='PUBLIC'").bind(pubMatch[1]).first();
      if (!note) return err("Not found", 404, origin);
      const { results: attachments } = await env.DB.prepare("SELECT id,filename,mime_type FROM attachments WHERE note_id=?").bind(pubMatch[1]).all();
      return json({ id:note.id, content:note.content, created_at:note.created_at, attachments }, 200, origin);
    }
    const pubAttMatch = url.pathname.match(/^\/api\/public\/attachments\/([^/]+)$/);
    if (pubAttMatch && request.method === "GET") {
      const att = await env.DB.prepare("SELECT a.r2_key,a.mime_type,a.filename FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.visibility='PUBLIC'").bind(pubAttMatch[1]).first();
      if (!att) return err("Not found", 404, origin);
      const obj = await env.ATTACHMENTS.get(att.r2_key);
      if (!obj) return err("Not found", 404, origin);
      return new Response(obj.body, { headers:{"Content-Type":att.mime_type||"application/octet-stream","Cache-Control":"public, max-age=3600",...corsHeaders(origin)} });
    }

    if (!url.pathname.startsWith("/api/")) return new Response("NoteFlow API v2", { headers: cors });

    let claims;
    const authHeader = request.headers.get("Authorization") || "";
    if (env.MIGRATION_KEY && authHeader === `Bearer ${env.MIGRATION_KEY}`) {
      claims = { email: request.headers.get("X-Migration-User") || "martin@jeppesen.cc", name: "Migration" };
    } else {
      claims = await verifyJWT(request, env);
      if (!claims) return err("Unauthorized", 401, origin);
    }
    const userId = await ensureUser(env.DB, claims);
    const path = url.pathname.replace(/\/$/, "");
    const method = request.method;

    try {
      if (path === "/api/boot" && method === "GET") {
        // Combined boot endpoint: settings + trackers + notes version + project tags in one request
        const [settingsRow, trackersResult, versionRow, projectTagsResult] = await Promise.all([
          env.DB.prepare("SELECT data FROM user_settings WHERE user_id=?").bind(userId).first(),
          env.DB.prepare("SELECT id,name,instructions,ai_model,color,archived,created_at,updated_at FROM tracker_subjects WHERE user_id=? ORDER BY created_at ASC").bind(userId).all(),
          env.DB.prepare("SELECT MAX(updated_at) as v FROM notes WHERE user_id=? AND archived=0").bind(userId).first(),
          env.DB.prepare("SELECT DISTINCT tag FROM note_tags WHERE user_id=? AND tag LIKE 'project:%' ORDER BY tag ASC").bind(userId).all(),
        ]);
        return json({
          settings: settingsRow ? JSON.parse(settingsRow.data) : {},
          trackers: trackersResult.results || [],
          version: versionRow?.v || 0,
          projectTags: (projectTagsResult.results || []).map(r => r.tag),
        }, 200, origin);
      }
      if (path === "/api/me" && method === "GET") { const user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(userId).first(); return json({ user, jwt_email: claims.email }, 200, origin); }
      if (path === "/api/notes/version" && method === "GET") { const row = await env.DB.prepare("SELECT MAX(updated_at) as v FROM notes WHERE user_id=? AND archived=0").bind(userId).first(); return json({ version: row?.v || 0 }, 200, origin); }
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
      if(path==="/api/attachments"&&method==="GET"){const{results}=await env.DB.prepare("SELECT * FROM attachments WHERE user_id=? ORDER BY created_at DESC").bind(userId).all();return json({attachments:results},200,origin);}
      if(path==="/api/attachments"&&method==="POST"){const contentType=request.headers.get("Content-Type")||"";let note_id,filename,mimeType,binary,b64content;if(contentType.includes("application/json")){const body=await request.json();({note_id,filename,type:mimeType,content:b64content}=body);if(!note_id||!filename||!b64content)return err("Missing fields",400,origin);const bs=atob(b64content);binary=new Uint8Array(bs.length);for(let i=0;i<bs.length;i++)binary[i]=bs.charCodeAt(i);}else{note_id=url.searchParams.get("note_id");filename=url.searchParams.get("filename");mimeType=contentType.split(";")[0].trim()||"application/octet-stream";if(!note_id||!filename)return err("Missing params",400,origin);binary=new Uint8Array(await request.arrayBuffer());}const note=await env.DB.prepare("SELECT id FROM notes WHERE id=? AND user_id=?").bind(note_id,userId).first();if(!note)return err("Note not found",404,origin);const attId=nanoid("a_");const r2Key=`${userId}/${note_id}/${attId}/${filename}`;await env.ATTACHMENTS.put(r2Key,binary,{httpMetadata:{contentType:mimeType},customMetadata:{filename,userId,noteId:note_id}});await env.DB.prepare("INSERT INTO attachments (id,note_id,user_id,filename,mime_type,size_bytes,r2_key) VALUES (?,?,?,?,?,?,?)").bind(attId,note_id,userId,filename,mimeType,binary.length,r2Key).run();const skipIndex=url.searchParams.get("skip_index")==="1";const willIndex=!skipIndex&&!!(env.ANTHROPIC_KEY&&shouldIndex(mimeType,filename));if(willIndex){if(!b64content){const C=8192;let s="";for(let i=0;i<binary.length;i+=C)s+=String.fromCharCode(...binary.subarray(i,i+C));b64content=btoa(s);}ctx.waitUntil(indexDocument(env,attId,filename,mimeType,b64content).catch(e=>console.error("Index error:",e.message)));}const attachment=await env.DB.prepare("SELECT * FROM attachments WHERE id=?").bind(attId).first();return json({attachment,indexing:willIndex,indexed:false},201,origin);}
      const attIndexMatch=path.match(/^\/api\/attachments\/([^/]+)\/index$/);if(attIndexMatch&&method==="GET"){const attId=attIndexMatch[1];const att=await env.DB.prepare("SELECT id FROM attachments WHERE id=? AND user_id=?").bind(attId,userId).first();if(!att)return err("Not found",404,origin);const row=await env.DB.prepare("SELECT text_content FROM document_index WHERE attachment_id=?").bind(attId).first();const attRow=await env.DB.prepare("SELECT filename,mime_type FROM attachments WHERE id=?").bind(attId).first();return json({text:row?.text_content||null,indexable:attRow?shouldIndex(attRow.mime_type,attRow.filename):false,pending:attRow?shouldIndex(attRow.mime_type,attRow.filename)&&!row:false},200,origin);}
      const attMatch=path.match(/^\/api\/attachments\/([^/]+)$/);if(attMatch){const attId=attMatch[1];if(method==="GET"){const att=await env.DB.prepare("SELECT * FROM attachments WHERE id=? AND user_id=?").bind(attId,userId).first();if(!att)return err("Not found",404,origin);const obj=await env.ATTACHMENTS.get(att.r2_key);if(!obj)return err("File not found",404,origin);return new Response(obj.body,{headers:{"Content-Type":att.mime_type,"Content-Disposition":`inline; filename="${att.filename}"`,"Cache-Control":"private, max-age=3600",...cors}});}if(method==="DELETE"){const att=await env.DB.prepare("SELECT * FROM attachments WHERE id=? AND user_id=?").bind(attId,userId).first();if(!att)return err("Not found",404,origin);await env.ATTACHMENTS.delete(att.r2_key);await env.DB.prepare("DELETE FROM attachments WHERE id=?").bind(attId).run();return json({deleted:true},200,origin);}}

      if(path==="/api/search"&&method==="POST"){const{q}=await request.json();if(!q||q.trim().length<2)return json({notes:[]},200,origin);const term=`%${q.trim()}%`;const{results:nr}=await env.DB.prepare("SELECT n.id,n.content,n.created_at,n.updated_at,n.visibility,n.pinned,n.archived,GROUP_CONCAT(nt.tag) as tags_csv,NULL as matched_file FROM notes n LEFT JOIN note_tags nt ON nt.note_id=n.id WHERE n.user_id=? AND n.archived=0 AND n.content LIKE ? GROUP BY n.id ORDER BY n.created_at DESC LIMIT 50").bind(userId,term).all();const{results:dr}=await env.DB.prepare("SELECT n.id,n.content,n.created_at,n.updated_at,n.visibility,n.pinned,n.archived,GROUP_CONCAT(nt.tag) as tags_csv,a.filename as matched_file FROM document_index di JOIN attachments a ON a.id=di.attachment_id JOIN notes n ON n.id=a.note_id LEFT JOIN note_tags nt ON nt.note_id=n.id WHERE n.user_id=? AND n.archived=0 AND di.text_content LIKE ? GROUP BY n.id ORDER BY n.created_at DESC LIMIT 20").bind(userId,term).all();const seen=new Set();const merged=[];for(const n of[...nr,...dr]){if(!seen.has(n.id)){seen.add(n.id);merged.push({...n,tags:n.tags_csv?n.tags_csv.split(","):[],tags_csv:void 0});}}if(merged.length>0){const ids=merged.map(n=>n.id);const ph=ids.map(()=>"?").join(",");const{results:atts}=await env.DB.prepare(`SELECT * FROM attachments WHERE note_id IN (${ph})`).bind(...ids).all();const am={};for(const a of atts){if(!am[a.note_id])am[a.note_id]=[];am[a.note_id].push(a);}for(const n of merged)n.attachments=am[n.id]||[];}return json({notes:merged},200,origin);}
      if(path==="/api/admin/reindex"&&method==="POST"){const{results:u}=await env.DB.prepare("SELECT a.id,a.filename,a.mime_type,a.r2_key FROM attachments a WHERE a.user_id=? AND a.id NOT IN (SELECT attachment_id FROM document_index)").bind(userId).all();const toIndex=u.filter(a=>shouldIndex(a.mime_type,a.filename));if(!toIndex.length)return json({done:true,remaining:0},200,origin);const att=toIndex[0];let status="ok";try{const obj=await env.ATTACHMENTS.get(att.r2_key);if(!obj){status="r2_miss";}else{const buf=await obj.arrayBuffer();const bytes=new Uint8Array(buf);let bin="";for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,Math.min(i+32768,bytes.length)));await indexDocument(env,att.id,att.filename,att.mime_type,btoa(bin));}}catch(e){status="error";console.error("reindex",att.filename,e.message);}await env.DB.prepare("INSERT OR IGNORE INTO document_index (attachment_id,text_content,indexed_at) VALUES (?,?,?)").bind(att.id,"",Math.floor(Date.now()/1e3)).run();return json({done:false,remaining:toIndex.length-1,indexed:{id:att.id,filename:att.filename,status}},200,origin);}
      if(path==="/api/notes/tag-contexts"&&method==="POST"){const{ids}=await request.json();if(!Array.isArray(ids)||!ids.length)return json({},200,origin);const safe=ids.slice(0,90);const ph=safe.map(()=>"?").join(",");const{results:notes}=await env.DB.prepare(`SELECT id,content FROM notes WHERE id IN (${ph}) AND user_id=?`).bind(...safe,userId).all();const{results:indexed}=await env.DB.prepare(`SELECT a.note_id,di.text_content FROM attachments a JOIN document_index di ON di.attachment_id=a.id WHERE a.note_id IN (${ph}) AND a.user_id=?`).bind(...safe,userId).all();const im={};for(const r of indexed){if(!im[r.note_id])im[r.note_id]=[];im[r.note_id].push(r.text_content||"");}const contexts={};for(const n of notes){const p=[n.content||"",...im[n.id]||[]].filter(s=>s.trim());contexts[n.id]=p.join("\n\n").slice(0,4e3);}return json(contexts,200,origin);}

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

      if(path==="/api/notes/autotag"&&method==="POST"){
        const{content,categories=[],people=[]}=await request.json();
        if(!content?.trim()) return json({tags:[]},200,origin);
        const stripped=(content||'').replace(/#[\w\u00C0-\u024F-]+/g,'').replace(/<[^>]+>/g,'').trim().slice(0,2000);
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

      if(path==="/api/user/settings"&&method==="GET"){await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')").run();const row=await env.DB.prepare("SELECT data FROM user_settings WHERE user_id=?").bind(userId).first();return json(row?JSON.parse(row.data):{},200,origin);}
      if(path==="/api/user/settings"&&method==="PUT"){await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}')").run();const body=await request.json();await env.DB.prepare("INSERT OR REPLACE INTO user_settings (user_id,data) VALUES (?,?)").bind(userId,JSON.stringify(body)).run();return json({ok:true},200,origin);}

      if(path==="/api/trackers"&&method==="GET"){const{results}=await env.DB.prepare("SELECT id,name,instructions,ai_model,color,archived,created_at,updated_at FROM tracker_subjects WHERE user_id=? ORDER BY created_at ASC").bind(userId).all();return json({trackers:results},200,origin);}
      if(path==="/api/trackers"&&method==="POST"){const body=await request.json();const{name,instructions="",ai_model="claude",color=null}=body;if(!name?.trim())return err("Name required",400,origin);const id=nanoid("tr_");const now=Math.floor(Date.now()/1e3);await env.DB.prepare("INSERT INTO tracker_subjects (id,user_id,name,instructions,ai_model,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").bind(id,userId,name.trim(),instructions,ai_model,color,now,now).run();const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(id).first();return json({tracker},201,origin);}
      const trackerMatch=path.match(/^\/api\/trackers\/([^/]+)$/);
      if(trackerMatch){const tid=trackerMatch[1];const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="GET")return json({tracker},200,origin);if(method==="PATCH"){const body=await request.json();const name=body.name!==void 0?body.name.trim():tracker.name;const instructions=body.instructions!==void 0?body.instructions:tracker.instructions;const ai_model=body.ai_model!==void 0?body.ai_model:tracker.ai_model;const color=body.color!==void 0?body.color:tracker.color;const archived=body.archived!==void 0?(body.archived?1:0):(tracker.archived||0);await env.DB.prepare("UPDATE tracker_subjects SET name=?,instructions=?,ai_model=?,color=?,archived=?,updated_at=? WHERE id=?").bind(name,instructions,ai_model,color,archived,Math.floor(Date.now()/1e3),tid).run();const updated=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(tid).first();return json({tracker:updated},200,origin);}if(method==="DELETE"){await env.DB.prepare("DELETE FROM tracker_subjects WHERE id=?").bind(tid).run();return json({deleted:true},200,origin);}}
      const trackerExportMatch=path.match(/^\/api\/trackers\/([^/]+)\/export$/);
      if(trackerExportMatch&&method==="GET"){const tid=trackerExportMatch[1];const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);const{results:notes}=await env.DB.prepare("SELECT id,content,created_at FROM tracker_notes WHERE tracker_id=? AND user_id=? ORDER BY created_at ASC").bind(tid,userId).all();const{results:conversation}=await env.DB.prepare("SELECT role,content,created_at FROM tracker_conversations WHERE tracker_id=? AND content NOT LIKE '[Auto]%' ORDER BY created_at ASC").bind(tid).all();return json({tracker,notes,conversation},200,origin);}

      const partnerTokensMatch=path.match(/^\/api\/trackers\/([^/]+)\/partner-tokens$/);
      if(partnerTokensMatch){const tid=partnerTokensMatch[1];const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="GET"){const{results}=await env.DB.prepare("SELECT id,token,partner_name,partner_instructions,partner_language,created_at,last_used_at FROM tracker_share_tokens WHERE tracker_id=? ORDER BY created_at DESC").bind(tid).all();return json({tokens:results},200,origin);}if(method==="POST"){const body=await request.json();const{partner_name="Partner",partner_instructions="",partner_language="da"}=body;const token=nanoid("ptk_");const id=nanoid("tst_");const now=Math.floor(Date.now()/1e3);await env.DB.prepare("INSERT INTO tracker_share_tokens (id,tracker_id,token,partner_name,partner_instructions,partner_language,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,tid,token,partner_name,partner_instructions,partner_language,now).run();const row=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=?").bind(id).first();return json({token:row},201,origin);}}
      const partnerTokenMatch=path.match(/^\/api\/trackers\/([^/]+)\/partner-tokens\/([^/]+)$/);
      if(partnerTokenMatch){const[,tid,tokenId]=partnerTokenMatch;const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="PATCH"){const body=await request.json();const existing=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=? AND tracker_id=?").bind(tokenId,tid).first();if(!existing)return err("Not found",404,origin);const pname=body.partner_name!==void 0?body.partner_name:existing.partner_name;const pinstr=body.partner_instructions!==void 0?body.partner_instructions:existing.partner_instructions;const plang=body.partner_language!==void 0?body.partner_language:(existing.partner_language||"da");await env.DB.prepare("UPDATE tracker_share_tokens SET partner_name=?,partner_instructions=?,partner_language=? WHERE id=?").bind(pname,pinstr,plang,tokenId).run();const updated=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=?").bind(tokenId).first();return json({token:updated},200,origin);}if(method==="DELETE"){await env.DB.prepare("DELETE FROM tracker_share_tokens WHERE id=? AND tracker_id=?").bind(tokenId,tid).run();return json({deleted:true},200,origin);}}

      const trackerNotesMatch=path.match(/^\/api\/trackers\/([^/]+)\/notes$/);
      if(trackerNotesMatch){const tid=trackerNotesMatch[1];const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="GET"){const ps=Math.min(parseInt(url.searchParams.get("pageSize")||"30"),100);const cursor=url.searchParams.get("cursor");let where="tracker_id=? AND user_id=?";const p=[tid,userId];if(cursor){where+=" AND created_at<?";p.push(parseInt(cursor));}p.push(ps+1);const{results:notes}=await env.DB.prepare(`SELECT * FROM tracker_notes WHERE ${where} ORDER BY created_at DESC LIMIT ?`).bind(...p).all();const hasMore=notes.length>ps;if(hasMore)notes.pop();return json({notes,nextCursor:hasMore?notes[notes.length-1].created_at:null},200,origin);}if(method==="POST"){const body=await request.json();const{content=""}=body;if(!content.trim())return err("Content required",400,origin);const id=nanoid("tn_");const now=Math.floor(Date.now()/1e3);await env.DB.prepare("INSERT INTO tracker_notes (id,tracker_id,user_id,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(id,tid,userId,content,now,now).run();const note=await env.DB.prepare("SELECT * FROM tracker_notes WHERE id=?").bind(id).first();const tf=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(tid).first();if(tf?.instructions&&env.ANTHROPIC_KEY){ctx.waitUntil((async()=>{try{const r=await callTrackerAI(env,tf,userId,`New entry logged: ${content}`,[]);if(r){const t=Math.floor(Date.now()/1e3);await env.DB.batch([env.DB.prepare("INSERT INTO tracker_conversations (id,tracker_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tc_"),tid,"user",`[Auto] New entry: ${content}`,t),env.DB.prepare("INSERT INTO tracker_conversations (id,tracker_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tc_"),tid,"assistant",r,t+1)]);}}catch(e){console.error("Auto AI reply:",e.message);}})());}return json({note},201,origin);}}
      const trackerNoteMatch=path.match(/^\/api\/trackers\/([^/]+)\/notes\/([^/]+)$/);
      if(trackerNoteMatch){const[,tid,nid]=trackerNoteMatch;const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);const note=await env.DB.prepare("SELECT * FROM tracker_notes WHERE id=? AND tracker_id=?").bind(nid,tid).first();if(!note)return err("Not found",404,origin);if(method==="PATCH"){const body=await request.json();const content=body.content!==void 0?body.content:note.content;await env.DB.prepare("UPDATE tracker_notes SET content=?,updated_at=? WHERE id=?").bind(content,Math.floor(Date.now()/1e3),nid).run();return json({note:await env.DB.prepare("SELECT * FROM tracker_notes WHERE id=?").bind(nid).first()},200,origin);}if(method==="DELETE"){await env.DB.prepare("DELETE FROM tracker_notes WHERE id=?").bind(nid).run();return json({deleted:true},200,origin);}}
      const trackerConvMatch=path.match(/^\/api\/trackers\/([^/]+)\/conversation$/);
      if(trackerConvMatch){const tid=trackerConvMatch[1];const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="GET"){const{results}=await env.DB.prepare("SELECT id,role,content,created_at FROM tracker_conversations WHERE tracker_id=? ORDER BY created_at ASC").bind(tid).all();return json({conversation:results},200,origin);}if(method==="DELETE"){await env.DB.prepare("DELETE FROM tracker_conversations WHERE tracker_id=?").bind(tid).run();return json({ok:true},200,origin);}}
      const trackerAIMatch=path.match(/^\/api\/trackers\/([^/]+)\/ai$/);
      if(trackerAIMatch&&method==="POST"){const tid=trackerAIMatch[1];const tracker=await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);const{message}=await request.json();if(!message?.trim())return err("Message required",400,origin);const{results:history}=await env.DB.prepare("SELECT role,content FROM tracker_conversations WHERE tracker_id=? ORDER BY created_at DESC LIMIT 20").bind(tid).all();const reply=await callTrackerAI(env,tracker,userId,message.trim(),history.reverse());const now=Math.floor(Date.now()/1e3);await env.DB.batch([env.DB.prepare("INSERT INTO tracker_conversations (id,tracker_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tc_"),tid,"user",message.trim(),now),env.DB.prepare("INSERT INTO tracker_conversations (id,tracker_id,role,content,created_at) VALUES (?,?,?,?,?)").bind(nanoid("tc_"),tid,"assistant",reply,now+1)]);return json({reply},200,origin);}

      return err("Not found", 404, origin);
    } catch(e) {
      console.error("API error:", e.message, e.stack);
      return err("Internal server error", 500, origin);
    }
  }
};

function shouldIndex(mimeType,filename){if(mimeType&&mimeType.startsWith("image/"))return true;const ext=filename.split(".").pop().toLowerCase();return["pdf","docx","doc","xlsx","xls","odt","ods","odp","txt","md","csv","json","xml"].includes(ext);}
async function indexDocument(env,attId,filename,mimeType,b64content){const ext=filename.split(".").pop().toLowerCase();let text="";if(["txt","md","csv","json","xml"].includes(ext)||(mimeType&&mimeType.startsWith("text/"))){text=new TextDecoder().decode(Uint8Array.from(atob(b64content),c=>c.charCodeAt(0))).slice(0,5e4);}else if(["docx","doc"].includes(ext)){const r=await extractDocxText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(["xlsx","xls"].includes(ext)){const r=await extractXlsxText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(["odt","ods","odp"].includes(ext)){const r=await extractOdfText(b64content);text=r&&env.ANTHROPIC_KEY?await extractTextViaAnthropic(env,r):r;}else if(ext==="pdf"||mimeType==="application/pdf"){if(env.ANTHROPIC_KEY)text=await extractViaAnthropic(env,filename,"application/pdf",b64content);}else if(mimeType&&mimeType.startsWith("image/")){if(env.ANTHROPIC_KEY)text=await extractViaAnthropic(env,filename,mimeType,b64content);}if(text.trim())await env.DB.prepare("INSERT OR REPLACE INTO document_index (attachment_id,text_content,indexed_at) VALUES (?,?,?)").bind(attId,text.slice(0,5e4),Math.floor(Date.now()/1e3)).run();}
function arr2str(arr,from,to){let s="";const end=Math.min(to,arr.length);for(let i=from;i<end;i++){const c=arr[i];s+=(c>=32&&c<128)||c===9||c===10||c===13?String.fromCharCode(c):" ";}return s;}
async function extractZipEntry(arr,entryName){let pos=0;while(pos<arr.length-30){if(arr[pos]!==80||arr[pos+1]!==75||arr[pos+2]!==3||arr[pos+3]!==4){pos++;continue;}const compression=arr[pos+8]|arr[pos+9]<<8;const compSize=arr[pos+18]|arr[pos+19]<<8|arr[pos+20]<<16|arr[pos+21]<<24;const fnLen=arr[pos+26]|arr[pos+27]<<8;const extraLen=arr[pos+28]|arr[pos+29]<<8;const fnStart=pos+30;const dataStart=fnStart+fnLen+extraLen;const fn=arr2str(arr,fnStart,fnStart+fnLen);if(fn===entryName||fn.endsWith("/"+entryName)){const data=arr.slice(dataStart,dataStart+compSize);if(compression===0)return new TextDecoder().decode(data);if(compression===8){try{const ds=new DecompressionStream("raw");const w=ds.writable.getWriter();w.write(data);w.close();return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());}catch(e){try{const ds2=new DecompressionStream("deflate-raw");const w2=ds2.writable.getWriter();w2.write(data);w2.close();return new TextDecoder().decode(await new Response(ds2.readable).arrayBuffer());}catch(e2){return "";}}}}pos=dataStart+(compSize>0?compSize:0);if(pos<=fnStart)pos=fnStart+1;}return "";}
async function extractDocxText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);const xml=await extractZipEntry(arr,"word/document.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractXlsxText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);let xml=await extractZipEntry(arr,"xl/sharedStrings.xml");if(xml){const t=(xml.match(/<t[^>]*>([^<]+)<\/t>/g)||[]).map(m=>m.replace(/<[^>]+>/g,"")).join(" ").trim();if(t)return t;}xml=await extractZipEntry(arr,"xl/worksheets/sheet1.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractOdfText(b64){try{const bin=atob(b64);const arr=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);const xml=await extractZipEntry(arr,"content.xml");return xml?xml.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"";}catch(e){return "";}}
async function extractTextViaAnthropic(env,rawText){try{const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1e3,messages:[{role:"user",content:"Clean up this raw text extracted from an Office document. Remove XML artifacts, fix spacing, return just readable content. May be Danish or English.\n\n"+rawText.slice(0,8e3)}]})});const data=await res.json();return data.content?.[0]?.text||rawText;}catch(e){return rawText;}}
async function extractViaAnthropic(env,filename,mimeType,b64content){try{const isImage=mimeType&&mimeType.startsWith("image/");const cb=isImage?{type:"image",source:{type:"base64",media_type:mimeType,data:b64content}}:{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64content}};const prompt=isImage?"Describe what is in this image and extract any visible text. Be thorough but concise. Content may be in Danish or English.":"Extract all text content from this document. Return only the raw text, no commentary.";const headers={"Content-Type":"application/json","x-api-key":env.ANTHROPIC_KEY,"anthropic-version":"2023-06-01"};if(!isImage)headers["anthropic-beta"]="pdfs-2024-09-25";const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers,body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1e3,messages:[{role:"user",content:[cb,{type:"text",text:prompt}]}]})});const data=await res.json();if(!res.ok){console.error("extractViaAnthropic error",res.status,filename,JSON.stringify(data).slice(0,300));return "";}return data.content?.[0]?.text||"";}catch(e){console.error("extractViaAnthropic exception",filename,e.message);return "";}}
