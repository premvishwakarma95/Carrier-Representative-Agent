/**
 * Classifies a call's Vapi endedReason into our CallAttempt.status taxonomy,
 * and applies the full outcome (status, transcript, recording, summary) onto
 * a CallAttempt document.
 *
 * Deliberately an allowlist, not a denylist: Vapi has 600+ possible
 * endedReason values (telephony-provider errors, SIP edge cases, etc.) and
 * new ones get added over time. Silently bucketing anything unrecognized
 * into "completed" would hide real failures as if the call went fine — safer
 * to default unrecognized reasons to "failed" and log them so they get
 * noticed and added here, than to assume the best.
 */
import type { HydratedDocument } from "mongoose";

const VOICEMAIL_REASONS = new Set(["voicemail"]);

const NO_ANSWER_REASONS = new Set([
  "customer-did-not-answer",
  "customer-busy",
  "twilio-reported-customer-misdialed",
  "call.ringing.sip-inbound-caller-hungup-before-call-connect",
]);

const NORMAL_COMPLETION_REASONS = new Set([
  "assistant-ended-call",
  "assistant-ended-call-with-hangup-task",
  "assistant-ended-call-after-message-spoken",
  "assistant-said-end-call-phrase",
  "assistant-forwarded-call",
  "customer-ended-call",
  "customer-ended-call-before-warm-transfer",
  "customer-ended-call-after-warm-transfer-attempt",
  "customer-ended-call-during-transfer",
  "exceeded-max-duration",
  "manually-canceled",
  "silence-timed-out",
  "call.in-progress.twilio-completed-call",
  "call.in-progress.sip-completed-call",
  "vonage-completed",
]);

export type CallStatus = "completed" | "voicemail" | "no_answer" | "failed";

export function classifyCallStatus(endedReason: string | undefined): CallStatus {
  if (!endedReason) return "completed";
  if (VOICEMAIL_REASONS.has(endedReason)) return "voicemail";
  if (NO_ANSWER_REASONS.has(endedReason)) return "no_answer";
  if (NORMAL_COMPLETION_REASONS.has(endedReason)) return "completed";
  console.warn(`Unrecognized Vapi endedReason "${endedReason}" — defaulting to status "failed". Consider adding it to src/server/callOutcome.ts.`);
  return "failed";
}

export function applyCallOutcome(
  attempt: HydratedDocument<any>,
  data: {
    endedReason?: string;
    transcript?: string;
    recordingUrl?: string;
    summary?: string;
  }
) {
  attempt.transcript = data.transcript;
  attempt.recordingUrl = data.recordingUrl;
  attempt.summary = data.summary;
  attempt.endedReason = data.endedReason;
  attempt.endedAt = new Date();

  if (attempt.status === "in_progress") {
    attempt.status = classifyCallStatus(data.endedReason);
  }

  // callResult only gets set by a tool call (submit_quote, log_decline, etc.)
  // mid-conversation. If the call genuinely completed but no tool ever fired
  // — a real gap, since the prompt requires one — record that explicitly
  // rather than leaving callResult silently empty.
  if (!attempt.callResult) {
    if (attempt.status === "voicemail") attempt.callResult = "voicemail";
    else if (attempt.status === "completed") attempt.callResult = "connected";
  }
}
