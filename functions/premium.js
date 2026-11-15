// Pure helpers for the view-only premium (no Firebase here, so they can be tested on their own).
const crypto = require("crypto");

const DAY = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 3;
const PLANS = {
  year: { paise: 29900, days: 365 },
  month: { paise: 3000, days: 30 },
};

const okToken = (t) => typeof t === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(t);
const premiumId = (owner, num) => owner + "_" + num;

function safeEq(a, b) {
  const x = Buffer.from(String(a || ""), "utf8"), y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const hmac = (msg, secret) => crypto.createHmac("sha256", secret).update(msg).digest("hex");

// Razorpay Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function paymentSigOk(orderId, paymentId, sig, secret) {
  if (!secret || !orderId || !paymentId || !sig) return false;
  return safeEq(hmac(String(orderId) + "|" + String(paymentId), secret), sig);
}
// Razorpay webhook: X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret)
function webhookOk(raw, sig, secret) {
  if (!secret || !raw || !sig) return false;
  return safeEq(hmac(raw, secret), sig);
}

const ms = (t) => (t == null ? 0 : typeof t === "number" ? t : typeof t.toMillis === "function" ? t.toMillis() : 0);

// paid days are added after any time already paid for, never lost
function extendUntil(paidUntilMs, now, days) {
  return Math.max(paidUntilMs || 0, now) + days * DAY;
}

function stateOf(d, now) {
  const trialEnd = ms(d && d.trialStart) + TRIAL_DAYS * DAY;
  const paidUntil = ms(d && d.paidUntil);
  return { trialEnd, paidUntil, active: paidUntil > now || trialEnd > now, paid: paidUntil > now };
}

module.exports = { DAY, TRIAL_DAYS, PLANS, okToken, premiumId, paymentSigOk, webhookOk, extendUntil, stateOf };
