/**
 * Receiver for MDR's real push webhook. Still raw-capturing everything as-is
 * into WebhookResponse (unchanged — kept as the safety net so no traffic is
 * ever lost, even if the structured extraction below has a bug or MDR
 * changes the shape). On top of that:
 *  1. Extracts `load` and upserts a structured Load record — see
 *     src/db/models/Load.ts for why field names mirror MDR's payload
 *     exactly.
 *  2. Calls MDR's real "Get All Carriers" endpoint for that load and upserts
 *     each carrier — see src/db/models/Carrier.ts / src/mdr/api.ts.
 *
 * Upsert (not insert) throughout, not blind create: MDR has been observed
 * sending the same load.posted webhook twice for the same load a couple
 * minutes apart (confirmed via real captured WebhookResponse data,
 * 2026-08-05) — a plain create() would produce duplicates.
 *
 * Neither extraction step blocks the raw capture above or the 200 response
 * to MDR — the WebhookResponse write already succeeded by that point, and we
 * don't want MDR retrying indefinitely over a bug or a live-API hiccup on
 * our side.
 *
 * No auth check yet — MDR's real signing/auth scheme for this webhook isn't
 * confirmed, and rejecting on a guessed scheme would silently drop real
 * capture data during this discovery phase.
 *
 * The old /load-ready route (built against the previous mock-based
 * push-webhook design, fed only by the now-deleted src/mdr-simulator-ui/) has
 * been removed — MDR's real webhook posts here instead.
 */
import { Router } from "express";
import { Carrier, Load, WebhookResponse } from "../db/models/index.js";
import { getAllCarriers } from "../mdr/api.js";

export const mdrWebhookRouter = Router();

mdrWebhookRouter.post("/capture", async (req, res) => {
  // This is the very first thing that runs on every real MDR delivery — if
  // it throws unguarded, the rejection is unhandled and (default Node
  // behavior since v15) takes down the whole process, not just this
  // request. Everything below the raw capture is already individually
  // guarded; this closes the one gap before that.
  try {
    await WebhookResponse.create({ timestamp: new Date(), data: req.body });
  } catch (err) {
    console.error("webhook capture: failed to write raw WebhookResponse:", err);
    res.status(500).json({ ok: false, error: "Failed to record webhook" });
    return;
  }

  res.status(200).json({ ok: true });

  const load = req.body?.load;
  if (!load?.id) {
    console.warn("webhook capture: no load.id present, skipping Load extraction");
    return;
  }

  try {
    await Load.findOneAndUpdate({ id: load.id }, load, { upsert: true, setDefaultsOnInsert: true });
  } catch (err) {
    console.error(`webhook capture: failed to extract/upsert Load ${load.id}:`, err);
    return;
  }

  try {
    const { carriers } = await getAllCarriers(load.id);
    await Promise.all(
      carriers.map((carrier) =>
        Carrier.findOneAndUpdate(
          { outreach_id: carrier.outreach_id },
          { ...carrier, load_id: load.id },
          { upsert: true, setDefaultsOnInsert: true }
        )
      )
    );
    console.log(`webhook capture: upserted ${carriers.length} carrier(s) for load ${load.id}`);
  } catch (err) {
    console.error(`webhook capture: failed to fetch/upsert carriers for load ${load.id}:`, err);
  }
});
