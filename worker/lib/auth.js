import { sha256hex } from "./utils.js";

async function checkPartnerPassword(tokenRow, request) {
  if (!tokenRow.password_hash) return true;
  const provided = request.headers.get("X-Partner-Password") || "";
  if (!provided) return false;
  return (await sha256hex(provided)) === tokenRow.password_hash;
}

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

export { checkPartnerPassword, resolveModel, verifyJWT, ensureUser };
