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
