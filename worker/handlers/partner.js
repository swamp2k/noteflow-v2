import { json, jsonOpen, err, errOpen, nanoid, sha256hex } from "../lib/utils.js";
import { checkPartnerPassword } from "../lib/auth.js";
import { callPartnerAI } from "../lib/ai.js";

function partnerPage(tokenRow, trackerName) {
  const pwRequired = !!(tokenRow && tokenRow.password_hash);
  const safeTrackerName = trackerName.replace(/`/g, "'");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<title>${safeTrackerName} — Partner View</title>
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
    document.getElementById("partner-sub").textContent = "Hi " + tokenData.partner_name + " — ask me anything";
    document.getElementById("welcome-title").textContent = "Understanding " + tokenData.owner_display_name;
    document.getElementById("welcome-desc").textContent = tokenData.partner_name + ", I’m here to help you understand what’s been going on. Ask me anything.";
    document.title = tokenData.tracker_name + " — Partner View";
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
  var thinking = addMsg("thinking", "💜 Thinking…");
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

export async function partnerHandler(request, env, ctx, url, path, method, userId, origin) {
  // ── /partner page ─────────────────────────────────────────────────────────────
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

  // ── Partner: set password (recipient sets on first visit) ─────────────────────
  const setPwMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/set-password$/);
  if (setPwMatch && method === "POST") {
    const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(setPwMatch[1]).first();
    if (!tokenRow) return errOpen("Invalid link", 404);
    const { password } = await request.json();
    if (!password || password.length < 4) return errOpen("Password too short", 400);
    await env.DB.prepare("UPDATE tracker_share_tokens SET password_hash=? WHERE id=?").bind(await sha256hex(password), tokenRow.id).run();
    return jsonOpen({ ok: true });
  }

  // ── Partner: verify password ──────────────────────────────────────────────────
  const checkPwMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/check-password$/);
  if (checkPwMatch && method === "POST") {
    const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(checkPwMatch[1]).first();
    if (!tokenRow) return errOpen("Invalid link", 404);
    return jsonOpen({ ok: await checkPartnerPassword(tokenRow, request) });
  }

  // ── Partner: metadata ─────────────────────────────────────────────────────────
  const partnerValidate = url.pathname.match(/^\/api\/partner\/([^/]+)$/);
  if (partnerValidate && method === "GET") {
    const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(partnerValidate[1]).first();
    if (!tokenRow) return errOpen("Invalid or revoked link", 404);
    const tracker = await env.DB.prepare("SELECT * FROM tracker_subjects WHERE id=?").bind(tokenRow.tracker_id).first();
    if (!tracker) return errOpen("Tracker not found", 404);
    const owner = await env.DB.prepare("SELECT display_name FROM users WHERE id=?").bind(tracker.user_id).first();
    await env.DB.prepare("UPDATE tracker_share_tokens SET last_used_at=? WHERE id=?").bind(Math.floor(Date.now()/1e3), tokenRow.id).run();
    return jsonOpen({ tracker_name: tracker.name, partner_name: tokenRow.partner_name, owner_display_name: owner?.display_name || "them", password_required: !!tokenRow.password_hash });
  }

  // ── Partner: conversation (password-gated) ────────────────────────────────────
  const partnerConvMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/conversation$/);
  if (partnerConvMatch && method === "GET") {
    const tokenRow = await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE token=?").bind(partnerConvMatch[1]).first();
    if (!tokenRow) return errOpen("Invalid link", 404);
    if (!(await checkPartnerPassword(tokenRow, request))) return errOpen("Password required", 401);
    const { results } = await env.DB.prepare("SELECT role, content, created_at FROM tracker_partner_conversations WHERE token_id=? ORDER BY created_at ASC").bind(tokenRow.id).all();
    return jsonOpen({ conversation: results });
  }

  // ── Partner: AI (password-gated) ──────────────────────────────────────────────
  const partnerAIMatch = url.pathname.match(/^\/api\/partner\/([^/]+)\/ai$/);
  if (partnerAIMatch && method === "POST") {
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

  // ── Authenticated: partner-tokens (need userId) ───────────────────────────────
  if (!userId) return null;

  const partnerTokensMatch=path.match(/^\/api\/trackers\/([^/]+)\/partner-tokens$/);
  if(partnerTokensMatch){const tid=partnerTokensMatch[1];const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="GET"){const{results}=await env.DB.prepare("SELECT id,token,partner_name,partner_instructions,partner_language,created_at,last_used_at FROM tracker_share_tokens WHERE tracker_id=? ORDER BY created_at DESC").bind(tid).all();return json({tokens:results},200,origin);}if(method==="POST"){const body=await request.json();const{partner_name="Partner",partner_instructions="",partner_language="da"}=body;const token=nanoid("ptk_");const id=nanoid("tst_");const now=Math.floor(Date.now()/1e3);await env.DB.prepare("INSERT INTO tracker_share_tokens (id,tracker_id,token,partner_name,partner_instructions,partner_language,created_at) VALUES (?,?,?,?,?,?,?)").bind(id,tid,token,partner_name,partner_instructions,partner_language,now).run();const row=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=?").bind(id).first();return json({token:row},201,origin);}}
  const partnerTokenMatch=path.match(/^\/api\/trackers\/([^/]+)\/partner-tokens\/([^/]+)$/);
  if(partnerTokenMatch){const[,tid,tokenId]=partnerTokenMatch;const tracker=await env.DB.prepare("SELECT id FROM tracker_subjects WHERE id=? AND user_id=?").bind(tid,userId).first();if(!tracker)return err("Not found",404,origin);if(method==="PATCH"){const body=await request.json();const existing=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=? AND tracker_id=?").bind(tokenId,tid).first();if(!existing)return err("Not found",404,origin);const pname=body.partner_name!==void 0?body.partner_name:existing.partner_name;const pinstr=body.partner_instructions!==void 0?body.partner_instructions:existing.partner_instructions;const plang=body.partner_language!==void 0?body.partner_language:(existing.partner_language||"da");await env.DB.prepare("UPDATE tracker_share_tokens SET partner_name=?,partner_instructions=?,partner_language=? WHERE id=?").bind(pname,pinstr,plang,tokenId).run();const updated=await env.DB.prepare("SELECT * FROM tracker_share_tokens WHERE id=?").bind(tokenId).first();return json({token:updated},200,origin);}if(method==="DELETE"){await env.DB.prepare("DELETE FROM tracker_share_tokens WHERE id=? AND tracker_id=?").bind(tokenId,tid).run();return json({deleted:true},200,origin);}}

  return null;
}
