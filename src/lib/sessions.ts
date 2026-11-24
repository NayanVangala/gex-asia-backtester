import { getPTDateKey } from "./goldMath";

/**
 * Converts a wall-clock time in America/Los_Angeles (handles PST/PDT automatically)
 * for a given YYYY-MM-DD date into UTC Unix milliseconds.
 */
export function ptWallTimeToUtcMs(
  dateStr: string,
  hour24: number,
  minute = 0
): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  // Start with UTC guess (PST is UTC-8, PDT is UTC-7)
  const approxUtc = Date.UTC(y, m - 1, d, hour24 + 8, minute, 0);

  // Measure actual America/Los_Angeles wall time at approxUtc and adjust delta
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(approxUtc));
  const gy = Number(parts.find((p) => p.type === "year")?.value ?? y);
  const gm = Number(parts.find((p) => p.type === "month")?.value ?? m);
  const gd = Number(parts.find((p) => p.type === "day")?.value ?? d);
  const gh = Number(parts.find((p) => p.type === "hour")?.value ?? hour24) % 24;
  const gmin = Number(parts.find((p) => p.type === "minute")?.value ?? minute);

  const gotAsUtc = Date.UTC(gy, gm - 1, gd, gh, gmin, 0);
  const wantAsUtc = Date.UTC(y, m - 1, d, hour24, minute, 0);
  return approxUtc + (wantAsUtc - gotAsUtc);
}

/**
 * Returns Asia session timestamps for a PT evening date (Section 11):
 * - Globex reopen: 15:00 PT (3:00 PM PT)
 * - Tokyo open:    16:00 PT (4:00 PM PT post-DST; 5:00 PM during PDT)
 * - China open:    17:00 PT (5:00 PM PT)
 * - Session end:   21:00 PT (9:00 PM PT school-night cutoff)
 */
export function getAsiaSessionWindow(sessionDate: string): {
  globexOpenTs: number;
  tokyoOpenTs: number;
  chinaOpenTs: number;
  asiaCloseTs: number;
} {
  return {
    globexOpenTs: ptWallTimeToUtcMs(sessionDate, 15, 0),
    tokyoOpenTs: ptWallTimeToUtcMs(sessionDate, 16, 0),
    chinaOpenTs: ptWallTimeToUtcMs(sessionDate, 17, 0),
    asiaCloseTs: ptWallTimeToUtcMs(sessionDate, 21, 0),
  };
}

/**
 * Generates recent weekday/Sunday Asia session date candidates (PT) going back N days.
 * COMEX GC Asia sessions run Sunday through Thursday evenings PT (skipping Friday/Saturday nights).
 */
export function listRecentAsiaDates(count = 20, includeWeekends = false): string[] {
  const dates: string[] = [];
  const now = Date.now();
  // Start from yesterday PT so we land on a completed session by default
  for (let d = 1; d <= 45 && dates.length < count; d++) {
    const ts = now - d * 24 * 3600 * 1000;
    const dateKey = getPTDateKey(ts);
    const noonUtc = ptWallTimeToUtcMs(dateKey, 12, 0);
    const dow = new Date(noonUtc).getUTCDay(); // 0 Sun .. 6 Sat
    // GC Globex has no Friday evening or Saturday evening session (5 = Fri, 6 = Sat)
    if (!includeWeekends && (dow === 5 || dow === 6)) continue;
    dates.push(dateKey);
  }
  return dates;
}
