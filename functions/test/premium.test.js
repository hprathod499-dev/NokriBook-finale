// node test/premium.test.js — fails (exit 1) if any payment check is wrong
const assert = require("assert");
const c = require("crypto");
const P = require("../premium");
const sig = (m, s) => c.createHmac("sha256", s).update(m).digest("hex");

assert.strictEqual(P.paymentSigOk("order_1", "pay_1", sig("order_1|pay_1", "k"), "k"), true);
assert.strictEqual(P.paymentSigOk("order_1", "pay_2", sig("order_1|pay_1", "k"), "k"), false, "other payment id");
assert.strictEqual(P.paymentSigOk("order_1", "pay_1", sig("order_1|pay_1", "k"), "x"), false, "other secret");
assert.strictEqual(P.paymentSigOk("order_1", "pay_1", "", "k"), false, "empty signature");
assert.strictEqual(P.paymentSigOk("order_1", "pay_1", sig("order_1|pay_1", ""), ""), false, "no secret set");
const raw = '{"event":"order.paid"}';
assert.strictEqual(P.webhookOk(raw, sig(raw, "w"), "w"), true);
assert.strictEqual(P.webhookOk(raw + " ", sig(raw, "w"), "w"), false, "changed body");

assert.deepStrictEqual(P.PLANS, { year: { paise: 29900, days: 365 }, month: { paise: 3000, days: 30 } });
const now = 1_800_000_000_000, D = P.DAY;
assert.strictEqual(P.extendUntil(0, now, 30), now + 30 * D, "first month");
assert.strictEqual(P.extendUntil(now + 5 * D, now, 365), now + 370 * D, "renew early keeps the 5 days left");
assert.strictEqual(P.extendUntil(now - 9 * D, now, 30), now + 30 * D, "renew after it ran out starts today");

let s = P.stateOf({ trialStart: now - 2 * D }, now);
assert.ok(s.active && !s.paid, "day 3 of trial");
s = P.stateOf({ trialStart: now - 3 * D }, now);
assert.ok(!s.active, "trial over after exactly 3 days");
s = P.stateOf({ trialStart: now - 99 * D, paidUntil: now + 1 }, now);
assert.ok(s.active && s.paid);
assert.ok(!P.stateOf({}, now).active, "no doc = not active");
assert.ok(P.okToken("A".repeat(32)) && !P.okToken("../x") && !P.okToken(""));
console.log("premium checks OK");
