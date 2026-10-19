/**
 * The attendance and leave rules as pure functions (no database, no clock): which hours a day
 * expects, how a day is classified, how many leave days a request takes and which of them are
 * paid. Used by the punch, leave, calendar and payroll services so every screen and the salary
 * use the same rules. Unit tested in tests/attendancerules.test.js.
 *
 * Units: minutes for time; "half-day units" (integers, 1 = half a day, 2 = a full day) for days,
 * so no floating point ever reaches the money math.
 *
 * Used by: services/attendance/*.service.js, services/payroll/payrollcalculator.js
 */
import { DAY_STATUS, DEFAULT_PAYROLL_SETTINGS } from "../../constants/payrollsettings.constant.js";
import { dateRange, istParts, minutesBetween, monthBounds, weekdayOf } from "../../helpers/istdate.helper.js";

const SATURDAY = 6;
const FULL_DAY_UNITS = 2;
const HALF_DAY_UNITS = 1;
const MINUTES_PER_HOUR = 60;
const MONTH_KEY_LENGTH = 7;

/**
 * Stored settings merged over the defaults (keys missing in the stored document fall back).
 *
 * @param {object} [stored]
 * @returns {typeof DEFAULT_PAYROLL_SETTINGS}
 */


export const mergeSettings = (stored = {}) => {
  const merged = { ...DEFAULT_PAYROLL_SETTINGS };
  for (const key of Object.keys(DEFAULT_PAYROLL_SETTINGS)) {
    const value = stored[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue; // empty array = not set (old Mongoose default)
    merged[key] = value;
  }
  return merged;
};

/**
 * Expected minutes of a working day. Saturday is always the Saturday shift (09:00-15:00 = 360);
 * other days use the employee's own shift when set, else the standard shift.
 * Example: Saturday -> 360, Monday -> 480 (or 420 for an employee with a 7h shift).
 *
 * @param {object} settings
 * @param {number} weekday 0-6
 * @param {number | null} [employeeShiftMinutes]
 * @returns {number}
 */
export const shiftMinutesFor = (settings, weekday, employeeShiftMinutes = null) => {
  if (weekday === SATURDAY) return settings.saturdayShiftMinutes;
  return employeeShiftMinutes || settings.standardShiftMinutes;
};

/** True when the date is a weekly off (Sunday by default). */
export const isWeeklyOff = (settings, dateKey) => settings.weeklyOffDays.includes(weekdayOf(dateKey));

/**
 * Classifies worked time against the expected time of a day with no leave.
 * Example (8h day, 10 min grace, 50%): 7h50 -> FULL; 5h -> HALF_DAY; 3h59 -> ABSENT; 8h45 -> FULL + 45 extra.
 *
 * @param {object} settings
 * @param {number} workedMinutes
 * @param {number} expectedMinutes
 * @returns {{ status: string, extraMinutes: number, shortUnits: number, absentUnits: number }}
 */
export const classifyWorkedTime = (settings, workedMinutes, expectedMinutes) => {
  const overtime = workedMinutes - expectedMinutes;
  const extraMinutes = overtime >= settings.extraMinimumMinutes ? overtime : 0;
  if (workedMinutes >= expectedMinutes - settings.fullDayGraceMinutes) {
    return { status: DAY_STATUS.PRESENT, extraMinutes, shortUnits: 0, absentUnits: 0 };
  }
  if (workedMinutes * 100 >= expectedMinutes * settings.halfDayThresholdPercent) {
    return { status: DAY_STATUS.HALF_DAY, extraMinutes: 0, shortUnits: HALF_DAY_UNITS, absentUnits: 0 };
  }
  return { status: DAY_STATUS.ABSENT, extraMinutes: 0, shortUnits: 0, absentUnits: FULL_DAY_UNITS };
};

/**
 * True when the punch-in was after the "late" time (IST). Information only.
 *
 * @param {object} settings
 * @param {Date | null} punchIn
 * @returns {boolean}
 */
export const isLatePunch = (settings, punchIn) => {
  if (!punchIn) return false;
  const [hours, minutes] = settings.lateAfterTime.split(":").map(Number);
  return istParts(punchIn).minutesOfDay > hours * MINUTES_PER_HOUR + minutes;
};

/**
 * Evaluates one calendar day for one employee. This is THE rule set used by the calendar and the
 * payroll; it never touches money.
 *
 * @param {object} input
 * @param {string} input.date "YYYY-MM-DD" (IST)
 * @param {string} input.todayKey today's IST date
 * @param {object} input.settings merged settings
 * @param {{ title: string } | null} [input.holiday]
 * @param {{ leaveType: string, fraction: number, halfDaySession?: string, paidFraction: number, approvalId?: string } | null} [input.leave] approved leave on this day
 * @param {{ leaveType: string, fraction: number, halfDaySession?: string } | null} [input.pendingLeave]
 * @param {object | null} [input.attendance] AttendanceDay-like { punchIn, punchOut, status, requiresAdminApproval, extraApproved }
 * @param {number | null} [input.employeeShiftMinutes]
 * @param {string | null} [input.joiningDate] "YYYY-MM-DD"
 * @returns {object} day result (see fields below)
 */
export const evaluateDay = ({
  date,
  todayKey,
  settings,
  holiday = null,
  leave = null,
  pendingLeave = null,
  attendance = null,
  employeeShiftMinutes = null,
  joiningDate = null,
}) => {
  const weekday = weekdayOf(date);
  const weeklyOff = isWeeklyOff(settings, date);
  const dayKind = holiday ? "HOLIDAY" : weeklyOff ? "WEEKLY_OFF" : "WORKING";
  const punchIn = attendance?.punchIn ? new Date(attendance.punchIn) : null;
  const punchOut = attendance?.punchOut ? new Date(attendance.punchOut) : null;
  const workedMinutes = punchIn && punchOut ? minutesBetween(punchIn, punchOut) : 0;
  const isOpenPunch = Boolean(punchIn && !punchOut);
  const awaitingCorrection = Boolean(isOpenPunch && attendance?.requiresAdminApproval);

  const result = {
    date,
    weekday,
    dayKind,
    holidayTitle: holiday?.title || null,
    punchIn,
    punchOut,
    workedMinutes,
    expectedMinutes: 0,
    status: DAY_STATUS.UPCOMING,
    isPending: false,
    isLate: isLatePunch(settings, punchIn),
    leave: leave
      ? {
          leaveType: leave.leaveType,
          fraction: leave.fraction,
          halfDaySession: leave.halfDaySession || null,
          paidFraction: leave.paidFraction,
          approvalId: leave.approvalId || null,
          isPending: false,
        }
      : pendingLeave
        ? {
            leaveType: pendingLeave.leaveType,
            fraction: pendingLeave.fraction,
            halfDaySession: pendingLeave.halfDaySession || null,
            paidFraction: 0,
            approvalId: pendingLeave.approvalId || null,
            isPending: true,
          }
        : null,
    units: { absent: 0, short: 0, paidLeave: 0, unpaidLeave: 0, notJoined: 0 },
    extraMinutes: 0,
    extraApproved: Boolean(attendance?.extraApproved),
    extraCounted: false,
  };

  const finishExtra = () => {
    result.extraCounted = result.extraMinutes > 0 && (!settings.extraRequiresApproval || result.extraApproved);
    return result;
  };

  if (joiningDate && date < joiningDate) {
    result.status = DAY_STATUS.NOT_JOINED;
    if (dayKind === "WORKING" && date <= todayKey) result.units.notJoined = FULL_DAY_UNITS;
    return result;
  }

  /* ---------- Sundays and holidays: no deduction, every worked minute is extra ---------- */
  if (dayKind !== "WORKING") {
    result.status = dayKind === "HOLIDAY" ? DAY_STATUS.HOLIDAY : DAY_STATUS.WEEKLY_OFF;
    if (isOpenPunch && date < todayKey) {
      result.isPending = true;
      result.status = awaitingCorrection ? DAY_STATUS.CORRECTION_PENDING : DAY_STATUS.MISSING_PUNCH_OUT;
    }
    if (isOpenPunch && date === todayKey) result.status = DAY_STATUS.IN_PROGRESS;
    result.extraMinutes = workedMinutes;
    return finishExtra();
  }

  const shiftMinutes = shiftMinutesFor(settings, weekday, employeeShiftMinutes);
  result.expectedMinutes = shiftMinutes;
  if (date > todayKey) {
    result.status = leave ? (leave.fraction === 1 ? DAY_STATUS.LEAVE : DAY_STATUS.HALF_DAY_LEAVE) : DAY_STATUS.UPCOMING;
    if (!leave && pendingLeave) result.status = DAY_STATUS.LEAVE_PENDING;
    return result;
  }

  /* ---------- Approved full-day leave ---------- */
  if (leave && leave.fraction === 1) {
    result.status = DAY_STATUS.LEAVE;
    result.expectedMinutes = 0;
    const paidUnits = Math.round(leave.paidFraction * FULL_DAY_UNITS);
    result.units.paidLeave = paidUnits;
    result.units.unpaidLeave = FULL_DAY_UNITS - paidUnits;
    return result;
  }

  /* ---------- Approved half-day leave: the other half expects shift / 2 ---------- */
  if (leave && leave.fraction === 0.5) {
    result.status = DAY_STATUS.HALF_DAY_LEAVE;
    result.expectedMinutes = Math.round(shiftMinutes / 2);
    const paidUnits = Math.round(leave.paidFraction * FULL_DAY_UNITS);
    result.units.paidLeave = paidUnits;
    result.units.unpaidLeave = HALF_DAY_UNITS - paidUnits;
    if (isOpenPunch) {
      if (date < todayKey) result.isPending = true;
      return result;
    }
    if (!punchIn) {
      if (date < todayKey) result.units.absent = HALF_DAY_UNITS;
      return result;
    }
    if (attendance?.status === "ABSENT" && !punchOut) {
      result.units.absent = HALF_DAY_UNITS;
      return result;
    }
    const overtime = workedMinutes - result.expectedMinutes;
    if (workedMinutes >= result.expectedMinutes - settings.fullDayGraceMinutes) {
      result.extraMinutes = overtime >= settings.extraMinimumMinutes ? overtime : 0;
    } else {
      result.units.short = HALF_DAY_UNITS;
    }
    return finishExtra();
  }

  /* ---------- Working day without approved leave ---------- */
  if (!punchIn) {
    if (pendingLeave) {
      result.status = DAY_STATUS.LEAVE_PENDING;
      result.isPending = date < todayKey;
      return result;
    }
    if (date === todayKey) {
      result.status = DAY_STATUS.NOT_STARTED;
      return result;
    }
    result.status = DAY_STATUS.ABSENT;
    result.units.absent = FULL_DAY_UNITS;
    return result;
  }

  if (isOpenPunch) {
    if (attendance?.status === "ABSENT") {
      result.status = DAY_STATUS.ABSENT;
      result.units.absent = FULL_DAY_UNITS;
      return result;
    }
    if (date === todayKey && !awaitingCorrection && attendance?.status !== "MISSING_PUNCH_OUT") {
      result.status = DAY_STATUS.IN_PROGRESS;
      return result;
    }
    result.status = awaitingCorrection ? DAY_STATUS.CORRECTION_PENDING : DAY_STATUS.MISSING_PUNCH_OUT;
    result.isPending = true;
    return result;
  }

  const classification = classifyWorkedTime(settings, workedMinutes, shiftMinutes);
  result.status = classification.status;
  result.extraMinutes = classification.extraMinutes;
  result.units.short = classification.shortUnits;
  result.units.absent = classification.absentUnits;
  return finishExtra();
};

/**
 * The days a leave request takes: every date in the range except weekly offs and holidays.
 * HALF_DAY is only allowed for one date and counts 0.5.
 * Example: Fri 16 Oct - Mon 19 Oct, FULL_DAY, Sunday off -> 16, 17, 19 -> totalDays 3.
 *
 * @param {object} input
 * @param {string} input.fromDate
 * @param {string} input.toDate
 * @param {"FULL_DAY" | "HALF_DAY"} input.leaveDuration
 * @param {Set<string>} input.holidayDates
 * @param {object} input.settings
 * @returns {{ days: Array<{ date: string, fraction: number }>, totalDays: number }}
 */
export const countLeaveDays = ({ fromDate, toDate, leaveDuration, holidayDates, settings }) => {
  const fraction = leaveDuration === "HALF_DAY" ? 0.5 : 1;
  const days = dateRange(fromDate, toDate)
    .filter((date) => !isWeeklyOff(settings, date) && !holidayDates.has(date))
    .map((date) => ({ date, fraction }));
  const totalUnits = days.reduce((sum, day) => sum + day.fraction * FULL_DAY_UNITS, 0);
  return { days, totalDays: totalUnits / FULL_DAY_UNITS };
};

/**
 * Decides which leave days are paid, using the monthly paid quota (shared by the paid types, no
 * carry-forward). Days are allocated in date order; a full day can be half paid when only 0.5 is
 * left. UNPAID leave is never paid.
 * Example: quota 1, nothing used, 2 CASUAL days -> first paid, second unpaid.
 *
 * @param {object} input
 * @param {Array<{ date: string, fraction: number }>} input.days
 * @param {string} input.leaveType
 * @param {object} input.settings
 * @param {Record<string, number>} input.usedByMonth paid days already used, by "YYYY-MM"
 * @returns {{ days: Array<{ date: string, fraction: number, paidFraction: number }>, paidDays: number, unpaidDays: number }}
 */
export const allocatePaidLeave = ({ days, leaveType, settings, usedByMonth }) => {
  const isPaidType = settings.paidLeaveTypes.includes(leaveType);
  const usedUnits = {};
  for (const [monthKey, used] of Object.entries(usedByMonth || {})) usedUnits[monthKey] = Math.round(used * 2);
  const quotaUnits = Math.round(settings.paidLeaveQuotaPerMonth * FULL_DAY_UNITS);

  let paidUnits = 0;
  let totalUnits = 0;
  const allocated = [...days]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((day) => {
      const dayUnits = Math.round(day.fraction * FULL_DAY_UNITS);
      totalUnits += dayUnits;
      if (!isPaidType) return { ...day, paidFraction: 0 };
      const monthKey = day.date.slice(0, MONTH_KEY_LENGTH);
      const available = Math.max(0, quotaUnits - (usedUnits[monthKey] || 0));
      const paid = Math.min(available, dayUnits);
      usedUnits[monthKey] = (usedUnits[monthKey] || 0) + paid;
      paidUnits += paid;
      return { ...day, paidFraction: paid / FULL_DAY_UNITS };
    });
  return { days: allocated, paidDays: paidUnits / FULL_DAY_UNITS, unpaidDays: (totalUnits - paidUnits) / FULL_DAY_UNITS };
};

/**
 * Working days of a month = calendar days - weekly offs - holidays (a holiday on a Sunday counts once).
 * Example: October 2026 has 31 days, 4 Sundays, 1 weekday holiday -> 26.
 *
 * @param {object} settings
 * @param {number} year
 * @param {number} month 1-12
 * @param {Set<string>} holidayDates
 * @returns {number}
 */
export const workingDaysInMonth = (settings, year, month, holidayDates) => {
  const { from, to } = monthBounds(year, month);
  return dateRange(from, to).filter((date) => !isWeeklyOff(settings, date) && !holidayDates.has(date)).length;
};
