/**
 * IST date helpers: the day boundary is Asia/Kolkata, storage is UTC, no dependency on the server zone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dateRange,
  istDateKey,
  istDateTimeToUtc,
  istParts,
  isValidDateKey,
  monthBounds,
  parseClientDateTime,
  weekdayOf,
} from "../src/helpers/istdate.helper.js";

test("an instant after 18:30 UTC belongs to the next IST date", () => {
  assert.equal(istDateKey(new Date("2026-10-16T18:29:59Z")), "2026-10-16");
  assert.equal(istDateKey(new Date("2026-10-16T18:30:00Z")), "2026-10-17");
});

test("IST wall time converts to the right UTC instant and back", () => {
  const instant = istDateTimeToUtc("2026-10-16", "09:30");
  assert.equal(instant.toISOString(), "2026-10-16T04:00:00.000Z");
  const parts = istParts(instant);
  assert.equal(parts.dateKey, "2026-10-16");
  assert.equal(parts.minutesOfDay, 570);
});

test("client date-time without a zone is read as IST; with Z it is an exact instant", () => {
  assert.equal(parseClientDateTime("2026-10-16T18:30").toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(parseClientDateTime("2026-10-16 18:30").toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(parseClientDateTime("2026-10-16T13:00:00Z").toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(parseClientDateTime("2026-10-16T18:30+05:30").toISOString(), "2026-10-16T13:00:00.000Z");
  assert.equal(parseClientDateTime("not a date"), null);
  assert.equal(parseClientDateTime("2026-02-30T10:00"), null);
});

test("date keys: validation, ranges, month bounds and weekdays", () => {
  assert.equal(isValidDateKey("2026-02-29"), false);
  assert.equal(isValidDateKey("2028-02-29"), true);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.deepEqual(dateRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(monthBounds(2026, 2), { from: "2026-02-01", to: "2026-02-28", days: 28 });
  assert.equal(weekdayOf("2026-10-18"), 0);
  assert.equal(weekdayOf("2026-10-17"), 6);
});
