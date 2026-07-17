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

const accessorialLineItem = {
  type: "object",
  properties: {
    name: { type: "string", description: "e.g. detention, overweight, pre-pull, tolls" },
    amount: { type: "number" },
    unit: { type: "string", description: "e.g. flat, per hour, per day, percentage" },
    trigger: { type: "string", description: "condition under which this charge applies" },
  },
  required: ["name", "amount"],
};

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "submit_quote",
      description:
        "Submit a carrier's confirmed quote. Only call after reading the quote back and " +
        "receiving explicit verbal confirmation from the carrier.",
      parameters: {
        type: "object",
        properties: {
          serviceScope: {
            type: "string",
            enum: ["drayage", "drayage_transload", "drayage_final_mile", "combined"],
          },
          baseRate: { type: "number" },
          fuelSurcharge: {
            type: "object",
            properties: {
              amount: { type: "number" },
              includedInBase: { type: "boolean" },
            },
          },
          chassis: {
            type: "object",
            properties: {
              amount: { type: "number" },
              includedInBase: { type: "boolean" },
              source: { type: "string", enum: ["carrier_supplied", "customer_supplied"] },
            },
          },
          accessorials: { type: "array", items: accessorialLineItem },
          freeTime: { type: "string", description: "e.g. '2 hours loading/unloading'" },
          detentionRate: { type: "number" },
          totalEstimatedAllIn: { type: "number" },
          capacity: { type: "string", description: "e.g. '2 containers/day'" },
          rateValidUntil: { type: "string", description: "ISO date/time" },
          transload: {
            type: "object",
            description: "Only if serviceScope includes transload",
            properties: {
              facilityName: { type: "string" },
              facilityAddress: { type: "string" },
              carrierOperated: { type: "boolean" },
              unloadCharge: { type: "number" },
              accessorials: { type: "array", items: accessorialLineItem },
            },
          },
          warehouseStorage: {
            type: "object",
            description: "Only if storage was selected within transload scope",
            properties: {
              ratePerPalletPerDay: { type: "number" },
              ratePerPalletPerMonth: { type: "number" },
              freeDays: { type: "number" },
              freeDaysBasis: { type: "string", enum: ["calendar", "business"] },
              billingStartTrigger: { type: "string" },
              minimumCharge: { type: "string" },
            },
          },
          finalMile: {
            type: "object",
            description: "Only if serviceScope includes final mile",
            properties: {
              baseRate: { type: "number" },
              equipmentType: { type: "string" },
              accessorials: { type: "array", items: accessorialLineItem },
            },
          },
          isConditional: {
            type: "boolean",
            description: "true if any detail was unknown/assumed and the quote is conditional on it",
          },
          conditionalOn: { type: "string", description: "what the quote is conditional on, if applicable" },
          carrierConfirmedReadBack: {
            type: "boolean",
            description: "must be true — the carrier explicitly confirmed the quote read-back",
          },
        },
        required: [
          "serviceScope",
          "baseRate",
          "totalEstimatedAllIn",
          "rateValidUntil",
          "carrierConfirmedReadBack",
        ],
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
      name: "escalate_to_human",
      description:
        "Hand off to a human — negotiation beyond asking for best rate, legal/compliance " +
        "questions, identity disputes, unusual equipment, aggressive callers, unresolved rate " +
        "contradictions, tool failures, or explicit carrier request.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          capturedQuestion: { type: "string" },
          preferredContactMethod: { type: "string", enum: ["phone", "email"] },
          liveTransferOffered: { type: "boolean" },
        },
        required: ["reason"],
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
      name: "update_contact",
      description: "Record a corrected contact name/phone/email, or a stated carrier preference.",
      parameters: {
        type: "object",
        properties: {
          correctedName: { type: "string" },
          correctedPhone: { type: "string" },
          correctedEmail: { type: "string" },
          preference: { type: "string", description: "e.g. 'email only', 'no brokers'" },
        },
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
