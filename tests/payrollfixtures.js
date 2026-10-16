/**
 * Shared builders for the attendance / payroll unit tests.
 */
import { dateRange, istDateTimeToUtc, monthBounds, weekdayOf } from "../src/helpers/istdate.helper.js";
import { mergeSettings, shiftMinutesFor } from "../src/services/attendance/attendancerules.js";

export const settings = mergeSettings();

/** An AttendanceDay-like object: punch in at `start` IST and work `minutes`. */
export const attendanceDay = (date, minutes, start = "09:00", extra = {}) => {
  const punchIn = istDateTimeToUtc(date, start);
  return {
    date,
    punchIn,
    punchOut: minutes === null ? null : new Date(punchIn.getTime() + minutes * 60_000),
    status: minutes === null ? "OPEN" : "PRESENT",
    ...extra,
  };
};

/**
 * A full month where every working day is worked exactly its shift (Saturday 6h, others 8h),
 * except the dates in `overrides` ({ [date]: minutes | null | "skip" }).
 */
export const monthOfAttendance = (year, month, holidayDates, overrides = {}) => {
  const { from, to } = monthBounds(year, month);
  return dateRange(from, to)
    .filter((date) => weekdayOf(date) !== 0 && !holidayDates.has(date))
    .filter((date) => overrides[date] !== "skip")
    .map((date) => {
      const minutes = date in overrides ? overrides[date] : shiftMinutesFor(settings, weekdayOf(date));
      return attendanceDay(date, minutes);
    });
};
