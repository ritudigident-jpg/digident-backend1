/**
 * India Standard Time (IST, Asia/Kolkata, UTC+05:30, no daylight saving) helpers for attendance,
 * leave and payroll. One rule everywhere:
 *   - instants (punch-in, punch-out, approvals) are stored as real UTC Date objects;
 *   - "which day" is always the IST calendar date, written as a "YYYY-MM-DD" date key.
 * Because IST has a fixed offset, plain arithmetic is exact and does not depend on the server's
 * own time zone (the old getISTNow() did, and stored times 5h30 ahead of UTC).
 *
 * Example: 2026-10-16T20:00:00.000Z (UTC) is 17 Oct 01:30 IST -> date key "2026-10-17".
 *
 * Pure module (no imports), unit tested in tests/istdate.test.js.
 * Used by: services/attendance/*, services/payroll/*, jobs/endofday.job.js
 */

export const IST_TIME_ZONE = "Asia/Kolkata";
export const IST_OFFSET_MINUTES = 330;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * MINUTE_MS;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Current instant. Wrapped so tests and services share one clock. */
export const nowUtc = () => new Date();

/**
 * IST calendar date of an instant.
 * Example: new Date("2026-10-16T19:00:00Z") -> "2026-10-17" (00:30 IST next day).
 *
 * @param {Date} [instant=new Date()]
 * @returns {string} "YYYY-MM-DD"
 */
export const istDateKey = (instant = nowUtc()) => new Date(instant.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

/**
 * IST wall-clock parts of an instant.
 *
 * @param {Date} instant
 * @returns {{ dateKey: string, hours: number, minutes: number, minutesOfDay: number, weekday: number }}
 */
export const istParts = (instant) => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  return {
    dateKey: shifted.toISOString().slice(0, 10),
    hours,
    minutes,
    minutesOfDay: hours * 60 + minutes,
    weekday: shifted.getUTCDay(),
  };
};

/** True when the value is a real calendar date written as YYYY-MM-DD. */
export const isValidDateKey = (value) => {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** True when the value is a 24-hour "HH:mm" time. */
export const isValidTime = (value) => typeof value === "string" && TIME_PATTERN.test(value);

/**
 * Day of week of a date key (0 = Sunday ... 6 = Saturday). The date key is already an IST date.
 *
 * @param {string} dateKey
 * @returns {number}
 */
export const weekdayOf = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();

/**
 * Adds whole days to a date key. Example: addDays("2026-10-31", 1) -> "2026-11-01".
 *
 * @param {string} dateKey
 * @param {number} days
 * @returns {string}
 */
export const addDays = (dateKey, days) =>
  new Date(new Date(`${dateKey}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Every date key from `fromKey` to `toKey`, both included. Empty when toKey < fromKey.
 *
 * @param {string} fromKey
 * @param {string} toKey
 * @returns {string[]}
 */
export const dateRange = (fromKey, toKey) => {
  const keys = [];
  for (let key = fromKey; key <= toKey; key = addDays(key, 1)) keys.push(key);
  return keys;
};

/**
 * First and last date key of a month. Example: (2026, 2) -> { from: "2026-02-01", to: "2026-02-28", days: 28 }.
 *
 * @param {number} year
 * @param {number} month 1-12
 * @returns {{ from: string, to: string, days: number }}
 */
export const monthBounds = (year, month) => {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (value) => String(value).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(days)}`, days };
};

/**
 * The UTC instant of an IST wall-clock time. Example: ("2026-10-16", "18:30") -> 2026-10-16T13:00:00.000Z.
 *
 * @param {string} dateKey
 * @param {string} time "HH:mm"
 * @returns {Date}
 */
export const istDateTimeToUtc = (dateKey, time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) + (hours * 60 + minutes) * MINUTE_MS - IST_OFFSET_MS);
};

/** UTC instant of 00:00 IST on a date key. */
export const istStartOfDay = (dateKey) => istDateTimeToUtc(dateKey, "00:00");

/**
 * Parses a client-supplied date-time into a UTC instant. Used ONLY for punch-out corrections.
 *   - With "Z" or an offset ("+05:30"): taken as that exact instant.
 *   - Without a zone ("2026-10-16T18:30" or "2026-10-16 18:30"): read as IST wall-clock time.
 *
 * @param {string} value
 * @returns {Date | null} null when it cannot be parsed.
 */
export const parseClientDateTime = (value) => {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(" ", "T");
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (hasZone) {
    const instant = new Date(text);
    return Number.isNaN(instant.getTime()) ? null : instant;
  }
  const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2}(\.\d+)?)?$/);
  if (!match || !isValidDateKey(match[1]) || !isValidTime(match[2])) return null;
  return istDateTimeToUtc(match[1], match[2]);
};

/**
 * Formats an instant as IST for messages and exports. Example: "16 Oct 2026, 06:30 pm".
 *
 * @param {Date} instant
 * @returns {string}
 */
export const formatIst = (instant) =>
  new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(instant);

/** Whole minutes between two instants (never negative). */
export const minutesBetween = (start, end) => Math.max(0, Math.floor((end.getTime() - start.getTime()) / MINUTE_MS));
