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
  // natural expressiveness. voiceId is still a placeholder pending MDR's
  // actual preference.
  voice: {
    provider: "11labs",
    voiceId: "sarah",
    speed: 0.9,
    stability: 0.4,
    similarityBoost: 0.8,
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
  },
  // Default endpointing was cutting the carrier off mid-sentence — a real
  // call showed numAssistantInterrupted: 6 in Vapi's own performance
  // metrics, which also explains garbled/stitched-together assistant
  // responses seen in transcripts. Vapi's smart endpointing (model-based,
  // not just silence-duration) plus a slightly longer wait reduces
  // premature barge-ins at the cost of a bit more turn latency.
  startSpeakingPlan: {
    waitSeconds: 0.8,
    smartEndpointingPlan: { provider: "vapi" },
  },
  endCallMessage:
    "Thank you for your time today. Have a great rest of your day.",
  // Vapi's default is 600s (10 min) — too short for a real carrier-pricing
  // conversation with multiple accessorials/edge cases; a live test call was
  // force-ended by the platform mid-conversation before quote submission.
  maxDurationSeconds: 900,
  endCallPhrases: ["goodbye", "talk to you soon"],
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
