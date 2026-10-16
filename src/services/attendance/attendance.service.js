/**
 * Business logic for employee attendance: punch-in / punch-out (server clock only), today's status
 * for the punch card, attendance lists and the monthly dashboard stats. Leave, punch-out
 * corrections, holidays and the calendar live in sibling files and are re-exported at the bottom
 * (the controllers import everything from here). Throws AppError subclasses on failure.
 *
 * Time rules: punch times are the SERVER's current UTC instant; the attendance date is the IST
 * date of the punch-in (helpers/istdate.helper.js). Client-sent times are ignored here; only
 * punch-out correction requests may carry a time.
 *
 * Used by: controllers/attendance/attendance.controller.js
 */
import { v6 as uuidv6 } from "uuid";
import mongoose from "mongoose";
import AttendanceDay from "../../models/attendanceday.model.js";
import Holiday from "../../models/holiday.model.js";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import { ATTENDANCE_STATUS, DAY_STATUS } from "../../constants/payrollsettings.constant.js";
import { computeStoredFields, findLeaveOnDate, toLegacyRecord } from "./attendancecommon.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ConflictError, ForbiddenError } from "../../helpers/apperror.helper.js";
import { addDays, istDateKey, istParts, monthBounds, nowUtc, weekdayOf } from "../../helpers/istdate.helper.js";
import { isDuplicateKeyError } from "../../helpers/transaction.helper.js";
import { evaluateDay, isLatePunch, isWeeklyOff, shiftMinutesFor } from "./attendancerules.js";
import { loadEmployeeContexts } from "./monthdata.service.js";
import { getPayrollSettings } from "../payroll/payrollsettings.service.js";
import { findActiveEmployeeByEmail, searchEmployeeIds } from "../employee/employeelookup.service.js";
import { getMyCalendarService } from "./calendar.service.js";

const MINUTES_PER_HOUR = 60;

/**
 * Punch in with the server clock. Refused on a full-day approved leave, and on Sundays / holidays
 * when settings.allowPunchOnOffDays is off. A second punch-in the same IST day is refused by the
 * unique (employee, date) index.
 *
 * @param {{ email: string }} user
 * @returns {Promise<object>} { date, time, punchIn, dayType, status, attendance }
 * @throws {ForbiddenError} 403 HOLIDAY_BLOCK / FULL_DAY_LEAVE
 * @throws {ConflictError} 409 ALREADY_PUNCHED_IN
 */
export const punchInService = async (user) => {
  const employee = await findActiveEmployeeByEmail(user.email);
  const settings = await getPayrollSettings();
  const now = nowUtc();
  const today = istDateKey(now);

  const holiday = await Holiday.findOne({ date: today }).select("date title").lean();
  if ((holiday || isWeeklyOff(settings, today)) && !settings.allowPunchOnOffDays) {
    throw new ForbiddenError("Today is a holiday. Punch-in is disabled.", { code: ERROR_CODES.HOLIDAY_BLOCK });
  }
  const { leave } = await findLeaveOnDate(employee._id, today, settings, new Set(holiday ? [today] : []));
  if (leave && leave.fraction === 1) {
    throw new ForbiddenError("You are on full-day leave today", { code: ERROR_CODES.FULL_DAY_LEAVE });
  }

  const contexts = await loadEmployeeContexts([employee._id]);
  const offDay = Boolean(holiday) || isWeeklyOff(settings, today);
  const shift = shiftMinutesFor(settings, weekdayOf(today), contexts.get(String(employee._id))?.employeeShiftMinutes);
  let day;
  try {
    day = await AttendanceDay.create({
      employee: employee._id,
      date: today,
      recordId: uuidv6(),
      punchIn: now,
      status: ATTENDANCE_STATUS.OPEN,
      isLate: isLatePunch(settings, now),
      expectedMinutes: offDay ? 0 : leave ? Math.round(shift / 2) : shift,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("Already punched in for today", { code: ERROR_CODES.ALREADY_PUNCHED_IN });
    }
    throw error;
  }
  const record = toLegacyRecord(day.toObject());
  return { date: today, time: now, punchIn: now, dayType: record.dayType, status: record.status, attendance: record };
};

/**
 * Punch out with the server clock for today's open session. Anything the client sends is ignored.
 * The update only matches a record that has no punch-out yet, so two fast clicks cannot both win.
 *
 * @param {{ email: string }} user
 * @returns {Promise<object>} { time, worked: { hours, minutes }, status, attendance }
 * @throws {BadRequestError} 400 NOT_PUNCHED_IN / ALREADY_PENDING_APPROVAL
 * @throws {ConflictError} 409 ALREADY_PUNCHED_OUT
 */
export const punchOutService = async (user) => {
  const employee = await findActiveEmployeeByEmail(user.email);
  const settings = await getPayrollSettings();
  const now = nowUtc();
  const today = istDateKey(now);

  const day = await AttendanceDay.findOne({ employee: employee._id, date: today }).lean();
  if (!day) {
    throw new BadRequestError("You have not punched in today", { code: ERROR_CODES.NOT_PUNCHED_IN });
  }
  if (day.punchOut) {
    throw new ConflictError("Already punched out today", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  }
  if (day.requiresAdminApproval) {
    throw new BadRequestError("A punch-out correction for today is waiting for approval", {
      code: ERROR_CODES.ALREADY_PENDING_APPROVAL,
    });
  }

  const fields = await computeStoredFields({
    employeeId: employee._id,
    date: today,
    punchIn: day.punchIn,
    punchOut: now,
    settings,
  });
  const updated = await AttendanceDay.findOneAndUpdate(
    { _id: day._id, punchOut: null },
    { $set: { punchOut: now, punchOutSource: "SELF", ...fields } },
    { new: true }
  ).lean();
  if (!updated) {
    throw new ConflictError("Already punched out today", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  }
  const record = toLegacyRecord(updated);
  return { time: now, punchOut: now, worked: record.totalWorkedTime, status: record.status, attendance: record };
};

/**
 * Everything the punch card needs: server time, today's record, expected hours (8h, 6h on
 * Saturday, half on a half-day leave, 0 on Sundays / holidays), and earlier days still missing a
 * punch-out (with whether a correction can still be requested).
 *
 * @param {{ email: string }} user
 * @returns {Promise<object>}
 */
export const getTodayStatusService = async (user) => {
  const employee = await findActiveEmployeeByEmail(user.email);
  const settings = await getPayrollSettings();
  const now = nowUtc();
  const today = istDateKey(now);
  const windowStart = addDays(today, -settings.punchOutCorrectionWindowDays);

  const [holiday, day, contexts, openDays, pendingRequests] = await Promise.all([
    Holiday.findOne({ date: today }).select("date title type").lean(),
    AttendanceDay.findOne({ employee: employee._id, date: today }).lean(),
    loadEmployeeContexts([employee._id]),
    AttendanceDay.find({ employee: employee._id, punchOut: null, date: { $lt: today }, status: { $ne: "ABSENT" } })
      .sort({ date: -1 })
      .limit(31)
      .lean(),
    AdminApproval.find({ employee: employee._id, requestType: "FORGOT_PUNCH_OUT", status: "PENDING" })
      .select("approvalId recordDate requestedPunchOutAt reason createdAt")
      .lean(),
  ]);
  const { leave, pendingLeave } = await findLeaveOnDate(employee._id, today, settings, new Set(holiday ? [today] : []));
  const context = contexts.get(String(employee._id)) || {};
  const evaluated = evaluateDay({
    date: today,
    todayKey: today,
    settings,
    holiday,
    leave,
    pendingLeave,
    attendance: day,
    employeeShiftMinutes: context.employeeShiftMinutes || null,
  });

  let state = "NOT_STARTED";
  if (day && !day.punchOut) state = "IN";
  else if (day && day.punchOut) state = "DONE";
  else if (leave && leave.fraction === 1) state = "ON_LEAVE";
  else if (holiday) state = "HOLIDAY";
  else if (isWeeklyOff(settings, today)) state = "WEEKLY_OFF";

  const pendingByDate = new Map(pendingRequests.map((request) => [request.recordDate, request]));
  return {
    serverTime: now,
    date: today,
    weekday: istParts(now).weekday,
    state,
    canPunchIn: !day && !(leave && leave.fraction === 1) && (settings.allowPunchOnOffDays || evaluated.dayKind === "WORKING"),
    canPunchOut: Boolean(day && !day.punchOut && !day.requiresAdminApproval),
    dayKind: evaluated.dayKind,
    holiday: holiday ? { date: holiday.date, title: holiday.title, type: holiday.type } : null,
    leave: evaluated.leave,
    expectedMinutes: evaluated.expectedMinutes,
    attendance: day ? toLegacyRecord(day) : null,
    rules: {
      fullDayGraceMinutes: settings.fullDayGraceMinutes,
      extraMinimumMinutes: settings.extraMinimumMinutes,
      standardShiftMinutes: settings.standardShiftMinutes,
      saturdayShiftMinutes: settings.saturdayShiftMinutes,
      punchOutCorrectionWindowDays: settings.punchOutCorrectionWindowDays,
    },
    missingPunchOuts: openDays.map((open) => ({
      attendanceId: open._id,
      date: open.date,
      punchIn: open.punchIn,
      status: open.status,
      pendingRequest: pendingByDate.get(open.date) || null,
      canRequestCorrection: open.date >= windowStart && !pendingByDate.has(open.date),
    })),
  };
};

/**
 * The logged-in employee's attendance days, newest first, in the old record shape.
 * Optional month / year filter; paginated (default 31 per page, max 400).
 *
 * @param {{ email: string }} user
 * @param {{ month?: number, year?: number, page: number, limit: number, skip: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getMyAttendancesService = async (user, { month, year, skip, limit }) => {
  const employee = await findActiveEmployeeByEmail(user.email);
  const filter = { employee: employee._id };
  if (month && year) {
    const { from, to } = monthBounds(Number(year), Number(month));
    filter.date = { $gte: from, $lte: to };
  }
  const [days, total] = await Promise.all([
    AttendanceDay.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
    AttendanceDay.countDocuments(filter),
  ]);
  return { items: days.map(toLegacyRecord), total };
};

/**
 * All employees' attendance days for admins, newest first, paginated.
 * Filters: employeeId, from, to (IST dates), status, search (name / email).
 *
 * @param {object} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getAllAttendancesService = async ({ employeeId, from, to, status, search, skip, limit }) => {
  const filter = {};
  if (employeeId) filter.employee = new mongoose.Types.ObjectId(String(employeeId));
  if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (status) filter.status = status;
  if (search) filter.employee = { $in: await searchEmployeeIds(search) };
  const [days, total] = await Promise.all([
    AttendanceDay.find(filter)
      .sort({ date: -1, punchIn: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName email role")
      .lean(),
    AttendanceDay.countDocuments(filter),
  ]);
  return { items: days.map(toLegacyRecord), total };
};

/**
 * Monthly dashboard numbers for the logged-in employee, computed with the same rules as payroll.
 * Keeps the old response keys (presentDays, absentDays, halfDays, lateDays, leaveDays,
 * leaveSummary, leaveTypeCount, totalHoursWorked) and adds extraHours, pendingDays, workingDays.
 *
 * @param {{ email: string }} user
 * @param {number} [month] 1-12, default current IST month
 * @param {number} [year]
 * @returns {Promise<object>}
 */
export const getMyAttendanceStatsService = async (user, month, year) => {
  const calendar = await getMyCalendarService(user, month, year);
  const stats = {
    presentDays: 0,
    absentDays: 0,
    halfDays: 0,
    lateDays: 0,
    leaveDays: 0,
    leaveSummary: { FULL_DAY: 0, HALF_DAY: 0 },
    leaveTypeCount: { SICK: 0, CASUAL: 0, UNPAID: 0, EMERGENCY: 0 },
    totalHoursWorked: 0,
    extraHours: 0,
    pendingDays: 0,
    workingDays: calendar.summary.workingDays,
  };
  let workedMinutes = 0;
  let extraMinutes = 0;
  for (const day of calendar.days) {
    if (day.status === DAY_STATUS.PRESENT) stats.presentDays += 1;
    if (day.status === DAY_STATUS.HALF_DAY) stats.halfDays += 1;
    if (day.units.absent) stats.absentDays += day.units.absent / 2;
    if (day.isLate) stats.lateDays += 1;
    if (day.isPending) stats.pendingDays += 1;
    if (day.leave && !day.leave.isPending) {
      stats.leaveDays += day.leave.fraction;
      if (day.leave.fraction === 1) stats.leaveSummary.FULL_DAY += 1;
      else stats.leaveSummary.HALF_DAY += 0.5;
      if (stats.leaveTypeCount[day.leave.leaveType] !== undefined) stats.leaveTypeCount[day.leave.leaveType] += day.leave.fraction;
    }
    workedMinutes += day.workedMinutes;
    extraMinutes += day.extraMinutes;
  }
  stats.totalHoursWorked = workedMinutes / MINUTES_PER_HOUR;
  stats.extraHours = extraMinutes / MINUTES_PER_HOUR;
  return { month: calendar.monthName, year: calendar.year, stats };
};

export { computeStoredFields, findLeaveOnDate, toLegacyRecord };

export {
  requestLeaveService,
  getAllLeaveRequestsForAdminService,
  updateLeaveRequestStatusService,
  getMyLeaveRequestsService,
  getLeaveRequestsByStatusService,
  cancelLeaveRequestService,
  getLeaveRequestByIdService,
  getLeaveBalanceService,
  overrideLeavePaidService,
  getTeamLeaveCalendarService,
} from "./leave.service.js";

export {
  sendPunchOutRequestService,
  getAllPunchOutRequestsForAdminService,
  updatePunchOutRequestStatusService,
  getMyPunchOutRequestsService,
  getAttendanceApprovalsByStatusService,
} from "./punchoutrequest.service.js";

export {
  createHolidayService,
  getHolidaysService,
  listHolidaysForAdminService,
  updateHolidayService,
  deleteHolidayService,
} from "./holiday.service.js";

export { getMyCalendarService };
