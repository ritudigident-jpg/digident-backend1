/**
 * Loads everything the rules need for one or many employees over a date range: holidays,
 * attendance days, approved / pending leave days (with their paid fraction) and each employee's
 * shift override and joining date. Shared by the calendar, the dashboard stats and the payroll, so
 * the same data feeds the same rules everywhere.
 *
 * Exports: loadHolidays, loadEmployeeContexts, leaveDaysFromApprovals, loadMonthData
 * Used by: services/attendance/calendar.service.js, services/payroll/payroll.service.js
 */
import mongoose from "mongoose";
import Holiday from "../../models/holiday.model.js";
import AttendanceDay from "../../models/attendanceday.model.js";
import EmployeeProfile from "../../models/employeeprofile.model.js";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import { monthBounds } from "../../helpers/istdate.helper.js";
import { allocatePaidLeave, countLeaveDays } from "./attendancerules.js";
import { getPayrollSettings } from "../payroll/payrollsettings.service.js";

const MINUTES_PER_HOUR = 60;
const MONTH_KEY_LENGTH = 7;

/**
 * Holidays between two dates (inclusive), sorted.
 *
 * @param {string} from
 * @param {string} to
 * @returns {Promise<Array<{ date: string, title: string, type: string }>>}
 */
export const loadHolidays = async (from, to) =>
  Holiday.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).select("date title type").lean();

/**
 * Shift override (minutes) and joining date per employee, from EmployeeProfile.
 *
 * @param {Array<*>} employeeIds
 * @returns {Promise<Map<string, { employeeShiftMinutes: number | null, joiningDate: string | null }>>}
 */
export const loadEmployeeContexts = async (employeeIds) => {
  const profiles = await EmployeeProfile.find({ employee: { $in: employeeIds } })
    .select("employee employment.shiftHours employment.joiningDate")
    .lean();
  const contexts = new Map();
  for (const profile of profiles) {
    contexts.set(profile.employee.toString(), {
      employeeShiftMinutes: profile.employment?.shiftHours ? Math.round(profile.employment.shiftHours * MINUTES_PER_HOUR) : null,
      joiningDate: profile.employment?.joiningDate || null,
    });
  }
  return contexts;
};

/**
 * Turns leave approvals into per-day entries. Leaves approved before this upgrade have no `days`;
 * those are counted with today's holidays and get the paid quota in date order (the migration
 * script stores the result so this fallback is rarely used).
 *
 * @param {Array<object>} approvals AdminApproval LEAVE documents (lean)
 * @param {Set<string>} holidayDates
 * @param {object} settings
 * @returns {Array<{ date, leaveType, fraction, halfDaySession, paidFraction, approvalId, status }>}
 */
export const leaveDaysFromApprovals = (approvals, holidayDates, settings) => {
  const usedByMonth = {};
  const result = [];
  const sorted = [...approvals].sort((left, right) => String(left.requestData?.fromDate).localeCompare(String(right.requestData?.fromDate)));
  for (const approval of sorted) {
    const data = approval.requestData || {};
    let days = approval.days;
    if (!days?.length) {
      const counted = countLeaveDays({
        fromDate: String(data.fromDate).slice(0, 10),
        toDate: String(data.toDate).slice(0, 10),
        leaveDuration: data.leaveDuration || "FULL_DAY",
        holidayDates,
        settings,
      });
      days =
        approval.status === "APPROVED"
          ? allocatePaidLeave({ days: counted.days, leaveType: data.leaveType, settings, usedByMonth }).days
          : counted.days.map((day) => ({ ...day, paidFraction: 0 }));
    }
    for (const day of days) {
      if (approval.status === "APPROVED") {
        const monthKey = day.date.slice(0, MONTH_KEY_LENGTH);
        usedByMonth[monthKey] = (usedByMonth[monthKey] || 0) + (day.paidFraction || 0);
      }
      result.push({
        date: day.date,
        leaveType: data.leaveType,
        fraction: day.fraction,
        halfDaySession: data.halfDaySession || null,
        paidFraction: day.paidFraction || 0,
        approvalId: approval.approvalId,
        status: approval.status,
      });
    }
  }
  return result;
};

/**
 * Everything needed to evaluate a month for the given employees.
 *
 * @param {object} input
 * @param {number} input.year
 * @param {number} input.month 1-12
 * @param {Array<*>} input.employeeIds ObjectIds
 * @returns {Promise<{ settings, holidays, from, to, byEmployee: Map<string, { attendanceDays, leaveDays, pendingLeaveDays, employeeShiftMinutes, joiningDate }> }>}
 */
export const loadMonthData = async ({ year, month, employeeIds }) => {
  const { from, to } = monthBounds(year, month);
  const ids = employeeIds.map((id) => new mongoose.Types.ObjectId(String(id)));
  const [settings, holidays, attendanceDays, approvals, contexts] = await Promise.all([
    getPayrollSettings(),
    loadHolidays(from, to),
    AttendanceDay.find({ employee: { $in: ids }, date: { $gte: from, $lte: to } }).lean(),
    AdminApproval.find({
      employee: { $in: ids },
      requestType: "LEAVE",
      status: { $in: ["APPROVED", "PENDING"] },
      "requestData.fromDate": { $lte: to },
      "requestData.toDate": { $gte: from },
    }).lean(),
    loadEmployeeContexts(ids),
  ]);
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));

  const byEmployee = new Map(
    ids.map((id) => [
      id.toString(),
      { attendanceDays: [], leaveDays: [], pendingLeaveDays: [], ...(contexts.get(id.toString()) || {}) },
    ])
  );
  for (const day of attendanceDays) byEmployee.get(day.employee.toString())?.attendanceDays.push(day);

  const approvalsByEmployee = new Map();
  for (const approval of approvals) {
    const key = approval.employee.toString();
    if (!approvalsByEmployee.has(key)) approvalsByEmployee.set(key, []);
    approvalsByEmployee.get(key).push(approval);
  }
  for (const [key, list] of approvalsByEmployee) {
    const entry = byEmployee.get(key);
    for (const day of leaveDaysFromApprovals(list, holidayDates, settings)) {
      if (day.date < from || day.date > to) continue;
      if (day.status === "APPROVED") entry.leaveDays.push(day);
      else entry.pendingLeaveDays.push(day);
    }
  }
  return { settings, holidays, from, to, byEmployee };
};
