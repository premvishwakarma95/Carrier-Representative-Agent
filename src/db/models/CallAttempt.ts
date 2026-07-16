import { Schema, model, Types } from "mongoose";

const callAttemptSchema = new Schema(
  {
    loadId: { type: Types.ObjectId, ref: "Load", required: true, index: true },
    carrierId: { type: Types.ObjectId, ref: "Carrier", required: true, index: true },
    attemptNumber: { type: Number, required: true }, // 1-4 per the confirmed cadence

    scheduledFor: { type: Date, required: true }, // when this attempt should fire, per cadence rules
    vapiCallId: String, // set once actually dialed

    status: {
      type: String,
      enum: ["scheduled", "in_progress", "completed", "no_answer", "voicemail", "failed", "cancelled"],
      default: "scheduled",
      index: true,
    },

    callResult: {
      type: String,
      enum: [
        "connected",
        "voicemail",
        "wrong_number",
        "callback",
        "quote_received",
        "conditional_quote",
        "declined",
        "do_not_call",
        "escalation",
      ],
    },

    // Audit trail — required per playbook Section 12 "Confirmation" / Section 13
    transcript: String,
    recordingUrl: String,
    summary: String,
    sentiment: String,
    qualityScore: Number,
    agentVersion: String,
    promptVersion: String,
    consentDisclosureDelivered: { type: Boolean, default: false },
    endedReason: String, // raw Vapi endedReason, useful for debugging call outcomes

    // Set by the log_decline / schedule_callback tool webhooks
    declineReason: String,
    declineNote: String,
    callbackAt: Date,
    callbackTimeZone: String,

    startedAt: Date,
    endedAt: Date,
  },
  { timestamps: true }
);

// A carrier should never have two concurrent/active attempts on the same load —
// this compound index backs the idempotency/locking requirement (Step 4.6).
callAttemptSchema.index({ loadId: 1, carrierId: 1, attemptNumber: 1 }, { unique: true });

export const CallAttempt = model("CallAttempt", callAttemptSchema);
