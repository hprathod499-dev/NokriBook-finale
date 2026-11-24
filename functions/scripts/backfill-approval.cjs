// Run once before the rule update. Dry-run unless --apply is supplied.
const admin = require("firebase-admin");
const projectId = process.argv[2];
if (!projectId || projectId.startsWith("-")) throw new Error("Pass the Firebase project ID before --apply.");
admin.initializeApp({ projectId });
const db = admin.firestore();
async function run() {
  const apply = process.argv.includes("--apply");
  const pending = db.collection("accounts").where("stationApprovalStatus", "==", "pending");
  let missing = 0, repaired = 0;
  for await (const candidate of pending.select("stationRequestedAtMs", "stationRequestedAt").stream()) {
    if (Number.isSafeInteger(candidate.get("stationRequestedAtMs"))) continue;
    const result = await db.runTransaction(async tx => {
      const current = await tx.get(candidate.ref);
      if (!current.exists || current.get("stationApprovalStatus") !== "pending" ||
          Number.isSafeInteger(current.get("stationRequestedAtMs"))) return "skip";
      const raw = current.get("stationRequestedAt");
      const ms = typeof raw === "string" ? Date.parse(raw) : NaN;
      if (!Number.isSafeInteger(ms) || ms <= 0 || ms > Date.now()) return "review";
      if (apply) tx.update(current.ref, { stationRequestedAtMs: ms });
      return "ready";
    });
    if (result === "review") { console.log("Review request date:", candidate.id); missing++; }
    if (result === "ready") repaired++;
  }
  console.log(apply ? "Updated:" : "Ready to update:", repaired, "Need manual review:", missing);
  if (missing) process.exitCode = 1;
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => admin.app().delete());
