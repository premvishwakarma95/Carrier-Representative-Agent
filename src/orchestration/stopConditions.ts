/**
 * Playbook Section 12, "Stop conditions": threshold reached, bid closed,
 * load closed for some other MDR-side reason (awarded/paused/cancelled —
 * MDR's confirmed quote-status API only exposes a single allowCalling flag,
 * not which of those it is), or carrier pool exhausted. Re-run after every
 * completed call — not just at the end of a batch — so we never keep
 * calling a load that just got covered.
 *
 * Per the 2026-07-20 client call: MDR doesn't push load-closed updates to
 * us, so this is also where we sync our own local Load.status — whenever
 * this returns shouldStop, the local record gets marked "closed" so
 * dispatcher.ts's pre-dial check (and future eligibility scans) stop
 * picking this load up again without needing to re-derive the same result.
 */
import { getLoadQuoteStatus } from "../mdr/api.js";
import { Load } from "../db/models/index.js";
import { buildCarrierQueue } from "./queueBuilder.js";
import type { LocalLoad } from "../db/models/Load.js";

export type StopCheckResult = {
  shouldStop: boolean;
  reason?: "threshold_met" | "bid_closed" | "closed" | "pool_exhausted";
};

export async function checkStopConditions(loadId: string): Promise<StopCheckResult> {
  const load = await Load.findOne({ id: loadId }).lean<LocalLoad>();
  if (!load) {
    throw new Error(`checkStopConditions: no local Load record for ${loadId}`);
  }

  if (load.bidCloseAt && new Date(load.bidCloseAt).getTime() <= Date.now()) {
    return stop(loadId, "bid_closed");
  }

  const quoteStatus = await getLoadQuoteStatus(loadId);
  if (quoteStatus.remainingQuoteCount <= 0) {
    return stop(loadId, "threshold_met");
  }
  if (!quoteStatus.allowCalling) {
    // MDR closed this load for some other reason (awarded/paused/cancelled) —
    // the confirmed API doesn't tell us which, just that calling is off.
    return stop(loadId, "closed");
  }

  // Full filter/rank pass, not just a proxy check — a carrier who's DNC'd but
  // still the only "invited" candidate should count as pool-exhausted too.
  const queue = await buildCarrierQueue(load);
  if (queue.length === 0) {
    return stop(loadId, "pool_exhausted");
  }

  return { shouldStop: false };
}

async function stop(loadId: string, reason: NonNullable<StopCheckResult["reason"]>): Promise<StopCheckResult> {
  await Load.updateOne({ id: loadId }, { status: "closed" });
  return { shouldStop: true, reason };
}
