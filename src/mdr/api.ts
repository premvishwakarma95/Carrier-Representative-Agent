/**
 * Typed functions for each MDR API operation (mock today, real once the
 * client builds it — see src/mock-mdr-api/ and requirements-tracker.md).
 *
 * As of the 2026-07-20 client call, MDR's integration is push-based, not
 * pull-based: MDR calls OUR webhook (src/server/mdrWebhook.ts) ~30 minutes
 * after a carrier invitation goes out, with the load, invited carriers
 * (id + do-not-call only — full profile requires the per-load carrier
 * lookup below), and account settings all in one payload. There is no
 * GET /loads or GET /loads/{id} in the client's confirmed API — load details
 * only ever arrive via that webhook, which is why we now persist them
 * locally (src/db/models/Load.ts) instead of re-fetching. The 4 confirmed
 * read/write APIs below are the only ones MDR will actually expose.
 */
import { mdr } from "./client.js";

export interface MdrLoad {
  id: string;
  externalId: string;
  accountId: string;
  equipment: {
    containerSize?: string;
    containerType?: string;
    chassisRequired?: boolean;
    overweight?: boolean;
    hazmat?: boolean;
    reefer?: boolean;
    [key: string]: unknown;
  };
  routing: {
    portOrRailRamp?: string;
    pickupTerminal?: string;
    deliveryCity?: string;
    deliveryState?: string;
    deliveryZip?: string;
    miles?: number;
    [key: string]: unknown;
  };
  timing: {
    earliestPickup?: string;
    lastFreeDay?: string;
    deliveryWindowStart?: string;
    deliveryWindowEnd?: string;
    bidExpiration?: string;
    [key: string]: unknown;
  };
  cargo: {
    commodity?: string;
    grossWeight?: number;
    [key: string]: unknown;
  };
  serviceScope: "drayage" | "drayage_transload" | "drayage_final_mile" | "combined";
  operationalAssumptions: {
    liveOrDrop?: "live" | "drop";
    freeTime?: string;
    chassisSource?: string;
    containerQuantity?: number;
    frequency?: "one_time" | "daily" | "weekly";
    [key: string]: unknown;
  };
  pricingRules: { lineItemOrAllIn?: string; currency?: string; [key: string]: unknown };
  disclosureSettings: {
    aiDisclosureRequired?: boolean;
    recordingDisclosureRequired?: boolean;
    shareBrokerIdentity?: boolean;
    firmOrForecasted?: string;
  };
  warehouseStorage?: Record<string, unknown>;
  quoteThreshold: number;
  bidCloseAt?: string;
}

export interface MdrCarrierContact {
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
  preferredMethod?: "phone" | "email";
}

export interface MdrCarrier {
  id: string;
  legalName: string;
  dba?: string;
  mcNumber?: string;
  usdotNumber?: string;
  contacts: MdrCarrierContact[];
  timezone: string;
  eligibility: {
    approvedAuthority: boolean;
    approvedInsurance: boolean;
    approvedEquipment: string[];
    approvedGeography: string[];
    safetyStatus: "ok" | "flagged" | "unknown";
    fraudFlag: boolean;
  };
  serviceHistory: { laneCount?: number; lastServiceDate?: string };
  doNotCall: {
    calls: boolean;
    email: boolean;
    reason?: string;
    source?: string;
    updatedBy?: string;
    recordedAt?: string | null;
  };
}

/** Result of the per-(carrier, load) lookup — carrier profile plus whether they've already quoted this specific load. */
export interface MdrCarrierForLoad extends MdrCarrier {
  hasQuoted: boolean;
}

export interface MdrQuote {
  id: string;
  loadId: string;
  carrierId: string;
  carrierEmail?: string;
  source: "everly" | "email";
  serviceScope: string;
  baseRate: number;
  totalEstimatedAllIn: number;
  status: "pending_review" | "valid" | "invalid" | "superseded";
  submittedAt: string;
  [key: string]: unknown;
}

export interface MdrQuoteStatus {
  loadId: string;
  requiredThreshold: number;
  currentValidQuoteCount: number;
  remainingQuoteCount: number;
  allowCalling: boolean;
}

export interface MdrAccountSettings {
  accountId: string;
  quoteThreshold: number;
  emailWaitMinutes: number;
  maxCallAttempts: number;
  callingWindow: { days: string[]; startHour: number; endHour: number };
  voicemailPolicy: { allowed: boolean };
  disclosurePolicy: { aiDisclosureRequired: boolean; wording: string };
  negotiationAuthority: string;
}

// The 4 APIs MDR confirmed on the 2026-07-20 client call. No load-discovery
// or bare carrier-lookup endpoints exist in the confirmed surface — loads
// arrive via webhook (src/db/models/Load.ts), and carrier lookups are always
// scoped to a specific load.

export function getLoadQuoteStatus(loadId: string): Promise<MdrQuoteStatus> {
  return mdr.get<MdrQuoteStatus>(`/loads/${loadId}/quote-status`);
}

export function submitQuote(loadId: string, data: Record<string, unknown>): Promise<MdrQuote> {
  return mdr.post<MdrQuote>(`/loads/${loadId}/quotes`, data);
}

/** GET /carriers/{carrier_id}/{load_id} — carrier profile + whether they've already quoted this load. */
export function getCarrierForLoad(carrierId: string, loadId: string): Promise<MdrCarrierForLoad> {
  return mdr.get<MdrCarrierForLoad>(`/carriers/${carrierId}/${loadId}`);
}

export function updateDoNotCall(
  carrierId: string,
  data: { scope: "calls_only" | "calls_and_email"; reason?: string; updatedBy?: string }
): Promise<MdrCarrier> {
  return mdr.patch<MdrCarrier>(`/carriers/${carrierId}/do-not-call`, data);
}
