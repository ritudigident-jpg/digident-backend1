/**
 * HTTP handlers for shop orders: create, Razorpay payment, status, cancel, returns and refunds:
 * read the request, call the service, send the response. No business logic here.
 *
 * Exports: createOrder, verifyRazorpay, getUserOrders, getSingleOrder, cancelOrder,
 * markRefundCompleted, updateOrderStatus, getOrdersByStatus and 9 more
 * Used by: routes/orders.routes.js
 */

import {
  cancelOrderService,
  createOrderService,
  createReturnRequestService,
  getAllOrdersAdminService,
  getAllOrdersService,
  getAllReturnRequestsService,
  getOrdersByStatusService,
  getSingleOrderService,
  getUserOrdersService,
  markRefundCompleteAdminService,
  markRefundCompletedService,
  salesDashboardService,
  updateCourierDetailsService,
  updateOrderStatusService,
  updatePendingReturnRequestService,
  updateReturnRequestStatusService,
  verifyRazorpayService,
} from "../../services/order/order.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { BadRequestError, ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

export const createOrder = asyncHandler(async (req, res) => {
  const result = await createOrderService(req.body, req.currentUser);
  return sendSuccess(res, { data: result, message: "Razorpay order created" });
});

export const verifyRazorpay = asyncHandler(async (req, res) => {
  const order = await verifyRazorpayService(req.body, req.currentUser);
  return sendCreated(res, { data: { order }, message: "Payment verified and order placed" });
});

export const getUserOrders = asyncHandler(async (req, res) => {
  const result = await getUserOrdersService(req.query, req.currentUser);
  return sendSuccess(res, { data: result, message: "Orders fetched successfully" });
});

export const getSingleOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const order = await getSingleOrderService(orderId, req.currentUser);
  return sendSuccess(res, { data: { order }, message: "Order fetched successfully" });
});

export const cancelOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { reason } = req.body;
  const result = await cancelOrderService(orderId, req.currentUser, reason);
  return sendSuccess(res, { data: result, message: "Order cancelled successfully" });
});

/**
 * NOTE: markRefundCompletedService now requires currentUser (ownership check).
 * Route must run `auth` + `attachUser` middleware before this controller.
 */
export const markRefundCompleted = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  if (!orderId) {
    throw new ValidationError("orderId is required");
  }
  const refundData = await markRefundCompletedService(orderId, req.currentUser);
  return sendSuccess(res, { data: refundData, message: "Refund completed successfully" });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  if (!orderId) {
    throw new BadRequestError("orderId is required");
  }
  const validStatuses = ["placed", "packed", "confirmed", "shipped", "delivered", "cancelled"];

  if (!status || !validStatuses.includes(status)) {
    throw new BadRequestError("Invalid order status");
  }

  const result = await updateOrderStatusService({ orderId, status }, req.user);

  return sendSuccess(res, { data: result, message: "Order status updated successfully" });
});

export const getOrdersByStatus = asyncHandler(async (req, res) => {
  const { status } = req.params;
  const { page = 1, limit = 10 } = req.query;

  const validStatuses = [
    "pending",
    "placed",
    "packed",
    "confirmed",
    "shipped",
    "delivered",
    "cancelled",
    "returned",
    "partial_returned",
  ];

  if (!validStatuses.includes(status)) {
    throw new BadRequestError("Invalid order status");
  }

  const result = await getOrdersByStatusService({
    status,
    page: Number(page),
    limit: Number(limit),
  });
  return sendSuccess(res, { data: result, message: "Orders fetched successfully" });
});

export const getAllOrdersAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 10);

  const result = await getAllOrdersAdminService({ page, limit });

  return sendSuccess(res, { data: result, message: "All orders fetched successfully" });
});

export const getAllOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 10);
  const result = await getAllOrdersService({ page, limit });
  return sendSuccess(res, { data: result, message: "All orders fetched successfully" });
});

export const markRefundCompleteAdmin = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { amount } = req.body;

  if (!orderId) {
    throw new BadRequestError("orderId is required");
  }
  const result = await markRefundCompleteAdminService({ orderId, amount }, req.user);
  return sendSuccess(res, { data: result, message: "Refund completed successfully" });
});

export const salesDashboard = asyncHandler(async (req, res) => {
  const { startDate, endDate, country, state, top } = req.query;
  const data = await salesDashboardService({ startDate, endDate, country, state, top });
  return sendSuccess(res, { data, message: "Sales dashboard fetched successfully" });
});

/**
 * NOTE: createReturnRequestService now requires currentUser (ownership check
 * — a user can only create a return request for their own order).
 */
export const createReturnRequest = asyncHandler(async (req, res) => {
  const { orderId, returnItems } = req.body;
  if (!orderId || !Array.isArray(returnItems) || returnItems.length === 0) {
    throw new ValidationError("Invalid return request data");
  }
  const data = await createReturnRequestService({ orderId, returnItems }, req.currentUser);

  return sendCreated(res, { data, message: "Return request created successfully" });
});

/**
 * NOTE: updatePendingReturnRequestService now requires currentUser (ownership check).
 */
export const updatePendingReturnRequest = asyncHandler(async (req, res) => {
  const { orderId, requestId } = req.params;
  const { returnItems } = req.body;
  if (!orderId || !requestId) {
    throw new ValidationError("orderId and requestId are required");
  }
  if (!Array.isArray(returnItems)) {
    throw new ValidationError("returnItems must be an array");
  }
  const data = await updatePendingReturnRequestService({ orderId, requestId, returnItems }, req.currentUser);

  return sendSuccess(res, { data, message: "Return request updated successfully" });
});

export const getAllReturnRequests = asyncHandler(async (req, res) => {
  const data = await getAllReturnRequestsService();
  return sendSuccess(res, {
    data,
    message: data.orders.length === 0 ? "No return requests found" : "Return requests fetched successfully",
  });
});

export const updateReturnRequestStatus = asyncHandler(async (req, res) => {
  const { orderId, requestId } = req.params;
  const { status, items, permission } = req.body;
  if (!orderId || !requestId) {
    throw new ValidationError("orderId and requestId are required");
  }
  if (!["approved", "rejected"].includes(status)) {
    throw new ValidationError("Invalid status");
  }
  const data = await updateReturnRequestStatusService({
    orderId,
    requestId,
    status,
    items,
    permission,
    userEmail: req.user.email,
  });

  return sendSuccess(res, { data, message: `Return request ${status} successfully` });
});

export const updateCourierDetails = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { corourseServiceName, DOCNumber, permission } = req.body;
  if (!orderId) {
    throw new ValidationError("orderId is required");
  }
  if (!corourseServiceName && !DOCNumber) {
    throw new ValidationError("At least one field is required");
  }
  const data = await updateCourierDetailsService({
    orderId,
    corourseServiceName,
    DOCNumber,
    permission,
    userEmail: req.user.email,
  });
  return sendSuccess(res, { data, message: "Courier details updated successfully" });
});
