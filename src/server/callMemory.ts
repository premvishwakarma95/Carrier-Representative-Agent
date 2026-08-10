/**
 * Builds a single short, plain-language sentence summarizing the most recent
 * MEANINGFUL prior call attempt with this real carrier, for the
 * {{callMemory}} prompt variable — or "" if there's no prior history at all
 * (first-time contact).
 *
 * Hard rules (mirrored in prompt.ts's "Call memory" guardrails):
 *  - Never invent details not present in stored data.
 *  - Never imply the carrier answered/connected if they didn't.
 *  - Reference only the single most recent meaningful attempt, not a history dump.
 *
 * Cross-load: MDR issues a fresh `outreach_id` per load invitation, even for
 * the same real carrier (see the comment on `outreach_id` in
 * src/db/models/Carrier.ts) — so `CallAttempt.carrierId` (= outreach_id) is
 * NOT a stable "this is the same company" key by itself. `carrier_id` (a
 * separate field, present on every Carrier record) is MDR's own stable
 * per-company identifier, per the carrier-profile endpoint description in
 * requirements-tracker.md ("carrier profile ... plus whether that carrier
 * has already quoted this specific load" — carrier_id identifies the
 * company, load_id is a separate dimension). This module looks up every
 * local Carrier record sharing the current carrier_id (across any load),
 * then every CallAttempt tied to any of their outreach_ids — so a carrier
 * who quoted a completely different load last week is still recognized here.
 * If carrier_id ever turns out to also be per-load in practice, this
 * degrades safely to exactly the old per-load behavior (the sibling lookup
 * just returns one Carrier — itself).
 */
import { Carrier, CallAttempt, Quote } from "../db/models/index.js";
import { humanizeReason } from "./webhookHandlers.js";

const MEANINGFUL_STATUSES = new Set(["completed"]);
const MEANINGFUL_RESULTS = new Set(["do_not_call"]);

function isMeaningful(attempt: any): boolean {
  return MEANINGFUL_STATUSES.has(attempt.status) || MEANINGFUL_RESULTS.has(attempt.callResult);
}

/** Every CallAttempt across every load tied to this same real carrier (by MDR's stable carrier_id), sorted oldest-first by actual time — attemptNumber is only meaningful within a single load's cadence, so real timestamps are what "most recent" has to mean once loads are mixed together. */
async function findCrossLoadAttempts(mdrCarrierId: number): Promise<any[]> {
  const siblingCarriers = await Carrier.find({ carrier_id: mdrCarrierId });
  const outreachIds = siblingCarriers.map((c) => String(c.outreach_id));
  if (outreachIds.length === 0) return [];

  return CallAttempt.find({ carrierId: { $in: outreachIds } }).sort({ startedAt: 1, createdAt: 1 });
}

/**
 * Same "meaningful" definition buildCallMemory uses internally, exposed so
 * dispatch.ts can pick between FOLLOW_UP_FIRST_MESSAGE and
 * FOLLOW_UP_UNANSWERED_FIRST_MESSAGE (src/assistant/prompt.ts) without
 * duplicating this logic.
 */
export async function hasMeaningfulPriorContact(mdrCarrierId: number): Promise<boolean> {
  const attempts = await findCrossLoadAttempts(mdrCarrierId);
  return attempts.some(isMeaningful);
}

function relativeDay(date: Date | undefined): string {
  if (!date) return "recently";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return "a while back";
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max).trim() + "…" : text;
}

/** "this load" if the attempt belongs to the load we're calling about right now, otherwise "a different load" — never left ambiguous, since claiming "this load" for a different one would be inventing context. */
function loadPhrase(attempt: any, currentLoadId: string): string {
  return attempt.loadId === currentLoadId ? "this load" : "a different load";
}

async function describeMeaningfulAttempt(attempt: any, currentLoadId: string): Promise<string> {
  const when = relativeDay(attempt.startedAt ?? attempt.createdAt);
  const about = loadPhrase(attempt, currentLoadId);

  if (attempt.callResult === "quote_received" || attempt.callResult === "conditional_quote") {
    const quote = await Quote.findOne({ callAttemptId: attempt._id }).lean();
    if (quote?.baseRate) {
      const qualifier = attempt.callResult === "conditional_quote" ? "a conditional quote of" : "a quote of";
      const fsc = quote.fsc ? ` plus a ${quote.fsc}% fuel surcharge` : "";
      return `We spoke ${when} about ${about} and you gave ${qualifier} $${quote.baseRate}${fsc}.`;
    }
    // Quote doc missing/incomplete — fall back below rather than fabricate a number.
  }

  if (attempt.callResult === "declined") {
    const reason = attempt.declineReason ? humanizeReason(attempt.declineReason) : null;
    return reason
      ? `We spoke ${when} about ${about} and you declined, citing: ${reason}.`
      : `We spoke ${when} about ${about} and it wasn't a fit at that time.`;
  }

  if (attempt.callResult === "callback") {
    const time = attempt.callbackAt
      ? ` around ${attempt.callbackAt.toLocaleString("en-US", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })}${attempt.callbackTimeZone ? ` (${attempt.callbackTimeZone})` : ""}`
      : "";
    return `We spoke ${when} about ${about} and you asked us to call back${time}.`;
  }

  if (attempt.callResult === "do_not_call") {
    // Defensive only — dispatch.ts's stop_call gate should already prevent
    // this call from firing live in the normal case.
    return `We spoke ${when} about ${about} and you asked not to be contacted about it again.`;
  }

  // connected / escalation / wrong_number / anything else with a real
  // conversation: fall back to Vapi's own auto-generated summary — grounded
  // in the real transcript, zero fabrication risk.
  if (attempt.summary) {
    // Vapi's own summary is written in third person about "the AI
    // assistant" / "the user" — awkward to speak verbatim in a first-person
    // call. Framed as raw background notes to extract one fact from, not a
    // line to recite, since a real call showed the model otherwise
    // defaulting to a vague "we spoke before" instead of pulling out an
    // actual detail from it.
    return `We spoke ${when} about ${about}. Background notes from that call (pull out one concrete detail, do not recite this verbatim): ${truncate(attempt.summary, 200)}`;
  }

  return `We spoke ${when} about ${about}.`;
}

function describeUnconnectedHistory(mostRecent: any, currentLoadId: string): string {
  const when = relativeDay(mostRecent.startedAt ?? mostRecent.createdAt);
  const about = loadPhrase(mostRecent, currentLoadId);
  if (mostRecent.status === "voicemail") {
    return `I left a voicemail ${when} about ${about}.`;
  }
  // no_answer covers both true no-answer and busy — accurate and
  // non-fabricating either way.
  return `I tried reaching you ${when} about ${about} but wasn't able to get through.`;
}

export async function buildCallMemory(mdrCarrierId: number, currentLoadId: string): Promise<string> {
  const allAttempts = await findCrossLoadAttempts(mdrCarrierId);
  if (allAttempts.length === 0) return "";

  // Sorted oldest-first by real time — scan from most recent backward, stop
  // at the first meaningful one. This naturally surfaces the last real
  // conversation even if later attempts (on this or another load) went
  // unanswered, without mentioning those unanswered attempts alongside it.
  const mostRecentMeaningful = [...allAttempts].reverse().find(isMeaningful);

  if (mostRecentMeaningful) {
    return await describeMeaningfulAttempt(mostRecentMeaningful, currentLoadId);
  }

  return describeUnconnectedHistory(allAttempts[allAttempts.length - 1], currentLoadId);
}
