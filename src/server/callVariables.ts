/**
 * Maps a Load + fresh Carrier (from MDR's real "Get Specific Carrier"
 * response) into the {{variable}} placeholders referenced in
 * src/assistant/prompt.ts. Field mapping confirmed against real captured
 * MDR data (see project memory) — hazmat/reefer intentionally omitted (told
 * to ignore them); deliveryWindow/liveOrDrop/freeTime/chassisRequirement/
 * bidCloseTime intentionally dropped from prompt.ts entirely (confirmed no
 * source field exists); quoteId/shipmentType/targetRate added (confirmed
 * these should be spoken to the carrier).
 *
 * Keep this in sync whenever prompt.ts's placeholders change.
 */
import type { MdrCarrierDetail } from "../mdr/api.js";

function fallback(value: unknown, label = "unknown"): string {
  if (value === null || value === undefined || value === "") return label;
  return String(value);
}

export function buildCallVariables(load: any, carrier: MdrCarrierDetail) {
  return {
    carrierName: fallback(carrier.company_name),
    carrierEmail: fallback(carrier.email),
    // No confirmed source for a real callback DID/number yet.
    callbackNumber: "TBD",

    quoteId: fallback(load.quote_id),
    loadId: fallback(load.id),

    origin: [load.origin_metro_location, load.origin_service_location].filter(Boolean).join(", ") || "unknown origin",
    destination: fallback(load.customer_location),
    pickupLocation: fallback(load.origin_service_location),
    deliveryLocation: fallback(load.customer_location),
    miles: fallback(load.distance),

    equipmentDescription: fallback(load.length),
    shipmentType: fallback(load.shipment_type),
    commodity: fallback(load.commodity),
    weight: fallback(load.cargo_weight),

    pickupTiming: fallback(load.load_available_date),
    lastFreeDay: fallback(load.lfd_cut),

    containerQuantity: fallback(load.quantity),
    frequency: fallback(load.frequency_status),
    serviceScope: fallback(load.service_type),
    targetRate: fallback(load.target_rate),

    specialRequirements: fallback(load.notes, "none"),
  };
}
