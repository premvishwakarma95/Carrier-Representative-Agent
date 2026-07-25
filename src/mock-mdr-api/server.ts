/**
 * Mock MDR API — stands in for the real API until the client builds and
 * confirms it. Everly's orchestration engine talks to this exactly as it
 * will talk to the real MDR API later (see src/mdr/client.ts) — swapping
 * requires only changing MDR_API_BASE_URL/MDR_API_KEY, not orchestration
 * code.
 *
 * As of the 2026-07-20 client call, MDR confirmed only 4 endpoints will
 * actually exist: GET /loads/:id/quote-status, POST /loads/:id/quotes,
 * GET /carriers/:carrierId/:loadId, PATCH /carriers/:carrierId/do-not-call
 * (see src/mdr/api.ts). Load discovery no longer happens via polling — MDR
 * pushes loads to Everly's own webhook instead (src/server/mdrWebhook.ts).
 * The remaining routes below (GET /loads, GET /loads/:id, bare GET
 * /carriers[/:id], account settings) are NOT part of MDR's confirmed API —
 * kept only so src/mdr-simulator-ui/ has data to read while standing in for
 * MDR's real system.
 *
 * Usage: npm run mock-mdr:dev (default port 4000)
 */
import express from "express";
import { db, resetMockData, MOCK_ACCOUNT_ID } from "./data.js";

const app = express();
app.use(express.json());

// Dev-only: lets src/mdr-simulator-ui/ (served from a different port) read
// the carrier list directly for its picker. Never enabled on a real MDR API.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  // PATCH (and PUT/DELETE) aren't browser-"safelisted" methods like GET/POST,
  // so without this the preflight OPTIONS request succeeds but the browser
  // still blocks the real request client-side — surfaces as "Failed to
  // fetch" with no server-side error to debug.
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

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

// Not part of MDR's confirmed API — Everly's orchestration no longer calls
// this (loads arrive via webhook). Kept only for src/mdr-simulator-ui/'s
// own load-picker convenience.
router.get("/loads", (req, res) => {
  const status = req.query.status as string | undefined;
  const results = status ? db.loads.filter((l) => l.status === status) : db.loads;
  res.json({ loads: results.map((l) => ({ id: l.id, externalId: l.externalId, status: l.status })) });
});

// Also simulator-only — not part of MDR's confirmed API (no GET /loads/{id}).
router.get("/loads/:loadId", (req, res) => {
  const load = db.loads.find((l) => l.id === req.params.loadId);
  if (!load) return res.status(404).json({ error: "Load not found" });
  res.json(load);
});

// Simulator-support only — not part of MDR's confirmed API. In the real
// system MDR's own database already knows about a load it's pushing to
// Everly's webhook; this mock has no such shared state by default, so
// src/mdr-simulator-ui/ calls this alongside the webhook to keep the mock's
// view in sync (otherwise quote-status/submit-quote below 404 for any load
// that only exists via the webhook).
router.post("/loads", (req, res) => {
  const load = req.body ?? {};
  if (!load.id || !load.quoteThreshold) {
    return res.status(400).json({ error: "id and quoteThreshold are required" });
  }
  const existingIndex = db.loads.findIndex((l) => l.id === load.id);
  const record = { status: "open", ...load };
  if (existingIndex >= 0) db.loads[existingIndex] = record;
  else db.loads.push(record);
  res.status(201).json(record);
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

// Simulator-support only — not part of MDR's confirmed API. Real carrier
// onboarding happens entirely on MDR's side; this exists so
// src/mdr-simulator-ui/ can add test carriers (e.g. a client's own number)
// without editing src/mock-mdr-api/data.ts and restarting the service.
router.post("/carriers", (req, res) => {
  const body = req.body ?? {};
  if (!body.legalName || !body.contacts?.[0]?.phone) {
    return res.status(400).json({ error: "legalName and at least one contact phone are required" });
  }

  const carrier = {
    id: body.id || `carrier-${Date.now().toString(36)}`,
    legalName: body.legalName,
    dba: body.dba,
    mcNumber: body.mcNumber,
    usdotNumber: body.usdotNumber,
    contacts: body.contacts,
    timezone: body.timezone || "Asia/Kolkata",
    eligibility: {
      approvedAuthority: true,
      approvedInsurance: true,
      approvedEquipment: [],
      approvedGeography: [],
      safetyStatus: "ok",
      fraudFlag: false,
      ...body.eligibility, // let the UI override any of the above if a test needs an ineligible carrier
    },
    serviceHistory: body.serviceHistory ?? {},
    doNotCall: { calls: false, email: false, recordedAt: null },
  };

  db.carriers.push(carrier);
  res.status(201).json(carrier);
});

router.get("/carriers/:carrierId", (req, res) => {
  const carrier = db.carriers.find((c) => c.id === req.params.carrierId);
  if (!carrier) return res.status(404).json({ error: "Carrier not found" });
  res.json(carrier);
});

// Simulator-support only — not part of MDR's confirmed API. Lets
// src/mdr-simulator-ui/ edit an in-memory test carrier's basic details
// (e.g. swap in a different real phone number to test with) without
// restarting the service.
router.patch("/carriers/:carrierId", (req, res) => {
  const carrier = db.carriers.find((c) => c.id === req.params.carrierId);
  if (!carrier) return res.status(404).json({ error: "Carrier not found" });

  const body = req.body ?? {};
  if (body.legalName !== undefined) carrier.legalName = body.legalName;
  if (body.dba !== undefined) carrier.dba = body.dba;
  if (body.mcNumber !== undefined) carrier.mcNumber = body.mcNumber;
  if (body.usdotNumber !== undefined) carrier.usdotNumber = body.usdotNumber;
  if (body.timezone !== undefined) carrier.timezone = body.timezone;
  if (body.contacts !== undefined) carrier.contacts = body.contacts;
  if (body.eligibility !== undefined) Object.assign(carrier.eligibility, body.eligibility);

  res.json(carrier);
});

// Confirmed on the 2026-07-20 client call — replaces the bare carrier lookup
// above for orchestration's purposes: carrier profile + whether they've
// already quoted THIS load, in one call, so Everly doesn't need a separate
// quotes-list fetch to figure out who's already responded.
router.get("/carriers/:carrierId/:loadId", (req, res) => {
  const carrier = db.carriers.find((c) => c.id === req.params.carrierId);
  if (!carrier) return res.status(404).json({ error: "Carrier not found" });

  // Deliberately doesn't require req.params.loadId to exist in this mock's
  // own seed data — loads now arrive at Everly via MDR's push webhook, not
  // from this service, so the mock has no independent notion of which loads
  // exist beyond whatever quotes reference them.
  const hasQuoted = db.quotes.some(
    (q) => q.loadId === req.params.loadId && q.carrierId === carrier.id && q.status === "valid"
  );

  res.json({ ...carrier, hasQuoted });
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
    updatedBy: req.body?.updatedBy ?? "everly-system",
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
