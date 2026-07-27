/**
 * Creates (or updates, if EVERLY_ASSISTANT_ID is set) the Everly assistant in Vapi.
 *
 * Usage:
 *   npm run assistant:create
 *
 * On first run this creates a new assistant and prints its ID — save that ID
 * into .env as EVERLY_ASSISTANT_ID so re-runs update the same assistant
 * instead of creating duplicates.
 */
import { vapi, VapiError } from "../vapi/client.js";
import { FIRST_MESSAGE, VOICEMAIL_MESSAGE, SYSTEM_PROMPT } from "./prompt.js";
import { TOOLS, ORCHESTRATION_WEBHOOK_URL } from "./tools.js";

const assistantPayload = {
  name: "Everly",
  firstMessage: FIRST_MESSAGE,
  voicemailMessage: VOICEMAIL_MESSAGE,
  model: {
    provider: "openai",
    model: "gpt-4.1",
    temperature: 0.4,
    messages: [{ role: "system", content: SYSTEM_PROMPT }],
    tools: TOOLS,
  },
  // Vapi's native voice provider doesn't support a speed control at all —
  // switched to ElevenLabs specifically to fix reported speaking-speed issues
  // (PlayHT also supports speed, but isn't enabled on this account/plan —
  // every PlayHT preset returned "Couldn't Find PlayHT Voice"). speed<1
  // slows delivery. stability was previously raised to 0.6 to fix an
  // "erratic" complaint, but that overcorrected into flat/robotic-sounding
  // delivery (2026-07-25 client feedback) — lowered back down for more
  // natural expressiveness. voiceId switched again (2026-07-27) to another
  // ElevenLabs voice ID provided directly by the user, still searching for
  // one that sounds natural enough — not in Vapi's curated voice-library
  // browse list, which only surfaces a fixed preset subset, not ElevenLabs'
  // full catalog.
  // Switched provider from ElevenLabs to Cartesia (2026-07-27) — real
  // turn-latency data from an eleven_v3 test call measured 1.85s average,
  // up to 4.81s (see git history for the raw numbers), confirmed
  // unacceptable. eleven_v3 was the only ElevenLabs model supporting the
  // audio-tag emotion system the client wanted, and turbo_v2_5/
  // multilingual_v2 don't support it — an ElevenLabs-only fix would have
  // meant giving up either speed or expressiveness. Cartesia's Sonic model
  // is marketed as delivering both (per Cartesia, ~90ms latency with
  // natural inflection/emotional cues) — this is unverified by us in
  // practice, watch the next real test call closely for both latency and
  // quality. Voice is a curated Cartesia voice via Vapi's voice-library
  // (not a clone of the prior ElevenLabs voice — client declined the
  // clone-from-sample path), picked for its "warmth and authority for
  // customer service" description matching this agent's target
  // personality. The prior ElevenLabs config (voiceId gE0owC0H9C8SzfDyIUtB,
  // eleven_turbo_v2_5, stability 0.3/style 0.65) is fully reversible — see
  // git history — if Cartesia doesn't hold up.
  voice: {
    provider: "cartesia",
    voiceId: "a7a59115-2425-4192-844c-1e98ec7d6877", // "Amber - Warm Support Agent"
    model: "sonic-3",
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
  },
  // startSpeakingPlan (how patiently Everly waits before she starts talking)
  // didn't move numAssistantInterrupted at all on the next test call — the
  // transcript showed HER speech getting cut off mid-word ("...includes the
  // CHAS Next..."), which means that metric is about her getting
  // interrupted, not her interrupting the carrier. Left in place since a
  // longer/smarter wait before she starts is still reasonable on its own.
  startSpeakingPlan: {
    waitSeconds: 0.8,
    smartEndpointingPlan: { provider: "vapi" },
  },
  // The actual fix for that: stopSpeakingPlan controls how easily she gets
  // cut off once she's already talking. Default is very sensitive (any
  // sound counts), so background noise or a short "yeah"/"uh" from the
  // carrier was killing her mid-sentence. Requiring 2 real words before it
  // counts as a genuine interruption, plus a brief backoff before she
  // resumes, should stop the mid-word cutoffs seen in transcripts.
  stopSpeakingPlan: {
    numWords: 2,
    voiceSeconds: 0.2,
    backoffSeconds: 1,
  },
  endCallMessage:
    "Thank you for your time today. Have a great rest of your day.",
  // Vapi's default is 600s (10 min) — too short for a real carrier-pricing
  // conversation with multiple accessorials/edge cases; a live test call was
  // force-ended by the platform mid-conversation before quote submission.
  maxDurationSeconds: 900,
  // Removed endCallPhrases (2026-07-25) — the prompt already has Everly give
  // her own natural sign-off before calling the endCall tool, which reliably
  // fires on every reviewed call. Having "goodbye" also configured as an
  // auto-hangup trigger phrase raced against endCallMessage above: the
  // moment Everly's own sign-off naturally included a word like "goodbye",
  // Vapi's phrase-detection hung up immediately, cutting endCallMessage off
  // mid-word ("...Have" then dead) instead of letting it finish. The
  // explicit endCall tool call is the reliable mechanism; this was a
  // redundant, actively harmful safety net. Explicitly set to [] rather than
  // omitted — Vapi's PATCH only updates fields present in the payload, so
  // omitting this would have silently left the old value in place (verified
  // this the hard way: the first attempt at this fix didn't actually clear it).
  endCallPhrases: [],
  // Explicit per client requirement ("record all calls where legally
  // permitted, store recordings/transcripts/summaries") — set explicitly
  // rather than relying on Vapi's account-level default.
  artifactPlan: {
    recordingEnabled: true,
    transcriptPlan: { enabled: true },
  },
  // Assistant-level server config — needed for lifecycle messages like
  // end-of-call-report, which aren't tied to a specific tool call.
  server: { url: ORCHESTRATION_WEBHOOK_URL },
  serverMessages: ["end-of-call-report", "status-update"],
};

async function main() {
  const existingId = process.env.EVERLY_ASSISTANT_ID;

  try {
    if (existingId) {
      const updated = await vapi.patch<{ id: string }>(
        `/assistant/${existingId}`,
        assistantPayload
      );
      console.log(`Updated existing Everly assistant: ${updated.id}`);
    } else {
      const created = await vapi.post<{ id: string }>("/assistant", assistantPayload);
      console.log(`Created Everly assistant: ${created.id}`);
      console.log(`Add this to .env: EVERLY_ASSISTANT_ID=${created.id}`);
    }
  } catch (err) {
    if (err instanceof VapiError) {
      console.error(`Vapi rejected the assistant payload (status ${err.status}):`);
      console.error(JSON.stringify(err.body, null, 2));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main();
