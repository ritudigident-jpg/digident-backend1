/**
 * HTTP handlers for leave requests: apply, list, get one, approve / reject, cancel, paid override,
 * balance and team calendar. Bodies and queries are validated in the route file (Joi).
 * Re-exported by attendance.controller.js.
 *
 * Used by: controllers/attendance/attendance.controller.js
 */
import { sendCreated, sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  cancelLeaveRequestService,
  getAllLeaveRequestsForAdminService,
  getLeaveBalanceService,
  getLeaveRequestByIdService,
  getMyLeaveRequestsService,
  getTeamLeaveCalendarService,
  overrideLeavePaidService,
  requestLeaveService,
  updateLeaveRequestStatusService,
} from "../../services/attendance/attendance.service.js";

/** POST /attendance/leave-request - totalDays is computed by the server. */
export const requestLeave = asyncHandler(async (req, res) => {
  const data = await requestLeaveService(req.user, req.body);
  return sendCreated(res, { data, message: "Leave request sent to admin for approval" });
});

/** GET /attendance/my-leave-requests?status&page&limit */
export const getMyLeaveRequests = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { items, total } = await getMyLeaveRequestsService(req.user.email, { ...req.query, ...pagination });
  return sendPaginated(res, { data: items, pagination: { ...pagination, total }, message: "My leave requests fetched successfully" });
});

/** GET /attendance/leave-request/:approvalId - owner or admin. */
export const getLeaveRequestById = asyncHandler(async (req, res) => {
  const data = await getLeaveRequestByIdService(req.currentUser, req.params.approvalId);
  return sendSuccess(res, { data, message: "Leave request fetched" });
});

/** GET /attendance/admin/leave-requests?status&search&from&to&page&limit */
export const getAllLeaveRequestsForAdmin = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { items, total } = await getAllLeaveRequestsForAdminService({ ...req.query, ...pagination });
  return sendPaginated(res, {
    data: items,
    pagination: { ...pagination, total },
    message: items.length ? "Leave requests fetched successfully" : "No leave requests found",
  });
});

/** POST /attendance/admin/leave-requests/action/:approvalId { action, note?, rejectionReason? } */
export const updateLeaveRequestStatus = asyncHandler(async (req, res) => {
  const { action, note, rejectionReason } = req.body;
  const data = await updateLeaveRequestStatusService(req.user, req.params.approvalId, action, { note, rejectionReason });
  return sendSuccess(res, { data, message: `Leave request ${action.toLowerCase()} successfully` });
});

/** DELETE /attendance/leave-request/:approvalId and POST /attendance/leave-request/:approvalId/cancel */
export const cancelLeaveRequest = asyncHandler(async (req, res) => {
  const data = await cancelLeaveRequestService(req.user.email, req.params.approvalId);
  return sendSuccess(res, { data, message: "Leave request cancelled successfully" });
});

/** GET /attendance/leave-balance?month&year */
export const getLeaveBalance = asyncHandler(async (req, res) => {
  const data = await getLeaveBalanceService(req.user, req.query.month, req.query.year);
  return sendSuccess(res, { data, message: "Leave balance fetched" });
});

/** PATCH /attendance/admin/leave-requests/:approvalId/paid { isPaid | days, note } */
export const overrideLeavePaid = asyncHandler(async (req, res) => {
  const data = await overrideLeavePaidService(req.currentUser, req.params.approvalId, req.body);
  return sendSuccess(res, { data, message: "Leave paid status updated" });
});

/** GET /attendance/admin/team-leaves?month&year&includePending&employeeId */
export const getTeamLeaveCalendar = asyncHandler(async (req, res) => {
  const data = await getTeamLeaveCalendarService(req.query);
  return sendSuccess(res, { data, message: "Team leave calendar fetched" });
});
