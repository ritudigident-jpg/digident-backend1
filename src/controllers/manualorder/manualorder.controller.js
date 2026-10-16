/**
 * HTTP handlers for orders typed in by staff (phone / walk-in sales): read the request, call the
 * service, send the response. No business logic here.
 *
 * Exports: createManualOrder, getManualOrder, getAllManualOrders, updateManualOrderStatus,
 * updateManualOrderPaymentStatus, cancelManualOrder, createManualReturn, getManualOrderAnalytics
 * and 2 more
 * Used by: routes/manualorders.routes.js
 */

import {
  createManualOrderService,
  getManualOrderService,
  getAllManualOrdersService,
  updateManualOrderStatusService,
  updateManualOrderPaymentStatusService,
  cancelManualOrderService,
  createManualReturnService,
  updateManualOrderCourierService,
  getManualOrderAnalyticsService,
  getCustomerBalanceLedgerService,
} from "../../services/manualorder/manualorder.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { BadRequestError, ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createManualOrder
 * @description Staff creates an order entirely from frontend-entered data —
 * no Product/User/Coupon lookup happens. Frontend sends productName + price
 * directly, and address is typed manually too.
 *
 * body: {
 *   customerName: string,
 *   customerPhone: string,
 *   customerEmail?: string,
 *   items: [{ productName, variantName?, sku?, price, quantity, notes? }],
 *   shippingAddress: { fullName, phone, street?, area?, city?, state?, country?, pincode? },
 *   billingAddress?: object (defaults to shippingAddress),
 *   organizationName?, gstNumber?, gstAmount?, gstPercentage?,
 *   discount?, shippingCharge?,
 *   paymentStatus: "paid" | "pending",
 *   paymentMethod?: "cash"|"upi"|"bank_transfer"|"cheque"|"card"|"other",
 *   paymentReference?, notes?
 * }
 */
export const createManualOrder = asyncHandler(async (req, res) => {
  const { customerName, customerPhone, items, shippingAddress, paymentStatus } = req.body;

  if (!customerName || !customerPhone) {
    throw new ValidationError("customerName and customerPhone are required");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError("items are required");
  }
  if (!shippingAddress || typeof shippingAddress !== "object") {
    throw new ValidationError("shippingAddress is required");
  }
  if (!["paid", "pending"].includes(paymentStatus)) {
    throw new ValidationError('paymentStatus must be "paid" or "pending"');
  }

  const order = await createManualOrderService(req.body, req.user);
  return sendCreated(res, { data: { order }, message: "Manual order created successfully" });
});

export const getManualOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const order = await getManualOrderService(orderId);
  return sendSuccess(res, { data: { order }, message: "Manual order fetched successfully" });
});

export const getAllManualOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.max(1, Number(req.query.limit) || 10);
  const result = await getAllManualOrdersService({ page, limit });
  return sendSuccess(res, { data: result, message: "Manual orders fetched successfully" });
});

export const updateManualOrderStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ["placed", "packed", "confirmed", "shipped", "delivered", "cancelled"];
  if (!orderId) throw new BadRequestError("orderId is required");
  if (!status || !validStatuses.includes(status)) {
    throw new BadRequestError("Invalid order status");
  }

  const result = await updateManualOrderStatusService({ orderId, status }, req.user);
  return sendSuccess(res, { data: result, message: "Manual order status updated successfully" });
});

export const updateManualOrderPaymentStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { paymentStatus, paymentMethod, paymentReference } = req.body;

  if (!orderId) throw new BadRequestError("orderId is required");
  if (!["paid", "pending"].includes(paymentStatus)) {
    throw new BadRequestError('paymentStatus must be "paid" or "pending"');
  }

  const result = await updateManualOrderPaymentStatusService(
    { orderId, paymentStatus, paymentMethod, paymentReference },
    req.user
  );
  return sendSuccess(res, { data: result, message: "Manual order payment status updated successfully" });
});

export const cancelManualOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { reason } = req.body;
  const result = await cancelManualOrderService(orderId, req.user, reason);
  return sendSuccess(res, { data: result, message: "Manual order cancelled successfully" });
});

/**
 * @function createManualReturn
 * body: {
 *   orderId: string,
 *   returnItems: [{ productName, variantName?, quantity, reason? }],
 *   refundNow: boolean,
 *   refundMethod?: "cash"|"upi"|"bank_transfer"|"card"|"other" (required if refundNow),
 *   notes?: string
 * }
 */
export const createManualReturn = asyncHandler(async (req, res) => {
  const { orderId, returnItems } = req.body;
  if (!orderId) {
    throw new ValidationError("orderId is required");
  }
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new ValidationError("returnItems are required");
  }

  const data = await createManualReturnService(req.body, req.user);
  return sendCreated(res, { data, message: "Manual return recorded successfully" });
});

/**
 * @function getManualOrderAnalytics
 * @description Aggregated analytics for manual orders — used to power
 * dashboard graphs (total orders/revenue, top selling products, sales
 * by city/state/country, order & payment status breakdowns, and a
 * date-wise trend for a line/bar chart).
 *
 * query: {
 *   startDate?: ISO date string,
 *   endDate?: ISO date string,
 *   topLimit?: number (default 10) - how many top products to return,
 *   locationLimit?: number (default 10) - how many top cities/states/countries,
 *   includeCancelled?: "true" | "false" (default false),
 *   groupBy?: "day" | "month" (default "day") - trend bucket size
 * }
 */
export const getManualOrderAnalytics = asyncHandler(async (req, res) => {
  const data = await getManualOrderAnalyticsService(req.query);
  return sendSuccess(res, { data, message: "Manual order analytics fetched successfully" });
});

/**
 * @function getCustomerBalanceLedger
 * @description Per-customer return & balance ledger — for every customer,
 * shows total orders, total returned value, and whether the company owes
 * the customer a refund or the customer still owes the company money.
 *
 * query: {
 *   startDate?: ISO date string,
 *   endDate?: ISO date string,
 *   search?: string - matches customer name / phone / email,
 *   balanceStatus?: "customer_owes" | "company_owes" | "settled",
 *   sortBy?: "netBalance" (default) | "name" | "recent"
 * }
 */
export const getCustomerBalanceLedger = asyncHandler(async (req, res) => {
  const data = await getCustomerBalanceLedgerService(req.query);
  return sendSuccess(res, { data, message: "Customer balance ledger fetched successfully" });
});

export const updateManualOrderCourier = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { corourseServiceName, DOCNumber } = req.body;

  if (!orderId) {
    throw new ValidationError("orderId is required");
  }
  if (!corourseServiceName && !DOCNumber) {
    throw new ValidationError("At least one field is required");
  }

  const data = await updateManualOrderCourierService({ orderId, corourseServiceName, DOCNumber }, req.user);
  return sendSuccess(res, { data, message: "Courier details updated successfully" });
});

// NOTE: Credit note settlement and the credit notes list have moved to the
// invoice controller/routes, since credit notes are now tracked entirely
// on the Invoice model (common across manual orders and ecommerce orders):
//   PUT /api/invoice/manage/credit-settle/:invoiceId   -> settleInvoiceCredit
//   GET /api/invoice/manage/credit-notes/:permission   -> getInvoiceCreditNotes
