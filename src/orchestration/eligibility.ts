/**
 * Finds loads that need voice outreach right now: open, past their email-wait
 * window, and still under quote threshold per MDR's quote-status endpoint.
 *
 * Uses MDR's load-list endpoint (GAP-FILL — not in the client's PDF spec, see
 * src/mock-mdr-api/README.md) since there's no other way to discover load ids.
 */
import { getLoadsList, getLoad, getLoadQuoteStatus, getAccountSettings } from "../mdr/api.js";
import type { MdrLoad } from "../mdr/api.js";

export async function findLoadsNeedingOutreach(): Promise<MdrLoad[]> {
  const now = new Date();
  const openLoadSummaries = await getLoadsList("open");

  const needsOutreach: MdrLoad[] = [];
  for (const summary of openLoadSummaries) {
    const load = await getLoad(summary.id);

    // GAP-FILL: bidEmailSentAt isn't in the client's PDF spec yet (question
    // sent, see requirements-tracker.md). Without it, there's no reliable way
    // to schedule the email-wait window, so skip rather than guess.
    const bidEmailSentAt = load.timing.bidEmailSentAt ? new Date(load.timing.bidEmailSentAt) : undefined;
    if (!bidEmailSentAt) continue;

    const settings = await getAccountSettings(load.accountId);
    const emailWaitElapsed = now.getTime() >= bidEmailSentAt.getTime() + settings.emailWaitMinutes * 60_000;
    if (!emailWaitElapsed) continue;

    const quoteStatus = await getLoadQuoteStatus(load.id);
    if (!quoteStatus.allowCalling) continue;

    needsOutreach.push(load);
  }

  return needsOutreach;
}
