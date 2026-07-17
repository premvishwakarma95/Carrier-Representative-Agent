/**
 * Playbook Section 12: "Pre-call eligibility" (hard filters) and "Carrier
 * ranking" (soft ordering — lane/equipment match, service history, proximity,
 * capacity, responsiveness, compliance; explicitly NOT ranked by cheapest
 * historical rate, since we don't have pricing before calling anyway).
 *
 * Candidate pool starts from load.invitedCarrierIds (GAP-FILL — not in the
 * client's PDF spec, see src/mock-mdr-api/README.md) rather than the general
 * carrier eligibility directory, so we only ever call carriers MDR actually
 * invited to bid on this load.
 */
import { getCarriers, getLoadQuotes } from "../mdr/api.js";
import type { MdrLoad, MdrCarrier } from "../mdr/api.js";

export async function buildCarrierQueue(load: MdrLoad): Promise<MdrCarrier[]> {
  const [invitedCarriers, quotes] = await Promise.all([
    getCarriers(load.invitedCarrierIds),
    getLoadQuotes(load.id),
  ]);

  const alreadyQuotedCarrierIds = new Set(
    quotes.filter((q) => q.status === "valid").map((q) => q.carrierId)
  );

  const eligible = invitedCarriers.filter(
    (carrier) =>
      !alreadyQuotedCarrierIds.has(carrier.id) &&
      !carrier.doNotCall.calls &&
      carrier.eligibility.approvedAuthority &&
      carrier.eligibility.approvedInsurance &&
      !carrier.eligibility.fraudFlag &&
      carrier.eligibility.safetyStatus !== "flagged"
  );

  return rankCarriers(eligible, load);
}

function rankCarriers(carriers: MdrCarrier[], load: MdrLoad): MdrCarrier[] {
  return carriers
    .map((carrier) => ({ carrier, score: scoreCarrier(carrier, load) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.carrier);
}

function scoreCarrier(carrier: MdrCarrier, load: MdrLoad): number {
  let score = 0;

  const equipmentTag = [load.equipment.containerSize, load.equipment.containerType]
    .filter(Boolean)
    .join("_");
  if (equipmentTag && carrier.eligibility.approvedEquipment?.includes(equipmentTag)) {
    score += 10;
  }

  if (
    load.routing.deliveryState &&
    carrier.eligibility.approvedGeography?.includes(load.routing.deliveryState as string)
  ) {
    score += 5;
  }

  // Service history as a light tiebreaker — not the primary ranking signal,
  // and never a proxy for "cheapest," per the playbook's explicit guardrail.
  score += Math.min(carrier.serviceHistory?.laneCount ?? 0, 50) / 50;

  return score;
}
