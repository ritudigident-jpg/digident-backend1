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
  settleOrderRefundService,
} from "../services/manualOrder.service.js";
import { sendError, handleError } from "../helpers/error.helper.js";
import { sendSuccess } from "../helpers/response.helper.js";

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
export const createManualOrder = async (req, res) => {
  try {
    const { customerName, customerPhone, items, shippingAddress, paymentStatus } = req.body;

    if (!customerName || !customerPhone) {
      return sendError(res, {
        message: "customerName and customerPhone are required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendError(res, {
        message: "items are required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }
    if (!shippingAddress || typeof shippingAddress !== "object") {
      return sendError(res, {
        message: "shippingAddress is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }
    if (!["paid", "pending"].includes(paymentStatus)) {
      return sendError(res, {
        message: 'paymentStatus must be "paid" or "pending"',
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }

    const order = await createManualOrderService(req.body, req.user);
    return sendSuccess(res, { order }, 201, "Manual order created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const getManualOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const order = await getManualOrderService(orderId);
    return sendSuccess(res, { order }, 200, "Manual order fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const getAllManualOrders = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Number(req.query.limit) || 10);
    const result = await getAllManualOrdersService({ page, limit });
    return sendSuccess(res, result, 200, "Manual orders fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateManualOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;

    const validStatuses = ["placed", "packed", "confirmed", "shipped", "delivered", "cancelled"];
    if (!orderId) return sendError(res, { message: "orderId is required", statusCode: 400 });
    if (!status || !validStatuses.includes(status)) {
      return sendError(res, { message: "Invalid order status", statusCode: 400 });
    }

    const result = await updateManualOrderStatusService({ orderId, status }, req.user);
    return sendSuccess(res, result, 200, "Manual order status updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateManualOrderPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { paymentStatus, paymentMethod, paymentReference } = req.body;

    if (!orderId) return sendError(res, { message: "orderId is required", statusCode: 400 });
    if (!["paid", "pending"].includes(paymentStatus)) {
      return sendError(res, { message: 'paymentStatus must be "paid" or "pending"', statusCode: 400 });
    }

    const result = await updateManualOrderPaymentStatusService(
      { orderId, paymentStatus, paymentMethod, paymentReference },
      req.user
    );
    return sendSuccess(res, result, 200, "Manual order payment status updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const cancelManualOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;
    const result = await cancelManualOrderService(orderId, req.user, reason);
    return sendSuccess(res, result, 200, "Manual order cancelled successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const createManualReturn = async (req, res) => {
  try {
    const { orderId, returnItems } = req.body;
    if (!orderId) {
      return sendError(res, { message: "orderId is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    if (!Array.isArray(returnItems) || returnItems.length === 0) {
      return sendError(res, { message: "returnItems are required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }

    const data = await createManualReturnService(req.body, req.user);
    return sendSuccess(res, data, 201, "Manual return recorded successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getManualOrderAnalytics = async (req, res) => {
  try {
    const data = await getManualOrderAnalyticsService(req.query);
    return sendSuccess(res, data, 200, "Manual order analytics fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getCustomerBalanceLedger = async (req, res) => {
  try {
    const data = await getCustomerBalanceLedgerService(req.query);
    return sendSuccess(res, data, 200, "Customer balance ledger fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function settleOrderCredit
 * @description Marks part or all of a pending refund on an order as
 * settled — either an actual cash/UPI/bank payout ("I've physically
 * refunded this"), or store credit applied to a new order ("customer will
 * take it next time"). This is the only way a "refund_pending" /
 * "partial_refunded" order can move to "refunded" once the return itself
 * has already been recorded.
 *
 * body: {
 *   amount: number,
 *   method?: "cash"|"upi"|"bank_transfer"|"card"|"other"|"credit_note" (default "credit_note"),
 *   reference?: string,       // payment reference, for cash-style methods
 *   appliedToOrderId?: string, // the new order this credit was used on
 *   notes?: string
 * }
 */
export const settleOrderCredit = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { amount, method, reference, appliedToOrderId, notes } = req.body;

    if (!orderId) {
      return sendError(res, { message: "orderId is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    if (!amount || Number(amount) <= 0) {
      return sendError(res, { message: "amount must be a positive number", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }

    const data = await settleOrderRefundService(
      { orderId, amount, method, reference, appliedToOrderId, notes },
      req.user
    );
    return sendSuccess(res, data, 200, "Refund settled successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateManualOrderCourier = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { corourseServiceName, DOCNumber } = req.body;

    if (!orderId) {
      return sendError(res, { message: "orderId is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    if (!corourseServiceName && !DOCNumber) {
      return sendError(res, { message: "At least one field is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }

    const data = await updateManualOrderCourierService({ orderId, corourseServiceName, DOCNumber }, req.user);
    return sendSuccess(res, data, 200, "Courier details updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};
