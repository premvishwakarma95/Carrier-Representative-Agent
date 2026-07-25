import { vapi } from "./client.js";

export async function createOutboundCall(params: {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
  variableValues: Record<string, string | number | boolean>;
}) {
  return vapi.post<{ id: string }>("/call", {
    assistantId: params.assistantId,
    phoneNumberId: params.phoneNumberId,
    customer: { number: params.customerNumber },
    assistantOverrides: { variableValues: params.variableValues },
  });
}

/**
 * Fetches a call's own authoritative record straight from Vapi — used for
 * reconciliation when our webhook never received (or received an incomplete)
 * end-of-call-report, e.g. because the tunnel/server was down at the time.
 * See src/orchestration/reconcile.ts.
 */
export function getCall(callId: string) {
  return vapi.get<{
    status: string;
    endedReason?: string;
    artifact?: { transcript?: string; recording?: { stereoUrl?: string } };
    summary?: string;
    analysis?: { summary?: string };
  }>(`/call/${callId}`);
}
