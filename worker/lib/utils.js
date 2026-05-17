function nanoid(prefix = "") {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = prefix; const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (const b of bytes) id += chars[b % chars.length];
  return id;
}
function extractTags(content) {
  const matches = content.match(/#([a-zA-Z0-9_\-æøåÆØÅ]+)/g) || [];
  return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
}
function corsHeaders(origin) {
  const allowed = [
    "https://notes.jeppesen.cc",
    "https://noteflow-v2.pages.dev", // New git connected page
    "https://noteflow.pages.dev",
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

export { nanoid, extractTags, corsHeaders, openCors, json, jsonOpen, err, errOpen, sha256hex };
