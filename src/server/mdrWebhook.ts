/**
 * Receiver for MDR's push webhook (confirmed on the 2026-07-20 client call).
 * MDR calls this ~30 minutes after a carrier invitation email goes out, with
 * the load, invited carriers (id + do-not-call), and account settings all in
 * one payload — that 30-minute gap means the email-wait window has already
 * elapsed by the time this fires, so cadence.ts treats `receivedAt` as
 * attempt-1's baseline directly rather than adding emailWaitMinutes again.
 *
 * Until MDR's real system exists, src/mdr-simulator-ui/ POSTs here directly
 * to stand in for it.
 */
import { Router } from "express";
import { Load, WebhookResponse } from "../db/models/index.js";

const WEBHOOK_SECRET = process.env.MDR_WEBHOOK_SECRET ?? "mock-webhook-secret";

export const mdrWebhookRouter = Router();

/**
 * Raw-capture endpoint for MDR's real webhook (new draft docs: "load.posted"
 * event, shape not yet confirmed/built against — see CLAUDE.md). Stores
 * whatever is sent as-is in WebhookResponse, unparsed, so real traffic can be
 * inspected before the Load model and orchestration flow get rebuilt against
 * the confirmed payload shape. No auth check yet — MDR's real signing/auth
 * scheme for this webhook isn't confirmed, and rejecting on a guessed scheme
 * would silently drop real capture data during this discovery phase.
 */
mdrWebhookRouter.post("/capture", async (req, res) => {
  await WebhookResponse.create({ timestamp: new Date(), data: req.body });
  res.status(200).json({ ok: true });
});

mdrWebhookRouter.post("/load-ready", async (req, res) => {
  const auth = req.header("authorization");
  if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const { load, invitedCarriers, settings } = req.body ?? {};

  if (!load?.id || !load?.accountId || !Array.isArray(invitedCarriers) || !settings) {
    res.status(400).json({ error: "Payload must include load, invitedCarriers[], and settings" });
    return;
  }

  const doc = await Load.findOneAndUpdate(
    { id: load.id },
    {
      id: load.id,
      externalId: load.externalId,
      accountId: load.accountId,
      equipment: load.equipment,
      routing: load.routing,
      timing: load.timing,
      cargo: load.cargo,
      serviceScope: load.serviceScope,
      operationalAssumptions: load.operationalAssumptions,
      pricingRules: load.pricingRules,
      disclosureSettings: load.disclosureSettings,
      warehouseStorage: load.warehouseStorage,
      quoteThreshold: load.quoteThreshold,
      bidCloseAt: load.bidCloseAt,
      invitedCarriers,
      settings,
      status: "open",
      receivedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Received load-ready webhook for load ${doc.id} — ${invitedCarriers.length} invited carriers`);
  res.status(200).json({ ok: true, loadId: doc.id });
});
