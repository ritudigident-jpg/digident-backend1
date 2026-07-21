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