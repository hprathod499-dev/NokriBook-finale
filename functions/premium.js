// Pure helpers for the view-only premium (no Firebase here, so they can be tested on their own).
const crypto = require("crypto");

const DAY = 24 * 60 * 60 * 1000;
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

// no free days: only paid time counts
function stateOf(d, now) {
  const paidUntil = ms(d && d.paidUntil);
  return { trialEnd: 0, paidUntil, active: paidUntil > now, paid: paidUntil > now };
}

// ---- promo codes (premiumPromos/{CODE}, made by the super admin) ----
const okPromoCode = (c) => typeof c === "string" && /^[A-Z0-9]{3,20}$/.test(c);
// { code, percent 1-100, plans "both"|"year"|"month", maxUses (0 = no limit), used, active }
function promoProblem(p, plan) {
  if (!p || p.active === false) return "missing";
  const pct = Number(p.percent);
  if (!(pct >= 1 && pct <= 100)) return "missing";
  if (p.maxUses > 0 && (p.used || 0) >= p.maxUses) return "usedup";
  if (plan && p.plans && p.plans !== "both" && p.plans !== plan) return "plan";
  return null;
}
// price in paise after the promo; Razorpay's smallest payment is ₹1 (100 paise); 100% = 0
function pricePaise(plan, percent) {
  const full = PLANS[plan].paise;
  const pct = Number(percent) || 0;
  if (pct >= 100) return 0;
  if (pct <= 0) return full;
  return Math.max(100, Math.round(full * (100 - pct) / 100));
}

module.exports = { DAY, PLANS, okPromoCode, promoProblem, pricePaise, okToken, premiumId, paymentSigOk, webhookOk, extendUntil, stateOf };
