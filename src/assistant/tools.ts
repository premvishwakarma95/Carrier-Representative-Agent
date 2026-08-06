/**
 * Function-calling tools for Everly. These turn the conversation into
 * structured data — see src/assistant/prompt.ts "Tool usage rules" for when
 * each one gets called.
 *
 * Deliberately NOT included in any tool's parameters: loadId/carrierId. The
 * LLM has no reliable way to know MongoDB's internal IDs (only carrierName
 * etc. are exposed as prompt variables), so the server resolves the load and
 * carrier from call context instead (matching the incoming webhook's
 * message.call.id against the CallAttempt that was created when we dialed —
 * see src/server/webhookHandlers.ts). Trusting the LLM to echo back a raw
 * database ID it never actually saw would be fragile.
 *
 * server.url points at the orchestration service's webhook receiver
 * (src/server/index.ts). Update ORCHESTRATION_WEBHOOK_URL to a public URL
 * (e.g. via ngrok) to test with real inbound webhooks from Vapi.
 */

export const ORCHESTRATION_WEBHOOK_URL =
  process.env.ORCHESTRATION_WEBHOOK_URL ?? "http://localhost:3000/vapi/tool-calls";

const DECLINE_REASONS = [
  "lane_not_serviced",
  "no_capacity",
  "equipment_unavailable",
  "timing_appointment_conflict",
  "rate_not_workable",
  "terminal_not_serviced",
  "overweight_unsupported",
  "hazmat_unsupported",
  "reefer_unsupported",
  "no_chassis_availability",
  "transload_unavailable",
  "final_mile_unsupported",
  "insurance_compliance_limitation",
  "customer_broker_restriction",
  "insufficient_shipment_information",
  "bid_already_closed",
  "duplicate_request",
  "carrier_not_interested",
  "other",
] as const;

// Shared by calculate_quote and submit_quote — MDR's call-result and
// call-final-result endpoints take the same fields (see src/mdr/api.ts).
// all_in is deliberately not here: it's derived server-side from whether
// acc_types is empty, not something Everly asks about or states.
const quoteFieldProperties = {
  base_rate: {
    type: "number",
    description:
      "base drayage rate — pickup to warehouse if this load needs storage, otherwise pickup to " +
      "final delivery",
  },
  fsc: { type: "number", description: "fuel surcharge, as a percentage" },
  acc_types: {
    type: "array",
    items: { type: "number" },
    description:
      "ids of every accessorial that applies — existing matched ids plus any newly registered via " +
      "add_accessorial. Empty array if none.",
  },
  transload_rate: { type: "number", description: "only if this load needs storage" },
  finalmile_rate: { type: "number", description: "only if this load needs storage" },
  finalmile_fsc: { type: "number", description: "only if this load needs storage" },
  is_warehouse: { type: "number", enum: [0, 1], description: "1 if this load needs storage, 0 otherwise" },
  storage_rate: { type: "number", description: "only if this load needs storage" },
  warehouse_id: {
    type: "number",
    description: "only if this load needs storage — existing matched id or one newly registered via add_warehouse",
  },
  rate_valid_until: { type: "string", description: "date, e.g. 2026-12-31" },
  driver_available: { type: "string", description: "date, e.g. 2026-08-15" },
  details: { type: "string", description: "free-text notes, if any" },
};

const quoteFieldRequired = ["base_rate", "fsc", "acc_types", "is_warehouse", "rate_valid_until", "driver_available"];

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "calculate_quote",
      description:
        "Send the carrier's stated pricing to MDR to get the calculated total back. Call this once " +
        "you've collected every applicable field — the result includes MDR's calculated total, " +
        "which is what gets read back to the carrier for confirmation, not anything you compute " +
        "yourself. Safe to call again if the carrier wants to change something before confirming.",
      parameters: {
        type: "object",
        properties: quoteFieldProperties,
        required: quoteFieldRequired,
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_quote",
      description:
        "Finalize and submit the quote to MDR. Only call after the carrier has explicitly " +
        "confirmed the calculated total that calculate_quote returned — restate every field exactly " +
        "as sent to calculate_quote.",
      parameters: {
        type: "object",
        properties: {
          ...quoteFieldProperties,
          carrierConfirmedReadBack: {
            type: "boolean",
            description: "must be true — the carrier explicitly confirmed the calculated total read-back",
          },
        },
        required: [...quoteFieldRequired, "carrierConfirmedReadBack"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "log_decline",
      description: "Log that the carrier declined to quote this load.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", enum: DECLINE_REASONS as unknown as string[] },
          note: { type: "string", description: "free-text detail, required if reason is 'other'" },
        },
        required: ["reason"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "schedule_callback",
      description: "Record a specific callback time the carrier agreed to.",
      parameters: {
        type: "object",
        properties: {
          callbackDateTime: { type: "string", description: "ISO date/time" },
          carrierTimeZone: { type: "string" },
        },
        required: ["callbackDateTime"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "record_do_not_call",
      description:
        "Record an opt-out immediately when a carrier asks to not be contacted. Call this " +
        "before anything else in the conversation once requested.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["calls_only", "calls_and_email"] },
        },
        required: ["scope"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "resend_email",
      description:
        "Resend the load invitation email to this carrier. Call when the carrier says they never " +
        "received it, or otherwise asks for it again.",
      parameters: { type: "object", properties: {} },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "add_accessorial",
      description:
        "Register a new accessorial charge the carrier named that isn't already in their known " +
        "accessorial list. Only call for a genuinely new one — if what the carrier said matches an " +
        "existing accessorial, use that existing one instead of calling this. If unsure whether it " +
        "matches, confirm with the carrier before deciding.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "the accessorial's name, as the carrier stated it" },
          price: { type: "number" },
        },
        required: ["name", "price"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  {
    type: "function" as const,
    function: {
      name: "add_warehouse",
      description:
        "Register a new warehouse address the carrier named that isn't already in their known " +
        "warehouse list. Only call for a genuinely new one — if what the carrier said matches an " +
        "existing warehouse, use that existing one instead of calling this. If unsure whether it " +
        "matches, confirm with the carrier before deciding.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string" },
        },
        required: ["address"],
      },
    },
    server: { url: ORCHESTRATION_WEBHOOK_URL },
  },
  // Vapi's built-in call-termination tool — no server URL, handled natively.
  // Without this, Everly has no reliable way to hang up after her closing
  // line; a live test call had to be ended by the carrier manually (see
  // test-cases.md notes) because endCallPhrases matching against her
  // paraphrased (non-verbatim) sign-off never fired.
  { type: "endCall" as const },
];
