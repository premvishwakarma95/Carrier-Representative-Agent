/**
 * Typed functions for each MDR API operation (mock today, real once the
 * client builds it — see src/mock-mdr-api/ and requirements-tracker.md).
 * Field shapes match src/mock-mdr-api/data.ts and the client's PDF; two
 * fields (Load.invitedCarrierIds, Load.timing.bidEmailSentAt) are GAP-FILL
 * additions not in the client's spec — see src/mock-mdr-api/README.md.
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
    bidEmailSentAt?: string; // GAP-FILL
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
  status: "open" | "threshold_met" | "closed" | "awarded" | "paused" | "cancelled";
  invitedCarrierIds: string[]; // GAP-FILL
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
  doNotCall: { calls: boolean; email: boolean; reason?: string; source?: string; recordedAt?: string | null };
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

export async function getLoadsList(status?: string): Promise<Array<{ id: string; externalId: string; status: string }>> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await mdr.get<{ loads: Array<{ id: string; externalId: string; status: string }> }>(`/loads${query}`);
  return res.loads;
}

export function getLoad(loadId: string): Promise<MdrLoad> {
  return mdr.get<MdrLoad>(`/loads/${loadId}`);
}

export function getLoadQuoteStatus(loadId: string): Promise<MdrQuoteStatus> {
  return mdr.get<MdrQuoteStatus>(`/loads/${loadId}/quote-status`);
}

export async function getLoadQuotes(loadId: string): Promise<MdrQuote[]> {
  const res = await mdr.get<{ quotes: MdrQuote[] }>(`/loads/${loadId}/quotes`);
  return res.quotes;
}

export function submitQuote(loadId: string, data: Record<string, unknown>): Promise<MdrQuote> {
  return mdr.post<MdrQuote>(`/loads/${loadId}/quotes`, data);
}

export async function getCarriers(ids?: string[]): Promise<MdrCarrier[]> {
  const query = ids && ids.length > 0 ? `?ids=${ids.join(",")}` : "";
  const res = await mdr.get<{ carriers: MdrCarrier[] }>(`/carriers${query}`);
  return res.carriers;
}

export function getCarrier(carrierId: string): Promise<MdrCarrier> {
  return mdr.get<MdrCarrier>(`/carriers/${carrierId}`);
}

export function updateDoNotCall(
  carrierId: string,
  data: { scope: "calls_only" | "calls_and_email"; reason?: string }
): Promise<MdrCarrier> {
  return mdr.patch<MdrCarrier>(`/carriers/${carrierId}/do-not-call`, data);
}

export function getAccountSettings(accountId: string): Promise<MdrAccountSettings> {
  return mdr.get<MdrAccountSettings>(`/accounts/${accountId}/settings`);
}
