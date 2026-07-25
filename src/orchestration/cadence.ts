/**
 * Confirmed attempt cadence (requirements-tracker.md):
 *   1st call: after the email-wait window
 *   2nd call: 1 hour after the 1st
 *   3rd call: 2 hours after the 2nd
 *   4th call: next business morning (only if stop conditions still not met)
 *
 * Every computed time is snapped forward to the carrier's calling window if it
 * would otherwise fall outside Mon-Fri 8am-5pm local.
 *
 * Per the 2026-07-20 client call, MDR now pushes the load to Everly's webhook
 * ~30 minutes after the carrier invitation goes out (see
 * src/server/mdrWebhook.ts) — i.e. the email-wait window has already elapsed
 * by the time a Load exists locally at all. So attempt 1 uses the webhook's
 * receivedAt directly as its baseline rather than adding emailWaitMinutes
 * again on top of it.
 */
import { nextCallingWindowOpen, nextBusinessMorning } from "./callingWindow.js";

const OFFSET_MINUTES_FROM_PREVIOUS: Record<number, number> = {
  2: 60,
  3: 120,
};

export function computeAttemptSchedule(params: {
  attemptNumber: number;
  timezone: string;
  webhookReceivedAt: Date;
  previousAttemptAt?: Date;
}): Date {
  const { attemptNumber, timezone, webhookReceivedAt, previousAttemptAt } = params;

  if (attemptNumber === 1) {
    return nextCallingWindowOpen(timezone, webhookReceivedAt);
  }

  if (!previousAttemptAt) {
    throw new Error(`Attempt ${attemptNumber} requires previousAttemptAt`);
  }

  if (attemptNumber === 4) {
    return nextBusinessMorning(timezone, previousAttemptAt);
  }

  const offsetMinutes = OFFSET_MINUTES_FROM_PREVIOUS[attemptNumber];
  if (!offsetMinutes) {
    throw new Error(`Unsupported attempt number: ${attemptNumber}`);
  }
  const target = new Date(previousAttemptAt.getTime() + offsetMinutes * 60_000);
  return nextCallingWindowOpen(timezone, target);
}
