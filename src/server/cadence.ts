/**
 * Confirmed attempt cadence:
 *   1st call: 30 minutes after the carrier's invitation email was sent
 *   2nd call: 1 hour after the 1st
 *   3rd call: 2 hours after the 2nd
 *   4th call: next business morning (only if stop conditions still not met)
 * Max 4 attempts per carrier.
 *
 * Baseline for attempt 1 is the carrier's own `email_sent_at` (from a fresh
 * MDR API response), not a load-level webhook-received timestamp — each
 * carrier can have its own invite time.
 */
import { nextCallingWindowOpen, nextBusinessMorning } from "./callingWindow.js";

export const EMAIL_WAIT_MINUTES = 30;
export const MAX_CALL_ATTEMPTS = 4;

const OFFSET_MINUTES_FROM_PREVIOUS: Record<number, number> = {
  2: 60,
  3: 120,
};

export function computeAttemptSchedule(params: {
  attemptNumber: number;
  timezone: string;
  emailSentAt: Date;
  previousAttemptAt?: Date;
}): Date {
  const { attemptNumber, timezone, emailSentAt, previousAttemptAt } = params;

  if (attemptNumber === 1) {
    const target = new Date(emailSentAt.getTime() + EMAIL_WAIT_MINUTES * 60_000);
    return nextCallingWindowOpen(timezone, target);
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
