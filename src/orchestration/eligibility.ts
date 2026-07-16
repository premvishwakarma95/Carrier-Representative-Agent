/**
 * Finds loads that need voice outreach right now: open, past their email-wait
 * window, and still under their quote threshold.
 */
import { Load } from "../db/models/index.js";
import { countValidQuotes } from "./stopConditions.js";

export async function findLoadsNeedingOutreach() {
  const now = new Date();

  const candidates = await Load.find({
    status: "open",
    $or: [{ bidCloseAt: { $exists: false } }, { bidCloseAt: { $gt: now } }],
  });

  const needsOutreach = [];
  for (const load of candidates) {
    // Assumption documented in cadence.ts: createdAt stands in for "email sent at"
    // until real MDR integration provides that timestamp separately.
    const emailWaitElapsed =
      now.getTime() >= load.createdAt.getTime() + load.emailWaitMinutes * 60_000;
    if (!emailWaitElapsed) continue;

    const validQuotes = await countValidQuotes(load.id);
    if (validQuotes >= load.quoteThreshold) continue;

    needsOutreach.push(load);
  }

  return needsOutreach;
}
