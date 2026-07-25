/**
 * Finds loads that need voice outreach right now.
 *
 * Loads no longer get discovered by polling MDR — MDR pushes them to
 * Everly's own webhook ~30 minutes after the carrier invitation goes out
 * (src/server/mdrWebhook.ts), which persists them locally (src/db/models/Load.ts)
 * since MDR's confirmed API has no GET /loads or GET /loads/{id} to re-fetch
 * from. By the time a Load exists locally at all, the email-wait window has
 * already elapsed (that's what triggered MDR to send the webhook), so there's
 * no separate wait-window check here — just "still open locally."
 */
import { Load } from "../db/models/index.js";
import type { LocalLoad } from "../db/models/Load.js";

export async function findLoadsNeedingOutreach(): Promise<LocalLoad[]> {
  return Load.find({ status: "open" }).lean<LocalLoad[]>();
}
