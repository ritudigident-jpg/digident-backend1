/**
 * Default values for the one PayrollSettings document (attendance, leave and payroll rules).
 * The live values are stored in MongoDB (models/payrollsettings.model.js) and can be changed by an
 * admin with PUT /api/v1/payroll/settings; these defaults are used until then and for any key the
 * stored document does not have. The frontend mirrors them in src/constants/PayrollConstants.js
 * (display only, never used for money).
 *
 * Used by: services/payroll/payrollsettings.service.js, services/attendance/attendancerules.js, tests
 */

export const PAYROLL_SETTINGS_KEY = "default";

export const DEFAULT_PAYROLL_SETTINGS = Object.freeze({
  /** Days of the week that are always off (0 = Sunday). Holidays come from the Holiday collection. */
  weeklyOffDays: [0],
  /** Standard working day, Monday-Friday: 8 hours. perHour = perDay / (standardShiftMinutes / 60). */
  standardShiftMinutes: 480,
  /** Saturday: office 09:00-15:00 = 6 hours counts as a full day. */
  saturdayShiftMinutes: 360,
  /** Punch-in after this IST time is flagged LATE (information only, no deduction). */
  lateAfterTime: "09:30",
  /** A day counts as FULL when worked >= expected - grace. Example: 8h shift, 10 min grace -> 7h50 is full. */
  fullDayGraceMinutes: 10,
  /** Worked at least this % of the expected time (but not full) -> HALF_DAY (0.5 day deducted). Below it -> ABSENT. */
  halfDayThresholdPercent: 50,
  /** Time beyond the expected hours counts as EXTRA only when it is at least this long. */
  extraMinimumMinutes: 30,
  /** extraPay = extraHours * perHour * multiplier. */
  extraPayMultiplier: 1,
  /** When true, extra pay is counted only after an admin approves it (it is always shown). */
  extraRequiresApproval: false,
  /** Paid leave days per month, shared by the paid leave types; no carry-forward. */
  paidLeaveQuotaPerMonth: 1,
  /** Leave types that can use the paid quota. UNPAID never does. */
  paidLeaveTypes: ["SICK", "CASUAL"],
  /** How many days back a leave may start (0 = from today only). */
  leaveBackdateDays: 7,
  /** How many days ahead a leave may end. */
  leaveMaxFutureDays: 180,
  /** How many days back a forgotten punch-out may be corrected. */
  punchOutCorrectionWindowDays: 7,
  /** Allow punching on Sundays and holidays (all that time is EXTRA). */
  allowPunchOnOffDays: true,
});

/** Leave types an employee can apply for. */
export const LEAVE_TYPES = Object.freeze(["SICK", "CASUAL", "UNPAID"]);
export const LEAVE_DURATIONS = Object.freeze(["FULL_DAY", "HALF_DAY"]);
export const HALF_DAY_SESSIONS = Object.freeze(["MORNING", "AFTERNOON"]);
export const HOLIDAY_TYPES = Object.freeze(["PUBLIC", "COMPANY"]);

/** Status stored on an AttendanceDay. */
export const ATTENDANCE_STATUS = Object.freeze({
  OPEN: "OPEN",
  PRESENT: "PRESENT",
  HALF_DAY: "HALF_DAY",
  ABSENT: "ABSENT",
  MISSING_PUNCH_OUT: "MISSING_PUNCH_OUT",
});

/** Status of one day in the calendar and the payroll breakdown (computed, never stored). */
export const DAY_STATUS = Object.freeze({
  PRESENT: "PRESENT",
  HALF_DAY: "HALF_DAY",
  ABSENT: "ABSENT",
  LEAVE: "LEAVE",
  HALF_DAY_LEAVE: "HALF_DAY_LEAVE",
  LEAVE_PENDING: "LEAVE_PENDING",
  WEEKLY_OFF: "WEEKLY_OFF",
  HOLIDAY: "HOLIDAY",
  MISSING_PUNCH_OUT: "MISSING_PUNCH_OUT",
  CORRECTION_PENDING: "CORRECTION_PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  NOT_STARTED: "NOT_STARTED",
  UPCOMING: "UPCOMING",
  NOT_JOINED: "NOT_JOINED",
});
