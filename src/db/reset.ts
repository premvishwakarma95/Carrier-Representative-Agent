/**
 * Clears local operational data (CallAttempt, Escalation) for a fresh test
 * run — dev-only. Load/Carrier mock data now lives in src/mock-mdr-api/
 * (reset via POST /mock/reset on that service, not here).
 *
 * Usage: npm run db:reset
 */
import { connectDB, disconnectDB } from "./connection.js";
import { CallAttempt, Escalation } from "./models/index.js";

async function main() {
  await connectDB();

  const [attempts, escalations] = await Promise.all([CallAttempt.deleteMany({}), Escalation.deleteMany({})]);

  console.log(`Cleared ${attempts.deletedCount} call attempts and ${escalations.deletedCount} escalations.`);

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
