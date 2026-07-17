/**
 * Maps a Load + Carrier into the {{variable}} placeholders referenced in
 * src/assistant/prompt.ts. Keep this in sync whenever the prompt's
 * placeholders change.
 */
import type { MdrLoad, MdrCarrier } from "../mdr/api.js";

function fmtDate(date?: string): string {
  return date ? new Date(date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "unknown";
}

export function buildCallVariables(load: MdrLoad, carrier: MdrCarrier) {
  const primaryContact = carrier.contacts?.[0];

  const equipmentDescription = [load.equipment.containerSize, load.equipment.containerType]
    .filter(Boolean)
    .join(" ")
    .concat(load.equipment.chassisRequired ? " with chassis" : "");

  return {
    carrierName: carrier.legalName,
    carrierEmail: primaryContact?.email ?? "unknown",
    loadId: load.externalId ?? load.id,
    bidId: load.externalId ?? load.id,
    equipmentDescription: equipmentDescription || "standard container",
    origin: load.routing.portOrRailRamp ?? load.routing.pickupTerminal ?? "unknown origin",
    destination: `${load.routing.deliveryCity ?? ""}, ${load.routing.deliveryState ?? ""}`.trim(),
    pickupLocation: load.routing.pickupTerminal ?? load.routing.portOrRailRamp ?? "unknown",
    deliveryLocation: `${load.routing.deliveryCity ?? "unknown"}, ${load.routing.deliveryState ?? ""} ${load.routing.deliveryZip ?? ""}`.trim(),
    miles: load.routing.miles ?? "unknown",
    commodity: load.cargo.commodity ?? "general freight",
    weight: load.cargo.grossWeight ?? "unknown",
    pickupTiming: fmtDate(load.timing.earliestPickup as string | undefined),
    deliveryWindow: `${fmtDate(load.timing.deliveryWindowStart as string | undefined)} - ${fmtDate(load.timing.deliveryWindowEnd as string | undefined)}`,
    lastFreeDay: load.timing.lastFreeDay ? fmtDate(load.timing.lastFreeDay as string) : "unknown",
    liveOrDrop: load.operationalAssumptions.liveOrDrop ?? "unspecified",
    freeTime: load.operationalAssumptions.freeTime ?? "unspecified",
    chassisRequirement: load.operationalAssumptions.chassisSource ?? "unspecified",
    containerQuantity: load.operationalAssumptions.containerQuantity ?? 1,
    frequency: load.operationalAssumptions.frequency ?? "one_time",
    serviceScope: load.serviceScope,
    specialRequirements: (load.cargo as any).specialHandling ?? "none",
    bidCloseTime: fmtDate(load.bidCloseAt),
    callbackNumber: "TBD", // filled in once MDR's callback number/DID is confirmed
  };
}
