/**
 * HTTP handlers for forgot-to-punch-out correction requests and the combined approvals filter.
 * Bodies are validated in the route file (Joi). Re-exported by attendance.controller.js.
 *
 * Used by: controllers/attendance/attendance.controller.js
 */
import { sendCreated, sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  getAllPunchOutRequestsForAdminService,
  getAttendanceApprovalsByStatusService,
  getMyPunchOutRequestsService,
  sendPunchOutRequestService,
  updatePunchOutRequestStatusService,
} from "../../services/attendance/attendance.service.js";

/** POST /attendance/punch-out/request { date, time, reason } (or legacy { requestedPunchOut, reason }) */
export const sendPunchOutRequest = asyncHandler(async (req, res) => {
  const data = await sendPunchOutRequestService(req.user, req.body);
  return sendCreated(res, { data, message: "Punch-out approval request sent" });
});

/** GET /attendance/admin/punchout-requests?status&page&limit */
export const getAllPunchOutRequestsForAdmin = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { items, total } = await getAllPunchOutRequestsForAdminService({ ...req.query, ...pagination });
  return sendPaginated(res, {
    data: items,
    pagination: { ...pagination, total },
    message: items.length ? "Punch-out approval requests fetched successfully" : "No punch-out requests found",
  });
});

/** POST /attendance/admin/punchout-requests/action/:approvalId { action, note?, rejectionReason? } */
export const updatePunchOutRequestStatus = asyncHandler(async (req, res) => {
  const { action, note, rejectionReason } = req.body;
  const data = await updatePunchOutRequestStatusService(req.user, req.params.approvalId, action, { note, rejectionReason });
  return sendSuccess(res, { data, message: `Punch-out request ${action.toLowerCase()} successfully` });
});

/** GET /attendance/my-punchout-requests */
export const getMyPunchOutRequests = asyncHandler(async (req, res) => {
  const data = await getMyPunchOutRequestsService(req.user.email);
  return sendSuccess(res, { data, message: "My punch-out requests fetched successfully" });
});

/** GET (or POST, kept for older screens) /attendance/admin/attendance-approvals/filter?status */
export const getAttendanceApprovalsByStatus = asyncHandler(async (req, res) => {
  const status = req.query.status || req.body?.status;
  const pagination = listPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const { items, total } = await getAttendanceApprovalsByStatusService({ status, ...pagination });
  return sendPaginated(res, { data: items, pagination: { ...pagination, total }, message: "Filtered approval requests fetched" });
});
