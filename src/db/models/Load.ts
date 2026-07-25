import { Schema, model } from "mongoose";
import type { MdrLoad, MdrAccountSettings } from "../../mdr/api.js";

/** Shape of a locally-persisted Load doc — MdrLoad's fields plus what only exists locally. */
export interface LocalLoad extends MdrLoad {
  invitedCarriers: Array<{ carrierId: string; doNotCall: boolean }>;
  settings: MdrAccountSettings;
  status: "open" | "closed";
  receivedAt: Date;
}

/**
 * Local cache of a load, populated entirely from MDR's push webhook
 * (POST /webhooks/mdr/load-ready — see src/server/mdrWebhook.ts). Brought
 * back after the 2026-07-20 client call confirmed there is no GET /loads or
 * GET /loads/{id} in MDR's real API — load details only ever arrive via that
 * webhook, so we have to persist them ourselves or lose them the moment the
 * request completes. Carrier and quote data stay API-only (src/mdr/api.ts),
 * since those DO have live, re-fetchable endpoints.
 *
 * `status` is our own local tracking, not something MDR pushes updates for —
 * synced opportunistically from GET /loads/{id}/quote-status's `allowCalling`
 * flag (see stopConditions.ts and dispatcher.ts's pre-dial check).
 */
const loadSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true }, // MDR's load id
    externalId: String,
    accountId: { type: String, required: true, index: true },

    equipment: Schema.Types.Mixed,
    routing: Schema.Types.Mixed,
    timing: Schema.Types.Mixed,
    cargo: Schema.Types.Mixed,
    serviceScope: {
      type: String,
      enum: ["drayage", "drayage_transload", "drayage_final_mile", "combined"],
      required: true,
    },
    operationalAssumptions: Schema.Types.Mixed,
    pricingRules: Schema.Types.Mixed,
    disclosureSettings: Schema.Types.Mixed,
    warehouseStorage: Schema.Types.Mixed,
    quoteThreshold: { type: Number, required: true },
    bidCloseAt: String,

    // Invited carriers as pushed by MDR — id + do-not-call only. Full
    // profile is fetched fresh per carrier via getCarrierForLoad() since
    // that also confirms current do-not-call/quoted status at call time.
    invitedCarriers: [
      {
        _id: false,
        carrierId: { type: String, required: true },
        doNotCall: { type: Boolean, default: false },
      },
    ],

    // Account settings snapshot from the webhook payload — no separate
    // settings-fetch endpoint exists in MDR's confirmed API, so this is
    // authoritative for this load's lifecycle until MDR's promised refresh
    // API exists (see requirements-tracker.md).
    settings: {
      quoteThreshold: Number,
      emailWaitMinutes: Number,
      maxCallAttempts: Number,
      callingWindow: { days: [String], startHour: Number, endHour: Number },
      voicemailPolicy: { allowed: Boolean },
      disclosurePolicy: { aiDisclosureRequired: Boolean, wording: String },
      negotiationAuthority: String,
    },

    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    receivedAt: { type: Date, required: true }, // when MDR's webhook arrived — the email-wait window has already elapsed by this point
  },
  { timestamps: true }
);

export const Load = model("Load", loadSchema);
