/**
 * Playbook Section 12: "Pre-call eligibility" (hard filters) and "Carrier
 * ranking" (soft ordering — lane/equipment match, service history, proximity,
 * capacity, responsiveness, compliance; explicitly NOT ranked by cheapest
 * historical rate, since we don't have pricing before calling anyway).
 *
 * Candidate pool starts from the load's locally-stored `invitedCarriers`
 * (from MDR's push webhook, see src/db/models/Load.ts) rather than any
 * carrier-search endpoint — MDR's confirmed API has no way to look up
 * carriers except scoped to a specific (carrier, load) pair, so full profile
 * + current quoted/do-not-call state is fetched fresh per candidate here.
 */
import { getCarrierForLoad } from "../mdr/api.js";
import type { MdrCarrierForLoad } from "../mdr/api.js";
import type { LocalLoad } from "../db/models/Load.js";

export async function buildCarrierQueue(load: LocalLoad): Promise<MdrCarrierForLoad[]> {
  const candidates = await Promise.all(
    load.invitedCarriers
      .filter((invited) => !invited.doNotCall) // skip the fetch entirely for carriers already flagged at invite time
      .map((invited) => getCarrierForLoad(invited.carrierId, load.id))
  );

  const eligible = candidates.filter(
    (carrier) =>
      !carrier.hasQuoted &&
      !carrier.doNotCall.calls &&
      carrier.eligibility.approvedAuthority &&
      carrier.eligibility.approvedInsurance &&
      !carrier.eligibility.fraudFlag &&
      carrier.eligibility.safetyStatus !== "flagged"
  );

  return rankCarriers(eligible, load);
}

function rankCarriers(carriers: MdrCarrierForLoad[], load: LocalLoad): MdrCarrierForLoad[] {
  return carriers
    .map((carrier) => ({ carrier, score: scoreCarrier(carrier, load) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.carrier);
}

function scoreCarrier(carrier: MdrCarrierForLoad, load: LocalLoad): number {
  let score = 0;

  const equipmentTag = [load.equipment?.containerSize, load.equipment?.containerType]
    .filter(Boolean)
    .join("_");
  if (equipmentTag && carrier.eligibility.approvedEquipment?.includes(equipmentTag)) {
    score += 10;
  }

  if (
    load.routing?.deliveryState &&
    carrier.eligibility.approvedGeography?.includes(load.routing.deliveryState as string)
  ) {
    score += 5;
  }

  // Service history as a light tiebreaker — not the primary ranking signal,
  // and never a proxy for "cheapest," per the playbook's explicit guardrail.
  score += Math.min(carrier.serviceHistory?.laneCount ?? 0, 50) / 50;

  return score;
}
