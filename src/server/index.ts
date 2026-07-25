import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDB } from "../db/connection.js";
import { handleToolCalls, handleEndOfCallReport } from "./webhookHandlers.js";
import { mdrWebhookRouter } from "./mdrWebhook.js";
import { runDispatchCycle } from "../orchestration/dispatcher.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
// Express's default body limit is 100kb — Vapi's webhook payloads carry the
// full conversation history (and, for end-of-call-report, the full artifact
// incl. transcript), which routinely exceeds that on longer calls and was
// being silently rejected with a 413 before ever reaching our handlers.
app.use(express.json({ limit: "10mb" }));

app.use("/webhooks/mdr", mdrWebhookRouter);

// Dev-only trigger for src/mdr-simulator-ui/'s "Run dispatch" button — lets
// runDispatchCycle() be fired from the browser instead of a terminal
// (npm run dispatch:run). This is a stand-in for the scheduler that doesn't
// exist yet; NOT something to expose once this goes anywhere near production
// — it places real Vapi calls if any carrier is actually due.
// Lets the simulator UI hide the invited-carriers section (real phone
// numbers + the place-calls trigger) on deployments where that shouldn't be
// publicly visible — set SIMULATOR_HIDE_CARRIER_LIST=true in that
// deployment's env only. Unset (local dev) keeps the section visible.
app.get("/simulator/api/config", (_req, res) => {
  res.json({ hideCarrierList: process.env.SIMULATOR_HIDE_CARRIER_LIST === "true" });
});

app.post("/simulator/api/dispatch-run", async (_req, res) => {
  try {
    const results = await runDispatchCycle();
    res.json({ results });
  } catch (err) {
    console.error("dispatch-run trigger failed:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Dev-only proxy so the simulator UI (which runs in the browser, not this
// server) can reach the mock MDR API even when it's not publicly exposed —
// e.g. internal-only on a Docker network in production. The browser only
// ever talks to this same origin; the actual MDR_API_BASE_URL/key stay
// server-side. Same "not for production" caveat as dispatch-run above.
const MDR_API_BASE_URL = process.env.MDR_API_BASE_URL ?? "http://localhost:4000/api/everly";
const MDR_API_KEY = process.env.MDR_API_KEY ?? "mock-api-key";

app.all("/simulator/api/mock-mdr/*", async (req, res) => {
  const targetPath = req.originalUrl.replace("/simulator/api/mock-mdr", "");
  try {
    const upstream = await fetch(`${MDR_API_BASE_URL}${targetPath}`, {
      method: req.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${MDR_API_KEY}` },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const text = await upstream.text();
    res.status(upstream.status).type(upstream.headers.get("content-type") ?? "application/json").send(text);
  } catch (err) {
    res.status(502).json({ error: `mock-mdr proxy failed: ${(err as Error).message}` });
  }
});

// Simulator UI — stands in for MDR's real system until it exists (see
// src/mdr-simulator-ui/). Served from this same process so it can hit
// /webhooks/mdr/load-ready same-origin, no CORS needed.
app.use("/simulator", express.static(path.join(__dirname, "../mdr-simulator-ui")));

app.post("/vapi/tool-calls", async (req, res) => {
  const message = req.body.message;

  try {
    if (message?.type === "tool-calls") {
      const vapiCallId = message.call?.id;
      // Vapi's real toolCallList items are {id, type, function: {name, arguments}}
      // with arguments as a JSON string — not the flat {id, name, parameters}
      // shape handleToolCalls expects, so map/parse here.
      //
      // arguments is NOT reliably a string despite that — live traffic has been
      // observed sending it as an already-parsed object (confirmed via raw
      // ngrok request capture 2026-07-21), which crashed JSON.parse() with
      // "\"[object Object]\" is not valid JSON" on every call with non-empty
      // arguments (log_decline, submit_quote — anything but endCall's "{}").
      // Only parse when it's actually a string.
      const toolCallList = (message.toolCallList ?? []).map((call: any) => ({
        id: call.id,
        name: call.function?.name,
        parameters:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
              ? JSON.parse(call.function.arguments)
              : {}
            : (call.function?.arguments ?? {}),
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
