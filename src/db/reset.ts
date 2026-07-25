/**
 * Clears local operational data (CallAttempt, Escalation, Load, Quote) for a
 * fresh test run — dev-only. Carrier/quote mock data still lives in
 * src/mock-mdr-api/ (reset via POST /mock/reset on that service, not here) —
 * Quote here is Everly's own local audit copy (see src/db/models/Quote.ts),
 * a separate thing from MDR's copy.
 * Load is local again as of the push-webhook redesign (2026-07-20 client
 * call) — see src/db/models/Load.ts.
 *
 * Usage: npm run db:reset
 */
import { connectDB, disconnectDB } from "./connection.js";
import { CallAttempt, Escalation, Load, Quote } from "./models/index.js";

async function main() {
  await connectDB();

  const [attempts, escalations, loads, quotes] = await Promise.all([
    CallAttempt.deleteMany({}),
    Escalation.deleteMany({}),
    Load.deleteMany({}),
    Quote.deleteMany({}),
  ]);

  console.log(
    `Cleared ${attempts.deletedCount} call attempts, ${escalations.deletedCount} escalations, ${loads.deletedCount} loads, and ${quotes.deletedCount} quotes.`
  );

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
