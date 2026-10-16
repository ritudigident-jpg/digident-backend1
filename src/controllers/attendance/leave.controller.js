/**
 * HTTP handlers for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals: read the request, call the service, send the response. No business logic here.
 *
 * Exports: requestLeave, getAllLeaveRequestsForAdmin, updateLeaveRequestStatus,
 * getMyLeaveRequests, getLeaveRequestsByStatus, cancelLeaveRequest
 * Used by: controllers/attendance/attendance.controller.js
 */

/**
 * HTTP handlers for leave requests. Re-exported by attendance.controller.js (the routes import from there).
 */
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import {
  cancelLeaveRequestService,
  getAllLeaveRequestsForAdminService,
  getLeaveRequestsByStatusService,
  getMyLeaveRequestsService,
  requestLeaveService,
  updateLeaveRequestStatusService,
} from "../../services/attendance/attendance.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function requestLeave
 *
 * @params
 * body: {
 *   leaveType: string,
 *   leaveDuration?: string, // "FULL_DAY" | "HALF_DAY", default: "FULL_DAY"
 *   fromDate: string,       // YYYY-MM-DD
 *   toDate: string,         // YYYY-MM-DD
 *   leaveReason?: string
 * }
 *
 * @process
 * 1. Validate required fields: `leaveType`, `fromDate`, and `toDate`.
 * 2. Get current date in IST format.
 * 3. Validate that `fromDate` and `toDate` are not in the past.
 * 4. Convert `fromDate` and `toDate` into Date objects.
 *    - Return error if invalid date format.
 *    - Ensure `toDate` is not before `fromDate`.
 * 5. Fetch the logged-in employee using `req.user.email`.
 *    - Return 404 if employee not found.
 * 6. Fetch EmployeeRecord for the employee (if exists).
 * 7. Generate all dates between `fromDate` and `toDate`.
 * 8. Check if any record already exists for those dates:
 *    - If yes, return error (leave cannot be requested on existing records).
 * 9. Check for overlapping pending leave requests:
 *    - Query AdminApproval for existing PENDING leave requests
 *    - If overlapping date range found, return error.
 * 10. Create a new AdminApproval document:
 *     - requestType: "LEAVE"
 *     - recordDate: fromDate
 *     - requestData: { leaveType, leaveDuration, fromDate, toDate, leaveReason }
 *     - status: "PENDING"
 * 11. Return success response with leave request details.
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Leave request sent to admin for approval",
 *   data: {
 *     approvalId: string,
 *     leaveType: string,
 *     leaveDuration: string,
 *     fromDate: string,
 *     toDate: string,
 *     status: "PENDING"
 *   }
 * }
 *
 * @errors
 * 400 { message: "leaveType, fromDate and toDate are required", errorCode: "MISSING_FIELDS" }
 * 400 { message: "Past dates are not allowed", errorCode: "INVALID_DATE_RANGE" }
 * 400 { message: "Invalid date format", errorCode: "INVALID_DATE_FORMAT" }
 * 400 { message: "toDate cannot be before fromDate", errorCode: "INVALID_DATE_ORDER" }
 * 400 { message: "Record already exists for <date>. Cannot request leave.", errorCode: "RECORD_EXISTS" }
 * 400 { message: "A leave request for this date range is already pending", errorCode: "DUPLICATE_REQUEST" }
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const requestLeave = asyncHandler(async (req, res) => {
  const { leaveType, leaveDuration, fromDate, toDate, leaveReason } = req.body;

  if (!leaveType || !fromDate || !toDate) {
    throw new ValidationError("leaveType, fromDate and toDate are required");
  }

  const result = await requestLeaveService(req.user, {
    leaveType,
    leaveDuration,
    fromDate,
    toDate,
    leaveReason,
  });

  return sendCreated(res, { data: result, message: "Leave request sent to admin for approval" });
});

/**
 * @function getAllLeaveRequestsForAdmin
 *
 * @params
 * query: None
 *
 * @process
 * 1. Fetch all leave approval requests with:
 *    - requestType: "LEAVE"
 * 2. Populate employee details: `firstName`, `lastName`, `email`, `role`.
 * 3. Sort requests by `createdAt` in descending order.
 * 4. Map each approval to a simplified response format containing:
 *    - approvalId
 *    - employee
 *    - leaveType
 *    - leaveDuration
 *    - fromDate
 *    - toDate
 *    - leaveReason
 *    - status
 *    - actionBy
 *    - actionAt
 *    - createdAt
 * 5. Return success response with the list of leave requests.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Leave requests fetched successfully",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: { firstName: string, lastName: string, email: string, role: string },
 *       leaveType: string,
 *       leaveDuration: string,
 *       fromDate: string,
 *       toDate: string,
 *       leaveReason: string,
 *       status: string,
 *       actionBy: string | null,
 *       actionAt: string | null,
 *       createdAt: string
 *     },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getAllLeaveRequestsForAdmin = asyncHandler(async (req, res) => {
  const leaveRequests = await getAllLeaveRequestsForAdminService();

  return sendSuccess(res, {
    data: leaveRequests,
    message: leaveRequests.length ? "Leave requests fetched successfully" : "No leave requests found",
  });
});

/**
 * @function updateLeaveRequestStatus
 *
 * @params
 * params: {
 *   approvalId: string   // Unique ID of the leave approval request
 * }
 * body: {
 *   action: string       // "APPROVED" or "REJECTED"
 *   rejectionReason?: string  // Optional, required if action is "REJECTED"
 * }
 *
 * @process
 * 1. Validate that `approvalId` and valid `action` are provided.
 * 2. Find the admin performing the action using `req.user.email`.
 *    - Return 403 if admin not found.
 * 3. Fetch the leave approval request by `approvalId` and requestType "LEAVE".
 *    - Return 404 if approval not found.
 *    - Return 400 if approval is already processed (not PENDING).
 * 4. If `action` is "REJECTED":
 *    - Update approval status to REJECTED.
 *    - Save `rejectionReason`.
 *    - Return success response with updated approval.
 * 5. If `action` is "APPROVED":
 *    - Extract employee and leave details (`leaveType`, `leaveDuration`, `fromDate`, `toDate`, `leaveReason`) from the approval request.
 *    - Fetch the EmployeeRecord for the employee.
 *      - Return 404 if not found.
 *    - Generate all dates in the leave range (from `fromDate` to `toDate`).
 *    - For each date:
 *       - Check if an attendance record already exists; return 400 if exists.
 *       - Otherwise, push a new record with:
 *         - dayType: ["LEAVE"], status: ["LEAVE"], leaveType, leaveDuration, leaveStatus: "APPROVED", etc.
 *    - Save the EmployeeRecord and the approval.
 * 6. Return success response with approved leave details.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Leave request approved",
 *   data: {
 *     approvalId: string,
 *     employee: ObjectId,
 *     fromDate: string,
 *     toDate: string,
 *     leaveType: string,
 *     leaveDuration: string,
 *     status: "APPROVED",
 *     actionBy: string
 *   }
 * }
 *
 * 200 (Rejected) {
 *   success: true,
 *   message: "Leave request rejected",
 *   data: { ...updated approval object }
 * }
 *
 * @errors
 * 400 { message: "Invalid approval action", errorCode: "INVALID_ACTION" }
 * 400 { message: "Request already processed", errorCode: "ALREADY_PROCESSED" }
 * 400 { message: "Attendance already exists for <date>", errorCode: "ATTENDANCE_EXISTS" }
 * 403 { message: "Admin not found", errorCode: "ADMIN_NOT_FOUND" }
 * 404 { message: "Leave request not found", errorCode: "APPROVAL_NOT_FOUND" }
 * 404 { message: "Employee record not found", errorCode: "EMPLOYEE_RECORD_NOT_FOUND" }
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const updateLeaveRequestStatus = asyncHandler(async (req, res) => {
  const { approvalId } = req.params;
  const { action, rejectionReason } = req.body;

  if (!approvalId || !["APPROVED", "REJECTED"].includes(action)) {
    throw new BadRequestError("Invalid approval action", { code: ERROR_CODES.INVALID_ACTION });
  }

  const result = await updateLeaveRequestStatusService(req.user, approvalId, action, rejectionReason);

  return sendSuccess(res, { data: result, message: `Leave request ${action.toLowerCase()} successfully` });
});

/**
 * @function getMyLeaveRequests
 *
 * @params
 * query: none
 *
 * @process
 * 1. Fetch the logged-in employee using req.user.email.
 * 2. If employee not found or marked deleted, return 404 Employee not found.
 * 3. Query the AdminApproval collection for records with:
 *    - employee: employee._id
 *    - requestType: "LEAVE"
 * 4. Sort the requests by createdAt in descending order.
 * 5. Return the list of leave requests.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "My leave requests",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: ObjectId,
 *       requestType: "LEAVE",
 *       recordDate: string,
 *       requestData: object,
 *       status: string,
 *       actionBy: ObjectId | null,
 *       actionAt: string | null,
 *       rejectionReason: string | null,
 *       createdAt: string
 *     },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getMyLeaveRequests = asyncHandler(async (req, res) => {
  const employeeEmail = req.user.email;
  if (!employeeEmail) {
    throw new ValidationError("Employee email missing in request");
  }
  const leaveRequests = await getMyLeaveRequestsService(employeeEmail);
  return sendSuccess(res, { data: leaveRequests, message: "My leave requests fetched successfully" });
});

/**
 * @function getLeaveRequestsByStatus
 *
 * @params
 * query: {
 *   status?: string // Optional: Filter by leave status. Allowed values: "PENDING", "APPROVED", "REJECTED"
 * }
 *
 * @process
 * 1. Validate that the logged-in user is an admin.
 * 2. If not an admin, return 403 Unauthorized.
 * 3. Prepare a filter for leave requests with requestType "LEAVE".
 * 4. If status query is provided, validate it against allowed values.
 * 5. Apply the status filter if valid.
 * 6. Fetch leave requests from AdminApproval collection, populating employee and actionBy fields.
 * 7. Sort the results by createdAt in descending order.
 * 8. Map each record to include approvalId, employee details, leave type/duration/dates/reason, status, action info, rejection reason, and createdAt.
 * 9. Return the formatted leave requests list in response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Leave requests fetched successfully",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: { firstName, lastName, email, role },
 *       leaveType: string,
 *       leaveDuration: string,
 *       fromDate: string,
 *       toDate: string,
 *       leaveReason: string,
 *       status: string,
 *       actionBy: { firstName, lastName, email },
 *       actionAt: string,
 *       rejectionReason: string,
 *       createdAt: string
 *     },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 400 { message: "Invalid status filter", errorCode: "INVALID_STATUS" }
 * 403 { message: "Unauthorized", errorCode: "UNAUTHORIZED" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getLeaveRequestsByStatus = asyncHandler(async (req, res) => {
  const adminEmail = req.user.email;
  const { status } = req.query;

  if (!adminEmail) {
    throw new ForbiddenError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    throw new BadRequestError("Invalid status filter", { code: ERROR_CODES.INVALID_STATUS });
  }

  const result = await getLeaveRequestsByStatusService(adminEmail, status);

  return sendSuccess(res, { data: result, message: "Leave requests fetched successfully" });
});

/**
 * @function cancelLeaveRequest
 *
 * @params
 * path: {
 *   approvalId: string // Required: ID of the leave request to cancel
 * }
 *
 * @process
 * 1. Validate that approvalId is provided.
 * 2. Fetch logged-in employee using req.user.email.
 * 3. Throw 404 if employee not found.
 * 4. Find pending leave request for this employee and approvalId.
 * 5. Throw 404 if request not found or already processed.
 * 6. Delete the leave request.
 * 7. Return success response with cancelled approvalId.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Leave request cancelled successfully",
 *   data: { approvalId: string }
 * }
 *
 * @errors
 * 400 { message: "approvalId is required", errorCode: "MISSING_APPROVAL_ID" }
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 404 { message: "Pending leave request not found or already processed", errorCode: "LEAVE_REQUEST_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const cancelLeaveRequest = asyncHandler(async (req, res) => {
  const { approvalId } = req.params;

  if (!approvalId) {
    throw new BadRequestError("approvalId is required", { code: ERROR_CODES.MISSING_APPROVAL_ID });
  }

  const employeeEmail = req.user.email;
  const result = await cancelLeaveRequestService(employeeEmail, approvalId);
  return sendSuccess(res, { data: result, message: "Leave request cancelled successfully" });
});
