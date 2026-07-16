/**
 * Playbook Section 12: "Pre-call eligibility" (hard filters) and "Carrier
 * ranking" (soft ordering — lane/equipment match, service history, proximity,
 * capacity, responsiveness, compliance; explicitly NOT ranked by cheapest
 * historical rate, since we don't have pricing before calling anyway).
 */
import { Carrier, Quote } from "../db/models/index.js";
import type { HydratedDocument } from "mongoose";

// Loosely typed on purpose — callers pass hydrated Mongoose Load documents,
// whose generated types are noisier than useful for this internal helper.
type LoadDoc = any;

export async function buildCarrierQueue(load: LoadDoc) {
  const alreadyQuotedCarrierIds = await Quote.find({ loadId: load.id, status: "valid" }).distinct(
    "carrierId"
  );

  const eligible = await Carrier.find({
    _id: { $nin: alreadyQuotedCarrierIds },
    "doNotCall.calls": { $ne: true },
    "eligibility.approvedAuthority": true,
    "eligibility.approvedInsurance": true,
    "eligibility.fraudFlag": { $ne: true },
    "eligibility.safetyStatus": { $ne: "flagged" },
  });

  return rankCarriers(eligible, load);
}

function rankCarriers(carriers: HydratedDocument<any>[], load: LoadDoc) {
  return carriers
    .map((carrier) => ({ carrier, score: scoreCarrier(carrier, load) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.carrier);
}

function scoreCarrier(carrier: HydratedDocument<any>, load: LoadDoc): number {
  let score = 0;

  const equipmentTag = [load.equipment.containerSize, load.equipment.containerType]
    .filter(Boolean)
    .join("_");
  if (equipmentTag && carrier.eligibility.approvedEquipment?.includes(equipmentTag)) {
    score += 10;
  }

  if (
    load.routing.deliveryState &&
    carrier.eligibility.approvedGeography?.includes(load.routing.deliveryState)
  ) {
    score += 5;
  }

  // Service history as a light tiebreaker — not the primary ranking signal,
  // and never a proxy for "cheapest," per the playbook's explicit guardrail.
  score += Math.min(carrier.serviceHistory?.laneCount ?? 0, 50) / 50;

  return score;
}
