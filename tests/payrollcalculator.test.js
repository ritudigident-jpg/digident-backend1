/**
 * Payroll calculator: the three worked examples from the specification plus edge cases.
 * October 2026 with a holiday on Fri 2 Oct has 26 working days (31 - 4 Sundays - 1 holiday),
 * so base 26,000 -> perDay 1,000, perHour 125.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateMonthlyPayroll, roundDiv } from "../src/services/payroll/payrollcalculator.js";
import { allocatePaidLeave, mergeSettings } from "../src/services/attendance/attendancerules.js";
import { attendanceDay, monthOfAttendance, settings } from "./payrollfixtures.js";

const HOLIDAYS = [{ date: "2026-10-02", title: "Gandhi Jayanti" }];
const HOLIDAY_DATES = new Set(HOLIDAYS.map((holiday) => holiday.date));
const AFTER_MONTH = "2026-11-15";
const BASE_PAISE = 26_000_00;

const run = (overrides) =>
  calculateMonthlyPayroll({
    year: 2026,
    month: 10,
    todayKey: AFTER_MONTH,
    settings,
    holidays: HOLIDAYS,
    baseSalaryPaise: BASE_PAISE,
    attendanceDays: [],
    leaveDays: [],
    ...overrides,
  });

test("full attendance -> net = base", () => {
  const result = run({ attendanceDays: monthOfAttendance(2026, 10, HOLIDAY_DATES) });
  assert.equal(result.workingDays, 26);
  assert.equal(result.perDay, 1000);
  assert.equal(result.perHour, 125);
  assert.equal(result.presentDays, 26);
  assert.equal(result.netPayable, 26000);
});

test("example 1: 2 unpaid full days + 1 unpaid half day + 5 extra hours -> 24,125", () => {
  const attendanceDays = monthOfAttendance(2026, 10, HOLIDAY_DATES, {
    "2026-10-05": "skip",
    "2026-10-06": "skip",
    "2026-10-07": 240,
    "2026-10-08": 480 + 120,
    "2026-10-09": 480 + 180,
  });
  const leaveDays = [
    { date: "2026-10-05", leaveType: "UNPAID", fraction: 1, paidFraction: 0 },
    { date: "2026-10-06", leaveType: "UNPAID", fraction: 1, paidFraction: 0 },
    { date: "2026-10-07", leaveType: "UNPAID", fraction: 0.5, halfDaySession: "AFTERNOON", paidFraction: 0 },
  ];
  const result = run({ attendanceDays, leaveDays });
  assert.equal(result.unpaidLeaveDays, 2.5);
  assert.equal(result.leaveDeduction, 2500);
  assert.equal(result.extraHours, 5);
  assert.equal(result.extraPay, 625);
  assert.equal(result.totalDeductions, 2500);
  assert.equal(result.netPayable, 24125);
});

test("example 2: 2 approved casual days with quota 1 -> 1 paid, 1 unpaid -> deduction 1,000", () => {
  const allocation = allocatePaidLeave({
    days: [{ date: "2026-10-12", fraction: 1 }, { date: "2026-10-13", fraction: 1 }],
    leaveType: "CASUAL",
    settings,
    usedByMonth: {},
  });
  const leaveDays = allocation.days.map((day) => ({ ...day, leaveType: "CASUAL" }));
  const attendanceDays = monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-12": "skip", "2026-10-13": "skip" });
  const result = run({ attendanceDays, leaveDays });
  assert.equal(result.paidLeaveDays, 1);
  assert.equal(result.unpaidLeaveDays, 1);
  assert.equal(result.totalDeductions, 1000);
  assert.equal(result.netPayable, 25000);
});

test("example 3: a weekday worked 5h with no leave -> HALF_DAY -> deduction 500", () => {
  const result = run({ attendanceDays: monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-14": 300 }) });
  assert.equal(result.halfDays, 1);
  assert.equal(result.shortHoursDeduction, 500);
  assert.equal(result.netPayable, 25500);
  assert.equal(result.days.find((day) => day.date === "2026-10-14").deduction, 500);
});

test("Saturday worked 09:00-15:00 is a full day; Sunday work is paid as extra", () => {
  const attendanceDays = [...monthOfAttendance(2026, 10, HOLIDAY_DATES), attendanceDay("2026-10-18", 120)];
  const result = run({ attendanceDays });
  assert.equal(result.days.find((day) => day.date === "2026-10-17").status, "PRESENT");
  assert.equal(result.extraPay, 250);
  assert.equal(result.netPayable, 26250);
});

test("absent days are deducted at perDay; net never goes below 0", () => {
  const twoAbsent = run({ attendanceDays: monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-20": "skip", "2026-10-21": "skip" }) });
  assert.equal(twoAbsent.absentDays, 2);
  assert.equal(twoAbsent.absentDeduction, 2000);
  assert.equal(run({ attendanceDays: [] }).netPayable, 0);
});

test("missing punch-out is pending (not deducted) until resolved", () => {
  const attendanceDays = monthOfAttendance(2026, 10, HOLIDAY_DATES).map((day) =>
    day.date === "2026-10-22" ? { ...day, punchOut: null, status: "MISSING_PUNCH_OUT" } : day
  );
  const result = run({ attendanceDays });
  assert.equal(result.pendingDays, 1);
  assert.equal(result.totalDeductions, 0);
});

test("current month: future days are never deducted", () => {
  const result = run({ todayKey: "2026-10-03", attendanceDays: [attendanceDay("2026-10-01", 480), attendanceDay("2026-10-03", 360)] });
  assert.equal(result.totalDeductions, 0);
  assert.equal(result.netPayable, 26000);
});

test("extra needs approval when extraRequiresApproval is on (shown, not paid)", () => {
  const strict = mergeSettings({ extraRequiresApproval: true });
  const attendanceDays = monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-08": 600 });
  const result = run({ settings: strict, attendanceDays });
  assert.equal(result.extraHours, 2);
  assert.equal(result.extraPay, 0);
  const approved = attendanceDays.map((day) => (day.date === "2026-10-08" ? { ...day, extraApproved: true } : day));
  assert.equal(run({ settings: strict, attendanceDays: approved }).extraPay, 250);
});

test("multiplier 1.5 and rounding half up in paise", () => {
  const result = run({ settings: mergeSettings({ extraPayMultiplier: 1.5 }), attendanceDays: monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-08": 540 }) });
  assert.equal(result.extraPay, 187.5);
  assert.equal(roundDiv(5n, 2n), 3n);
  assert.equal(roundDiv(10_000_00n, 3n), 333_333n);
});

test("salary that does not divide evenly stays exact to the paisa", () => {
  const result = run({ baseSalaryPaise: 25_000_00, attendanceDays: monthOfAttendance(2026, 10, HOLIDAY_DATES, { "2026-10-20": "skip" }) });
  assert.equal(result.absentDeduction, 961.54);
  assert.equal(result.netPayable, 24038.46);
});
