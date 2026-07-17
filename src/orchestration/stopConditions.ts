/**
 * Playbook Section 12, "Stop conditions": threshold reached, load awarded, bid
 * closed, user paused/cancelled, carrier pool exhausted, or compliance issue.
 * Re-run after every completed call — not just at the end of a batch — so we
 * never keep calling a load that just got covered.
 *
 * Load status and quote counts are MDR's canonical data now (see src/mdr/) —
 * this only reads, it never writes load.status back, since MDR owns that.
 */
import { getLoad, getLoadQuoteStatus } from "../mdr/api.js";
import { buildCarrierQueue } from "./queueBuilder.js";

export type StopCheckResult = {
  shouldStop: boolean;
  reason?: "threshold_met" | "bid_closed" | "awarded" | "paused" | "cancelled" | "pool_exhausted";
};

const TERMINAL_REASONS: Record<string, StopCheckResult["reason"]> = {
  awarded: "awarded",
  paused: "paused",
  cancelled: "cancelled",
  closed: "bid_closed",
};

export async function checkStopConditions(loadId: string): Promise<StopCheckResult> {
  const load = await getLoad(loadId);

  const terminalReason = TERMINAL_REASONS[load.status];
  if (terminalReason) {
    return { shouldStop: true, reason: terminalReason };
  }

  if (load.bidCloseAt && new Date(load.bidCloseAt).getTime() <= Date.now()) {
    return { shouldStop: true, reason: "bid_closed" };
  }

  const quoteStatus = await getLoadQuoteStatus(load.id);
  if (quoteStatus.remainingQuoteCount <= 0) {
    return { shouldStop: true, reason: "threshold_met" };
  }

  // Full filter/rank pass, not just a proxy check — a carrier who's DNC'd but
  // still the only "invited" candidate should count as pool-exhausted too.
  const queue = await buildCarrierQueue(load);
  if (queue.length === 0) {
    return { shouldStop: true, reason: "pool_exhausted" };
  }

  return { shouldStop: false };
}
