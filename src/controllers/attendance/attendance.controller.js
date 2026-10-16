/**
 * HTTP handlers for punch-in / punch-out, today's status, attendance lists, calendar and dashboard
 * stats: read the request, call the service, send the response. No business logic here.
 * Leave, punch-out correction and holiday handlers are re-exported at the bottom.
 *
 * Used by: routes/attendance.routes.js
 */
import { sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  getAllAttendancesService,
  getMyAttendancesService,
  getMyAttendanceStatsService,
  getMyCalendarService,
  getTodayStatusService,
  punchInService,
  punchOutService,
} from "../../services/attendance/attendance.service.js";

/** POST /attendance/punch-in - body ignored; the server clock is used. */
export const punchIn = asyncHandler(async (req, res) => {
  const data = await punchInService(req.user);
  return sendSuccess(res, { data, message: "Punch-in successful" });
});

/** POST /attendance/punch-out - body ignored (a client punchOutTime is never trusted). */
export const punchOut = asyncHandler(async (req, res) => {
  const data = await punchOutService(req.user);
  return sendSuccess(res, { data, message: "Punch-out successful" });
});

/** GET /attendance/today - punch card state, expected hours and days missing a punch-out. */
export const getTodayStatus = asyncHandler(async (req, res) => {
  const data = await getTodayStatusService(req.user);
  return sendSuccess(res, { data, message: "Today's attendance fetched" });
});

/** GET /attendance/my-attendance?month&year&page&limit - own attendance days (old record shape). */
export const getMyAttendances = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 62, maxLimit: 400 });
  const { items, total } = await getMyAttendancesService(req.user, { ...req.query, ...pagination });
  return sendPaginated(res, {
    data: items,
    pagination: { ...pagination, total },
    message: items.length ? "Attendance history fetched successfully" : "No attendance records found",
  });
});

/** GET /attendance/admin/attendances?employeeId&from&to&status&search&page&limit */
export const getAllAttendances = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const { items, total } = await getAllAttendancesService({ ...req.query, ...pagination });
  return sendPaginated(res, {
    data: items,
    pagination: { ...pagination, total },
    message: items.length ? "All attendances fetched successfully" : "No attendance records found",
  });
});

/** GET /attendance/my-calendar?month&year - day-by-day calendar with holidays, leave and status. */
export const getMyCalendar = asyncHandler(async (req, res) => {
  const data = await getMyCalendarService(req.user, req.query.month, req.query.year);
  return sendSuccess(res, { data, message: "Calendar fetched" });
});

/** GET /attendance/my-dashboard?month&year - monthly counters (old keys kept). */
export const getMyAttendanceStats = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const result = await getMyAttendanceStatsService(req.user, month, year);
  const round = (value, digits = 1) => Number(value.toFixed(digits));
  const stats = result.stats;
  return sendSuccess(res, {
    data: {
      presentDays: stats.presentDays,
      absentDays: round(stats.absentDays),
      halfDays: stats.halfDays,
      lateDays: stats.lateDays,
      leaveDays: round(stats.leaveDays),
      leaveSummary: { FULL_DAY: round(stats.leaveSummary.FULL_DAY), HALF_DAY: round(stats.leaveSummary.HALF_DAY) },
      leaveTypeCount: Object.fromEntries(Object.entries(stats.leaveTypeCount).map(([key, value]) => [key, round(value)])),
      totalHoursWorked: round(stats.totalHoursWorked, 2),
      extraHours: round(stats.extraHours, 2),
      pendingDays: stats.pendingDays,
      workingDays: stats.workingDays,
      month: result.month,
      year: result.year,
    },
    message: "Attendance dashboard stats fetched",
  });
});

export {
  requestLeave,
  getAllLeaveRequestsForAdmin,
  updateLeaveRequestStatus,
  getMyLeaveRequests,
  getLeaveRequestById,
  cancelLeaveRequest,
  getLeaveBalance,
  overrideLeavePaid,
  getTeamLeaveCalendar,
} from "./leave.controller.js";

export {
  sendPunchOutRequest,
  getAllPunchOutRequestsForAdmin,
  updatePunchOutRequestStatus,
  getMyPunchOutRequests,
  getAttendanceApprovalsByStatus,
} from "./punchoutrequest.controller.js";

export { createHoliday, getHolidays, listHolidaysForAdmin, updateHoliday, deleteHoliday } from "./holiday.controller.js";
