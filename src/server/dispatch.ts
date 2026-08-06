/**
 * Dispatch/orchestration trigger. For each open load, for each of its
 * not-stopped carriers, freshly re-checks MDR and either skips the carrier
 * (per the rules below) or — if it's actually due, per attempt cadence and
 * calling window — PLACES A REAL OUTBOUND VAPI CALL. This has real-world
 * side effects: it rings an actual phone and costs money. Once the system
 * is ready this same endpoint is what a real scheduler (cron/interval) will
 * hit instead of a person calling it by hand — which is exactly why error
 * handling here is layered rather than a single top-level try/catch: one
 * bad carrier (malformed timezone, a transient MDR API failure, a DB
 * hiccup, a failed dial) must never take down the rest of the run for every
 * other carrier and load. Every failure is caught at the narrowest point it
 * can happen, logged with enough context to act on, and recorded as a
 * result entry — never silently swallowed, never left to crash the
 * process.
 *
 * Per load:
 *   1. Loop its carriers (local Carrier records already filtered to
 *      stop_call: false).
 *   2. For each, call MDR's real "Get Specific Carrier" endpoint fresh —
 *      local DB state can be stale by the time this runs.
 *      a. fresh.is_load_close === true  → stop processing this load
 *         entirely, mark it closed locally, move to the next load.
 *      b. fresh.carrier.stop_call === true → skip just this carrier.
 *      c. Otherwise → compute which attempt number is next (from existing
 *         CallAttempt records) and whether it's actually due yet, per the
 *         confirmed cadence and calling window. If due: create the
 *         CallAttempt (idempotent via the loadId+carrierId+attemptNumber
 *         unique index — a duplicate-key error means another run already
 *         claimed this slot, not a real failure) and dial via Vapi.
 */
import { Router } from "express";
import { Load, Carrier, CallAttempt } from "../db/models/index.js";
import { getSpecificCarrier } from "../mdr/api.js";
import { computeAttemptSchedule, MAX_CALL_ATTEMPTS } from "./cadence.js";
import { isWithinCallingWindow, isValidTimezone } from "./callingWindow.js";
import { buildCallVariables } from "./callVariables.js";
import { createOutboundCall } from "../vapi/calls.js";
import { env } from "../config/env.js";

export const dispatchRouter = Router();

type Result = Record<string, unknown>;

dispatchRouter.post("/run", async (_req, res) => {
  const results: Result[] = [];

  // Top-level guard: even a failure before any load-specific work starts
  // (e.g. the DB connection itself is down) must still return a proper HTTP
  // response, not hang the request or crash the process.
  let loads;
  try {
    // Oldest-posted loads first (FIFO).
    loads = await Load.find({ is_load_close: false }).sort({ createdAt: 1 });
  } catch (err) {
    console.error("dispatch/run: failed to fetch open loads:", err);
    res.status(500).json({ ok: false, error: "Failed to fetch open loads", details: (err as Error).message });
    return;
  }

  for (const load of loads) {
    try {
      await processLoad(load, results);
    } catch (err) {
      // Should be unreachable — processLoad has its own internal handling —
      // but if something still escapes it, this load's failure must not
      // stop the remaining loads from being processed.
      console.error(`dispatch/run: unexpected failure processing load ${load.id}:`, err);
      results.push({ loadId: load.id, outcome: "error", error: (err as Error).message });
    }
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    const outcome = String(r.outcome);
    acc[outcome] = (acc[outcome] ?? 0) + 1;
    return acc;
  }, {});

  res.status(200).json({ ok: true, summary, results });
});

async function processLoad(load: any, results: Result[]) {
  let carriers;
  try {
    carriers = await Carrier.find({ load_id: load.id, stop_call: false }).sort({ rank: 1 });
  } catch (err) {
    console.error(`dispatch/run: failed to fetch carriers for load ${load.id}:`, err);
    results.push({ loadId: load.id, outcome: "error", error: `Failed to fetch carriers: ${(err as Error).message}` });
    return;
  }

  for (const carrier of carriers) {
    try {
      const stop = await processCarrier(load, carrier, results);
      if (stop) return; // load was closed — abandon the rest of this load's carriers
    } catch (err) {
      // Same belt-and-suspenders as the load-level catch above — processCarrier
      // handles its own errors, but a carrier-level surprise still can't be
      // allowed to take out the rest of the loop.
      console.error(
        `dispatch/run: unexpected failure processing carrier (load ${load.id}, outreach_id ${carrier.outreach_id}):`,
        err
      );
      results.push({
        loadId: load.id,
        outreachId: carrier.outreach_id,
        outcome: "error",
        error: (err as Error).message,
      });
    }
  }
}

/** Returns true if the load was found closed and the caller should stop processing it further. */
async function processCarrier(load: any, carrier: any, results: Result[]): Promise<boolean> {
  let fresh;
  try {
    fresh = await getSpecificCarrier(load.id, carrier.carrier_id);
  } catch (err) {
    console.error(
      `dispatch/run: MDR "Get Specific Carrier" call failed (load ${load.id}, carrier ${carrier.carrier_id}):`,
      err
    );
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "mdr_api_error",
      error: (err as Error).message,
    });
    return false;
  }

  if (fresh.is_load_close) {
    try {
      await Load.updateOne({ id: load.id }, { is_load_close: true });
    } catch (err) {
      // The load IS closed per MDR — that fact matters more than our local
      // write succeeding, so we still report the closure, but flag that the
      // local record may now be stale until the next successful sync.
      console.error(`dispatch/run: failed to persist is_load_close for load ${load.id}:`, err);
      results.push({
        loadId: load.id,
        outcome: "load_closed_local_update_failed",
        error: (err as Error).message,
      });
      return true;
    }
    results.push({ loadId: load.id, outcome: "load_closed_skipping_rest" });
    return true;
  }

  if (fresh.carrier.stop_call) {
    results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "skipped_stop_call" });
    return false;
  }

  if (!isValidTimezone(fresh.carrier.carrier_timezone)) {
    console.error(
      `dispatch/run: invalid/missing carrier_timezone "${fresh.carrier.carrier_timezone}" (load ${load.id}, outreach_id ${carrier.outreach_id})`
    );
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "invalid_timezone",
      timezone: fresh.carrier.carrier_timezone,
    });
    return false;
  }

  const emailSentAt = new Date(fresh.carrier.email_sent_at);
  if (Number.isNaN(emailSentAt.getTime())) {
    console.error(
      `dispatch/run: invalid/missing email_sent_at "${fresh.carrier.email_sent_at}" (load ${load.id}, outreach_id ${carrier.outreach_id})`
    );
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "invalid_email_sent_at",
      email_sent_at: fresh.carrier.email_sent_at,
    });
    return false;
  }

  let existingAttempts;
  try {
    existingAttempts = await CallAttempt.find({
      loadId: String(load.id),
      carrierId: String(carrier.outreach_id),
    }).sort({ attemptNumber: 1 });
  } catch (err) {
    console.error(
      `dispatch/run: failed to fetch CallAttempt history (load ${load.id}, outreach_id ${carrier.outreach_id}):`,
      err
    );
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "error",
      error: `Failed to fetch attempt history: ${(err as Error).message}`,
    });
    return false;
  }

  const nextAttemptNumber = existingAttempts.length + 1;
  if (nextAttemptNumber > MAX_CALL_ATTEMPTS) {
    results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "max_attempts_reached" });
    return false;
  }

  let scheduledFor;
  try {
    const lastAttempt = existingAttempts[existingAttempts.length - 1];
    scheduledFor = computeAttemptSchedule({
      attemptNumber: nextAttemptNumber,
      timezone: fresh.carrier.carrier_timezone,
      emailSentAt,
      previousAttemptAt: lastAttempt?.startedAt ?? lastAttempt?.createdAt,
    });
  } catch (err) {
    console.error(
      `dispatch/run: failed to compute attempt schedule (load ${load.id}, outreach_id ${carrier.outreach_id}, attempt ${nextAttemptNumber}):`,
      err
    );
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "cadence_computation_error",
      attemptNumber: nextAttemptNumber,
      error: (err as Error).message,
    });
    return false;
  }

  const now = new Date();
  if (scheduledFor.getTime() > now.getTime()) {
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "not_due_yet",
      attemptNumber: nextAttemptNumber,
      dueAt: scheduledFor.toISOString(),
    });
    return false;
  }

  if (!isWithinCallingWindow(fresh.carrier.carrier_timezone, now)) {
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "outside_calling_window",
      timezone: fresh.carrier.carrier_timezone,
    });
    return false;
  }

  if (!env.vapiPhoneNumberId || !process.env.EVERLY_ASSISTANT_ID) {
    results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "not_configured" });
    return false;
  }

  const phone = fresh.carrier.phone;
  if (!phone) {
    results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "no_phone_number" });
    return false;
  }

  let attempt;
  try {
    attempt = await CallAttempt.create({
      loadId: String(load.id),
      carrierId: String(carrier.outreach_id),
      attemptNumber: nextAttemptNumber,
      scheduledFor,
      status: "in_progress",
      startedAt: now,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      // Another concurrent dispatch run already claimed this exact attempt
      // slot — not a real error, just a race we lost.
      results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "attempt_slot_already_claimed" });
      return false;
    }
    console.error(
      `dispatch/run: failed to create CallAttempt (load ${load.id}, outreach_id ${carrier.outreach_id}):`,
      err
    );
    results.push({ loadId: load.id, outreachId: carrier.outreach_id, outcome: "error", error: (err as Error).message });
    return false;
  }

  try {
    const variableValues = buildCallVariables(load, fresh.carrier);
    const call = await createOutboundCall({
      assistantId: process.env.EVERLY_ASSISTANT_ID as string,
      phoneNumberId: env.vapiPhoneNumberId,
      customerNumber: phone,
      variableValues,
    });

    attempt.vapiCallId = call.id;
    await attempt.save();

    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "dialed",
      attemptNumber: nextAttemptNumber,
      vapiCallId: call.id,
    });
  } catch (err) {
    console.error(
      `dispatch/run: failed to place Vapi call (load ${load.id}, outreach_id ${carrier.outreach_id}):`,
      err
    );
    attempt.status = "failed";
    try {
      await attempt.save();
    } catch (saveErr) {
      console.error(
        `dispatch/run: also failed to mark CallAttempt ${attempt.id} as failed:`,
        saveErr
      );
    }
    results.push({
      loadId: load.id,
      outreachId: carrier.outreach_id,
      outcome: "dial_failed",
      attemptNumber: nextAttemptNumber,
      error: (err as Error).message,
    });
  }

  return false;
}
