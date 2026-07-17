import { Schema, model, Types } from "mongoose";

const escalationSchema = new Schema(
  {
    // Plain strings — MDR's external ids, not local collections. See the
    // same note in db/models/CallAttempt.ts.
    loadId: { type: String, required: true, index: true },
    carrierId: { type: String, required: true, index: true },
    callAttemptId: { type: Types.ObjectId, ref: "CallAttempt", required: true },

    reason: { type: String, required: true },
    capturedQuestion: String,
    preferredContactMethod: { type: String, enum: ["phone", "email"] },
    liveTransferOffered: { type: Boolean, default: false },

    status: { type: String, enum: ["open", "resolved"], default: "open", index: true },
    resolvedAt: Date,
  },
  { timestamps: true }
);

export const Escalation = model("Escalation", escalationSchema);
