/**
 * Timezone-aware calling window: business days/hours in the carrier's local
 * time. Both come from env (CALLING_WINDOW_DAYS, CALLING_WINDOW_START_HOUR,
 * CALLING_WINDOW_END_HOUR), not hardcoded — defaults match the confirmed
 * client rule (Mon-Fri, 8am-5pm) if unset.
 *
 * Timezone always comes from a FRESH MDR API response's carrier_timezone,
 * never the locally stored Carrier.calling_window.startingTime/endTime,
 * which is deliberately ignored per instruction.
 */
/**
 * `Number(process.env.X ?? fallback)` has a real gap: `??` only catches
 * null/undefined, not an empty string — a misconfigured `.env` with a
 * trailing `=` and no value (CALLING_WINDOW_START_HOUR=) would silently
 * parse to 0 (midnight) instead of falling back to the intended default. A
 * garbage non-numeric value would silently parse to NaN, which makes every
 * calling-window comparison false — no crash, just calls that silently
 * never go out. Both cases fall back to the given default here instead.
 */
function envHour(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const num = Number(raw);
  return Number.isFinite(num) ? num : fallback;
}

const CALLING_WINDOW_START_HOUR = envHour("CALLING_WINDOW_START_HOUR", 8);
const CALLING_WINDOW_END_HOUR = envHour("CALLING_WINDOW_END_HOUR", 17);
// Normalized to match Intl.DateTimeFormat's weekday: "short" casing ("Mon",
// "Tue", ...) regardless of how CALLING_WINDOW_DAYS happens to be cased.
function normalizeDay(day: string): string {
  const trimmed = day.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1, 3).toLowerCase();
}
const BUSINESS_DAYS = new Set(
  (process.env.CALLING_WINDOW_DAYS ?? "Mon,Tue,Wed,Thu,Fri").split(",").filter(Boolean).map(normalizeDay)
);

/**
 * Checks a timezone string is a real IANA identifier before it's used
 * anywhere else — Intl.DateTimeFormat throws a RangeError on an invalid one,
 * and MDR's staging data has already shown enough inconsistency (missing
 * fields, mismatched types) that a blank/malformed carrier_timezone is a
 * real possibility, not a hypothetical.
 */
export function isValidTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== "string" || !timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

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
 * Returns the next moment (UTC Date) at which the calling window opens for
 * this timezone, starting from `from`. If already within the window,
 * returns `from`.
 */
export function nextCallingWindowOpen(timezone: string, from: Date = new Date()): Date {
  if (isWithinCallingWindow(timezone, from)) return from;

  // Walk forward 30 minutes at a time (bounded) until inside the window.
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

/** Next business-day morning (start of the window), used for cadence attempt #4. */
export function nextBusinessMorning(timezone: string, from: Date = new Date()): Date {
  const candidate = new Date(from);
  candidate.setUTCDate(candidate.getUTCDate() + 1);

  for (let i = 0; i < 8; i++) {
    const { weekday, hour } = localParts(candidate, timezone);
    if (BUSINESS_DAYS.has(weekday)) {
      // Roll back by the candidate's own local hour (+1 buffer) so we land
      // safely before the window's start hour local, then walk forward to
      // find the window opening.
      candidate.setUTCHours(candidate.getUTCHours() - hour - 1);
      return nextCallingWindowOpen(timezone, candidate);
    }
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  throw new Error(`Could not find next business morning for timezone ${timezone}`);
}
