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

/**
 * Nothing in this file or prompt.ts previously told Everly what today's
 * actual date is — a real call (2026-08-07) showed the LLM resolving
 * "this month" / "end of the year" to 2024 instead of 2026 for
 * driver_available/rate_valid_until, two full years off. Every relative
 * date question needs this as its anchor.
 */
function formatCurrentDate(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** hazmat/reefer arrive as boolean or string (per the webhook doc) — normalize either to plain "Yes"/"No" for speech. */
function yesNo(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && value.trim() !== "") {
    return ["true", "yes", "1"].includes(value.trim().toLowerCase()) ? "Yes" : "No";
  }
  return "unknown";
}

/**
 * Spoken summary of transload/warehouse/final-mile services, mirroring the
 * same "Additional Services" list MDR's own carrier-facing quote page shows
 * (e.g. "Transloading Required", "Warehouse Required (2 days, 5 pallets)",
 * "Final Mile Delivery Required") — purely descriptive, built from the same
 * transload/storage/final-mile flags already computed below for pricing
 * branching, not a new condition of its own.
 */
function renderAdditionalServices(params: {
  transloadNeeded: string;
  storageNeeded: string;
  storageDays: string;
  storagePallets: string;
  finalMileNeeded: string;
}): string {
  if (params.transloadNeeded !== "yes") return "None";
  const parts = ["Transloading required"];
  if (params.storageNeeded === "yes") {
    parts.push(`warehouse storage required (${params.storageDays} days, ${params.storagePallets} pallets)`);
  }
  if (params.finalMileNeeded === "yes") {
    parts.push("final-mile delivery required");
  }
  return parts.join("; ");
}

/**
 * Renders the carrier's existing warehouses (from a fresh "Get Specific
 * Carrier" response) as a spoken-context string. The prompt tells Everly to
 * match against "the known list already given in your context for this
 * call" — this is that list; without it there's nothing to match against, so
 * every warehouse the carrier names would look "genuinely new" and get
 * re-registered as a duplicate.
 */
function renderKnownWarehouses(items: Array<{ id: number; address: string }>): string {
  if (!items || items.length === 0) return "none on file";
  return items.map((item) => `${item.address} (id ${item.id})`).join(", ");
}

/**
 * Same idea as renderKnownWarehouses, but for accessorials — includes the
 * on-file price too. A real call showed why this matters: the carrier named
 * "lumper fee," which already existed on file at $100, but this list didn't
 * include that price — Everly had no way to know the carrier's stated $40
 * differed from what was on file, and MDR has no "update price" endpoint
 * (only add_accessorial, which creates a new entry), so a price mismatch
 * genuinely can't be reconciled by reusing the old id. Showing the price
 * here lets Everly recognize the mismatch and explain it to the carrier
 * (see prompt.ts's accessorial-matching instructions) instead of silently
 * reusing a stale price or silently creating an unexplained duplicate.
 */
function renderKnownAccessorials(items: Array<{ id: number; name: string; price: string }>): string {
  if (!items || items.length === 0) return "none on file";
  return items.map((item) => `${item.name} (id ${item.id}, $${item.price})`).join(", ");
}

export function buildCallVariables(load: any, carrier: MdrCarrierDetail) {
  const currentDate = formatCurrentDate();

  // Three independent gates, per client clarification — do not conflate
  // them, each drives a different subset of the "Storage & final-mile
  // pricing" section in prompt.ts:
  //   - transloadNeeded: is there a transload leg at all (transload_rate).
  //     Driven by service_type, NOT storage_needed — a load can transload
  //     without needing formal warehouse storage.
  //   - storageNeeded: does this transload leg need warehouse storage
  //     (is_warehouse/storage_rate/warehouse_id). Driven by the load's own
  //     storage_needed boolean, independent of service_type's exact value.
  //   - finalMileNeeded: is there a final-mile leg on top of transload
  //     (finalmile_rate/finalmile_fsc). Driven by service_type; a load can
  //     transload (with or without storage) without needing final mile.
  // service_type is a confirmed 3-value enum (per "Voice Webhook
  // Documentation" v1.0): "Drayage Only" / "Drayage + Transloading" /
  // "Drayage + Transloading + Final Mile" — exact match, not a substring
  // check, since it's a closed enum.
  const transloadNeeded =
    load.service_type === "Drayage + Transloading" || load.service_type === "Drayage + Transloading + Final Mile"
      ? "yes"
      : "no";
  const storageNeeded = load.storage_needed ? "yes" : "no";
  const storageDays = fallback(load.storage_days);
  const storagePallets = fallback(load.storage_pallets);
  const finalMileNeeded = load.service_type === "Drayage + Transloading + Final Mile" ? "yes" : "no";

  return {
    currentDate,

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
    ssl: fallback(load.ssl),
    shipmentType: fallback(load.shipment_type),
    commodity: fallback(load.commodity),
    weight: fallback(load.cargo_weight),
    // Plain informational facts about the cargo — per client instruction,
    // these are spoken as-is and are NOT a branch condition for any other
    // question (unlike transloadNeeded/storageNeeded/finalMileNeeded below).
    hazmat: yesNo(load.hazmat),
    reefer: yesNo(load.reefer),

    pickupTiming: fallback(load.load_available_date),
    lastFreeDay: fallback(load.lfd_cut),

    containerQuantity: fallback(load.quantity),
    frequency: fallback(load.frequency_status),
    serviceScope: fallback(load.service_type),
    additionalServices: renderAdditionalServices({ transloadNeeded, storageNeeded, storageDays, storagePallets, finalMileNeeded }),
    targetRate: fallback(load.target_rate),

    specialRequirements: fallback(load.notes, "none"),

    transloadNeeded,
    storageNeeded,
    storageDays,
    storagePallets,
    finalMileNeeded,

    // The carrier's own known accessorials/warehouses, for the matching
    // logic described in the "Drayage pricing capture" / "Storage &
    // final-mile pricing" sections of prompt.ts.
    existingAccessorials: renderKnownAccessorials(carrier.accessorials),
    existingWarehouses: renderKnownWarehouses(carrier.warehouses),
  };
}
