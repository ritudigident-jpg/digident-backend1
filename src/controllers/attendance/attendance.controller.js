/**
 * HTTP handlers for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals: read the request, call the service, send the response. No business logic here.
 *
 * Exports: punchIn, punchOut, sendPunchOutRequest, getMyAttendances, getAllAttendances,
 * requestLeave, getAllLeaveRequestsForAdmin, getAllPunchOutRequestsForAdmin and 10 more
 * Used by: routes/attendance.routes.js
 */

import { sendSuccess } from "../../helpers/response.helper.js";
import {
  getAllAttendancesService,
  getMyAttendancesService,
  getMyAttendanceStatsService,
  punchInService,
  punchOutService,
} from "../../services/attendance/attendance.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { UnauthorizedError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function punchIn
 *
 * @params
 * body: none
 * auth: required (req.user.email)
 *
 * @process
 * 1. Fetch employee using `req.user.email` where `isDeleted = false`.
 *    - If not found → return 404 error.
 * 2. Get current IST time (`nowIST`) and extract today's date (`YYYY-MM-DD`).
 * 3. Fetch EmployeeRecord document:
 *    - If not exists → create new record document with empty records array.
 * 4. Check if today's attendance record exists:
 *
 *    CASE A: Record exists
 *    --------------------------------
 *    a. If `punchIn` already exists → return error (already punched in).
 *    b. If `dayType` includes "HOLIDAY" → block punch-in.
 *    c. If full-day leave → block punch-in.
 *    d. If half-day leave → allow punch-in and ensure "WORKING" is added to dayType.
 *    e. Set `punchIn = nowIST`.
 *
 *    CASE B: Record does NOT exist
 *    --------------------------------
 *    a. Create new record:
 *       - recordId (UUID)
 *       - date = today
 *       - dayType = ["WORKING"]
 *       - punchIn = nowIST
 *       - punchOut = null
 *       - status = []
 *       - totalWorkedTime = { hours: 0, minutes: 0 }
 *    b. Push into records array.
 *
 * 5. Late Mark Logic:
 *    - If time is after 09:30 AM IST:
 *      → Add "LATE" to status (avoid duplicates).
 *
 * 6. Save EmployeeRecord document.
 *
 * 7. Return success response with punch-in details.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Punch-in successful",
 *   data: {
 *     date: string,
 *     time: string,
 *     dayType: string[],
 *     status: string[]
 *   }
 * }
 *
 * @errors
 * 400 { message: "Already punched in for today", errorCode: "ALREADY_PUNCHED_IN" }
 * 403 { message: "Today is a Holiday. Punch-in disabled.", errorCode: "HOLIDAY_RESTRICTION" }
 * 403 { message: "You are on Full-Day Leave", errorCode: "FULL_DAY_LEAVE" }
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const punchIn = asyncHandler(async (req, res) => {
  // optional: if you have validation schema, plug here
  if (!req.user?.email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }
  const result = await punchInService(req.user);
  return sendSuccess(res, { data: result, message: "Punch-in successful" });
});

/**
 * @function punchOut
 *
 * @params
 * body: none
 * auth: required (req.user.email)
 *
 * @process
 * 1. Validate that `req.user.email` exists (authenticated user).
 *    - If missing → return UNAUTHORIZED error.
 * 2. Call `punchOutService(req.user)` to handle business logic:
 *    - Service handles:
 *      a. Employee lookup
 *      b. Today's attendance record validation
 *      c. Punch-in existence check
 *      d. Prevent duplicate punch-out
 *      e. Calculate totalWorkedTime
 *      f. Update punchOut time
 * 3. Return success response with updated attendance data.
 * 4. Handle errors using centralized `handleError`.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Punch-out successful",
 *   data: {
 *     date: string,
 *     punchIn: string,
 *     punchOut: string,
 *     totalWorkedTime: {
 *       hours: number,
 *       minutes: number
 *     },
 *     status: string[]
 *   }
 * }
 *
 * @errors
 * 401 { message: "Unauthorized", errorCode: "UNAUTHORIZED" }
 * 400 { message: "Punch-in not found", errorCode: "NO_PUNCH_IN" }
 * 400 { message: "Already punched out", errorCode: "ALREADY_PUNCHED_OUT" }
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 404 { message: "Attendance record not found", errorCode: "RECORD_NOT_FOUND" }
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const punchOut = asyncHandler(async (req, res) => {
  if (!req.user?.email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  const data = await punchOutService(req.user);

  return sendSuccess(res, { data, message: "Punch-out successful" });
});

/**
 * @function getMyAttendances
 *
 * @params
 * query: none
 *
 * @process
 * 1. Fetch the logged-in employee using `req.user.email`.
 * 2. If employee is not found or marked as deleted, return 404 error.
 * 3. Fetch the EmployeeRecord document for the employee.
 * 4. If no record exists:
 *    - Return success response with an empty array.
 * 5. If record exists:
 *    - Extract the `records` array (daily attendance entries).
 * 6. Return the attendance history for the employee.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Attendance history fetched successfully",
 *   data: [
 *     {
 *       recordId: string,
 *       date: string,
 *       dayType: string[],
 *       status: string[],
 *       leaveType: string | null,
 *       leaveDuration: string,
 *       leaveStatus: string | null,
 *       fromDate: string | null,
 *       toDate: string | null,
 *       leaveReason: string | null,
 *       punchIn: string | null,
 *       punchOut: string | null,
 *       totalWorkedTime: {
 *         hours: number,
 *         minutes: number
 *       },
 *       requiresAdminApproval: boolean,
 *       adminAdjusted: boolean
 *     },
 *     ...
 *   ]
 * }
 *
 * 200 (No Records) {
 *   success: true,
 *   message: "No attendance records found",
 *   data: []
 * }
 *
 * @errors
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getMyAttendances = asyncHandler(async (req, res) => {
  if (!req.user?.email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }
  const attendances = await getMyAttendancesService(req.user);
  return sendSuccess(res, {
    data: attendances,
    message: attendances.length ? "Attendance history fetched successfully" : "No attendance records found",
  });
});

/**
 * @function getAllAttendances
 *
 * @params
 * query: none
 *
 * @process
 * 1. Fetch all EmployeeRecord documents from the database.
 * 2. Populate employee details: `firstName`, `lastName`, `email`, `role`.
 * 3. Sort records by `createdAt` in descending order.
 * 4. Flatten the records:
 *    - Iterate through each EmployeeRecord.
 *    - Map each `records` array (daily entries) into individual attendance entries.
 *    - Attach employee details to each day record.
 * 5. Return the flattened list of attendance records.
 *    (Alternatively, grouped data can be returned if required.)
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All attendances fetched successfully",
 *   data: [
 *     {
 *       employee: {
 *         firstName: string,
 *         lastName: string,
 *         email: string,
 *         role: string
 *       },
 *       recordId: string,
 *       date: string,
 *       dayType: string[],
 *       status: string[],
 *       leaveType: string | null,
 *       leaveDuration: string,
 *       leaveStatus: string | null,
 *       fromDate: string | null,
 *       toDate: string | null,
 *       leaveReason: string | null,
 *       punchIn: string | null,
 *       punchOut: string | null,
 *       totalWorkedTime: {
 *         hours: number,
 *         minutes: number
 *       },
 *       requiresAdminApproval: boolean,
 *       adminAdjusted: boolean
 *     },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getAllAttendances = asyncHandler(async (req, res) => {
  const attendances = await getAllAttendancesService();

  return sendSuccess(res, {
    data: attendances,
    message: attendances.length ? "All attendances fetched successfully" : "No attendance records found",
  });
});

/**
 * @function getMyAttendanceStats
 *
 * @params
 * query: {
 *   month?: number, // optional, 1-12, defaults to current month
 *   year?: number   // optional, defaults to current year
 * }
 *
 * @process
 * 1. Fetch logged-in employee using req.user.email.
 * 2. Validate that employee exists; throw 404 if not found.
 * 3. Fetch employee's attendance record document (EmployeeRecord).
 * 4. Determine the selected month and year:
 *    - month defaults to current month
 *    - year defaults to current year
 * 5. Initialize statistics object with default counters:
 *    - presentDays, absentDays, halfDays, lateDays
 *    - leaveDays, leaveSummary (FULL_DAY/HALF_DAY)
 *    - leaveTypeCount (SICK, CASUAL, EMERGENCY)
 *    - totalHoursWorked
 * 6. Filter records for the selected month and year.
 * 7. Iterate over monthly records and compute:
 *    - Attendance counts: present, absent, half-day, late
 *    - Leave calculation including duration and type
 *    - Total worked hours from totalWorkedTime
 * 8. Format and return the statistics in a structured response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Dashboard stats fetched",
 *   data: {
 *     month: string,           // Month name, e.g., "March"
 *     year: number,            // Selected year
 *     presentDays: number,
 *     absentDays: number,
 *     halfDays: number,
 *     lateDays: number,
 *     leaveDays: number,
 *     leaveSummary: { FULL_DAY: number, HALF_DAY: number },
 *     leaveTypeCount: { SICK: number, CASUAL: number, EMERGENCY: number },
 *     totalHoursWorked: number // Total hours worked in decimal
 *   }
 * }
 *
 * @errors
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getMyAttendanceStats = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const result = await getMyAttendanceStatsService(req.user, month, year);
  return sendSuccess(res, {
    data: {
      presentDays: result.stats.presentDays,
      absentDays: result.stats.absentDays,
      halfDays: result.stats.halfDays,
      lateDays: result.stats.lateDays,
      leaveDays: Number(result.stats.leaveDays.toFixed(1)),
      leaveSummary: {
        FULL_DAY: Number(result.stats.leaveSummary.FULL_DAY.toFixed(1)),
        HALF_DAY: Number(result.stats.leaveSummary.HALF_DAY.toFixed(1)),
      },
      leaveTypeCount: {
        SICK: Number(result.stats.leaveTypeCount.SICK.toFixed(1)),
        CASUAL: Number(result.stats.leaveTypeCount.CASUAL.toFixed(1)),
        EMERGENCY: Number(result.stats.leaveTypeCount.EMERGENCY.toFixed(1)),
      },
      totalHoursWorked: Number(result.stats.totalHoursWorked.toFixed(2)),
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
  getLeaveRequestsByStatus,
  cancelLeaveRequest,
} from "./leave.controller.js";

export {
  sendPunchOutRequest,
  getAllPunchOutRequestsForAdmin,
  updatePunchOutRequestStatus,
  getMyPunchOutRequests,
  getAttendanceApprovalsByStatus,
} from "./punchoutrequest.controller.js";

export { createHoliday, getHolidays } from "./holiday.controller.js";
