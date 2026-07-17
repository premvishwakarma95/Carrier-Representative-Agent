/**
 * Mock MDR API — stands in for the real API described in
 * Everly_MDR_API_Workload_Timeline_Estimation.pdf until the client builds and
 * confirms it. Everly's orchestration engine talks to this exactly as it will
 * talk to the real MDR API later (see src/mdr/client.ts) — swapping requires
 * only changing MDR_API_BASE_URL/MDR_API_KEY, not any orchestration code.
 *
 * Implements the 7 endpoints from the PDF (A-G) plus one addition not in the
 * spec: GET /loads (list) — the PDF has no load-discovery endpoint at all
 * (GET /loads/{id} requires already knowing the id), and Everly has no other
 * way to find loads that need outreach. Marked GAP-FILL below.
 *
 * Usage: npm run mock-mdr:dev (default port 4000)
 */
import express from "express";
import { db, resetMockData, MOCK_ACCOUNT_ID } from "./data.js";

const app = express();
app.use(express.json());

const API_KEY = process.env.MDR_API_KEY || "mock-api-key";

app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/mock/reset") return next();
  const auth = req.header("authorization");
  if (auth !== `Bearer ${API_KEY}`) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  next();
});

const router = express.Router();

// GAP-FILL: no load-discovery endpoint exists in the client's PDF spec —
// GET /loads/{id} requires already knowing the id. Included so Everly can
// find loads at all; reconcile with the client's actual answer once given.
router.get("/loads", (req, res) => {
  const status = req.query.status as string | undefined;
  const results = status ? db.loads.filter((l) => l.status === status) : db.loads;
  res.json({ loads: results.map((l) => ({ id: l.id, externalId: l.externalId, status: l.status })) });
});

router.get("/loads/:loadId", (req, res) => {
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) return res.status(404).json({ error: "Load not found" });
  res.json(load);
});

router.get("/loads/:loadId/quote-status", (req, res) => {
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) return res.status(404).json({ error: "Load not found" });

  const validQuoteCount = db.quotes.filter((q) => q.loadId === load.id && q.status === "valid").length;
  const remaining = Math.max(load.quoteThreshold - validQuoteCount, 0);

  res.json({
    loadId: load.id,
    requiredThreshold: load.quoteThreshold,
    currentValidQuoteCount: validQuoteCount,
    remainingQuoteCount: remaining,
    allowCalling: remaining > 0 && load.status === "open",
  });
});

router.get("/loads/:loadId/quotes", (req, res) => {
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) return res.status(404).json({ error: "Load not found" });

  const quotes = db.quotes.filter((q) => q.loadId === load.id);
  res.json({ quotes });
});

router.post("/loads/:loadId/quotes", (req, res) => {
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) return res.status(404).json({ error: "Load not found" });

  const body = req.body ?? {};
  const required = ["carrierId", "serviceScope", "baseRate", "totalEstimatedAllIn", "rateValidUntil", "carrierConfirmedReadBack"];
  const missing = required.filter((field) => body[field] === undefined || body[field] === null);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  const quote = {
    id: `quote-${db.quotes.length + 1}`,
    loadId: load.id,
    carrierId: body.carrierId,
    carrierEmail: body.carrierEmail,
    source: "everly",
    serviceScope: body.serviceScope,
    baseRate: body.baseRate,
    fuelSurcharge: body.fuelSurcharge,
    chassis: body.chassis,
    accessorials: body.accessorials ?? [],
    freeTime: body.freeTime,
    detentionRate: body.detentionRate,
    totalEstimatedAllIn: body.totalEstimatedAllIn,
    capacity: body.capacity,
    rateValidUntil: body.rateValidUntil,
    transload: body.transload,
    warehouseStorage: body.warehouseStorage,
    finalMile: body.finalMile,
    isConditional: body.isConditional ?? false,
    conditionalOn: body.conditionalOn,
    carrierConfirmedReadBack: Boolean(body.carrierConfirmedReadBack),
    status: body.isConditional ? "pending_review" : "valid",
    submittedAt: db.now().toISOString(),
  };

  db.quotes.push(quote);
  res.status(201).json(quote);
});

router.get("/carriers", (req, res) => {
  const ids = typeof req.query.ids === "string" ? req.query.ids.split(",") : undefined;
  const results = ids ? db.carriers.filter((c) => ids.includes(c.id)) : db.carriers;
  res.json({ carriers: results });
});

router.get("/carriers/:carrierId", (req, res) => {
  const carrier = db.carriers.find((c) => c.id === req.params.carrierId);
  if (!carrier) return res.status(404).json({ error: "Carrier not found" });
  res.json(carrier);
});

router.patch("/carriers/:carrierId/do-not-call", (req, res) => {
  const carrier = db.carriers.find((c) => c.id === req.params.carrierId);
  if (!carrier) return res.status(404).json({ error: "Carrier not found" });

  const scope = req.body?.scope ?? "calls_only";
  carrier.doNotCall = {
    calls: true,
    email: scope === "calls_and_email",
    reason: req.body?.reason,
    source: req.body?.source ?? "everly",
    recordedAt: db.now().toISOString(),
  };

  res.json(carrier);
});

router.get("/accounts/:accountId/settings", (req, res) => {
  const settings = db.accountSettings[req.params.accountId];
  if (!settings) return res.status(404).json({ error: "Account not found" });
  res.json(settings);
});

router.patch("/accounts/:accountId/settings", (req, res) => {
  const settings = db.accountSettings[req.params.accountId];
  if (!settings) return res.status(404).json({ error: "Account not found" });
  Object.assign(settings, req.body ?? {});
  res.json(settings);
});

app.use("/api/everly", router);

app.get("/health", (_req, res) => res.json({ ok: true, accountId: MOCK_ACCOUNT_ID }));

app.post("/mock/reset", (_req, res) => {
  resetMockData();
  res.json({ ok: true });
});

const PORT = process.env.MOCK_MDR_PORT ?? 4000;

app.listen(PORT, () => {
  console.log(`Mock MDR API listening on port ${PORT} (auth key: ${API_KEY})`);
});
