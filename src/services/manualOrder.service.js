import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
import Employee from "../models/manage/employee.model.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";
import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
import { sendNotification } from "./notification.service.js";
import { sendZohoMail } from "./ZohoEmail/zohoMail.service.js";
import { orderConfirmationTemplate } from "../config/templates/orderConfirmationTemplate.js";
import { createInvoiceService, updateInvoiceService } from "./invoice.service.js";

/* =========================================================
   INVOICE INTEGRATION HELPERS
   Uses your existing Invoice model/service as-is (services/invoice.service.js).
   That schema expects GST-INCLUSIVE per-item prices and computes its own
   totals via a pre-save hook — it does NOT read a pre-computed grandTotal.
   Manual orders track GST as one flat order-level amount instead of
   per-item, so this mapping applies the order's overall gstPercentage to
   every line item as a best-effort match. If your manual-order GST setup
   differs from that assumption, adjust buildInvoiceItemsFromOrder() below.
========================================================= */
const buildInvoiceItemsFromOrder = (order) =>
  (order.items || [])
    .filter((i) => Number(i.quantity) - Number(i.returnedQuantity || 0) > 0)
    .map((i) => ({
      description: i.variantName ? `${i.productName} - ${i.variantName}` : i.productName,
      qty: Number(i.quantity) - Number(i.returnedQuantity || 0),
      price: Number(i.price), // treated as GST-inclusive by the invoice schema
      discountPercent: 0,
      gstType: "IGST",
      gstPercent: Number(order.gstPercentage) || 0,
    }));

const buildAddressString = (addr = {}) =>
  [addr.street, addr.area, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(", ");

/**
 * Creates the invoice right after a manual order is placed, using your
 * existing createInvoiceService. Non-blocking — failures here are logged
 * but never roll back the order itself.
 */
const generateInvoiceForOrder = async (order) => {
  const items = buildInvoiceItemsFromOrder(order);
  if (items.length === 0) return null;

  const invoicePayload = {
    billTo: {
      companyName: order.organizationName || order.customerName,
      address: buildAddressString(order.billingAddress || order.shippingAddress),
      gstin: order.gstNumber || "",
      contactPerson: order.customerName,
      contactNumber: order.customerPhone,
    },
    items,
    summary: {
      freightCost: Number(order.shippingCharge) || 0,
      paidAmount: 0, // patched below once the schema has computed totalPayAmount
    },
    notes: `Manual Order: ${order.orderId}`,
    status: "issued",
  };

  const invoice = await createInvoiceService(invoicePayload);

  // If the order was paid up front, mark the invoice fully paid using the
  // total the schema just computed for us.
  if (order.paymentStatus === "paid") {
    await updateInvoiceService({
      invoiceId: invoice.invoiceId,
      data: {
        summary: { paidAmount: invoice.summary.totalPayAmount },
        status: "paid",
      },
    });
  }

  order.invoiceId = invoice.invoiceId;
  await order.save();

  return invoice;
};

/**
 * Re-syncs the invoice after a return/partial return: rebuilds the line
 * items to reflect only what's still active on the order (so the schema's
 * pre-save hook recomputes totals to match), and re-derives paidAmount from
 * how much the company has actually retained after any refunds already
 * paid out (order.partialRefundAmount).
 */
const syncInvoiceForReturn = async (order) => {
  if (!order.invoiceId) return null; // order predates invoicing

  const items = buildInvoiceItemsFromOrder(order);
  const wasEverFullyPaid = ["paid", "partial_refunded", "refunded"].includes(order.paymentStatus);
  const grossPaid = wasEverFullyPaid ? Number(order.grandTotal || 0) : 0;
  const refunded = Number(order.partialRefundAmount || 0);
  const netPaid = Math.max(grossPaid - refunded, 0);

  const status = items.length === 0 ? "cancelled" : undefined; // let paidAmount decide paid/partially_paid otherwise

  const updated = await updateInvoiceService({
    invoiceId: order.invoiceId,
    data: {
      items: items.length > 0 ? items : undefined,
      summary: { paidAmount: netPaid },
      ...(status ? { status } : {}),
      notes: `Adjusted for return on ${new Date().toLocaleDateString("en-IN")}`,
    },
  });

  // items.length === 0 has no valid items array to satisfy the invoice's
  // own "min 1 item" validation on manual edits from the UI later, but the
  // service layer itself doesn't enforce that on updateInvoiceService, so
  // status "cancelled" with an empty items array is left as-is here.
  if (!status && updated) {
    const newStatus = Number(updated.summary?.amountToPay) <= 0 ? "paid" : "partially_paid";
    if (updated.status !== newStatus) {
      await updateInvoiceService({ invoiceId: order.invoiceId, data: { status: newStatus } });
    }
  }

  return updated;
};
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

  /* ---------- AUTO-GENERATE INVOICE (non-blocking) ---------- */
  try {
    await generateInvoiceForOrder(order);
  } catch (err) {
    console.error("Invoice auto-creation failed on manual order create:", err.message);
  }

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
  // NOTE: previously auto-marked paymentStatus "paid" here when an order
  // hit "delivered" (assuming COD-style payment on delivery). Everything in
  // this system is staff-driven, so that assumption doesn't hold — payment
  // status now only ever changes via the explicit payment-status endpoint.

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

  /* ---------- AUTO-ADJUST INVOICE (non-blocking) ---------- */
  try {
    await syncInvoiceForReturn(order);
  } catch (err) {
    console.error("Invoice auto-update failed on manual return:", err.message);
  }

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
        // Grouped by phone + normalized name together — not phone alone —
        // so two different people who happen to share a phone number
        // (e.g. a clinic's front-desk line used by multiple doctors, or
        // family members) don't get their balances merged into one.
        // Same person typed with different capitalization/spacing still
        // groups correctly since the name is lowercased + trimmed first.
        _id: {
          phone: "$customerPhone",
          normalizedName: { $trim: { input: { $toLower: "$customerName" } } },
        },
        customerPhone: { $last: "$customerPhone" },
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
      $match: { $or: [{ customerName: regex }, { customerPhone: regex }, { customerEmail: regex }] },
    });
  }

  const allowedStatusFilters = ["customer_owes", "company_owes", "settled"];
  if (balanceStatus && allowedStatusFilters.includes(balanceStatus)) {
    pipeline.push({ $match: { balanceStatus } });
  }

  pipeline.push({
    $project: {
      _id: 0,
      customerPhone: 1,
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
   SETTLE A PENDING REFUND WITH STORE CREDIT
   Covers the "customer said they'll take it next time" case: instead of
   physically handing back cash for a return/cancellation, staff apply the
   amount they're owed as a discount on a new order. This just records that
   the old order's refund has been settled that way — it does NOT touch the
   new order's numbers; staff still enter the discount manually on the new
   order (see CreateOrderPage). This only exists so the old order stops
   showing up as "we owe customer" once the credit has actually been used.
========================================================= */
/* =========================================================
   SETTLE A PENDING REFUND (cash payout OR store credit)
   Covers both:
     - "I've physically handed the customer their refund" (method: cash/upi/
       bank_transfer/card/other) — the normal case after a return/cancel.
     - "Customer said they'll take it next time" (method: credit_note) —
       the amount is applied as a discount on a new order instead (see
       CreateOrderPage's credit lookup), and this just records that the old
       order's refund has now been used up.
   Either way, this is the ONLY way a "refund_pending" / "partial_refunded"
   order moves toward "refunded" — createManualReturnService only sets that
   automatically when refundNow was ticked at return time; if it wasn't,
   this is how staff go back and settle it later.
========================================================= */
export const settleOrderRefundService = async (data, currentUser) => {
  const { orderId, amount, method = "credit_note", reference, appliedToOrderId, notes } = data;

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

  if (!["refund_pending", "partial_refunded"].includes(order.paymentStatus)) {
    const error = new Error(`This order has no pending refund to settle (currently "${order.paymentStatus}")`);
    error.statusCode = 400;
    throw error;
  }

  const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other", "credit_note"];
  if (!allowedMethods.includes(method)) {
    const error = new Error(`method must be one of: ${allowedMethods.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const creditAmount = Number(amount);
  if (!creditAmount || creditAmount <= 0) {
    const error = new Error("amount must be a positive number");
    error.statusCode = 400;
    throw error;
  }

  const isCancellation = order.orderStatus === "cancelled";
  let outstanding;

  if (isCancellation) {
    outstanding = Math.max(Number(order.refundAmount || 0) - Number(order.partialRefundAmount || 0), 0);
  } else {
    const totalReturnedValue = (order.returnRequests || []).reduce(
      (sum, rr) =>
        sum + (rr.items || []).reduce((s, it) => s + Number(it.price) * Number(it.quantity), 0),
      0
    );
    outstanding = Math.max(totalReturnedValue - Number(order.partialRefundAmount || 0), 0);
  }

  if (creditAmount > outstanding + 0.01) {
    const error = new Error(
      `Amount (${creditAmount}) is more than what's actually owed on this order (${outstanding.toFixed(2)})`
    );
    error.statusCode = 400;
    throw error;
  }

  order.partialRefundAmount = Number(order.partialRefundAmount || 0) + creditAmount;
  order.paymentStatus = creditAmount >= outstanding - 0.01 ? "refunded" : "partial_refunded";
  order.refundedAt = new Date();
  const refundId = `MANUAL-${uuidv6()}`;
  order.refundHistory.push({
    refundId,
    amount: creditAmount,
    method,
    refundedBy: employee.email,
    refundedAt: new Date(),
    refundStatus: "processed",
    appliedToOrderId: appliedToOrderId || null,
  });
  order.notes = [
    order.notes,
    method === "credit_note"
      ? `₹${creditAmount} credited toward ${appliedToOrderId ? `order ${appliedToOrderId}` : "a later purchase"}${
          notes ? ` — ${notes}` : ""
        }`
      : `₹${creditAmount} refunded via ${method}${reference ? ` (ref: ${reference})` : ""}${
          notes ? ` — ${notes}` : ""
        }`,
  ]
    .filter(Boolean)
    .join(" | ");

  await order.save();

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: order._id,
    actionForEmail: order.customerEmail,
    permission: "manual_order_refund_settle",
    action: "update",
    meta: { orderId: order.orderId, amount: creditAmount, method, appliedToOrderId: appliedToOrderId || null },
  });

  // If this credit was applied straight onto a new order (the
  // CreateOrderPage "Check credit" flow), pull that order's details too so
  // the instantly-downloaded PDF shows real context, not just an ID.
  let appliedOrderDate = null;
  let appliedOrderGrandTotal = null;
  let appliedOrderItems = [];
  if (appliedToOrderId) {
    const appliedOrder = await ManualOrder.findOne({ orderId: appliedToOrderId }).lean();
    if (appliedOrder) {
      appliedOrderDate = appliedOrder.createdAt;
      appliedOrderGrandTotal = appliedOrder.grandTotal;
      appliedOrderItems = appliedOrder.items || [];
    }
  }

  return {
    refundId,
    orderId: order.orderId,
    orderDate: order.createdAt,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    paymentStatus: order.paymentStatus,
    amountSettled: creditAmount,
    method,
    refundedBy: employee.email,
    appliedToOrderId: appliedToOrderId || null,
    appliedOrderDate,
    appliedOrderGrandTotal,
    appliedOrderItems,
    remainingOwed: Math.max(outstanding - creditAmount, 0),
    sourceOrderGstPercentage: order.gstPercentage || 0,
    // What was actually returned on this order — so a downloaded credit
    // note PDF shows real products, not just a bare amount.
    returnedItems: (order.returnRequests || []).reduce((all, rr) => all.concat(rr.items || []), []),
  };
};

// Old name kept as an alias — CreateOrderPage's credit-apply flow already
// calls this via the same route/controller.
export const settleRefundWithCreditService = settleOrderRefundService;

/* =========================================================
   CREDIT NOTES LIST
   Every refundHistory entry across every order where method === "credit_note"
   — i.e. every time staff recorded "customer will take it next time"
   instead of a cash payout. Used to power a dedicated Credit Notes page and
   to let staff re-download a specific credit note's PDF later.
========================================================= */
export const getCreditNotesService = async (query) => {
  const { search, startDate, endDate } = query;

  const match = {};
  if (startDate || endDate) {
    match["refundHistory.refundedAt"] = {};
    if (startDate) {
      const from = new Date(startDate);
      if (!Number.isNaN(from.getTime())) match["refundHistory.refundedAt"].$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        match["refundHistory.refundedAt"].$lte = to;
      }
    }
  }

  const pipeline = [
    { $unwind: "$refundHistory" },
    { $match: { "refundHistory.method": "credit_note", ...match } },
    {
      $project: {
        _id: 0,
        refundId: "$refundHistory.refundId",
        amount: "$refundHistory.amount",
        refundedBy: "$refundHistory.refundedBy",
        refundedAt: "$refundHistory.refundedAt",
        refundStatus: "$refundHistory.refundStatus",
        appliedToOrderId: "$refundHistory.appliedToOrderId",
        sourceOrderId: "$orderId",
        sourceOrderDate: "$createdAt",
        sourceOrderGrandTotal: "$grandTotal",
        sourceOrderGstPercentage: "$gstPercentage",
        customerName: "$customerName",
        customerPhone: "$customerPhone",
        customerEmail: "$customerEmail",
        // Every item ever returned on this order (across all its return
        // requests) — so a credit note actually shows WHAT the credit is
        // for, not just a bare rupee amount. Flattened into one list since
        // a single credit-note settlement usually covers everything owed
        // on the order at that point, not just one specific return.
        returnedItems: {
          $reduce: {
            input: { $ifNull: ["$returnRequests", []] },
            initialValue: [],
            in: { $concatArrays: ["$$value", { $ifNull: ["$$this.items", []] }] },
          },
        },
      },
    },
    // Pull in the actual new order this credit was spent on — a bare order
    // ID means nothing to a customer, they need to see what they bought
    // with it and when.
    {
      $lookup: {
        from: ManualOrder.collection.name,
        localField: "appliedToOrderId",
        foreignField: "orderId",
        as: "_appliedOrder",
      },
    },
    { $unwind: { path: "$_appliedOrder", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        appliedOrderDate: "$_appliedOrder.createdAt",
        appliedOrderGrandTotal: "$_appliedOrder.grandTotal",
        appliedOrderItems: { $ifNull: ["$_appliedOrder.items", []] },
      },
    },
    { $project: { _appliedOrder: 0 } },
    { $sort: { refundedAt: -1 } },
  ];

  if (search && search.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: {
        $or: [
          { customerName: regex },
          { customerPhone: regex },
          { customerEmail: regex },
          { sourceOrderId: regex },
          { refundId: regex },
        ],
      },
    });
  }

  const creditNotes = await ManualOrder.aggregate(pipeline);

  const totalIssued = creditNotes.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const totalApplied = creditNotes
    .filter((c) => c.appliedToOrderId)
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  return {
    creditNotes,
    summary: {
      totalCreditNotes: creditNotes.length,
      totalIssued,
      totalApplied,
      totalUnapplied: Math.max(totalIssued - totalApplied, 0),
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
