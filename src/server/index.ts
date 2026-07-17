import express from "express";
import { connectDB } from "../db/connection.js";
import { handleToolCalls, handleEndOfCallReport } from "./webhookHandlers.js";

const app = express();
// Express's default body limit is 100kb — Vapi's webhook payloads carry the
// full conversation history (and, for end-of-call-report, the full artifact
// incl. transcript), which routinely exceeds that on longer calls and was
// being silently rejected with a 413 before ever reaching our handlers.
app.use(express.json({ limit: "10mb" }));

app.post("/vapi/tool-calls", async (req, res) => {
  const message = req.body.message;

  try {
    if (message?.type === "tool-calls") {
      const vapiCallId = message.call?.id;
      // Vapi's real toolCallList items are {id, type, function: {name, arguments}}
      // with arguments as a JSON string — not the flat {id, name, parameters}
      // shape handleToolCalls expects, so map/parse here.
      const toolCallList = (message.toolCallList ?? []).map((call: any) => ({
        id: call.id,
        name: call.function?.name,
        parameters: call.function?.arguments ? JSON.parse(call.function.arguments) : {},
      }));
      const results = await handleToolCalls(toolCallList, vapiCallId);
      res.json({ results });
      return;
    }

    if (message?.type === "end-of-call-report") {
      await handleEndOfCallReport(message);
      res.status(200).json({ ok: true });
      return;
    }

    // Other server message types (status-update, speech-update, etc.) — ack and ignore.
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT ?? 3000;

async function main() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
