/**
 * Temporary raw-capture store for whatever MDR's real webhook actually sends
 * (see the new draft docs: "MDR Voice Team API Integration Guide" / "Voice
 * Webhook Documentation"). Stores payloads as-is, unparsed, so real traffic
 * can be inspected before the actual Load/Carrier models and orchestration
 * flow get rebuilt against the confirmed shape. Not the final data model —
 * see CLAUDE.md's note on the new API once that rebuild happens.
 */
import { Schema, model } from "mongoose";

const webhookResponseSchema = new Schema({
  timestamp: { type: Date, required: true, default: Date.now },
  data: { type: Schema.Types.Mixed, required: true },
});

export const WebhookResponse = model("WebhookResponse", webhookResponseSchema);
