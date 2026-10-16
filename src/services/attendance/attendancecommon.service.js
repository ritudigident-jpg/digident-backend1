/**
 * Shared attendance helpers used by the punch, correction and leave services:
 * the old record shape for existing screens, leave lookup for one date, and the cached fields
 * (worked / expected / extra minutes, status) stored on an AttendanceDay after its punch-out.
 *
 * Exports: toLegacyRecord, findLeaveOnDate, computeStoredFields
 * Used by: services/attendance/attendance.service.js, services/attendance/punchoutrequest.service.js
 */
import Holiday from "../../models/holiday.model.js";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import { ATTENDANCE_STATUS, DAY_STATUS } from "../../constants/payrollsettings.constant.js";
import { addDays } from "../../helpers/istdate.helper.js";
import { evaluateDay } from "./attendancerules.js";
import { leaveDaysFromApprovals, loadEmployeeContexts } from "./monthdata.service.js";

const STATUS_TO_LEGACY = {
  PRESENT: ["PRESENT"],
  HALF_DAY: ["HALF_DAY"],
  ABSENT: ["ABSENT"],
  MISSING_PUNCH_OUT: ["MISSING_PUNCH_OUT"],
  OPEN: [],
};

/**
 * An AttendanceDay in the shape the old screens read (dayType / status arrays / totalWorkedTime)
 * plus the new fields.
 *
 * @param {object} day AttendanceDay (lean or document)
 * @returns {object}
 */
export const toLegacyRecord = (day) => {
  const status = [...(STATUS_TO_LEGACY[day.status] || [])];
  if (day.isLate) status.push("LATE");
  return {
    _id: day._id,
    attendanceId: day._id,
    recordId: day.recordId,
    employee: day.employee,
    date: day.date,
    dayType: ["WORKING"],
    punchIn: day.punchIn,
    punchOut: day.punchOut,
    status,
    attendanceStatus: day.status,
    isLate: Boolean(day.isLate),
    workedMinutes: day.workedMinutes || 0,
    expectedMinutes: day.expectedMinutes || 0,
    extraMinutes: day.extraMinutes || 0,
    extraApproved: Boolean(day.extraApproved),
    totalWorkedTime: { hours: Math.floor((day.workedMinutes || 0) / 60), minutes: (day.workedMinutes || 0) % 60 },
    punchOutSource: day.punchOutSource || null,
    leaveType: null,
    leaveDuration: "FULL_DAY",
    fromDate: null,
    toDate: null,
    leaveStatus: null,
    leaveReason: null,
    requiresAdminApproval: Boolean(day.requiresAdminApproval),
    adminAdjusted: Boolean(day.adminAdjusted),
  };
};

/**
 * Approved and pending leave of one employee on one date (null when none).
 *
 * @param {*} employeeId
 * @param {string} date
 * @param {object} settings
 * @param {Set<string>} holidayDates
 * @returns {Promise<{ leave: object | null, pendingLeave: object | null }>}
 */
export const findLeaveOnDate = async (employeeId, date, settings, holidayDates) => {
  const approvals = await AdminApproval.find({
    employee: employeeId,
    requestType: "LEAVE",
    status: { $in: ["APPROVED", "PENDING"] },
    "requestData.fromDate": { $lte: date },
    "requestData.toDate": { $gte: date },
  }).lean();
  const days = leaveDaysFromApprovals(approvals, holidayDates, settings).filter((day) => day.date === date);
  return {
    leave: days.find((day) => day.status === "APPROVED") || null,
    pendingLeave: days.find((day) => day.status === "PENDING") || null,
  };
};

/**
 * The cached fields stored on an AttendanceDay once its punch-out is known.
 *
 * @param {object} input
 * @returns {Promise<{ workedMinutes, expectedMinutes, extraMinutes, status }>}
 */
export const computeStoredFields = async ({ employeeId, date, punchIn, punchOut, settings }) => {
  const holiday = await Holiday.findOne({ date }).select("date title").lean();
  const holidayDates = new Set(holiday ? [date] : []);
  const [{ leave }, contexts] = await Promise.all([
    findLeaveOnDate(employeeId, date, settings, holidayDates),
    loadEmployeeContexts([employeeId]),
  ]);
  const context = contexts.get(String(employeeId)) || {};
  const evaluated = evaluateDay({
    date,
    todayKey: addDays(date, 1),
    settings,
    holiday,
    leave,
    attendance: { punchIn, punchOut },
    employeeShiftMinutes: context.employeeShiftMinutes || null,
  });
  let status = ATTENDANCE_STATUS.PRESENT;
  if (evaluated.status === DAY_STATUS.HALF_DAY || evaluated.units.short > 0) status = ATTENDANCE_STATUS.HALF_DAY;
  if (evaluated.status === DAY_STATUS.ABSENT) status = ATTENDANCE_STATUS.ABSENT;
  return {
    workedMinutes: evaluated.workedMinutes,
    expectedMinutes: evaluated.expectedMinutes,
    extraMinutes: evaluated.extraMinutes,
    status,
  };
};

