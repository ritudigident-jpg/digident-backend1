/**
 * The employee's month calendar: one entry per date with holiday / Sunday, own leave (full or
 * half with MORNING / AFTERNOON, pending or approved) and the attendance status (present, half
 * day, absent, missing punch-out, extra time). Computed with the same rules as the payroll, but
 * without any money.
 *
 * Exports: getMyCalendarService, resolveMonth
 * Used by: services/attendance/attendance.service.js
 */
import { dateRange, istDateKey, nowUtc } from "../../helpers/istdate.helper.js";
import { evaluateDay, workingDaysInMonth } from "./attendancerules.js";
import { loadMonthData } from "./monthdata.service.js";
import { findActiveEmployeeByEmail } from "../employee/employeelookup.service.js";
import { BadRequestError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Month / year from the query, defaulting to the current IST month.
 *
 * @param {*} month
 * @param {*} year
 * @returns {{ month: number, year: number }}
 * @throws {BadRequestError} 400 INVALID_MONTH / INVALID_YEAR
 */
export const resolveMonth = (month, year) => {
  const [currentYear, currentMonth] = istDateKey(nowUtc()).split("-").map(Number);
  const resolvedMonth = month ? Number(month) : currentMonth;
  const resolvedYear = year ? Number(year) : currentYear;
  if (!Number.isInteger(resolvedMonth) || resolvedMonth < 1 || resolvedMonth > 12) {
    throw new BadRequestError("month must be 1-12", { code: ERROR_CODES.INVALID_MONTH });
  }
  if (!Number.isInteger(resolvedYear) || resolvedYear < 2000 || resolvedYear > 2100) {
    throw new BadRequestError("year is not valid", { code: ERROR_CODES.INVALID_YEAR });
  }
  return { month: resolvedMonth, year: resolvedYear };
};

/**
 * @param {{ email: string }} user
 * @param {*} [month]
 * @param {*} [year]
 * @returns {Promise<{ year, month, monthName, today, days: object[], holidays: object[], summary: object }>}
 */
export const getMyCalendarService = async (user, month, year) => {
  const resolved = resolveMonth(month, year);
  const employee = await findActiveEmployeeByEmail(user.email);
  const today = istDateKey(nowUtc());
  const { settings, holidays, from, to, byEmployee } = await loadMonthData({ ...resolved, employeeIds: [employee._id] });
  const data = byEmployee.get(String(employee._id));
  const holidayByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]));
  const attendanceByDate = new Map(data.attendanceDays.map((day) => [day.date, day]));
  const leaveByDate = new Map(data.leaveDays.map((day) => [day.date, day]));
  const pendingByDate = new Map(data.pendingLeaveDays.map((day) => [day.date, day]));

  const days = dateRange(from, to).map((date) => {
    const evaluated = evaluateDay({
      date,
      todayKey: today,
      settings,
      holiday: holidayByDate.get(date) || null,
      leave: leaveByDate.get(date) || null,
      pendingLeave: pendingByDate.get(date) || null,
      attendance: attendanceByDate.get(date) || null,
      employeeShiftMinutes: data.employeeShiftMinutes || null,
      joiningDate: data.joiningDate || null,
    });
    return {
      ...evaluated,
      attendanceId: attendanceByDate.get(date)?._id || null,
      isToday: date === today,
      canRequestCorrection: evaluated.status === "MISSING_PUNCH_OUT",
    };
  });

  const count = (status) => days.filter((day) => day.status === status).length;
  return {
    ...resolved,
    monthName: MONTH_NAMES[resolved.month - 1],
    today,
    days,
    holidays: holidays.map((holiday) => ({ date: holiday.date, title: holiday.title, type: holiday.type })),
    summary: {
      workingDays: workingDaysInMonth(settings, resolved.year, resolved.month, new Set(holidayByDate.keys())),
      present: count("PRESENT"),
      halfDay: count("HALF_DAY"),
      absent: count("ABSENT"),
      leave: days.filter((day) => day.leave && !day.leave.isPending).reduce((sum, day) => sum + day.leave.fraction, 0),
      pending: days.filter((day) => day.isPending).length,
      extraMinutes: days.reduce((sum, day) => sum + day.extraMinutes, 0),
      workedMinutes: days.reduce((sum, day) => sum + day.workedMinutes, 0),
    },
  };
};
