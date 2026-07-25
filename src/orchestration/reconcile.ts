/**
 * Backfills CallAttempts that never got their end-of-call-report — e.g. our
 * webhook server or tunnel was down at the exact moment Vapi tried to
 * deliver it (this has actually happened during testing). Without this, a
 * CallAttempt can sit at status "in_progress" forever even though the call
 * itself ended minutes ago, which defeats "every call has a correct stored
 * outcome." Vapi's own call record is authoritative regardless of whether
 * our webhook delivery succeeded, so we just go pull it directly.
 *
 * Only considers attempts older than STUCK_THRESHOLD_MINUTES, comfortably
 * past the assistant's maxDurationSeconds (src/assistant/create.ts) so we're
 * not racing a call that's still genuinely in progress.
 */
import { CallAttempt } from "../db/models/index.js";
import { getCall } from "../vapi/calls.js";
import { applyCallOutcome } from "../server/callOutcome.js";
import { checkStopConditions } from "./stopConditions.js";

const STUCK_THRESHOLD_MINUTES = 25; // assistant maxDurationSeconds is 900s (15min) — leaves a 10min buffer

export async function reconcileStuckCallAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60_000);
  const stuck = await CallAttempt.find({
    status: "in_progress",
    vapiCallId: { $exists: true, $ne: null },
    startedAt: { $lte: cutoff },
  });

  let reconciled = 0;
  for (const attempt of stuck) {
    try {
      const call = await getCall(attempt.vapiCallId as string);
      if (call.status !== "ended") continue; // genuinely still in progress somehow — leave it for next time

      applyCallOutcome(attempt, {
        endedReason: call.endedReason,
        transcript: call.artifact?.transcript,
        recordingUrl: call.artifact?.recording?.stereoUrl,
        summary: call.summary ?? call.analysis?.summary,
      });
      await attempt.save();
      await checkStopConditions(attempt.loadId);
      reconciled++;
    } catch (err) {
      console.error(`Failed to reconcile stuck CallAttempt ${attempt.id} (vapiCallId ${attempt.vapiCallId}):`, err);
    }
  }

  return reconciled;
}
