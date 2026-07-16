import express from "express";
import { connectDB } from "../db/connection.js";
import { handleToolCalls, handleEndOfCallReport } from "./webhookHandlers.js";

const app = express();
app.use(express.json());

app.post("/vapi/tool-calls", async (req, res) => {
  const message = req.body.message;

  try {
    if (message?.type === "tool-calls") {
      const vapiCallId = message.call?.id;
      const results = await handleToolCalls(message.toolCallList ?? [], vapiCallId);
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
