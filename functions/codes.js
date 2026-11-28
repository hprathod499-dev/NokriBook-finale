const { createHash } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");
const HOUR = 3600000;
const PERIOD = 48 * HOUR;
const delays = [60000, 300000, 900000, HOUR, 3 * HOUR, 8 * HOUR];
const hash = text => createHash("sha256").update(text).digest("hex");
const delay = failures => failures < 6 ? 0 : delays[Math.min(failures - 6, delays.length - 1)];
const shareCode = (key, period) => hash(key + "|" + period).replace(/[a-f]/g, "").slice(0, 6);

async function verifyCode(db, uid, input, clock = Date.now) {
  const { kind, token, num, code, emailHash } = input;
  const station = kind === "station";
  const number = kind === "number";
  if (!["station", "number", "share"].includes(kind) ||
      (station && (!/^[A-Z0-9]{8}$/.test(code) || !/^[a-f0-9]{64}$/.test(emailHash))) ||
      (!station && (!/^[a-zA-Z0-9]{32}$/.test(token) || !/^[A-Z0-9]{1,12}$/.test(num))) ||
      (kind === "share" && !/^[0-9]{6}$/.test(code)) ||
      [code, emailHash, token, num].some(v => v !== undefined && typeof v !== "string")) {
    return { status: 400, reason: "invalid" };
  }
  const scope = station ? "" : token;
  const buckets = [db.collection("codeFailures").doc(hash(JSON.stringify([kind, scope, uid])))];
  // A fresh anonymous session also inherits the wait for this staff number.
  if (kind === "share") {
    buckets.push(db.collection("codeFailures").doc(hash(JSON.stringify(["staff", token, num]))));
  }
  return db.runTransaction(async tx => {
    const counters = await tx.getAll(...buckets);
    const now = clock();
    const remaining = Math.max(...counters.map(s => (s.get("until") || 0) - now));
    if (remaining > 0) return { status: 429, retryMs: remaining };
    const fail = () => {
      let retryMs = 0;
      for (const snapshot of counters) {
        const failures = Math.min((snapshot.get("failures") || 0) + 1, 11);
        const wait = delay(failures);
        retryMs = Math.max(retryMs, wait);
        tx.set(snapshot.ref, { failures, until: now + wait });
      }
      if (!station) {
        // The station's counter is informational only. It never locks another viewer.
        const summary = db.collection("shareTries").doc(token);
        const increment = FieldValue.increment(1);
        tx.set(summary, { ["p" + Math.floor(now / PERIOD)]: increment }, { merge: true });
      }
      return { status: retryMs ? 429 : 403, reason: "nomatch", retryMs };
    };
    if (station) {
      const login = (await tx.get(db.collection("codeLogins").doc(code))).data();
      if (!login || login.emailHash !== emailHash) return fail();
      const ref = db.collection("stationMembers").doc(uid);
      const existing = (await tx.get(ref)).data();
      if (existing && existing.via !== "code") return { status: 409, reason: "membership" };
      tx.set(ref, { owner: login.owner, via: "code", code, emailHash, name: String(login.label || "").slice(0, 80), joinedAt: now });
    } else {
      const key = (await tx.get(db.collection("shareKeys").doc(token))).data();
      if (!key) return { status: 404, reason: "inactive" };
      const account = (await tx.get(db.collection("accounts").doc(key.owner))).data();
      if (!account?.shareEnabled || account.shareToken !== token) return { status: 404, reason: "inactive" };
      if (!Object.hasOwn(key.nums || {}, num)) return fail();
      const period = Math.floor(now / PERIOD);
      if (!number && code !== shareCode(key.key, period) &&
          !(now % PERIOD < HOUR && code === shareCode(key.key, period - 1))) return fail();
      const seatRef = db.collection("shareSeats").doc(token + "_" + num);
      const phones = (await tx.get(seatRef)).data()?.uids || [];
      if (!phones.includes(uid) && phones.length >= 2) return { status: 409, reason: "seats" };
      if (!number) {
        if (!phones.includes(uid)) tx.set(seatRef, { token, num, uids: [...phones, uid] });
        tx.set(db.collection("shareGrants").doc(uid + "_" + token), { uid, token, num, s2: true, at: new Date(now) });
      }
    }
    for (const snapshot of counters) {
      if (snapshot.exists) tx.delete(snapshot.ref);
    }
    return { status: 200 };
  });
}
module.exports = { verifyCode };
