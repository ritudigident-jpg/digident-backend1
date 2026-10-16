/**
 * HTTP handlers for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals: read the request, call the service, send the response. No business logic here.
 *
 * Exports: sendPunchOutRequest, getAllPunchOutRequestsForAdmin, updatePunchOutRequestStatus,
 * getMyPunchOutRequests, getAttendanceApprovalsByStatus
 * Used by: controllers/attendance/attendance.controller.js
 */

/**
 * HTTP handlers for forgot-to-punch-out requests. Re-exported by attendance.controller.js.
 */
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import {
  getAllPunchOutRequestsForAdminService,
  getAttendanceApprovalsByStatusService,
  getMyPunchOutRequestsService,
  sendPunchOutRequestService,
  updatePunchOutRequestStatusService,
} from "../../services/attendance/attendance.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function sendPunchOutRequest
 *
 * @params
 * body: {
 *   requestedPunchOut: string // Required: DateTime (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm)
 * }
 *
 * @process
 * 1. Validate that `requestedPunchOut` is provided.
 * 2. Ensure the value contains time (HH:mm format).
 *    - Reject if only date is provided.
 * 3. Convert `requestedPunchOut` into a Date object.
 *    - Return error if invalid format.
 * 4. Validate that punch-out time is not in the future.
 * 5. Extract the date (YYYY-MM-DD) from the punch-out time.
 * 6. Ensure the request is not for a future date.
 * 7. Fetch the logged-in employee using `req.user.email`.
 *    - Return 404 if employee not found.
 * 8. Fetch EmployeeRecord for the employee.
 *    - Return 404 if not found.
 * 9. Find the attendance record for the given date.
 *    - Return error if no record found.
 * 10. Validate conditions before allowing request:
 *     - Punch-in must exist.
 *     - Punch-out must not already exist.
 *     - Day must not be a holiday.
 *     - Must not be a full-day leave.
 *     - Request must not already be sent for admin approval.
 * 11. Check if a pending punch-out request already exists:
 *     - If yes, return duplicate request error.
 * 12. Mark the record as requiring admin approval.
 * 13. Create a new AdminApproval entry:
 *     - requestType: "FORGOT_PUNCH_OUT"
 *     - recordDate: extracted date
 *     - requestData: { requestedPunchOut }
 *     - status: "PENDING"
 * 14. Save the EmployeeRecord.
 * 15. Return success response with request details.
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Punch-out approval request sent",
 *   data: {
 *     date: string,
 *     requestedPunchOut: string,
 *     status: "PENDING"
 *   }
 * }
 *
 * @errors
 * 400 { message: "Punch-out date and time is required", errorCode: "MISSING_PUNCH_OUT" }
 * 400 { message: "Punch-out must include time", errorCode: "INVALID_TIME_FORMAT" }
 * 400 { message: "Invalid punch-out time format", errorCode: "INVALID_DATE_FORMAT" }
 * 400 { message: "Punch-out time cannot be greater than current time", errorCode: "FUTURE_TIME_NOT_ALLOWED" }
 * 400 { message: "Cannot request for future date", errorCode: "FUTURE_DATE_NOT_ALLOWED" }
 * 400 { message: "No record found for this date", errorCode: "RECORD_NOT_FOUND" }
 * 400 { message: "No punch-in found for this date", errorCode: "NO_PUNCH_IN" }
 * 400 { message: "Punch-out already exists", errorCode: "ALREADY_PUNCHED_OUT" }
 * 400 { message: "This date is a holiday", errorCode: "HOLIDAY_RESTRICTION" }
 * 400 { message: "You were on full-day leave", errorCode: "FULL_DAY_LEAVE" }
 * 400 { message: "Already sent for admin approval", errorCode: "ALREADY_REQUESTED" }
 * 400 { message: "Request already pending", errorCode: "DUPLICATE_REQUEST" }
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 404 { message: "Attendance not found", errorCode: "EMPLOYEE_RECORD_NOT_FOUND" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const sendPunchOutRequest = asyncHandler(async (req, res) => {
  const { requestedPunchOut } = req.body;

  if (!requestedPunchOut) {
    throw new BadRequestError("Punch-out date and time is required", {
      code: ERROR_CODES.PUNCH_OUT_REQUIRED,
    });
  }
  const result = await sendPunchOutRequestService(req.user, requestedPunchOut);
  return sendCreated(res, { data: result, message: "Punch-out approval request sent" });
});

/**
 * @function getAllPunchOutRequestsForAdmin
 *
 * @params
 * query: None
 *
 * @process
 * 1. Fetch all punch-out approval requests with:
 *    - requestType: "FORGOT_PUNCH_OUT"
 *    - status: "PENDING"
 * 2. Populate employee details: `firstName`, `lastName`, `email`, `role`.
 * 3. Sort requests by `createdAt` in descending order.
 * 4. Map each approval to a simplified response format containing:
 *    - approvalId
 *    - employee
 *    - date (recordDate)
 *    - requestedPunchOut
 *    - status
 *    - createdAt
 * 5. Return success response with the list of requests.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Punch-out approval requests fetched successfully",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: { firstName: string, lastName: string, email: string, role: string },
 *       date: string,
 *       requestedPunchOut: string,
 *       status: string,
 *       createdAt: string
 *     },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getAllPunchOutRequestsForAdmin = asyncHandler(async (req, res) => {
  const requests = await getAllPunchOutRequestsForAdminService();

  return sendSuccess(res, {
    data: requests,
    message: requests.length
      ? "Punch-out approval requests fetched successfully"
      : "No punch-out requests found",
  });
});

/**
 * @function updatePunchOutRequestStatus
 *
 * @params
 * params: {
 *   approvalId: string   // Unique ID of the punch-out approval request
 * }
 * body: {
 *   action: string       // "APPROVED" or "REJECTED"
 *   rejectionReason?: string  // Optional, required if action is "REJECTED"
 * }
 *
 * @process
 * 1. Validate that `approvalId` is provided and `action` is valid ("APPROVED" or "REJECTED").
 * 2. Find the admin performing the action using `req.user.email`.
 *    - Return 403 if admin not found.
 * 3. Fetch the punch-out approval request by `approvalId`.
 *    - Return 404 if approval not found.
 *    - Return 400 if approval status is not PENDING.
 * 4. Update basic approval info:
 *    - Set `status` to the provided action.
 *    - Set `actionBy` to admin ID and `actionAt` to current timestamp.
 * 5. If `action` is "REJECTED":
 *    - Save `rejectionReason`.
 *    - Return success response with updated approval.
 * 6. If `action` is "APPROVED":
 *    - Extract employee, `recordDate`, and `requestedPunchOut` from approval request.
 *    - Validate `requestedPunchOut` exists.
 *    - Fetch EmployeeRecord for the employee.
 *      - Return 404 if not found.
 *    - Fetch the day record for `recordDate`.
 *      - Return 404 if not found.
 *      - Return 400 if punch-in is missing or punch-out already exists.
 *    - Apply punch-out:
 *      - Validate punch-out time format and ensure it is after punch-in.
 *      - Update `punchOut`, `requiresAdminApproval`, and `adminAdjusted`.
 *    - Recompute worked hours and status:
 *      - Calculate total hours and minutes worked.
 *      - Update `status` based on worked hours and weekday.
 *      - Update `totalWorkedTime`.
 *    - Save EmployeeRecord and AdminApproval.
 * 7. Return success response with punch-out details.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Punch-out request approved",
 *   data: {
 *     approvalId: string,
 *     employee: ObjectId,
 *     date: string,
 *     punchOut: string,
 *     worked: { hours: number, minutes: number },
 *     status: string[],
 *     actionBy: string
 *   }
 * }
 *
 * 200 (Rejected) {
 *   success: true,
 *   message: "Punch-out request rejected",
 *   data: { ...updated approval object }
 * }
 *
 * @errors
 * 400 { message: "Invalid approval action", errorCode: "INVALID_ACTION" }
 * 400 { message: "Request already processed", errorCode: "ALREADY_PROCESSED" }
 * 400 { message: "Cannot punch-out without punch-in", errorCode: "NO_PUNCH_IN" }
 * 400 { message: "Punch-out already exists", errorCode: "ALREADY_PUNCHED_OUT" }
 * 400 { message: "Invalid punch-out time", errorCode: "INVALID_PUNCH_OUT" }
 * 400 { message: "Punch-out request before punch-in not allowed", errorCode: "INVALID_PUNCH_OUT_ORDER" }
 * 403 { message: "Admin not found", errorCode: "ADMIN_NOT_FOUND" }
 * 404 { message: "Approval request not found", errorCode: "APPROVAL_NOT_FOUND" }
 * 404 { message: "Employee record not found", errorCode: "EMPLOYEE_RECORD_NOT_FOUND" }
 * 404 { message: "Day record not found", errorCode: "DAY_RECORD_NOT_FOUND" }
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const updatePunchOutRequestStatus = asyncHandler(async (req, res) => {
  const { approvalId } = req.params;
  const { action, rejectionReason } = req.body;

  if (!approvalId || !["APPROVED", "REJECTED"].includes(action)) {
    throw new BadRequestError("Invalid approval action", { code: ERROR_CODES.INVALID_ACTION });
  }

  const result = await updatePunchOutRequestStatusService(req.user, approvalId, action, rejectionReason);

  return sendSuccess(res, {
    data: result,
    message: `Punch-out request ${action.toLowerCase()} successfully`,
  });
});

/**
 * @function getMyPunchOutRequests
 *
 * @params
 * query: none
 *
 * @process
 * 1. Fetch the logged-in employee using req.user.email.
 * 2. If employee not found or marked deleted, return 404 Employee not found.
 * 3. Query the AdminApproval collection for records with:
 *    - employee: employee._id
 *    - requestType: "FORGOT_PUNCH_OUT"
 * 4. Sort the requests by createdAt in descending order.
 * 5. Return the list of punch-out requests.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "My punch-out requests",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: ObjectId,
 *       requestType: "FORGOT_PUNCH_OUT",
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
export const getMyPunchOutRequests = asyncHandler(async (req, res) => {
  const employeeEmail = req.user.email;
  if (!employeeEmail) {
    throw new ValidationError("Employee email missing in request");
  }
  const punchOutRequests = await getMyPunchOutRequestsService(employeeEmail);
  return sendSuccess(res, { data: punchOutRequests, message: "My punch-out requests fetched successfully" });
});

/**
 * @function getAttendanceApprovalsByStatus
 *
 * @params
 * body: {
 *   status?: string // Optional: Filter by approval status. Allowed values: "PENDING", "APPROVED", "REJECTED"
 * }
 *
 * @process
 * 1. Validate that the logged-in user is an admin.
 * 2. If not an admin, return 403 Unauthorized.
 * 3. Prepare a filter object for AdminApproval requests.
 * 4. If status is provided, validate it and add to the filter.
 * 5. Fetch approval requests from AdminApproval collection, populating employee and actionBy details.
 * 6. Sort results by createdAt in descending order.
 * 7. Map each record to include approvalId, employee info, request type, record date, request data, status, actionBy info, actionAt, rejectionReason, createdAt.
 * 8. Return the filtered approval requests in the response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Filtered approval requests fetched",
 *   data: [
 *     {
 *       approvalId: string,
 *       employee: { firstName, lastName, email, role },
 *       requestType: string,
 *       recordDate: string,
 *       requestData: object,
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
export const getAttendanceApprovalsByStatus = asyncHandler(async (req, res) => {
  const { status } = req.body; // PENDING | APPROVED | REJECTED
  const adminEmail = req.user.email;

  if (!adminEmail) {
    throw new ForbiddenError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  if (status && !["PENDING", "APPROVED", "REJECTED"].includes(status)) {
    throw new BadRequestError("Invalid status filter", { code: ERROR_CODES.INVALID_STATUS });
  }

  const approvals = await getAttendanceApprovalsByStatusService(adminEmail, status);

  return sendSuccess(res, { data: approvals, message: "Filtered approval requests fetched" });
});
