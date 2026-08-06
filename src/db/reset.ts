/**
 * Clears local operational data (CallAttempt, Escalation, Quote) for a fresh
 * test run — dev-only. WebhookResponse (raw MDR capture) is left in place —
 * that's the real data we're inspecting to rebuild against, not test noise.
 *
 * Usage: npm run db:reset
 */
import { connectDB, disconnectDB } from "./connection.js";
import { CallAttempt, Escalation, Quote } from "./models/index.js";

async function main() {
  await connectDB();

  const [attempts, escalations, quotes] = await Promise.all([
    CallAttempt.deleteMany({}),
    Escalation.deleteMany({}),
    Quote.deleteMany({}),
  ]);

  console.log(
    `Cleared ${attempts.deletedCount} call attempts, ${escalations.deletedCount} escalations, and ${quotes.deletedCount} quotes.`
  );

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
