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
 * Assumption: Load.createdAt is treated as the bid-email-sent timestamp, since
 * we don't yet have a separate MDR-provided "email sent at" field. Revisit
 * once real MDR integration lands (Phase 2).
 */
import { nextCallingWindowOpen, nextBusinessMorning } from "./callingWindow.js";

const OFFSET_MINUTES_FROM_PREVIOUS: Record<number, number> = {
  2: 60,
  3: 120,
};

export function computeAttemptSchedule(params: {
  attemptNumber: number;
  timezone: string;
  emailSentAt: Date;
  emailWaitMinutes: number;
  previousAttemptAt?: Date;
}): Date {
  const { attemptNumber, timezone, emailSentAt, emailWaitMinutes, previousAttemptAt } = params;

  if (attemptNumber === 1) {
    const target = new Date(emailSentAt.getTime() + emailWaitMinutes * 60_000);
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
