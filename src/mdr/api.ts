/**
 * Typed functions for MDR's real Voice API endpoints, confirmed against
 * live staging responses (see project memory / CLAUDE.md for the full
 * endpoint list). Only "Get All Carriers" is implemented so far — the rest
 * (call-result, call-final-result, decline, stop, email-resend,
 * add-accessorials, add-warehouse, get-specific-carrier) come as directed.
 *
 * Endpoint method is unconfirmed (the doc's own table says GET, its detail
 * section header says POST) — using GET per the table; trivial to swap if
 * that turns out wrong.
 */
import { mdr } from "./client.js";

export interface MdrCallingWindow {
  startingTime: string;
  endTime: string;
}

export interface MdrCarrier {
  outreach_id: number;
  carrier_id: number;
  rank: number;
  carrier_timezone: string;
  calling_window: MdrCallingWindow;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  email_sent: boolean;
  email_sent_at: string;
  stop_call: boolean;
  stop_reason: string | null;
}

export interface MdrResponseSummary {
  threshold: number;
  total_carriers: number;
  responses_received: number;
  responses_remaining: number;
  threshold_reached: boolean;
}

export interface MdrGetAllCarriersResponse {
  is_load_close: boolean;
  response_summary: MdrResponseSummary;
  batch: number;
  batch_size: number;
  carriers: MdrCarrier[];
}

/**
 * Fetches one batch of carriers for a load. Paginated — batch_size is 25
 * per the real response, undocumented in either PDF. Callers needing the
 * full list should keep incrementing `batch` until they've collected
 * response_summary.total_carriers carriers.
 */
export function getAllCarriersBatch(loadId: number, batch = 1): Promise<MdrGetAllCarriersResponse> {
  return mdr.get<MdrGetAllCarriersResponse>(`/voice/load/${loadId}?batch=${batch}`);
}

const MAX_CARRIER_BATCHES = 200; // 200 * batch_size(25) = 5000 carriers — far above any real load, just a runaway-loop backstop

/** Fetches every carrier for a load, looping through all batches. */
export async function getAllCarriers(loadId: number): Promise<MdrGetAllCarriersResponse> {
  const first = await getAllCarriersBatch(loadId, 1);
  const carriers = [...first.carriers];

  // total_carriers has been unreliable enough elsewhere in this API (string
  // vs number type mismatches on other fields) that a missing/non-numeric
  // value here shouldn't be trusted to drive a loop condition — treat it as
  // "just this first batch" instead of looping on NaN comparisons forever.
  const totalCarriers = Number(first.response_summary?.total_carriers);
  if (!Number.isFinite(totalCarriers)) {
    console.warn(`getAllCarriers: missing/invalid total_carriers for load ${loadId}, returning first batch only`);
    return first;
  }

  let batch = 1;
  while (carriers.length < totalCarriers && first.carriers.length > 0) {
    if (batch >= MAX_CARRIER_BATCHES) {
      console.error(`getAllCarriers: hit ${MAX_CARRIER_BATCHES}-batch safety cap for load ${loadId} — returning ${carriers.length}/${totalCarriers} carriers`);
      break;
    }
    batch += 1;
    const next = await getAllCarriersBatch(loadId, batch);
    if (next.carriers.length === 0) break;
    carriers.push(...next.carriers);
  }

  return { ...first, carriers };
}

export interface MdrAccessorial {
  name: string;
  price: string;
  id: number;
}

export interface MdrWarehouse {
  address: string;
  id: number;
}

export interface MdrCarrierDetail extends MdrCarrier {
  accessorials: MdrAccessorial[];
  warehouses: MdrWarehouse[];
}

export interface MdrGetSpecificCarrierResponse {
  is_load_close: boolean;
  response_summary: MdrResponseSummary;
  carrier: MdrCarrierDetail;
}

/**
 * Fresh, single-carrier lookup — used immediately before deciding whether to
 * call, since load/carrier state can change between when the local queue was
 * built and now (threshold met, carrier opted out, load closed, etc.).
 */
export function getSpecificCarrier(loadId: number, carrierId: number): Promise<MdrGetSpecificCarrierResponse> {
  return mdr.get<MdrGetSpecificCarrierResponse>(`/voice/load/${loadId}/carrier/${carrierId}`);
}
