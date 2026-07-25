/**
 * Ties eligibility + queue building + cadence + calling window together and
 * actually places calls. This is meant to be invoked repeatedly (cron/poll —
 * see runOnce.ts) since attempts become "due" at different future times.
 *
 * Idempotency: CallAttempt has a unique (loadId, carrierId, attemptNumber)
 * index (see db/models/CallAttempt.ts). If two dispatcher runs race for the
 * same attempt slot, the loser's insert fails with a duplicate-key error,
 * which we treat as "someone else already claimed it" rather than an error.
 */
import { env } from "../config/env.js";
import { CallAttempt, Load } from "../db/models/index.js";
import { findLoadsNeedingOutreach } from "./eligibility.js";
import { buildCarrierQueue } from "./queueBuilder.js";
import { checkStopConditions } from "./stopConditions.js";
import { computeAttemptSchedule } from "./cadence.js";
import { isWithinCallingWindow } from "./callingWindow.js";
import { buildCallVariables } from "./callVariables.js";
import { createOutboundCall } from "../vapi/calls.js";
import { getLoadQuoteStatus, getCarrierForLoad } from "../mdr/api.js";
import { reconcileStuckCallAttempts } from "./reconcile.js";
import type { MdrCarrierForLoad } from "../mdr/api.js";
import type { LocalLoad } from "../db/models/Load.js";

export async function runDispatchCycle() {
  const reconciledCount = await reconcileStuckCallAttempts();
  if (reconciledCount > 0) {
    console.log(`Reconciled ${reconciledCount} stuck call attempt(s) directly from Vapi.`);
  }

  const loads = await findLoadsNeedingOutreach();
  const results: Array<{ loadId: string; carrierId: string; outcome: string }> = [];

  for (const load of loads) {
    const stopCheck = await checkStopConditions(load.id);
    if (stopCheck.shouldStop) {
      results.push({ loadId: load.id, carrierId: "-", outcome: `stopped: ${stopCheck.reason}` });
      continue;
    }

    const queue = await buildCarrierQueue(load);

    for (const carrier of queue) {
      const outcome = await tryDialCarrier(load, carrier);
      results.push({ loadId: load.id, carrierId: carrier.id, outcome });

      // Re-check after every attempt actually placed — not just at the end of
      // the batch — so we stop dialing the moment this load is covered.
      if (outcome === "dialed") {
        const recheck = await checkStopConditions(load.id);
        if (recheck.shouldStop) break;
      }
    }
  }

  return results;
}

async function tryDialCarrier(load: LocalLoad, carrier: MdrCarrierForLoad): Promise<string> {
  const maxAttempts = load.settings.maxCallAttempts;

  const existingAttempts = await CallAttempt.find({ loadId: load.id, carrierId: carrier.id }).sort({
    attemptNumber: 1,
  });

  const nextAttemptNumber = existingAttempts.length + 1;
  if (nextAttemptNumber > maxAttempts) {
    return "skipped: max attempts reached";
  }

  const lastAttempt = existingAttempts[existingAttempts.length - 1];
  const scheduledFor = computeAttemptSchedule({
    attemptNumber: nextAttemptNumber,
    timezone: carrier.timezone,
    webhookReceivedAt: new Date(load.receivedAt),
    previousAttemptAt: lastAttempt?.startedAt ?? lastAttempt?.createdAt,
  });

  const now = new Date();
  if (scheduledFor.getTime() > now.getTime()) {
    return `skipped: not due until ${scheduledFor.toISOString()}`;
  }

  if (!isWithinCallingWindow(carrier.timezone, now)) {
    return "skipped: outside calling window right now";
  }

  if (!env.vapiPhoneNumberId || !process.env.EVERLY_ASSISTANT_ID) {
    return "skipped: VAPI_PHONE_NUMBER_ID or EVERLY_ASSISTANT_ID not configured";
  }

  const primaryContact = carrier.contacts?.[0];
  if (!primaryContact?.phone) {
    return "skipped: no phone number on file for carrier";
  }

  // Fresh, right-before-dialing checks — the queue was built earlier in this
  // cycle (or on a prior cycle, for later cadence attempts), so both the
  // load's status and this carrier's do-not-call flag could have changed
  // since. Re-verify with live data rather than trusting the stale queue.
  const freshQuoteStatus = await getLoadQuoteStatus(load.id);
  if (!freshQuoteStatus.allowCalling) {
    await Load.updateOne({ id: load.id }, { status: "closed" });
    return "skipped: load closed since queue was built";
  }

  const freshCarrier = await getCarrierForLoad(carrier.id, load.id);
  if (freshCarrier.doNotCall.calls) {
    return "skipped: carrier opted out since queue was built";
  }

  let attempt;
  try {
    attempt = await CallAttempt.create({
      loadId: load.id,
      carrierId: carrier.id,
      attemptNumber: nextAttemptNumber,
      scheduledFor,
      status: "in_progress",
      startedAt: now,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return "skipped: attempt slot already claimed by a concurrent run";
    }
    throw err;
  }

  try {
    const variableValues = buildCallVariables(load, carrier);
    const call = await createOutboundCall({
      assistantId: process.env.EVERLY_ASSISTANT_ID as string,
      phoneNumberId: env.vapiPhoneNumberId,
      customerNumber: primaryContact.phone,
      variableValues,
    });

    attempt.vapiCallId = call.id;
    await attempt.save();
    return "dialed";
  } catch (err) {
    attempt.status = "failed";
    await attempt.save();
    throw err;
  }
}
