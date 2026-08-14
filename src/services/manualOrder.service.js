import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
import Employee from "../models/manage/employee.model.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";
import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
import { sendNotification } from "./notification.service.js";
import { sendZohoMail } from "./ZohoEmail/zohoMail.service.js";
import { orderConfirmationTemplate } from "../config/templates/orderConfirmationTemplate.js";

const requiredAddrFields = ["fullName", "phone"]; // street/city/etc optional since it's manual

/* =========================================================
   CREATE MANUAL ORDER — everything comes from frontend directly,
   nothing is looked up against Product/User/Coupon collections.
========================================================= */
export const createManualOrderService = async (data, currentUser) => {
  /* ---------- EMPLOYEE (only DB reference we keep, for audit) ---------- */
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    error.errorCode = "EMPLOYEE_NOT_FOUND";
    throw error;
  }

  const {
    customerName,
    customerPhone,
    customerEmail,
    items: rawItems,
    shippingAddress,
    billingAddress,
    organizationName,
    gstNumber,
    gstAmount = 0,
    gstPercentage = 0,
    discount = 0,
    shippingCharge = 0,
    paymentStatus,
    paymentMethod,
    paymentReference,
    notes,
  } = data;

  /* ---------- CUSTOMER VALIDATION ---------- */
  if (!customerName || !customerPhone) {
    const error = new Error("customerName and customerPhone are required");
    error.statusCode = 400;
    error.errorCode = "VALIDATION_ERROR";
    throw error;
  }

  /* ---------- PAYMENT VALIDATION ---------- */
  const allowedPaymentStatuses = ["paid", "pending"];
  if (!paymentStatus || !allowedPaymentStatuses.includes(paymentStatus)) {
    const error = new Error(`paymentStatus must be one of: ${allowedPaymentStatuses.join(", ")}`);
    error.statusCode = 400;
    error.errorCode = "INVALID_PAYMENT_STATUS";
    throw error;
  }

  if (paymentStatus === "paid") {
    const allowedMethods = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
    if (!paymentMethod || !allowedMethods.includes(paymentMethod)) {
      const error = new Error(
        `paymentMethod is required and must be one of: ${allowedMethods.join(", ")} when paymentStatus is "paid"`
      );
      error.statusCode = 400;
      error.errorCode = "INVALID_PAYMENT_METHOD";
      throw error;
    }
  }

  /* ---------- ITEMS (name + price sent directly, no lookup) ---------- */
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    const error = new Error("items are required");
    error.statusCode = 400;
    error.errorCode = "INVALID_ITEMS";
    throw error;
  }

  let subtotal = 0;
  const items = [];

  for (const item of rawItems) {
    const { productName, variantName, sku, price, quantity, notes: itemNotes } = item;

    if (!productName || !productName.trim()) {
      const error = new Error("productName is required for every item");
      error.statusCode = 400;
      error.errorCode = "INVALID_ITEM_DATA";
      throw error;
    }
    if (price == null || Number.isNaN(Number(price)) || Number(price) <= 0) {
      const error = new Error(`Invalid price for item "${productName}"`);
      error.statusCode = 400;
      error.errorCode = "INVALID_PRICE";
      throw error;
    }
    if (!quantity || Number(quantity) <= 0) {
      const error = new Error(`Invalid quantity for item "${productName}"`);
      error.statusCode = 400;
      error.errorCode = "INVALID_QUANTITY";
      throw error;
    }

    const itemPrice = Number(price);
    const itemQty = Number(quantity);
    subtotal += itemPrice * itemQty;

    items.push({
      productName: productName.trim(),
      variantName: variantName?.trim() || "",
      sku: sku?.trim() || "",
      price: itemPrice,
      quantity: itemQty,
      notes: itemNotes?.trim() || "",
    });
  }

  /* ---------- ADDRESS (typed directly, no lookup) ---------- */
  if (!shippingAddress || typeof shippingAddress !== "object") {
    const error = new Error("shippingAddress is required");
    error.statusCode = 400;
    error.errorCode = "ADDRESS_REQUIRED";
    throw error;
  }
  for (const field of requiredAddrFields) {
    if (!shippingAddress[field]) {
      const error = new Error(`shippingAddress.${field} is required`);
      error.statusCode = 400;
      error.errorCode = "INVALID_ADDRESS";
      throw error;
    }
  }

  const finalBillingAddress = billingAddress && typeof billingAddress === "object"
    ? billingAddress
    : shippingAddress;

  /* ---------- CALCULATION (no coupon) ---------- */
  const finalDiscount = Math.max(Number(discount) || 0, 0);
  const finalShippingCharge = Math.max(Number(shippingCharge) || 0, 0);
  const finalGstAmount = Math.max(Number(gstAmount) || 0, 0);

  const grandTotal = Math.max(subtotal + finalShippingCharge + finalGstAmount - finalDiscount, 0);
  if (grandTotal <= 0) {
    const error = new Error("Invalid order amount");
    error.statusCode = 400;
    error.errorCode = "INVALID_ORDER_AMOUNT";
    throw error;
  }

  /* ---------- CREATE ORDER ---------- */
  const orderId = `MORD-${uuidv6()}`;
  const now = new Date();

  const order = await ManualOrder.create({
    orderId,
    customerName: customerName.trim(),
    customerPhone: customerPhone.trim(),
    customerEmail: customerEmail?.trim() || null,
    items,
    shippingCharge: finalShippingCharge,
    discount: finalDiscount,
    grandTotal,
    billingAddress: finalBillingAddress,
    shippingAddress,
    organizationName: organizationName || null,
    gstAmount: finalGstAmount,
    gstPercentage: Number(gstPercentage) || 0,
    gstNumber: gstNumber || null,
    paymentStatus,
    paymentMethod: paymentStatus === "paid" ? paymentMethod : null,
    paymentReference: paymentReference || null,
    paidAt: paymentStatus === "paid" ? now : null,
    orderStatus: "placed",
    statusUpdatedAt: now,
    notes: notes || null,
    createdBy: employee._id,
  });

  /* ---------- AUDIT LOG ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    actionForEmail: order.customerEmail,
    permission: "manual_order_create",
    action: "create",
    meta: {
      orderId: order.orderId,
      grandTotal: order.grandTotal,
      paymentStatus: order.paymentStatus,
    },
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "sales.order.update",
      title: "Manual Order Created",
      message: `Manual order ${order.orderId} created by ${employee.email}`,
      type: "MANUAL_ORDER_CREATED",
      entityId: order._id,
      entityModel: "ManualOrder",
      metadata: {
        orderId: order.orderId,
        createdBy: employee.email,
        paymentStatus: order.paymentStatus,
      },
    });
  } catch (err) {
    console.error("Notification failed on manual order create:", err.message);
  }

  /* ---------- EMAIL (non-blocking, only if email given) ---------- */
  if (order.customerEmail) {
    try {
      const emailHtml = orderConfirmationTemplate(
        order.customerName,
        order.orderId,
        order.grandTotal,
        order.items
      );
      await sendZohoMail(order.customerEmail, "Order Confirmed", emailHtml);
    } catch (err) {
      console.log("EMAIL ERROR (manual order):", err.message);
    }
  }

  return order;
};

/* =========================================================
   GET SINGLE MANUAL ORDER
========================================================= */
export const getManualOrderService = async (orderId) => {
  if (!orderId) {
    const error = new Error("orderId is required");
    error.statusCode = 400;
    throw error;
  }
  const order = await ManualOrder.findOne({ orderId })
    .populate("createdBy", "email firstName lastName")
    .lean();
  if (!order) {
    const error = new Error("Manual order not found");
    error.statusCode = 404;
    throw error;
  }
  return order;
};

/* =========================================================
   GET ALL MANUAL ORDERS (paginated)
========================================================= */
export const getAllManualOrdersService = async ({ page = 1, limit = 10 }) => {
  const skip = (page - 1) * limit;
  const [orders, total] = await Promise.all([
    ManualOrder.find()
      .populate("createdBy", "email firstName lastName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ManualOrder.countDocuments(),
  ]);

  return {
    orders,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/* =========================================================
   UPDATE MANUAL ORDER STATUS
========================================================= */
export const updateManualOrderStatusService = async (data, currentUser) => {
  const { orderId, status } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    const err = new Error("Manual order not found");
    err.statusCode = 404;
    throw err;
  }

  const currentStatus = order.orderStatus;

  if (["cancelled", "returned"].includes(currentStatus)) {
    const err = new Error(`Order cannot be updated because it is already ${currentStatus}`);
    err.statusCode = 400;
    throw err;
  }

  const statusFlow = {
    placed: ["packed", "confirmed", "shipped"],
    packed: ["confirmed", "shipped"],
    confirmed: ["shipped"],
    shipped: ["delivered"],
  };

  if (currentStatus === status) {
    const err = new Error(`Order already in status ${status}`);
    err.statusCode = 400;
    throw err;
  }

  const allowedNextStatuses = statusFlow[currentStatus] || [];
  if (!allowedNextStatuses.includes(status)) {
    const err = new Error(`Invalid status update: cannot change from "${currentStatus}" to "${status}"`);
    err.statusCode = 400;
    throw err;
  }

  order.orderStatus = status;
  order.statusUpdatedAt = new Date();
  if (status === "delivered" && order.paymentStatus === "pending") {
    order.paymentStatus = "paid";
    order.paidAt = new Date();
  }

  await order.save();

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    permission: "update_manual_order_status",
    action: "update",
    meta: { from: currentStatus, to: status },
  });

  try {
    await sendNotification({
      sender: employee._id,
      permission: "sales.order.update",
      title: "Manual Order Status Updated",
      message: `Manual order ${order.orderId} status updated to ${status}`,
      type: "MANUAL_ORDER_STATUS_UPDATED",
      entityId: order._id,
      entityModel: "ManualOrder",
      metadata: { orderId: order.orderId, createdBy: employee.email },
    });
  } catch (err) {
    console.error("Notification failed on manual order status update:", err.message);
  }

  return {
    orderId: order.orderId,
    oldStatus: currentStatus,
    newStatus: status,
    paymentStatus: order.paymentStatus,
    statusUpdatedAt: order.statusUpdatedAt,
  };
};

/* =========================================================
   UPDATE MANUAL ORDER PAYMENT STATUS (pending <-> paid)
========================================================= */
export const updateManualOrderPaymentStatusService = async (data, currentUser) => {
  const { orderId, paymentStatus, paymentMethod, paymentReference } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    const err = new Error("Manual order not found");
    err.statusCode = 404;
    throw err;
  }

  const nonEditableStatuses = ["refunded", "refund_pending", "partial_refunded"];
  if (nonEditableStatuses.includes(order.paymentStatus)) {
    const err = new Error(`Payment status cannot be changed manually while it is "${order.paymentStatus}"`);
    err.statusCode = 400;
    throw err;
  }

  if (order.paymentStatus === paymentStatus) {
    const err = new Error(`Order payment is already "${paymentStatus}"`);
    err.statusCode = 400;
    throw err;
  }

  const oldPaymentStatus = order.paymentStatus;

  if (paymentStatus === "paid") {
    const allowedMethods = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
    if (!paymentMethod || !allowedMethods.includes(paymentMethod)) {
      const err = new Error(
        `paymentMethod is required and must be one of: ${allowedMethods.join(", ")} when paymentStatus is "paid"`
      );
      err.statusCode = 400;
      err.errorCode = "INVALID_PAYMENT_METHOD";
      throw err;
    }
    order.paymentStatus = "paid";
    order.paymentMethod = paymentMethod;
    order.paymentReference = paymentReference || null;
    order.paidAt = new Date();
  } else {
    order.paymentStatus = "pending";
    order.paymentMethod = null;
    order.paymentReference = null;
    order.paidAt = null;
  }

  await order.save();

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    permission: "update_manual_order_payment_status",
    action: "update",
    meta: { orderId: order.orderId, from: oldPaymentStatus, to: order.paymentStatus },
  });

  try {
    await sendNotification({
      sender: employee._id,
      permission: "sales.order.update",
      title: "Manual Order Payment Updated",
      message: `Manual order ${order.orderId} payment status updated to ${order.paymentStatus}`,
      type: "MANUAL_ORDER_PAYMENT_STATUS_UPDATED",
      entityId: order._id,
      entityModel: "ManualOrder",
      metadata: { orderId: order.orderId, createdBy: employee.email },
    });
  } catch (err) {
    console.error("Notification failed on manual order payment status update:", err.message);
  }

  return {
    orderId: order.orderId,
    oldPaymentStatus,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    paymentReference: order.paymentReference,
    paidAt: order.paidAt,
  };
};

/* =========================================================
   CANCEL MANUAL ORDER (no stock to restore — nothing to look up)
========================================================= */
export const cancelManualOrderService = async (orderId, currentUser, reason) => {
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    const err = new Error("Manual order not found");
    err.statusCode = 404;
    throw err;
  }

  const nonCancellable = ["delivered", "cancelled", "shipped"];
  if (nonCancellable.includes(order.orderStatus)) {
    const err = new Error(`Order cannot be cancelled once ${order.orderStatus}`);
    err.statusCode = 400;
    throw err;
  }

  order.orderStatus = "cancelled";
  order.cancellationReason = reason?.trim() || "Cancelled by staff";
  order.cancelledAt = new Date();

  if (order.paymentStatus === "paid") {
    order.paymentStatus = "refund_pending";
    order.refundAmount = order.grandTotal;
  }

  await order.save();

  try {
    await sendNotification({
      sender: employee._id,
      permission: "sales.order.update",
      title: "Manual Order Cancelled",
      message: `Manual order ${order.orderId} was cancelled`,
      type: "MANUAL_ORDER_CANCELLED",
      entityId: order._id,
      entityModel: "ManualOrder",
      metadata: { orderId: order.orderId, createdBy: employee.email },
    });
  } catch (err) {
    console.error("Notification failed on manual order cancel:", err.message);
  }

  return {
    orderId: order.orderId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    refundAmount: order.refundAmount || 0,
    cancellationReason: order.cancellationReason,
    cancelledAt: order.cancelledAt,
  };
};

/* =========================================================
   MANUAL RETURN (no stock to restore — item identified by name only)
========================================================= */
export const createManualReturnService = async (data, currentUser) => {
  const { orderId, returnItems, refundNow, refundMethod, notes } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    const error = new Error("Manual order not found");
    error.statusCode = 404;
    throw error;
  }

  const allowedStatuses = ["placed", "packed", "confirmed", "shipped", "delivered", "partial_returned"];
  if (!allowedStatuses.includes(order.orderStatus)) {
    const error = new Error(`Order cannot be returned. Current status: ${order.orderStatus}`);
    error.statusCode = 400;
    throw error;
  }

  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    const error = new Error("returnItems are required");
    error.statusCode = 400;
    throw error;
  }

  const validatedItems = [];
  let refundableAmount = 0;

  for (const item of returnItems) {
    const { productName, variantName, quantity, reason } = item;
    if (!productName || !quantity || Number(quantity) <= 0) {
      const error = new Error("Invalid return item data");
      error.statusCode = 400;
      throw error;
    }

    const orderItem = order.items.find(
      (o) =>
        o.productName === productName &&
        (o.variantName || "") === (variantName || "")
    );
    if (!orderItem) {
      const error = new Error(`Item not found in order: ${productName}`);
      error.statusCode = 404;
      throw error;
    }

    const availableQty = Number(orderItem.quantity) - Number(orderItem.returnedQuantity || 0);
    if (Number(quantity) > availableQty) {
      const error = new Error(`Return quantity exceeds available quantity for ${orderItem.productName}`);
      error.statusCode = 400;
      throw error;
    }

    orderItem.returnedQuantity = Number(orderItem.returnedQuantity || 0) + Number(quantity);
    refundableAmount += Number(orderItem.price) * Number(quantity);

    validatedItems.push({
      productName: orderItem.productName,
      variantName: orderItem.variantName,
      quantity: Number(quantity),
      price: Number(orderItem.price),
      reason: reason || "Manual return",
    });
  }

  const requestId = uuidv6();
  order.returnRequests.push({
    requestId,
    items: validatedItems,
    status: "approved",
    processedBy: employee._id,
    requestedAt: new Date(),
    processedAt: new Date(),
  });

  const totalActiveQty = order.items.reduce((sum, i) => sum + (Number(i.quantity) - Number(i.returnedQuantity || 0)), 0);
  const totalReturnedQty = order.items.reduce((sum, i) => sum + Number(i.returnedQuantity || 0), 0);
  order.orderStatus = totalActiveQty === 0 && totalReturnedQty > 0 ? "returned" : "partial_returned";

  if (refundNow) {
    const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other"];
    if (!refundMethod || !allowedMethods.includes(refundMethod)) {
      const error = new Error(`refundMethod is required and must be one of: ${allowedMethods.join(", ")}`);
      error.statusCode = 400;
      throw error;
    }
    const alreadyRefunded = Number(order.partialRefundAmount || 0);
    const newTotalRefunded = alreadyRefunded + refundableAmount;

    order.partialRefundAmount = newTotalRefunded;
    order.paymentStatus = newTotalRefunded >= Number(order.grandTotal) ? "refunded" : "partial_refunded";
    order.refundedAt = new Date();
    order.refundHistory.push({
      refundId: `MANUAL-${uuidv6()}`,
      amount: refundableAmount,
      method: refundMethod,
      refundedBy: employee.email,
      refundedAt: new Date(),
      refundStatus: "processed",
    });
  } else {
    order.paymentStatus = "refund_pending";
  }

  await order.save();

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    actionForEmail: order.customerEmail,
    permission: "manual_return_create",
    action: "create",
    meta: { orderId: order.orderId, requestId, refundableAmount, refundNow, notes: notes || null },
  });

  try {
    await sendNotification({
      sender: employee._id,
      permission: "sales.order.update",
      title: "Manual Return Recorded",
      message: `Manual return recorded for order ${order.orderId}`,
      type: "MANUAL_ORDER_RETURN_RECORDED",
      entityId: order._id,
      entityModel: "ManualOrder",
      metadata: { orderId: order.orderId, requestId, refundableAmount, refundNow, createdBy: employee.email },
    });
  } catch (err) {
    console.error("Notification failed on manual return:", err.message);
  }

  return {
    orderId: order.orderId,
    requestId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    refundableAmount,
    refundProcessed: !!refundNow,
    items: validatedItems,
  };
};

/* =========================================================
   MANUAL ORDER ANALYTICS (totals, top products, sales by
   city/state/country, status breakdowns, trend for graphs)
========================================================= */
export const getManualOrderAnalyticsService = async (query) => {
  const {
    startDate,
    endDate,
    topLimit = 10,
    locationLimit = 10,
    includeCancelled = false,
    groupBy = "day", // "day" | "month"
  } = query;

  const parsedTopLimit = Math.min(Math.max(Number(topLimit) || 10, 1), 100);
  const parsedLocationLimit = Math.min(Math.max(Number(locationLimit) || 10, 1), 100);

  /* ---------- MATCH STAGE ---------- */
  const match = {};

  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) {
      const from = new Date(startDate);
      if (Number.isNaN(from.getTime())) {
        const error = new Error("Invalid startDate");
        error.statusCode = 400;
        error.errorCode = "VALIDATION_ERROR";
        throw error;
      }
      match.createdAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (Number.isNaN(to.getTime())) {
        const error = new Error("Invalid endDate");
        error.statusCode = 400;
        error.errorCode = "VALIDATION_ERROR";
        throw error;
      }
      to.setHours(23, 59, 59, 999);
      match.createdAt.$lte = to;
    }
  }

  const includeCancelledBool = includeCancelled === true || includeCancelled === "true";
  if (!includeCancelledBool) {
    match.orderStatus = { $ne: "cancelled" };
  }

  const dateFormat = groupBy === "month" ? "%Y-%m" : "%Y-%m-%d";

  const [result] = await ManualOrder.aggregate([
    { $match: match },
    {
      $facet: {
        /* ---------- OVERALL SUMMARY ---------- */
        summary: [
          {
            $group: {
              _id: null,
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: "$grandTotal" },
              totalItemsSold: {
                $sum: {
                  $sum: "$items.quantity",
                },
              },
              uniqueCustomers: { $addToSet: "$customerPhone" },
            },
          },
          {
            $project: {
              _id: 0,
              totalOrders: 1,
              totalRevenue: 1,
              totalItemsSold: 1,
              totalUniqueCustomers: { $size: "$uniqueCustomers" },
              avgOrderValue: {
                $cond: [
                  { $eq: ["$totalOrders", 0] },
                  0,
                  { $divide: ["$totalRevenue", "$totalOrders"] },
                ],
              },
            },
          },
        ],

        /* ---------- ORDERS BY STATUS ---------- */
        ordersByStatus: [
          {
            $group: {
              _id: "$orderStatus",
              count: { $sum: 1 },
              totalRevenue: { $sum: "$grandTotal" },
            },
          },
          { $project: { _id: 0, status: "$_id", count: 1, totalRevenue: 1 } },
          { $sort: { count: -1 } },
        ],

        /* ---------- PAYMENT STATUS BREAKDOWN ---------- */
        paymentStatusBreakdown: [
          {
            $group: {
              _id: "$paymentStatus",
              count: { $sum: 1 },
              totalAmount: { $sum: "$grandTotal" },
            },
          },
          { $project: { _id: 0, paymentStatus: "$_id", count: 1, totalAmount: 1 } },
          { $sort: { count: -1 } },
        ],

        /* ---------- TOP SELLING PRODUCTS ---------- */
        topProducts: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.productName",
              totalQuantitySold: { $sum: "$items.quantity" },
              totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
              orderIds: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              productName: "$_id",
              totalQuantitySold: 1,
              totalRevenue: 1,
              totalOrders: { $size: "$orderIds" },
            },
          },
          { $sort: { totalQuantitySold: -1 } },
          { $limit: parsedTopLimit },
        ],

        /* ---------- SALES BY CITY ---------- */
        salesByCity: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$shippingAddress.city",
              totalQuantitySold: { $sum: "$items.quantity" },
              totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
              orderIds: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              city: { $ifNull: ["$_id", "Unknown"] },
              totalQuantitySold: 1,
              totalRevenue: 1,
              totalOrders: { $size: "$orderIds" },
            },
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: parsedLocationLimit },
        ],

        /* ---------- SALES BY STATE ---------- */
        salesByState: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$shippingAddress.state",
              totalQuantitySold: { $sum: "$items.quantity" },
              totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
              orderIds: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              state: { $ifNull: ["$_id", "Unknown"] },
              totalQuantitySold: 1,
              totalRevenue: 1,
              totalOrders: { $size: "$orderIds" },
            },
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: parsedLocationLimit },
        ],

        /* ---------- SALES BY COUNTRY ---------- */
        salesByCountry: [
          { $unwind: "$items" },
          {
            $group: {
              _id: "$shippingAddress.country",
              totalQuantitySold: { $sum: "$items.quantity" },
              totalRevenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
              orderIds: { $addToSet: "$orderId" },
            },
          },
          {
            $project: {
              _id: 0,
              country: { $ifNull: ["$_id", "Unknown"] },
              totalQuantitySold: 1,
              totalRevenue: 1,
              totalOrders: { $size: "$orderIds" },
            },
          },
          { $sort: { totalRevenue: -1 } },
          { $limit: parsedLocationLimit },
        ],

        /* ---------- ORDERS / REVENUE TREND (for line/bar graph) ---------- */
        salesTrend: [
          {
            $group: {
              _id: { $dateToString: { format: dateFormat, date: "$createdAt" } },
              totalOrders: { $sum: 1 },
              totalRevenue: { $sum: "$grandTotal" },
            },
          },
          { $project: { _id: 0, date: "$_id", totalOrders: 1, totalRevenue: 1 } },
          { $sort: { date: 1 } },
        ],
      },
    },
  ]);

  return {
    summary: result.summary[0] || {
      totalOrders: 0,
      totalRevenue: 0,
      totalItemsSold: 0,
      totalUniqueCustomers: 0,
      avgOrderValue: 0,
    },
    ordersByStatus: result.ordersByStatus,
    paymentStatusBreakdown: result.paymentStatusBreakdown,
    topProducts: result.topProducts,
    salesByCity: result.salesByCity,
    salesByState: result.salesByState,
    salesByCountry: result.salesByCountry,
    salesTrend: result.salesTrend,
    filters: {
      startDate: startDate || null,
      endDate: endDate || null,
      includeCancelled: includeCancelledBool,
      groupBy,
    },
  };
};

/* =========================================================
   CUSTOMER BALANCE LEDGER
   Groups every manual order by customer (phone number) and works out,
   per customer, whether the company still owes them money (unrefunded
   returns / cancellations) or the customer still owes the company
   (unpaid orders). Nothing here needs a separate Customer collection —
   it's all derived from ManualOrder documents already on file.

   Per order:
     - totalReturnedValue     = value of everything returned on that order
     - pendingReturnRefund    = totalReturnedValue - amount already paid out
                                 via refundHistory (tracked as partialRefundAmount)
     - cancellationRefundOwed = grandTotal, only when the order was
                                 cancelled after being paid and hasn't been
                                 refunded yet (paymentStatus stays
                                 "refund_pending" for cancellations)
     - unpaidDue              = grandTotal, only when paymentStatus is
                                 still "pending"

   owedToCustomer = pendingReturnRefund + cancellationRefundOwed  (company owes)
   owedByCustomer = unpaidDue                                     (customer owes)
   netBalance     = owedByCustomer - owedToCustomer
     > 0  -> "customer_owes"   (customer still owes the company)
     < 0  -> "company_owes"    (company owes the customer a refund)
     = 0  -> "settled"

   NOTE: this reads paymentStatus/refundHistory/partialRefundAmount as the
   source of truth. If a cancellation refund is later paid out by some other
   means, update that order's paymentStatus (e.g. to "refunded") so it stops
   showing up as owed here.
========================================================= */
export const getCustomerBalanceLedgerService = async (query) => {
  const { startDate, endDate, search, balanceStatus, sortBy } = query;

  const match = {};
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) {
      const from = new Date(startDate);
      if (Number.isNaN(from.getTime())) {
        const error = new Error("Invalid startDate");
        error.statusCode = 400;
        error.errorCode = "VALIDATION_ERROR";
        throw error;
      }
      match.createdAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (Number.isNaN(to.getTime())) {
        const error = new Error("Invalid endDate");
        error.statusCode = 400;
        error.errorCode = "VALIDATION_ERROR";
        throw error;
      }
      to.setHours(23, 59, 59, 999);
      match.createdAt.$lte = to;
    }
  }

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        totalReturnedValue: {
          $sum: {
            $map: {
              input: { $ifNull: ["$returnRequests", []] },
              as: "rr",
              in: {
                $sum: {
                  $map: {
                    input: { $ifNull: ["$$rr.items", []] },
                    as: "it",
                    in: { $multiply: ["$$it.price", "$$it.quantity"] },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      $addFields: {
        pendingReturnRefund: {
          $max: [
            { $subtract: ["$totalReturnedValue", { $ifNull: ["$partialRefundAmount", 0] }] },
            0,
          ],
        },
        cancellationRefundOwed: {
          $cond: [
            {
              $and: [
                { $eq: ["$orderStatus", "cancelled"] },
                { $eq: ["$paymentStatus", "refund_pending"] },
              ],
            },
            { $ifNull: ["$refundAmount", 0] },
            0,
          ],
        },
        unpaidDue: {
          $cond: [{ $eq: ["$paymentStatus", "pending"] }, "$grandTotal", 0],
        },
      },
    },
    {
      $addFields: {
        owedToCustomer: { $add: ["$pendingReturnRefund", "$cancellationRefundOwed"] },
        owedByCustomer: "$unpaidDue",
      },
    },
    {
      $group: {
        _id: "$customerPhone",
        customerName: { $last: "$customerName" },
        customerEmail: { $last: "$customerEmail" },
        totalOrders: { $sum: 1 },
        totalOrderValue: { $sum: "$grandTotal" },
        totalReturnedValue: { $sum: "$totalReturnedValue" },
        totalOwedToCustomer: { $sum: "$owedToCustomer" },
        totalOwedByCustomer: { $sum: "$owedByCustomer" },
        lastOrderAt: { $max: "$createdAt" },
        orders: {
          $push: {
            orderId: "$orderId",
            orderStatus: "$orderStatus",
            paymentStatus: "$paymentStatus",
            grandTotal: "$grandTotal",
            totalReturnedValue: "$totalReturnedValue",
            owedToCustomer: "$owedToCustomer",
            owedByCustomer: "$owedByCustomer",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $addFields: {
        netBalance: { $subtract: ["$totalOwedByCustomer", "$totalOwedToCustomer"] },
      },
    },
    {
      $addFields: {
        balanceStatus: {
          $switch: {
            branches: [
              { case: { $gt: ["$netBalance", 0] }, then: "customer_owes" },
              { case: { $lt: ["$netBalance", 0] }, then: "company_owes" },
            ],
            default: "settled",
          },
        },
      },
    },
  ];

  if (search && search.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: { $or: [{ customerName: regex }, { _id: regex }, { customerEmail: regex }] },
    });
  }

  const allowedStatusFilters = ["customer_owes", "company_owes", "settled"];
  if (balanceStatus && allowedStatusFilters.includes(balanceStatus)) {
    pipeline.push({ $match: { balanceStatus } });
  }

  pipeline.push({
    $project: {
      _id: 0,
      customerPhone: "$_id",
      customerName: 1,
      customerEmail: 1,
      totalOrders: 1,
      totalOrderValue: 1,
      totalReturnedValue: 1,
      totalOwedToCustomer: 1,
      totalOwedByCustomer: 1,
      netBalance: 1,
      balanceStatus: 1,
      lastOrderAt: 1,
      orders: 1,
    },
  });

  pipeline.push({
    $sort:
      sortBy === "name"
        ? { customerName: 1 }
        : sortBy === "recent"
        ? { lastOrderAt: -1 }
        : { netBalance: -1 },
  });

  const customers = await ManualOrder.aggregate(pipeline);

  const summary = customers.reduce(
    (acc, c) => {
      if (c.balanceStatus === "customer_owes") {
        acc.totalCustomerOwesCompany += c.netBalance;
        acc.customersWhoOwe += 1;
      } else if (c.balanceStatus === "company_owes") {
        acc.totalCompanyOwesCustomers += Math.abs(c.netBalance);
        acc.customersOwed += 1;
      } else {
        acc.settledCustomers += 1;
      }
      return acc;
    },
    {
      totalCustomerOwesCompany: 0,
      totalCompanyOwesCustomers: 0,
      customersWhoOwe: 0,
      customersOwed: 0,
      settledCustomers: 0,
    }
  );

  return {
    customers,
    summary: { ...summary, totalCustomers: customers.length },
    filters: {
      startDate: startDate || null,
      endDate: endDate || null,
      search: search || null,
      balanceStatus: balanceStatus || null,
    },
  };
};

/* =========================================================
   MANUAL COURIER UPDATE
========================================================= */
export const updateManualOrderCourierService = async (data, currentUser) => {
  const { orderId, corourseServiceName, DOCNumber } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    const error = new Error("Manual order not found");
    error.statusCode = 404;
    throw error;
  }

  if (corourseServiceName) order.corourseServiceName = corourseServiceName;
  if (DOCNumber) order.DOCNumber = DOCNumber;
  order.statusUpdatedAt = new Date();

  await order.save();

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    permission: "update_manual_courier_details",
    action: "update",
    meta: { orderId: order.orderId, corourseServiceName, DOCNumber },
  });

  return {
    orderId: order.orderId,
    corourseServiceName: order.corourseServiceName,
    DOCNumber: order.DOCNumber,
    updatedAt: order.statusUpdatedAt,
  };
};
