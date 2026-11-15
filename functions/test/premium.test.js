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

let s = P.stateOf({}, now);
assert.ok(!s.active, "no free days: nothing paid = not active");
s = P.stateOf({ paidUntil: now + 1 }, now);
assert.ok(s.active && s.paid);
assert.ok(!P.stateOf({ paidUntil: now }, now).active, "paid time over");

// promo codes
assert.strictEqual(P.pricePaise("year", 0), 29900);
assert.strictEqual(P.pricePaise("year", 50), 14950);
assert.strictEqual(P.pricePaise("month", 20), 2400);
assert.strictEqual(P.pricePaise("month", 99), 100, "never under ₹1");
assert.strictEqual(P.pricePaise("year", 100), 0, "100% is free");
assert.strictEqual(P.promoProblem(null, "year"), "missing");
assert.strictEqual(P.promoProblem({ percent: 50, active: false }, "year"), "missing", "switched off");
assert.strictEqual(P.promoProblem({ percent: 0 }, "year"), "missing");
assert.strictEqual(P.promoProblem({ percent: 50, maxUses: 2, used: 2 }, "year"), "usedup");
assert.strictEqual(P.promoProblem({ percent: 50, maxUses: 2, used: 1 }, "year"), null);
assert.strictEqual(P.promoProblem({ percent: 50, maxUses: 0, used: 999 }, "year"), null, "0 = no limit");
assert.strictEqual(P.promoProblem({ percent: 50, plans: "year" }, "month"), "plan");
assert.strictEqual(P.promoProblem({ percent: 50, plans: "year" }, null), null);
assert.ok(P.okPromoCode("DEMO50") && !P.okPromoCode("de mo") && !P.okPromoCode("AB"));
assert.ok(P.okToken("A".repeat(32)) && !P.okToken("../x") && !P.okToken(""));
console.log("premium checks OK");
