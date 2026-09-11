/**
 * Typed functions for MDR's real Voice API endpoints (see "MDR Voice Team
 * API Integration Guide"). Get All Carriers / Get Specific Carrier are
 * confirmed against live staging responses; the rest (decline/stop/
 * email-resend/add-accessorials/add-warehouse/call-result/call-final-result)
 * are built directly from the doc's request/response examples, not yet
 * exercised against staging.
 *
 * Get All Carriers / Get Specific Carrier's method is unconfirmed (the
 * doc's own table says GET, its detail section header says POST) — using
 * GET per the table, and confirmed working against real staging data.
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
  is_agent_call_on: boolean;
}

export interface MdrGetAllCarriersResponse {
  is_load_close: boolean;
  response_summary: MdrResponseSummary;
  batch: number;
  batch_size: number;
  carriers: MdrCarrier[];
}

/**
 * Fetches every carrier for a load. Previously paginated (25 per page via a
 * ?batch= param, looped until response_summary.total_carriers was met) —
 * per MDR (2026-09-10), this endpoint no longer takes/needs that param and
 * returns the full carrier list for the load in one response.
 *
 * availableCount is the same endpoint with one added param (MDR, 2026-09-10)
 * — pass it to pull fresh replacement carrier(s) not yet invited on this
 * load, e.g. after one declines. Same response shape either way.
 */
export function getAllCarriers(loadId: number, options?: { availableCount?: number }): Promise<MdrGetAllCarriersResponse> {
  const query = options?.availableCount ? `?available_count=${options.availableCount}` : "";
  return mdr.get<MdrGetAllCarriersResponse>(`/voice/load/${loadId}${query}`);
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

export interface MdrActionResponse {
  success: boolean;
  message: string;
}

/** Doc 2.5 — use only when the carrier explicitly refuses this load. */
export function declineCarrier(outreachId: number, reason: string): Promise<MdrActionResponse> {
  return mdr.post<MdrActionResponse>("/voice/decline", { outreach_id: outreachId, reason });
}

/** Doc 2.6 — stop contacting this carrier (opted out, wrong number, blocked, invalid phone). */
export function stopCarrier(outreachId: number, reason: string): Promise<MdrActionResponse> {
  return mdr.post<MdrActionResponse>("/voice/stop", { outreach_id: outreachId, reason });
}

/** Doc 2.7 — carrier asked for the invitation email to be resent. */
export function resendInvitationEmail(outreachId: number): Promise<MdrActionResponse> {
  return mdr.post<MdrActionResponse>("/voice/email-resend", { outreach_id: outreachId });
}

/**
 * Updates MDR's own confirmed pricing/dispatch contact for this outreach
 * (client-provided endpoint, 2026-09-11) — form-data, not JSON, see
 * client.ts's postForm. phone is optional; MDR's own example sends it as an
 * empty string when unknown rather than omitting the field.
 */
export function updateCarrierDetail(outreachId: number, name: string, phone: string = ""): Promise<MdrActionResponse> {
  return mdr.postForm<MdrActionResponse>("/voice/update-carrier-detail", {
    outreach_id: String(outreachId),
    name,
    phone,
  });
}

export interface MdrAddAccessorialResponse {
  success: boolean;
  accessorials: MdrAccessorial;
}

/** Doc 2.8 — register an accessorial the carrier named that isn't already in their known list. */
export function addAccessorial(outreachId: number, name: string, price: number): Promise<MdrAddAccessorialResponse> {
  return mdr.post<MdrAddAccessorialResponse>("/voice/add-accessorials", {
    outreach_id: outreachId,
    accessorial: name,
    price,
  });
}

export interface MdrAddWarehouseResponse {
  success: boolean;
  warehouse: MdrWarehouse;
}

/** Doc 2.9 — register a warehouse address the carrier named that isn't already in their known list. */
export function addWarehouse(outreachId: number, address: string): Promise<MdrAddWarehouseResponse> {
  return mdr.post<MdrAddWarehouseResponse>("/voice/add-warehouse", { outreach_id: outreachId, address });
}

/**
 * Shared request shape for call-result (doc 2.3) and call-final-result (doc
 * 2.4) — same fields, MDR expects the full set resent to each, not just a
 * reference to the earlier call-result call.
 */
export interface MdrCallResultRequest {
  outreach_id: number;
  base_rate: number;
  fsc: number;
  acc_types: number[];
  transload_rate?: number;
  finalmile_rate?: number;
  finalmile_fsc?: number;
  is_warehouse: 0 | 1;
  storage_rate?: number;
  warehouse_id?: number;
  rate_valid_until: string;
  driver_available: string;
  details?: string;
}

export interface MdrAccessorialCharge {
  accessorial_id: number;
  name: string;
  unit_price: string;
  quantity: string;
  total: number;
}

export interface MdrRateCalculationData {
  quote_id: number;
  carrier_id: number;
  carrier_name: string;
  carrier_email: string;
  quantity: string;
  base_rate: { rate_per_unit: string; quantity: string; total: number };
  fsc: { percentage: string; amount: number; calculation: string };
  accessorial_charges: MdrAccessorialCharge[];
  accessorial_total: number;
  transload_charges: unknown;
  final_rate: number;
  rate_breakdown: {
    base_rate_total: number;
    fsc_amount: number;
    accessorial_total: number;
    transload_total: number;
    grand_total: number;
  };
  driver_availability: string;
  details: string;
  existing_response: boolean;
}

export interface MdrCallResultResponse {
  success: boolean;
  rate_calculation: {
    headers: Record<string, unknown>;
    original: {
      success: boolean;
      message: string;
      data: MdrRateCalculationData;
    };
    exception: unknown;
  };
}

/**
 * MDR's staging backend throws an uncaught server-side exception (500,
 * Laravel's default error page) when acc_types arrives as a real JSON
 * array. Sending the exact same value as a string — "[5,6]" or "[]" for
 * none — succeeds. Confirmed by isolation: identical payload, only this
 * field's JSON type changed, JSON vs multipart/form-data content-type made
 * no difference. This was the actual cause of the "call-result returns 500"
 * finding from 2026-08-06 — not a broken endpoint on MDR's side.
 */
function serializeAccTypes(accTypes: number[]): string {
  return JSON.stringify(accTypes);
}

/**
 * Doc 2.3 — call once mid-conversation, after the carrier has given their
 * rate, to get MDR's calculated total back. That calculated total (not
 * anything Everly computes herself) is what gets read back for
 * confirmation before submitCallFinalResult.
 */
export function submitCallResult(payload: MdrCallResultRequest): Promise<MdrCallResultResponse> {
  return mdr.post<MdrCallResultResponse>("/voice/call-result", {
    ...payload,
    acc_types: serializeAccTypes(payload.acc_types),
  });
}

export interface MdrCallFinalResultRequest extends MdrCallResultRequest {
  all_in: 0 | 1;
}

export interface MdrCallFinalResultResponse {
  success: boolean;
}

/** Doc 2.4 — call once, after the carrier explicitly confirms the calculated total. */
export function submitCallFinalResult(payload: MdrCallFinalResultRequest): Promise<MdrCallFinalResultResponse> {
  return mdr.post<MdrCallFinalResultResponse>("/voice/call-final-result", {
    ...payload,
    acc_types: serializeAccTypes(payload.acc_types),
  });
}

/**
 * MDR's own fixed business-outcome vocabulary for the Call Log API (spec
 * received 2026-08-27) plus CALL_DROPPED, added 2026-08-31 per explicit
 * instruction to cover a connected call the carrier hung up on before
 * reaching any conclusive outcome — confirmed on a real test call, MDR's
 * original 6 values had no honest equivalent for that case. Mapped from our
 * CallAttempt.status/callResult in callOutcome.ts's mapToMdrCallLogStatus,
 * which still returns null (skip the push entirely) for outcomes that
 * remain a poor fit even with CALL_DROPPED available (do_not_call, failed,
 * wrong_number) rather than force one of these 7 onto something that
 * doesn't fit.
 */
export type MdrCallLogStatus =
  | "NO_ANSWER"
  | "LEFT_VOICEMAIL"
  | "FOLLOW_UP_REQUIRED"
  | "EMAIL_REQUESTED"
  | "ACCEPTED"
  | "DECLINED"
  | "CALL_DROPPED";

export interface MdrCallLogRequest {
  outreach_id: number;
  call_id: string;
  status: MdrCallLogStatus;
  // MM:SS, per MDR's spec (e.g. "03:05") — see formatDurationMmSs in
  // callOutcome.ts, built from the same real Vapi timestamps as
  // CallAttempt.durationSeconds.
  duration: string;
  data?: Record<string, unknown>;
}

export interface MdrCallLogResponse {
  success?: boolean;
  [key: string]: unknown;
}

/**
 * Voice Team API Integration — Call Log API (spec received 2026-08-27, not
 * yet exercised against staging). Called once per ended call (connected or
 * not) so MDR's own system has a record of every attempt, not just
 * successful ones — separate from and in addition to the decline/stop/
 * call-result endpoints above, which report business outcomes rather than
 * raw call logs.
 */
export function submitCallLog(payload: MdrCallLogRequest): Promise<MdrCallLogResponse> {
  return mdr.post<MdrCallLogResponse>("/voice/call-logs", payload);
}
