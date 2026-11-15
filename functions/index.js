// Nokri Book — view-only premium (Razorpay).
//
// One HTTPS function, nbPremium, region asia-south1:
//   POST /status   {token}                          -> paid state of this phone's buckle number
//   POST /promo    {code}                           -> is this promo code usable, and how much off
//   POST /order    {token, plan, promo?}            -> a Razorpay order for ₹299 / ₹30 (less the promo);
//                                                      a 100% promo is applied straight away ({free:true})
//   POST /verify   {orderId, paymentId, signature}  -> checks Razorpay's signature and adds the days
//   POST /webhook  (Razorpay calls this)            -> same as /verify, in case the phone closed before /verify ran
//
// The phone sends its Firebase ID token (the view link's own anonymous session) as "Authorization: Bearer ...".
// Only this function writes premium/* and premiumPayments/* — the Firestore rules allow no phone to write them.
//
// Settings (GitHub repo secrets, written into functions/.env by the deploy workflow):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const P = require("./premium");

admin.initializeApp();
const db = admin.firestore();

const cfg = () => ({
  keyId: process.env.RAZORPAY_KEY_ID || "",
  keySecret: process.env.RAZORPAY_KEY_SECRET || "",
  webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || "",
});

async function razorpay(method, path, body) {
  const c = cfg();
  const res = await fetch("https://api.razorpay.com/v1" + path, {
    method,
    headers: {
      "Authorization": "Basic " + Buffer.from(c.keyId + ":" + c.keySecret).toString("base64"),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("razorpay " + res.status + " " + JSON.stringify(j.error || j)), { http: 502 });
  return j;
}

async function uidOf(req) {
  const m = String(req.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m) throw Object.assign(new Error("no sign-in"), { http: 401 });
  const d = await admin.auth().verifyIdToken(m[1]);
  return d.uid;
}

// the phone's grant for this link -> station owner + buckle number
async function whoIs(uid, token) {
  if (!P.okToken(token)) throw Object.assign(new Error("bad link"), { http: 400 });
  const g = await db.doc("shareGrants/" + uid + "_" + token).get();
  if (!g.exists || !g.data().num) return null;
  const k = await db.doc("shareKeys/" + token).get();
  if (!k.exists || !k.data().owner) return null;
  return { owner: k.data().owner, num: String(g.data().num) };
}

async function status(uid, token) {
  const w = await whoIs(uid, token);
  if (!w) return { grant: false };
  const s = await db.doc("premium/" + P.premiumId(w.owner, w.num)).get();
  const now = Date.now();
  return { grant: true, owner: w.owner, num: w.num, now, ...P.stateOf(s.exists ? s.data() : null, now) };
}

async function readPromo(code) {
  if (!P.okPromoCode(code)) return null;
  const s = await db.doc("premiumPromos/" + code).get();
  return s.exists ? { code, ...s.data() } : null;
}

// adds the plan's days to premium/{owner}_{num} and records it under premiumPayments/{key}; runs once per key
async function grantDays(key, w, plan, extra) {
  const ref = db.doc("premium/" + P.premiumId(w.owner, w.num));
  const payRef = db.doc("premiumPayments/" + key);
  const promoRef = extra.promo ? db.doc("premiumPromos/" + extra.promo) : null;
  const now = Date.now();
  return db.runTransaction(async (tx) => {
    const [s, pay, pr] = await Promise.all([tx.get(ref), tx.get(payRef), promoRef ? tx.get(promoRef) : Promise.resolve(null)]);
    const cur = s.exists ? s.data() : { owner: w.owner, num: w.num };
    if (pay.exists) return P.stateOf(cur, now);            // already counted (verify + webhook both arrive)
    if (extra.free) {
      // a free code must still have uses left at this moment
      const why = P.promoProblem(pr && pr.exists ? pr.data() : null, plan);
      if (why) throw Object.assign(new Error(why === "usedup" ? "promo used up" : "promo not valid"), { http: why === "usedup" ? 410 : 404 });
    }
    const until = P.extendUntil(cur.paidUntil ? cur.paidUntil.toMillis() : 0, now, P.PLANS[plan].days);
    const next = { ...cur, paidUntil: admin.firestore.Timestamp.fromMillis(until), plan };
    tx.set(ref, next);
    tx.set(payRef, {
      owner: w.owner, num: w.num, plan, amount: extra.amount, paymentId: extra.paymentId || null,
      promo: extra.promo || null, uid: extra.uid || null, at: admin.firestore.Timestamp.fromMillis(now),
    });
    if (promoRef && pr && pr.exists) tx.update(promoRef, { used: admin.firestore.FieldValue.increment(1) });
    return P.stateOf(next, now);
  });
}

async function applyOrder(orderId, paymentId) {
  const order = await razorpay("GET", "/orders/" + encodeURIComponent(orderId));
  if (order.status !== "paid" || !(order.amount_paid >= order.amount)) {
    throw Object.assign(new Error("order not paid yet"), { http: 409 });
  }
  const n = order.notes || {};
  // the notes were written by /order itself, so the amount must match the plan less that promo exactly
  if (!P.PLANS[n.plan] || !n.owner || !n.num || order.amount !== P.pricePaise(n.plan, n.pct || 0)) {
    throw Object.assign(new Error("order does not match a plan"), { http: 400 });
  }
  return grantDays(orderId, { owner: n.owner, num: n.num }, n.plan, { amount: order.amount, paymentId, promo: n.promo || "", uid: n.uid });
}

exports.nbPremium = onRequest({ region: "asia-south1", cors: true, maxInstances: 20, memory: "256MiB" }, async (req, res) => {
  const path = (req.path || "/").replace(/\/+$/, "") || "/";
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    if (path === "/webhook") {
      const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
      if (!P.webhookOk(raw, req.get("x-razorpay-signature"), cfg().webhookSecret)) return res.status(400).json({ error: "bad signature" });
      const ev = JSON.parse(raw);
      const orderId = ev && ev.payload && ev.payload.order && ev.payload.order.entity && ev.payload.order.entity.id
        || ev && ev.payload && ev.payload.payment && ev.payload.payment.entity && ev.payload.payment.entity.order_id;
      const paymentId = ev && ev.payload && ev.payload.payment && ev.payload.payment.entity && ev.payload.payment.entity.id;
      if ((ev.event === "order.paid" || ev.event === "payment.captured") && orderId) {
        try { await applyOrder(orderId, paymentId); } catch (e) { if (e.http !== 409) throw e; }
      }
      return res.json({ ok: true });
    }

    const uid = await uidOf(req);
    const b = req.body || {};

    if (path === "/status") return res.json(await status(uid, b.token));

    if (path === "/promo") {
      const p = await readPromo(String(b.code || "").toUpperCase());
      const why = P.promoProblem(p, null);
      if (why) return res.status(why === "usedup" ? 410 : 404).json({ error: why });
      return res.json({ code: p.code, percent: Number(p.percent), plans: p.plans || "both" });
    }

    if (path === "/order") {
      if (!P.PLANS[b.plan]) return res.status(400).json({ error: "bad plan" });
      const w = await whoIs(uid, b.token);
      if (!w) return res.status(403).json({ error: "no grant" });
      let pct = 0, promo = "";
      if (b.promo) {
        const p = await readPromo(String(b.promo).toUpperCase());
        const why = P.promoProblem(p, b.plan);
        if (why) return res.status(why === "usedup" ? 410 : 404).json({ error: why });
        pct = Number(p.percent); promo = p.code;
      }
      const amount = P.pricePaise(b.plan, pct);
      if (amount === 0) {
        // 100% code: no payment; one free use per buckle number per code
        const st = await grantDays("free_" + promo + "_" + P.premiumId(w.owner, w.num), w, b.plan, { amount: 0, promo, uid, free: true });
        return res.json({ free: true, ok: true, ...st });
      }
      const order = await razorpay("POST", "/orders", {
        amount, currency: "INR",
        receipt: ("nb" + w.num + "_" + Date.now()).slice(0, 40),
        notes: { owner: w.owner, num: w.num, plan: b.plan, uid, promo, pct: String(pct) },
      });
      return res.json({ orderId: order.id, amount: order.amount, currency: "INR", keyId: cfg().keyId, num: w.num });
    }

    if (path === "/verify") {
      if (!P.paymentSigOk(b.orderId, b.paymentId, b.signature, cfg().keySecret)) return res.status(400).json({ error: "bad signature" });
      return res.json({ ok: true, ...(await applyOrder(String(b.orderId), String(b.paymentId))) });
    }

    return res.status(404).json({ error: "not found" });
  } catch (e) {
    console.error(path, e && e.message);
    return res.status(e.http || 500).json({ error: e.http ? e.message : "server error" });
  }
});
