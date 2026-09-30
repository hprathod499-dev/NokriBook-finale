// Nokri Book — email sender (Cloudflare Worker)
//
// Replaces EmailJS. The app calls POST /send with the signed-in user's
// Firebase ID token. This Worker:
//   1. verifies the token really comes from Firebase for THIS project
//      (Google's public keys, RS256, audience, issuer, expiry),
//   2. only sends to that user's OWN, VERIFIED email address — the app
//      can't choose the recipient, so nobody can use this to spam others,
//   3. builds the email text itself from a fixed template (the app only
//      sends a few short fields), so nobody can send arbitrary content,
//   4. sends through Resend with a secret API key that never leaves
//      Cloudflare (it is NOT in the web page, unlike EmailJS keys).
//
// The ONLY setting you must add (Cloudflare → the Worker → Settings →
// Variables and Secrets):   RESEND_API_KEY  (type: Secret)
// Everything else has a built-in default below and can optionally be
// overridden with a variable of the same name.
const DEFAULTS = {
  FROM_EMAIL: "Nokri Book <noreply@nokribook.in>",
  FIREBASE_PROJECT_ID: "duty-roaster-944b9",
  ALLOWED_ORIGINS: "https://nokribook.in,https://www.nokribook.in",
};

const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let jwksCache = { keys: null, until: 0 };

// ---------- Firebase ID token verification ----------
async function getGoogleKeys(fetchImpl = fetch) {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error("could not load Google keys");
  const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") || "");
  const { keys } = await res.json();
  jwksCache = { keys, until: Date.now() + (m ? Number(m[1]) * 1000 : 3600 * 1000) };
  return keys;
}
export function _resetKeyCache() { jwksCache = { keys: null, until: 0 }; }

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}
function b64urlJson(s) { return JSON.parse(new TextDecoder().decode(b64urlToBytes(s))); }

export async function verifyFirebaseIdToken(token, projectId, { now = Date.now(), fetchImpl = fetch } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (header.alg !== "RS256" || !header.kid) throw new Error("wrong token algorithm");
  const jwk = (await getGoogleKeys(fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey(
    "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1])
  );
  if (!ok) throw new Error("bad signature");
  const nowSec = Math.floor(now / 1000);
  if (payload.aud !== projectId) throw new Error("wrong project");
  if (payload.iss !== "https://securetoken.google.com/" + projectId) throw new Error("wrong issuer");
  if (!(typeof payload.exp === "number" && payload.exp > nowSec)) throw new Error("token expired");
  if (!(typeof payload.iat === "number" && payload.iat <= nowSec + 300)) throw new Error("token issued in the future");
  if (!payload.sub) throw new Error("no user");
  return payload;
}

// ---------- email content (fixed template) ----------
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

export function buildEmail(body, now = new Date()) {
  const kind = body && body.kind;
  if (kind !== "format-keep" && kind !== "format-all") throw new Error("unknown email type");
  const personName = clean(body.personName, 80) || "—";
  const buckle = clean(body.buckleNumber, 12).replace(/\D/g, "") || "—";
  const station = clean(body.stationName, 120);
  const keepMonths = [2, 6].includes(Number(body.keepMonths)) ? Number(body.keepMonths) : 2;
  const when = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  const stationLine = station ? `Station: ${station}` : null;
  let subject, lines;
  if (kind === "format-all") {
    subject = "Nokri Book — all data was deleted";
    lines = [
      "This confirms that ALL data in Nokri Book was deleted — every staff member, work type, and duty record, with no exceptions.",
      "",
      stationLine,
      `Performed by: ${personName} (buckle number ${buckle})`,
      `Time: ${when} (IST)`,
      "",
      "A full backup of everything, as it stood right before this, was downloaded automatically to the device used.",
    ];
  } else {
    subject = "Nokri Book — old duty data was formatted";
    lines = [
      `This confirms that duty data older than ${keepMonths} months in Nokri Book was cleared.`,
      "",
      stationLine,
      `Performed by: ${personName} (buckle number ${buckle})`,
      `Time: ${when} (IST)`,
      "",
      `Staff names, designations, and work types were kept, along with the last ${keepMonths} months of duty history. A full backup of everything as it was before was downloaded automatically to the device used.`,
    ];
  }
  const text = lines.filter((l) => l !== null).join("\n");
  const html = "<div style=\"font-family:Arial,sans-serif;font-size:14px;line-height:1.5\">" +
    text.split("\n").map((l) => (l ? escapeHtml(l) : "&nbsp;")).map((l) => `<div>${l}</div>`).join("") +
    "</div>";
  return { subject, text, html };
}

// ---------- HTTP ----------
function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "https://nokribook.in").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    ok,
    headers: {
      ...(ok ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  };
}
const json = (status, obj, headers) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });

// Best-effort per-user limit (per Worker instance): max 10 emails / hour.
const recent = new Map();
function rateLimited(uid, now = Date.now()) {
  const list = (recent.get(uid) || []).filter((t) => now - t < 3600 * 1000);
  if (list.length >= 10) { recent.set(uid, list); return true; }
  list.push(now); recent.set(uid, list); return false;
}

export default {
  async fetch(request, rawEnv, ctx, deps = {}) {
    const env = { ...DEFAULTS, ...Object.fromEntries(Object.entries(rawEnv || {}).filter(([, v]) => v)) };
    const fetchImpl = deps.fetch || fetch;
    const url = new URL(request.url);
    const { ok: originOk, headers: cors } = corsHeaders(request.headers.get("Origin"), env);

    if (request.method === "OPTIONS") return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (url.pathname === "/" && request.method === "GET") return json(200, { ok: true, service: "nokribook-email" }, cors);
    if (url.pathname !== "/send" || request.method !== "POST") return json(404, { ok: false, error: "not found" }, cors);
    if (!originOk) return json(403, { ok: false, error: "origin not allowed" }, cors);
    if (!env.RESEND_API_KEY || !env.FROM_EMAIL || !env.FIREBASE_PROJECT_ID) return json(500, { ok: false, error: "email sender not configured" }, cors);

    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let user;
    try { user = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID, { fetchImpl }); }
    catch (e) { return json(401, { ok: false, error: "not signed in (" + e.message + ")" }, cors); }
    if (!user.email || user.email_verified !== true) return json(403, { ok: false, error: "email address not verified" }, cors);
    if (rateLimited(user.sub)) return json(429, { ok: false, error: "too many emails, try later" }, cors);

    let body;
    try { body = await request.json(); } catch (e) { return json(400, { ok: false, error: "bad request" }, cors); }
    let email;
    try { email = buildEmail(body); } catch (e) { return json(400, { ok: false, error: e.message }, cors); }

    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.FROM_EMAIL, to: [user.email], subject: email.subject, text: email.text, html: email.html }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return json(502, { ok: false, error: "email service error " + res.status + (detail ? ": " + detail.slice(0, 200) : "") }, cors);
    }
    return json(200, { ok: true }, cors);
  },
};
