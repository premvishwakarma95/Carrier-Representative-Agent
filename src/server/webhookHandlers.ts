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
 */
import { CallAttempt, Quote, Escalation, Carrier } from "../db/models/index.js";
import { checkStopConditions } from "../orchestration/stopConditions.js";
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

  const quote = await Quote.create({
    loadId: attempt.loadId,
    carrierId: attempt.carrierId,
    callAttemptId: attempt.id,
    source: "call",
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
    status: isComplete ? "valid" : "pending_review",
  });

  attempt.callResult = params.isConditional ? "conditional_quote" : "quote_received";
  await attempt.save();

  if (isComplete) {
    await checkStopConditions(attempt.loadId.toString());
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
  await Carrier.updateOne(
    { _id: attempt.carrierId },
    {
      $set: {
        "doNotCall.calls": true,
        "doNotCall.email": params.scope === "calls_and_email",
        "doNotCall.recordedAt": new Date(),
      },
    }
  );

  attempt.callResult = "do_not_call";
  await attempt.save();

  return { ok: true };
}

async function updateContact(params: any, { attempt }: CallContext) {
  const update: Record<string, any> = {};
  if (params.correctedName) update["contacts.0.name"] = params.correctedName;
  if (params.correctedPhone) update["contacts.0.phone"] = params.correctedPhone;
  if (params.correctedEmail) update["contacts.0.email"] = params.correctedEmail;
  if (params.preference) update["preferences.notes"] = params.preference;

  if (Object.keys(update).length > 0) {
    await Carrier.updateOne({ _id: attempt.carrierId }, { $set: update });
  }
  return { ok: true };
}

export async function handleEndOfCallReport(message: any) {
  const vapiCallId = message.call?.id;
  const attempt = await CallAttempt.findOne({ vapiCallId });
  if (!attempt) {
    console.warn(`No CallAttempt found for vapiCallId ${vapiCallId} — ignoring end-of-call-report`);
    return;
  }

  attempt.transcript = message.artifact?.transcript;
  attempt.recordingUrl = message.artifact?.recording?.stereoUrl ?? message.artifact?.recording?.url;
  attempt.summary = message.summary ?? message.analysis?.summary;
  attempt.endedReason = message.endedReason;
  attempt.endedAt = new Date();

  if (attempt.status === "in_progress") {
    attempt.status = message.endedReason?.includes("voicemail") ? "voicemail" : "completed";
  }

  await attempt.save();
  await checkStopConditions(attempt.loadId.toString());
}
