/**
 * Timezone-aware calling window: Mon-Fri, 8:00 AM - 5:00 PM, carrier's local time.
 * Confirmed value from the client — see requirements-tracker.md.
 *
 * Uses Node's built-in Intl API rather than a date library, since all we need
 * is "what's the local weekday/hour in this IANA timezone right now."
 */

const CALLING_WINDOW_START_HOUR = 8; // 8:00 AM
const CALLING_WINDOW_END_HOUR = 17; // 5:00 PM
const BUSINESS_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);

function localParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    weekday: get("weekday"),
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
  };
}

export function isWithinCallingWindow(timezone: string, at: Date = new Date()): boolean {
  const { weekday, hour } = localParts(at, timezone);
  if (!BUSINESS_DAYS.has(weekday)) return false;
  return hour >= CALLING_WINDOW_START_HOUR && hour < CALLING_WINDOW_END_HOUR;
}

/**
 * Returns the next moment (UTC Date) at which the calling window opens for this
 * timezone, starting from `from`. If already within the window, returns `from`.
 */
export function nextCallingWindowOpen(timezone: string, from: Date = new Date()): Date {
  if (isWithinCallingWindow(timezone, from)) return from;

  // Walk forward hour by hour (bounded) until we land inside the window.
  // Simple and correct across DST transitions; cheap enough at this volume.
  const candidate = new Date(from);
  for (let i = 0; i < 24 * 8; i++) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 30);
    if (isWithinCallingWindow(timezone, candidate)) {
      return candidate;
    }
  }
  throw new Error(`Could not find a calling window opening for timezone ${timezone}`);
}

/** Next business-day morning (start of the calling window, 8:00 AM local), used for cadence attempt #4. */
export function nextBusinessMorning(timezone: string, from: Date = new Date()): Date {
  const candidate = new Date(from);
  candidate.setUTCDate(candidate.getUTCDate() + 1);

  for (let i = 0; i < 8; i++) {
    const { weekday, hour } = localParts(candidate, timezone);
    if (BUSINESS_DAYS.has(weekday)) {
      // Roll back by the candidate's own local hour (+1 buffer) so we land
      // safely before 8am local on this calendar day, then walk forward to
      // find the window opening. Without this, nextCallingWindowOpen would
      // just return `candidate` as-is whenever it already happens to fall
      // inside business hours, instead of snapping to the morning open.
      candidate.setUTCHours(candidate.getUTCHours() - hour - 1);
      return nextCallingWindowOpen(timezone, candidate);
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  throw new Error(`Could not find next business morning for timezone ${timezone}`);
}
