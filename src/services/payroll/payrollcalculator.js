/**
 * Pure monthly payroll calculator. All salary math of the system lives here (the frontend only
 * displays its output). Money is integer paise in BigInt; every amount is rounded once, half up,
 * at the end of its category.
 *
 *   workingDays = calendar days - weekly offs - holidays
 *   perDay      = base / workingDays
 *   perHour     = perDay / (standardShiftMinutes / 60)
 *   leaveDeduction      = unpaid leave days * perDay
 *   absentDeduction     = (absent days + days before joining) * perDay
 *   shortHoursDeduction = half days (from worked hours) * 0.5 * perDay
 *   extraPay            = counted extra hours * perHour * multiplier
 *   net = max(0, base - leaveDeduction - absentDeduction - shortHoursDeduction + extraPay)
 *
 * Worked example (tests/payrollcalculator.test.js): base 26,000, 26 working days -> perDay 1,000,
 * perHour 125. 2 unpaid full days + 1 unpaid half day = 2,500 deducted; 5 extra hours = +625;
 * net = 26,000 - 2,500 + 625 = 24,125.
 *
 * Used by: services/payroll/payroll.service.js
 */
import { monthBounds, dateRange } from "../../helpers/istdate.helper.js";
import { evaluateDay, workingDaysInMonth } from "../attendance/attendancerules.js";

const HALF_UNITS_PER_DAY = 2n;
const MINUTES_PER_HOUR = 60;
const PAISE_PER_RUPEE = 100;
const MULTIPLIER_SCALE = 100;

/**
 * Divides two BigInts and rounds half up (inputs are never negative here).
 * Example: roundDiv(5n, 2n) -> 3n.
 */
export const roundDiv = (numerator, denominator) => {
  if (denominator === 0n) return 0n;
  return (numerator * 2n + denominator) / (denominator * 2n);
};

/** Paise (BigInt or number) -> rupees number with 2 decimals. Example: 2412500n -> 24125. */
export const paiseToRupees = (paise) => Number(paise) / 100;

/** Rupees (number or numeric string) -> integer paise. Example: 26000.5 -> 2600050. */
export const rupeesToPaise = (rupees) => Math.round(Number(rupees) * 100);

/**
 * Computes one employee's payroll for one month.
 *
 * @param {object} input
 * @param {number} input.year
 * @param {number} input.month 1-12
 * @param {string} input.todayKey IST date key of "now"; later days are never deducted
 * @param {object} input.settings merged payroll settings
 * @param {Array<{ date: string, title: string }>} input.holidays holidays of the month
 * @param {number} input.baseSalaryPaise monthly base salary in paise (0 when no profile)
 * @param {number | null} [input.employeeShiftMinutes]
 * @param {string | null} [input.joiningDate]
 * @param {Array<object>} input.attendanceDays AttendanceDay documents of the month
 * @param {Array<object>} input.leaveDays approved leave days: { date, leaveType, fraction, halfDaySession, paidFraction, approvalId }
 * @param {Array<object>} [input.pendingLeaveDays] pending leave days: { date, leaveType, fraction, halfDaySession, approvalId }
 * @returns {object} totals, counts and the day-by-day breakdown
 */
export const calculateMonthlyPayroll = ({
  year,
  month,
  todayKey,
  settings,
  holidays,
  baseSalaryPaise,
  employeeShiftMinutes = null,
  joiningDate = null,
  attendanceDays,
  leaveDays,
  pendingLeaveDays = [],
}) => {
  const { from, to } = monthBounds(year, month);
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  const attendanceByDate = new Map(attendanceDays.map((day) => [day.date, day]));
  const leaveByDate = new Map(leaveDays.map((day) => [day.date, day]));
  const pendingLeaveByDate = new Map(pendingLeaveDays.map((day) => [day.date, day]));

  const workingDays = workingDaysInMonth(settings, year, month, new Set(holidayByDate.keys()));
  const base = BigInt(Math.max(0, Math.round(baseSalaryPaise || 0)));
  const workingDaysBig = BigInt(workingDays);
  const halfDayDenominator = workingDaysBig * HALF_UNITS_PER_DAY;
  const multiplierScaled = BigInt(Math.round(settings.extraPayMultiplier * MULTIPLIER_SCALE));
  const extraDenominator = workingDaysBig * BigInt(settings.standardShiftMinutes) * BigInt(MULTIPLIER_SCALE);

  const totals = {
    absentUnits: 0,
    shortUnits: 0,
    paidLeaveUnits: 0,
    unpaidLeaveUnits: 0,
    notJoinedUnits: 0,
    workedMinutes: 0,
    extraMinutes: 0,
    extraMinutesCounted: 0,
    presentDays: 0,
    halfDays: 0,
    pendingDays: 0,
    lateDays: 0,
  };

  const days = dateRange(from, to).map((date) => {
    const evaluated = evaluateDay({
      date,
      todayKey,
      settings,
      holiday: holidayByDate.get(date) || null,
      leave: leaveByDate.get(date) || null,
      pendingLeave: pendingLeaveByDate.get(date) || null,
      attendance: attendanceByDate.get(date) || null,
      employeeShiftMinutes,
      joiningDate,
    });
    totals.absentUnits += evaluated.units.absent;
    totals.shortUnits += evaluated.units.short;
    totals.paidLeaveUnits += evaluated.units.paidLeave;
    totals.unpaidLeaveUnits += evaluated.units.unpaidLeave;
    totals.notJoinedUnits += evaluated.units.notJoined;
    totals.workedMinutes += evaluated.workedMinutes;
    totals.extraMinutes += evaluated.extraMinutes;
    if (evaluated.extraCounted) totals.extraMinutesCounted += evaluated.extraMinutes;
    if (evaluated.status === "PRESENT") totals.presentDays += 1;
    if (evaluated.status === "HALF_DAY") totals.halfDays += 1;
    if (evaluated.isPending) totals.pendingDays += 1;
    if (evaluated.isLate) totals.lateDays += 1;

    const dayDeductionUnits =
      evaluated.units.absent + evaluated.units.short + evaluated.units.unpaidLeave + evaluated.units.notJoined;
    const dayDeduction = roundDiv(base * BigInt(dayDeductionUnits), halfDayDenominator);
    const dayExtra = evaluated.extraCounted
      ? roundDiv(base * BigInt(evaluated.extraMinutes) * multiplierScaled, extraDenominator)
      : 0n;
    return {
      ...evaluated,
      punchIn: evaluated.punchIn ? evaluated.punchIn.toISOString() : null,
      punchOut: evaluated.punchOut ? evaluated.punchOut.toISOString() : null,
      attendanceId: attendanceByDate.get(date)?._id?.toString?.() || null,
      deduction: paiseToRupees(dayDeduction),
      extraPay: paiseToRupees(dayExtra),
    };
  });

  const leaveDeduction = roundDiv(base * BigInt(totals.unpaidLeaveUnits), halfDayDenominator);
  const absentDeduction = roundDiv(base * BigInt(totals.absentUnits + totals.notJoinedUnits), halfDayDenominator);
  const shortHoursDeduction = roundDiv(base * BigInt(totals.shortUnits), halfDayDenominator);
  const extraPay = roundDiv(base * BigInt(totals.extraMinutesCounted) * multiplierScaled, extraDenominator);
  const totalDeductions = leaveDeduction + absentDeduction + shortHoursDeduction;
  let net = base - totalDeductions + extraPay;
  if (net < 0n) net = 0n;

  const perDay = roundDiv(base, workingDaysBig);
  const perHour = roundDiv(base * BigInt(MINUTES_PER_HOUR), workingDaysBig * BigInt(settings.standardShiftMinutes));

  return {
    year,
    month,
    workingDays,
    baseSalary: paiseToRupees(base),
    perDay: paiseToRupees(perDay),
    perHour: paiseToRupees(perHour),
    presentDays: totals.presentDays,
    halfDays: totals.halfDays,
    paidLeaveDays: totals.paidLeaveUnits / 2,
    unpaidLeaveDays: totals.unpaidLeaveUnits / 2,
    absentDays: totals.absentUnits / 2,
    notJoinedDays: totals.notJoinedUnits / 2,
    pendingDays: totals.pendingDays,
    lateDays: totals.lateDays,
    totalWorkedHours: Math.round((totals.workedMinutes / MINUTES_PER_HOUR) * PAISE_PER_RUPEE) / PAISE_PER_RUPEE,
    extraHours: Math.round((totals.extraMinutes / MINUTES_PER_HOUR) * PAISE_PER_RUPEE) / PAISE_PER_RUPEE,
    extraHoursCounted: Math.round((totals.extraMinutesCounted / MINUTES_PER_HOUR) * PAISE_PER_RUPEE) / PAISE_PER_RUPEE,
    leaveDeduction: paiseToRupees(leaveDeduction),
    absentDeduction: paiseToRupees(absentDeduction),
    shortHoursDeduction: paiseToRupees(shortHoursDeduction),
    totalDeductions: paiseToRupees(totalDeductions),
    extraPay: paiseToRupees(extraPay),
    netPayable: paiseToRupees(net),
    netPayablePaise: Number(net),
    days,
  };
};
