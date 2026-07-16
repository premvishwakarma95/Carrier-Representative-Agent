/**
 * Playbook Section 12, "Stop conditions": threshold reached, load awarded, bid
 * closed, user paused/cancelled, carrier pool exhausted, or compliance issue.
 * Re-run after every completed call — not just at the end of a batch — so we
 * never keep calling a load that just got covered.
 */
import { Load, Quote, Carrier } from "../db/models/index.js";
import { Types } from "mongoose";

export async function countValidQuotes(loadId: Types.ObjectId | string): Promise<number> {
  return Quote.countDocuments({ loadId, status: "valid" });
}

export type StopCheckResult = {
  shouldStop: boolean;
  reason?: "threshold_met" | "bid_closed" | "awarded" | "paused" | "cancelled" | "pool_exhausted";
};

/**
 * Re-evaluates a load's stop conditions and updates its status if needed.
 * Returns whether outreach should stop (and why) so the caller can decide
 * whether to cancel/skip any further dispatch for this load.
 */
export async function checkStopConditions(loadId: Types.ObjectId | string): Promise<StopCheckResult> {
  const load = await Load.findById(loadId);
  if (!load) throw new Error(`Load not found: ${loadId}`);

  // Terminal states already set by a human/external action.
  if (["awarded", "paused", "cancelled"].includes(load.status)) {
    return { shouldStop: true, reason: load.status as StopCheckResult["reason"] };
  }

  if (load.bidCloseAt && load.bidCloseAt.getTime() <= Date.now()) {
    if (load.status !== "closed") {
      load.status = "closed";
      await load.save();
    }
    return { shouldStop: true, reason: "bid_closed" };
  }

  const validQuoteCount = await countValidQuotes(load.id);
  if (validQuoteCount >= load.quoteThreshold) {
    if (load.status !== "threshold_met") {
      load.status = "threshold_met";
      await load.save();
    }
    return { shouldStop: true, reason: "threshold_met" };
  }

  const eligibleRemaining = await hasEligibleCarriersRemaining(load.id);
  if (!eligibleRemaining) {
    return { shouldStop: true, reason: "pool_exhausted" };
  }

  return { shouldStop: false };
}

async function hasEligibleCarriersRemaining(loadId: Types.ObjectId | string): Promise<boolean> {
  // Cheap existence check — the queue builder does the full filter/rank pass;
  // this just answers "is it even worth building the queue."
  const carrierCount = await Carrier.countDocuments({ "doNotCall.calls": { $ne: true } });
  return carrierCount > 0;
}
