/**
 * Runs a single dispatch cycle and exits. In production this would be called
 * on a schedule (cron/interval) rather than run manually — see the note in
 * dispatcher.ts about why it's designed to be safely re-run repeatedly.
 *
 * Usage: npm run dispatch:run
 */
import { connectDB, disconnectDB } from "../db/connection.js";
import { runDispatchCycle } from "./dispatcher.js";

async function main() {
  await connectDB();
  const results = await runDispatchCycle();

  if (results.length === 0) {
    console.log("No loads currently need outreach.");
  } else {
    console.table(results);
  }

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
