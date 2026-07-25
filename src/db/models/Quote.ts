/**
 * Local audit copy of every quote Everly submits — kept independently of
 * MDR's own copy so there's durable proof of exactly what was captured and
 * sent, even if MDR's write fails, is delayed, or their system later shows
 * something different. Written at submission time in src/server/webhookHandlers.ts,
 * before the write to MDR is attempted, so a failed MDR submission still
 * leaves a record (mdrSubmissionStatus: "failed") rather than losing the
 * captured quote entirely.
 *
 * Deliberately NOT the source of truth MDR itself reads from — MDR's own
 * copy (src/mdr/api.ts, mock or real) still drives eligibility/threshold
 * decisions (getLoadQuoteStatus, getCarrierForLoad.hasQuoted). This is audit
 * data only, same category as CallAttempt/Escalation.
 */
import { Schema, model, Types } from "mongoose";

const quoteSchema = new Schema(
  {
    loadId: { type: String, required: true, index: true },
    carrierId: { type: String, required: true, index: true },
    callAttemptId: { type: Types.ObjectId, ref: "CallAttempt", required: true },

    serviceScope: String,
    baseRate: Number,
    fuelSurcharge: Schema.Types.Mixed,
    chassis: Schema.Types.Mixed,
    accessorials: [Schema.Types.Mixed],
    freeTime: String,
    detentionRate: Number,
    totalEstimatedAllIn: Number,
    capacity: String,
    rateValidUntil: String,
    transload: Schema.Types.Mixed,
    warehouseStorage: Schema.Types.Mixed,
    finalMile: Schema.Types.Mixed,
    isConditional: Boolean,
    conditionalOn: String,
    carrierConfirmedReadBack: Boolean,

    // Populated after MDR's write succeeds — see submitQuote() in webhookHandlers.ts.
    mdrQuoteId: String,
    mdrStatus: String,
    mdrSubmissionStatus: { type: String, enum: ["submitted", "failed"], default: "submitted", index: true },
    mdrError: String,
  },
  { timestamps: true }
);

export const Quote = model("Quote", quoteSchema);
