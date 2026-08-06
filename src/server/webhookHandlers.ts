/**
 * Handles Vapi's two server message types relevant to us:
 *  - "tool-calls": Everly invoked one of the function tools mid-call
 *  - "end-of-call-report": the call ended; transcript/recording/summary arrive here
 *
 * Payload shapes verified against docs.vapi.ai/server-url/events.
 *
 * loadId/carrierId/callAttemptId are never trusted from the LLM's tool-call
 * arguments (see comment in src/assistant/tools.ts) — they're resolved here
 * from the CallAttempt matching the webhook's vapiCallId instead.
 *
 * STATUS (2026-08-06): all tools write through to MDR's real API (see
 * src/mdr/api.ts). calculate_quote/submit_quote map to call-result/
 * call-final-result respectively — see the Quote model's header comment for
 * how a quote record is built up across the two calls. The stop-condition
 * re-check after a tool call is still disabled — that belongs to the
 * orchestration-flow rebuild, not this file.
 */
import { CallAttempt, Quote } from "../db/models/index.js";
import { applyCallOutcome } from "./callOutcome.js";
import {
  declineCarrier as mdrDeclineCarrier,
  stopCarrier as mdrStopCarrier,
  resendInvitationEmail as mdrResendInvitationEmail,
  addAccessorial as mdrAddAccessorial,
  addWarehouse as mdrAddWarehouse,
  submitCallResult as mdrSubmitCallResult,
  submitCallFinalResult as mdrSubmitCallFinalResult,
} from "../mdr/api.js";
import type { HydratedDocument } from "mongoose";

/** "lane_not_serviced" -> "Lane not serviced" — MDR's reason fields are free text, not our fixed enum. */
function humanizeReason(reason: string): string {
  const text = reason.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type ToolCall = { id: string; name: string; parameters: Record<string, any> };
type CallContext = { attempt: HydratedDocument<any> };

export async function handleToolCalls(toolCallList: ToolCall[], vapiCallId: string) {
  const attempt = await CallAttempt.findOne({ vapiCallId });
  if (!attempt) {
    console.warn(`No CallAttempt found for vapiCallId ${vapiCallId} — cannot resolve call context`);
    return toolCallList.map((call) => ({
      toolCallId: call.id,
      name: call.name,
      result: JSON.stringify({ error: "Unknown call — no matching CallAttempt" }),
    }));
  }

  const context: CallContext = { attempt };
  const results = [];
  for (const call of toolCallList) {
    try {
      const result = await dispatchTool(call.name, call.parameters, context);
      results.push({ toolCallId: call.id, name: call.name, result: JSON.stringify(result) });
    } catch (err) {
      // Previously silent — a real submit_quote failure (server 404 during a
      // dispatch cron collision, 2026-07-25) went completely unlogged here,
      // discoverable only via Vapi's own call message history days later.
      console.error(`Tool call ${call.name} failed for vapiCallId ${vapiCallId}:`, err);
      results.push({
        toolCallId: call.id,
        name: call.name,
        result: JSON.stringify({ error: (err as Error).message }),
      });
    }
  }
  return results;
}

async function dispatchTool(name: string, params: Record<string, any>, context: CallContext) {
  switch (name) {
    case "calculate_quote":
      return calculateQuote(params, context);
    case "submit_quote":
      return submitQuote(params, context);
    case "log_decline":
      return logDecline(params, context);
    case "schedule_callback":
      return scheduleCallback(params, context);
    case "record_do_not_call":
      return recordDoNotCall(params, context);
    case "resend_email":
      return resendEmail(params, context);
    case "add_accessorial":
      return addAccessorialTool(params, context);
    case "add_warehouse":
      return addWarehouseTool(params, context);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/** Maps calculate_quote/submit_quote's tool params to MDR's call-result/call-final-result request shape. */
function buildQuotePayload(outreachId: number, params: any) {
  return {
    outreach_id: outreachId,
    base_rate: params.base_rate,
    fsc: params.fsc,
    acc_types: params.acc_types ?? [],
    transload_rate: params.transload_rate,
    finalmile_rate: params.finalmile_rate,
    finalmile_fsc: params.finalmile_fsc,
    is_warehouse: params.is_warehouse,
    storage_rate: params.storage_rate,
    warehouse_id: params.warehouse_id,
    rate_valid_until: params.rate_valid_until,
    driver_available: params.driver_available,
    details: params.details,
  };
}

/** Same field set as buildQuotePayload, reshaped for the local Quote record (camelCase, no outreach_id). */
function buildLocalQuoteFields(params: any) {
  return {
    baseRate: params.base_rate,
    fsc: params.fsc,
    accTypes: params.acc_types ?? [],
    transloadRate: params.transload_rate,
    finalmileRate: params.finalmile_rate,
    finalmileFsc: params.finalmile_fsc,
    isWarehouse: params.is_warehouse,
    storageRate: params.storage_rate,
    warehouseId: params.warehouse_id,
    rateValidUntil: params.rate_valid_until,
    driverAvailable: params.driver_available,
    details: params.details,
  };
}

async function calculateQuote(params: any, { attempt }: CallContext) {
  // No fallback here — the whole point of this call is MDR's calculated
  // total, so a failure has to be visible to Everly, not swallowed.
  const result = await mdrSubmitCallResult(buildQuotePayload(Number(attempt.carrierId), params));
  const data = result.rate_calculation.original.data;

  // Draft record, upserted per call attempt — durable proof of what was
  // calculated even if the carrier never confirms. submitQuote() below
  // updates this same record once they do.
  await Quote.findOneAndUpdate(
    { callAttemptId: attempt._id },
    {
      loadId: attempt.loadId,
      carrierId: attempt.carrierId,
      callAttemptId: attempt._id,
      ...buildLocalQuoteFields(params),
      rateCalculation: result.rate_calculation,
      mdrQuoteId: data.quote_id,
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return {
    ok: true,
    finalRate: data.final_rate,
    breakdown: data.rate_breakdown,
    accessorialCharges: data.accessorial_charges,
  };
}

async function submitQuote(params: any, { attempt }: CallContext) {
  const accTypes = params.acc_types ?? [];
  const allIn = accTypes.length > 0 ? 0 : 1;

  // Local audit copy first — durable proof of exactly what was captured and
  // confirmed, even if the MDR write below fails.
  const localQuote = await Quote.findOneAndUpdate(
    { callAttemptId: attempt._id },
    {
      loadId: attempt.loadId,
      carrierId: attempt.carrierId,
      callAttemptId: attempt._id,
      ...buildLocalQuoteFields(params),
      allIn,
      carrierConfirmedReadBack: Boolean(params.carrierConfirmedReadBack),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  attempt.callResult = "quote_received";
  await attempt.save();

  try {
    await mdrSubmitCallFinalResult({ ...buildQuotePayload(Number(attempt.carrierId), params), all_in: allIn });
    localQuote.mdrSubmissionStatus = "submitted";
    await localQuote.save();
  } catch (err) {
    console.error(`submit_quote: MDR call-final-result write-back failed for carrier ${attempt.carrierId}:`, err);
    localQuote.mdrSubmissionStatus = "failed";
    localQuote.mdrError = (err as Error).message;
    await localQuote.save();
    return { ok: true, mdrSync: "failed", quoteId: localQuote.id };
  }

  return { ok: true, mdrSync: "ok", quoteId: localQuote.id };
}

async function logDecline(params: any, { attempt }: CallContext) {
  attempt.callResult = "declined";
  attempt.declineReason = params.reason;
  attempt.declineNote = params.note;
  await attempt.save();

  // Local record is durable regardless of MDR's API being reachable — the
  // MDR write-back is attempted but its failure doesn't erase what Everly
  // already captured on the call.
  const reasonText = params.reason === "other" && params.note ? params.note : humanizeReason(params.reason);
  let mdrSync: "ok" | "failed" = "ok";
  try {
    await mdrDeclineCarrier(Number(attempt.carrierId), reasonText);
  } catch (err) {
    console.error(`log_decline: MDR decline write-back failed for carrier ${attempt.carrierId}:`, err);
    mdrSync = "failed";
  }

  return { ok: true, mdrSync };
}

async function scheduleCallback(params: any, { attempt }: CallContext) {
  attempt.callResult = "callback";
  attempt.callbackAt = params.callbackDateTime;
  attempt.callbackTimeZone = params.carrierTimeZone;
  await attempt.save();
  return { ok: true };
}

async function recordDoNotCall(params: any, { attempt }: CallContext) {
  attempt.callResult = "do_not_call";
  await attempt.save();

  // MDR's /voice/stop has no email-vs-calls distinction — it always means
  // "stop calling." scope is kept as our own local-only nuance; the reason
  // text sent to MDR just reflects it for their audit trail.
  const reasonText =
    params.scope === "calls_and_email" ? "Requested no further calls or emails" : "Requested no further calls";
  let mdrSync: "ok" | "failed" = "ok";
  try {
    await mdrStopCarrier(Number(attempt.carrierId), reasonText);
  } catch (err) {
    console.error(`record_do_not_call: MDR stop write-back failed for carrier ${attempt.carrierId}:`, err);
    mdrSync = "failed";
  }

  return { ok: true, mdrSync };
}

async function resendEmail(_params: any, { attempt }: CallContext) {
  // No fallback here — unlike decline/stop, there's no local state to fall
  // back on if this fails, so let a failure propagate to handleToolCalls'
  // outer catch and get reported to Everly rather than being swallowed.
  const result = await mdrResendInvitationEmail(Number(attempt.carrierId));
  return { ok: true, message: result.message };
}

async function addAccessorialTool(params: any, { attempt }: CallContext) {
  // Same reasoning as resendEmail — the whole point of this call is the
  // MDR-assigned id; a failure has to be visible, not silently absorbed.
  const result = await mdrAddAccessorial(Number(attempt.carrierId), params.name, params.price);
  return { ok: true, accessorial: result.accessorials };
}

async function addWarehouseTool(params: any, { attempt }: CallContext) {
  const result = await mdrAddWarehouse(Number(attempt.carrierId), params.address);
  return { ok: true, warehouse: result.warehouse };
}

export async function handleEndOfCallReport(message: any) {
  const vapiCallId = message.call?.id;
  const attempt = await CallAttempt.findOne({ vapiCallId });
  if (!attempt) {
    console.warn(`No CallAttempt found for vapiCallId ${vapiCallId} — ignoring end-of-call-report`);
    return;
  }

  applyCallOutcome(attempt, {
    endedReason: message.endedReason,
    transcript: message.artifact?.transcript,
    recordingUrl: message.artifact?.recording?.stereoUrl,
    summary: message.summary ?? message.analysis?.summary,
  });

  await attempt.save();
  // Stop-condition re-check disabled pending rebuild — see the PENDING
  // REBUILD note at the top of this file.
}
