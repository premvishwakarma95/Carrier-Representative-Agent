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
  voice: {
    provider: "vapi",
    voiceId: "Elliot", // placeholder — swap once MDR confirms Everly's voice preference
  },
  transcriber: {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
  },
  endCallMessage:
    "Thank you for your time today. Have a great rest of your day.",
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
