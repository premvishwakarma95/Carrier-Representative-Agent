/**
 * Handles Vapi's two server message types relevant to us:
 *  - "tool-calls": Everly invoked one of the 6 function tools mid-call
 *  - "end-of-call-report": the call ended; transcript/recording/summary arrive here
 *
 * Payload shapes verified against docs.vapi.ai/server-url/events.
 *
 * loadId/carrierId/callAttemptId are never trusted from the LLM's tool-call
 * arguments (see comment in src/assistant/tools.ts) — they're resolved here
 * from the CallAttempt matching the webhook's vapiCallId instead.
 *
 * Quotes and do-not-call flags are written to MDR (src/mdr/api.ts — mock
 * today, real once the client builds it), since those are the two write
 * endpoints the client's API actually covers. Everything else (declines,
 * callbacks, escalations) has no MDR equivalent and stays local only.
 */
import { CallAttempt, Escalation, Quote } from "../db/models/index.js";
import { checkStopConditions } from "../orchestration/stopConditions.js";
import { submitQuote as submitQuoteToMdr, updateDoNotCall } from "../mdr/api.js";
import { applyCallOutcome } from "./callOutcome.js";
import type { HydratedDocument } from "mongoose";

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
    case "submit_quote":
      return submitQuote(params, context);
    case "log_decline":
      return logDecline(params, context);
    case "schedule_callback":
      return scheduleCallback(params, context);
    case "escalate_to_human":
      return escalateToHuman(params, context);
    case "record_do_not_call":
      return recordDoNotCall(params, context);
    case "update_contact":
      return updateContact(params, context);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function submitQuote(params: any, { attempt }: CallContext) {
  const isComplete = Boolean(
    params.carrierConfirmedReadBack && params.baseRate != null && params.totalEstimatedAllIn != null
  );

  const quotePayload = {
    serviceScope: params.serviceScope,
    baseRate: params.baseRate,
    fuelSurcharge: params.fuelSurcharge,
    chassis: params.chassis,
    accessorials: params.accessorials ?? [],
    freeTime: params.freeTime,
    detentionRate: params.detentionRate,
    totalEstimatedAllIn: params.totalEstimatedAllIn,
    capacity: params.capacity,
    rateValidUntil: params.rateValidUntil,
    transload: params.transload,
    warehouseStorage: params.warehouseStorage,
    finalMile: params.finalMile,
    isConditional: params.isConditional ?? false,
    conditionalOn: params.conditionalOn,
    carrierConfirmedReadBack: Boolean(params.carrierConfirmedReadBack),
  };

  // Written before the MDR call so there's proof of exactly what was
  // captured even if the MDR submission below fails.
  const localQuote = await Quote.create({
    loadId: attempt.loadId,
    carrierId: attempt.carrierId,
    callAttemptId: attempt._id,
    ...quotePayload,
    mdrSubmissionStatus: "failed",
  });

  const quote = await submitQuoteToMdr(attempt.loadId, { carrierId: attempt.carrierId, ...quotePayload }).catch(
    async (err) => {
      localQuote.mdrError = (err as Error).message;
      await localQuote.save();
      throw err;
    }
  );

  localQuote.mdrQuoteId = quote.id;
  localQuote.mdrStatus = quote.status;
  localQuote.mdrSubmissionStatus = "submitted";
  await localQuote.save();

  attempt.callResult = params.isConditional ? "conditional_quote" : "quote_received";
  await attempt.save();

  if (isComplete) {
    await checkStopConditions(attempt.loadId);
  }

  return { ok: true, quoteId: quote.id, status: quote.status };
}

async function logDecline(params: any, { attempt }: CallContext) {
  attempt.callResult = "declined";
  attempt.declineReason = params.reason;
  attempt.declineNote = params.note;
  await attempt.save();
  return { ok: true };
}

async function scheduleCallback(params: any, { attempt }: CallContext) {
  attempt.callResult = "callback";
  attempt.callbackAt = params.callbackDateTime;
  attempt.callbackTimeZone = params.carrierTimeZone;
  await attempt.save();
  return { ok: true };
}

async function escalateToHuman(params: any, { attempt }: CallContext) {
  await Escalation.create({
    loadId: attempt.loadId,
    carrierId: attempt.carrierId,
    callAttemptId: attempt.id,
    reason: params.reason,
    capturedQuestion: params.capturedQuestion,
    preferredContactMethod: params.preferredContactMethod,
    liveTransferOffered: params.liveTransferOffered ?? false,
  });

  attempt.callResult = "escalation";
  await attempt.save();

  return { ok: true };
}

async function recordDoNotCall(params: any, { attempt }: CallContext) {
  await updateDoNotCall(attempt.carrierId, {
    scope: params.scope === "calls_and_email" ? "calls_and_email" : "calls_only",
    updatedBy: "everly-system",
  });

  attempt.callResult = "do_not_call";
  await attempt.save();

  return { ok: true };
}

async function updateContact(params: any, { attempt }: CallContext) {
  // No MDR endpoint exists for this (not in the client's 7-endpoint spec) —
  // logged only until the client confirms whether it's in scope.
  console.warn(
    `update_contact called for carrier ${attempt.carrierId} but no MDR write endpoint exists yet:`,
    params
  );
  return { ok: true, note: "not yet persisted — no MDR endpoint for contact updates" };
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
  await checkStopConditions(attempt.loadId);
}
