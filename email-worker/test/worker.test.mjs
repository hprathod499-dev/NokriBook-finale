// Run:  node --test email-worker/test/
// Tests the Worker with a locally generated signing key standing in for
// Google's, and a fake email service — no network needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { _resetKeyCache, buildEmail } from "../src/worker.js";

const PROJECT = "duty-roaster-944b9";
const ORIGIN = "https://nokribook.in";
const env = { RESEND_API_KEY: "re_test", FROM_EMAIL: "Nokri Book <noreply@nokribook.in>", FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: "https://nokribook.in,https://www.nokribook.in" };

const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pubJwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "RS256", use: "sig" };
const { privateKey: otherKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function makeToken(claims = {}, key = privateKey, kid = "k1") {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ aud: PROJECT, iss: "https://securetoken.google.com/" + PROJECT, sub: "user1", iat: now - 10, exp: now + 3600, auth_time: now - 10, email: "station@example.com", email_verified: true, ...claims }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(header + "." + payload));
  return header + "." + payload + "." + b64url(sig);
}

function fakeFetch() {
  const sent = [];
  const f = async (url, init) => {
    if (String(url).includes("googleapis.com")) return new Response(JSON.stringify({ keys: [pubJwk] }), { headers: { "cache-control": "public, max-age=3600" } });
    if (String(url).includes("api.resend.com")) { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "x" }), { status: 200 }); }
    throw new Error("unexpected fetch " + url);
  };
  f.sent = sent;
  return f;
}
async function call({ token, body, origin = ORIGIN, method = "POST", path = "/send", fetchImpl = fakeFetch() } = {}) {
  _resetKeyCache();
  const headers = { "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = "Bearer " + token;
  const req = new Request("https://mail.example.workers.dev" + path, { method, headers, body: method === "POST" ? JSON.stringify(body || {}) : undefined });
  const res = await worker.fetch(req, env, {}, { fetch: fetchImpl });
  return { res, out: res.status === 204 ? null : await res.json(), sent: fetchImpl.sent };
}
const goodBody = { kind: "format-keep", keepMonths: 6, personName: "Test Officer", buckleNumber: "1756", stationName: "Dhari Police Station" };

test("valid signed-in user: email goes to THEIR OWN address with the fixed text", async () => {
  const { res, out, sent } = await call({ token: await makeToken(), body: goodBody });
  assert.equal(res.status, 200); assert.equal(out.ok, true);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ["station@example.com"]);
  assert.match(sent[0].subject, /old duty data was formatted/);
  assert.match(sent[0].text, /older than 6 months/);
  assert.match(sent[0].text, /Test Officer \(buckle number 1756\)/);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("the app cannot choose the recipient or the message", async () => {
  const { sent } = await call({ token: await makeToken(), body: { ...goodBody, to: "victim@example.com", to_email: "victim@example.com", message: "BUY NOW", subject: "spam" } });
  assert.deepEqual(sent[0].to, ["station@example.com"]);
  assert.doesNotMatch(sent[0].text + sent[0].subject, /BUY NOW|spam|victim/);
});

test("HTML / links in fields are neutralised", async () => {
  const { sent } = await call({ token: await makeToken(), body: { ...goodBody, personName: "<a href=http://evil>click</a>", buckleNumber: "12ab<script>" } });
  assert.doesNotMatch(sent[0].html, /<a |<script/);
  assert.match(sent[0].text, /buckle number 12\)/);
});

test("no token -> 401, nothing sent", async () => {
  const { res, sent } = await call({ body: goodBody });
  assert.equal(res.status, 401); assert.equal(sent.length, 0);
});
test("token signed by someone else -> 401", async () => {
  const { res, sent } = await call({ token: await makeToken({}, otherKey), body: goodBody });
  assert.equal(res.status, 401); assert.equal(sent.length, 0);
});
test("token for another Firebase project -> 401", async () => {
  const { res } = await call({ token: await makeToken({ aud: "someone-else" }), body: goodBody });
  assert.equal(res.status, 401);
});
test("expired token -> 401", async () => {
  const { res } = await call({ token: await makeToken({ exp: Math.floor(Date.now() / 1000) - 5 }), body: goodBody });
  assert.equal(res.status, 401);
});
test("unverified email address -> 403 (app falls back to a mail draft)", async () => {
  const { res, sent } = await call({ token: await makeToken({ email_verified: false }), body: goodBody });
  assert.equal(res.status, 403); assert.equal(sent.length, 0);
});
test("request from another website -> 403", async () => {
  const { res, sent } = await call({ token: await makeToken(), body: goodBody, origin: "https://evil.example" });
  assert.equal(res.status, 403); assert.equal(sent.length, 0);
});
test("unknown email type -> 400", async () => {
  const { res } = await call({ token: await makeToken(), body: { kind: "anything" } });
  assert.equal(res.status, 400);
});
test("preflight from nokribook.in is allowed", async () => {
  const { res } = await call({ method: "OPTIONS", origin: ORIGIN });
  assert.equal(res.status, 204);
});
test("more than 10 emails an hour for one user -> 429", async () => {
  const token = await makeToken({ sub: "busy-user" });
  let last;
  for (let i = 0; i < 11; i++) last = await call({ token, body: goodBody });
  assert.equal(last.res.status, 429);
});
test("full-wipe email text", () => {
  const e = buildEmail({ kind: "format-all", personName: "A", buckleNumber: "1" });
  assert.match(e.subject, /all data was deleted/);
});
