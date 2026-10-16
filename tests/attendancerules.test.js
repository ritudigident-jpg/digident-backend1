/**
 * Punch and leave rules: day classification (8h weekdays, 6h Saturdays), grace, extra time,
 * pending days, leave day counting and paid-quota allocation.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  allocatePaidLeave,
  classifyWorkedTime,
  countLeaveDays,
  evaluateDay,
  isLatePunch,
  shiftMinutesFor,
  workingDaysInMonth,
} from "../src/services/attendance/attendancerules.js";
import { istDateTimeToUtc } from "../src/helpers/istdate.helper.js";
import { attendanceDay, settings } from "./payrollfixtures.js";

const TODAY = "2026-10-31";
const MONDAY = "2026-10-12";
const SATURDAY = "2026-10-17";
const SUNDAY = "2026-10-18";

describe("expected hours", () => {
  test("weekdays expect 8h, Saturday expects 6h (09:00-15:00)", () => {
    assert.equal(shiftMinutesFor(settings, 1), 480);
    assert.equal(shiftMinutesFor(settings, 6), 360);
    assert.equal(shiftMinutesFor(settings, 1, 420), 420);
    assert.equal(shiftMinutesFor(settings, 6, 420), 360);
  });
});

describe("classifying worked time", () => {
  test("8h day: 7h50 is full (10 min grace), 7h49 is half, 4h is half, 3h59 is absent", () => {
    assert.equal(classifyWorkedTime(settings, 470, 480).status, "PRESENT");
    assert.equal(classifyWorkedTime(settings, 469, 480).status, "HALF_DAY");
    assert.equal(classifyWorkedTime(settings, 240, 480).status, "HALF_DAY");
    assert.equal(classifyWorkedTime(settings, 239, 480).status, "ABSENT");
  });

  test("Saturday 6h day: 6h is full, 5h50 is full, 3h is half, 2h59 is absent", () => {
    assert.equal(evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, attendance: attendanceDay(SATURDAY, 360) }).status, "PRESENT");
    assert.equal(evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, attendance: attendanceDay(SATURDAY, 350) }).status, "PRESENT");
    assert.equal(evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, attendance: attendanceDay(SATURDAY, 180) }).status, "HALF_DAY");
    assert.equal(evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, attendance: attendanceDay(SATURDAY, 179) }).status, "ABSENT");
  });

  test("extra counts only from 30 minutes beyond the expected time", () => {
    assert.equal(classifyWorkedTime(settings, 509, 480).extraMinutes, 0);
    assert.equal(classifyWorkedTime(settings, 510, 480).extraMinutes, 30);
    const saturday = evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, attendance: attendanceDay(SATURDAY, 420) });
    assert.equal(saturday.extraMinutes, 60);
  });
});

describe("evaluating a day", () => {
  test("a day worked 5h with no leave is HALF_DAY with one half-day unit deducted", () => {
    const day = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, attendance: attendanceDay(MONDAY, 300) });
    assert.equal(day.status, "HALF_DAY");
    assert.equal(day.units.short, 1);
  });

  test("every minute worked on a Sunday or holiday is extra, nothing is deducted", () => {
    const sunday = evaluateDay({ date: SUNDAY, todayKey: TODAY, settings, attendance: attendanceDay(SUNDAY, 200) });
    assert.equal(sunday.status, "WEEKLY_OFF");
    assert.equal(sunday.extraMinutes, 200);
    const holiday = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, holiday: { title: "Diwali" }, attendance: attendanceDay(MONDAY, 15) });
    assert.equal(holiday.status, "HOLIDAY");
    assert.equal(holiday.extraMinutes, 15);
    assert.deepEqual(holiday.units, { absent: 0, short: 0, paidLeave: 0, unpaidLeave: 0, notJoined: 0 });
  });

  test("past working day with no punch is ABSENT; today with no punch is not deducted yet", () => {
    assert.equal(evaluateDay({ date: MONDAY, todayKey: TODAY, settings }).units.absent, 2);
    const today = evaluateDay({ date: TODAY, todayKey: TODAY, settings });
    assert.equal(today.status, "NOT_STARTED");
    assert.equal(today.units.absent, 0);
  });

  test("an unresolved missing punch-out is pending and excluded from deductions", () => {
    const day = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, attendance: { ...attendanceDay(MONDAY, null), status: "MISSING_PUNCH_OUT" } });
    assert.equal(day.status, "MISSING_PUNCH_OUT");
    assert.equal(day.isPending, true);
    assert.equal(day.units.absent + day.units.short, 0);
    const requested = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, attendance: { ...attendanceDay(MONDAY, null), status: "MISSING_PUNCH_OUT", requiresAdminApproval: true } });
    assert.equal(requested.status, "CORRECTION_PENDING");
  });

  test("a rejected correction (stored ABSENT) is deducted as absent", () => {
    const day = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, attendance: { ...attendanceDay(MONDAY, null), status: "ABSENT" } });
    assert.equal(day.status, "ABSENT");
    assert.equal(day.units.absent, 2);
  });

  test("half-day leave: the other half expects 4h (3h on Saturday)", () => {
    const leave = { leaveType: "CASUAL", fraction: 0.5, halfDaySession: "MORNING", paidFraction: 0.5 };
    const worked = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, leave, attendance: attendanceDay(MONDAY, 240, "13:00") });
    assert.equal(worked.status, "HALF_DAY_LEAVE");
    assert.equal(worked.expectedMinutes, 240);
    assert.deepEqual(worked.units, { absent: 0, short: 0, paidLeave: 1, unpaidLeave: 0, notJoined: 0 });
    const short = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, leave, attendance: attendanceDay(MONDAY, 120, "13:00") });
    assert.equal(short.units.short, 1);
    const saturday = evaluateDay({ date: SATURDAY, todayKey: TODAY, settings, leave, attendance: attendanceDay(SATURDAY, 180) });
    assert.equal(saturday.expectedMinutes, 180);
    assert.equal(saturday.units.short, 0);
  });

  test("late flag after 09:30 IST", () => {
    assert.equal(isLatePunch(settings, istDateTimeToUtc(MONDAY, "09:30")), false);
    assert.equal(isLatePunch(settings, istDateTimeToUtc(MONDAY, "09:31")), true);
  });

  test("days before the joining date are not paid", () => {
    const day = evaluateDay({ date: MONDAY, todayKey: TODAY, settings, joiningDate: "2026-10-15" });
    assert.equal(day.status, "NOT_JOINED");
    assert.equal(day.units.notJoined, 2);
  });
});

describe("leave day counting", () => {
  test("skips Sundays and holidays; Saturday counts as a full leave day", () => {
    const result = countLeaveDays({ fromDate: "2026-10-16", toDate: "2026-10-20", leaveDuration: "FULL_DAY", holidayDates: new Set(["2026-10-20"]), settings });
    assert.deepEqual(result.days.map((day) => day.date), ["2026-10-16", "2026-10-17", "2026-10-19"]);
    assert.equal(result.totalDays, 3);
  });

  test("a half day counts 0.5; a Sunday-only range counts 0", () => {
    assert.equal(countLeaveDays({ fromDate: MONDAY, toDate: MONDAY, leaveDuration: "HALF_DAY", holidayDates: new Set(), settings }).totalDays, 0.5);
    assert.equal(countLeaveDays({ fromDate: SUNDAY, toDate: SUNDAY, leaveDuration: "FULL_DAY", holidayDates: new Set(), settings }).totalDays, 0);
  });
});

describe("paid leave quota", () => {
  test("2 casual days with quota 1 -> 1 paid, 1 unpaid", () => {
    const result = allocatePaidLeave({ days: [{ date: "2026-10-12", fraction: 1 }, { date: "2026-10-13", fraction: 1 }], leaveType: "CASUAL", settings, usedByMonth: {} });
    assert.equal(result.paidDays, 1);
    assert.equal(result.unpaidDays, 1);
    assert.deepEqual(result.days.map((day) => day.paidFraction), [1, 0]);
  });

  test("half of the quota already used -> a full day is half paid", () => {
    const result = allocatePaidLeave({ days: [{ date: "2026-10-12", fraction: 1 }], leaveType: "SICK", settings, usedByMonth: { "2026-10": 0.5 } });
    assert.equal(result.days[0].paidFraction, 0.5);
  });

  test("UNPAID never uses the quota; a leave across months uses each month's quota", () => {
    assert.equal(allocatePaidLeave({ days: [{ date: "2026-10-12", fraction: 1 }], leaveType: "UNPAID", settings, usedByMonth: {} }).paidDays, 0);
    const across = allocatePaidLeave({ days: [{ date: "2026-10-31", fraction: 1 }, { date: "2026-11-02", fraction: 1 }], leaveType: "CASUAL", settings, usedByMonth: {} });
    assert.equal(across.paidDays, 2);
  });
});

test("working days: October 2026 with one weekday holiday = 26", () => {
  assert.equal(workingDaysInMonth(settings, 2026, 10, new Set(["2026-10-02"])), 26);
});
