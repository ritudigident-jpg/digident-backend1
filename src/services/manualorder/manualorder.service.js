/**
 * Business logic for orders typed in by staff (phone / walk-in sales). Throws AppError subclasses
 * on failure.
 *
 * Exports: orderDiscountRatio, returnLineValue, orderReturnedValue, resyncInvoiceForOrder,
 * createManualOrderService, getManualOrderService, getAllManualOrdersService,
 * updateManualOrderStatusService and 6 more
 * Used by: controllers/manualorder/manualorder.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import Employee from "../../models/employee.model.js";
import ManualOrder from "../../models/manualorder.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import { orderConfirmationTemplate } from "../../templates/email/orderconfirmation.template.js";
import { createInvoiceService, updateInvoiceService } from "../invoice/invoice.service.js";
import Invoice from "../../models/invoice.model.js";
import CreditNote from "../../models/creditnote.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

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
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ---------- ONE discount rule for order, invoice, return and refund ----------
   order.discount is a flat rupee amount (manual discount + any store credit
   applied at checkout) off the ORIGINAL items subtotal. It is treated as a
   fixed ratio of every rupee of goods:
     discountRatio  = order.discount / original items subtotal
     return value   = price × qty × (1 − discountRatio)   (what the customer actually paid for it)
     invoice items  = still-active items, each discounted by the same ratio
   so at every point:  invoice total = order.grandTotal − returned value.
   (Before, the return refunded the FULL price while the invoice put the WHOLE
   discount on the remaining items — order, invoice, ledger and the return
   popup each showed a different number.) */
/**
 * Order discount ratio.
 *
 * @param {*} order
 * @returns {*}
 */
export const orderDiscountRatio = (order) => {
  const original = (order.items || []).reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  if (original <= 0) return 0;
  return Math.min(Math.max(Number(order.discount) || 0, 0) / original, 1);
};

/**
 * Return line value.
 *
 * @param {*} order
 * @param {*} price
 * @param {*} qty
 * @returns {*}
 */
export const returnLineValue = (order, price, qty) =>
  round2(Number(price) * Number(qty) * (1 - orderDiscountRatio(order)));

/**
 * Order returned value.
 *
 * @param {*} order
 * @returns {*}
 */
export const orderReturnedValue = (order) =>
  round2(
    (order.returnRequests || []).reduce(
      (sum, rr) =>
        sum + (rr.items || []).reduce((s, it) => s + returnLineValue(order, it.price, it.quantity), 0),
      0
    )
  );

const buildInvoiceItemsFromOrder = (order) => {
  const activeItems = (order.items || []).filter(
    (i) => Number(i.quantity) - Number(i.returnedQuantity || 0) > 0
  );
  const ratio = orderDiscountRatio(order);
  const lines = activeItems.map((i) => {
    const qty = Number(i.quantity) - Number(i.returnedQuantity || 0);
    return { item: i, qty, gross: Number(i.price) * qty };
  });

  // Rupee discount for the active items, split per line so the rounded line
  // discounts add up EXACTLY to it (last line takes the paise left over) —
  // otherwise invoice total and order grand total differ by a few paise.
  const activeSubtotal = lines.reduce((s, l) => s + l.gross, 0);
  const totalDiscount = round2(activeSubtotal * ratio);
  let left = totalDiscount;

  return lines.map((l, idx) => {
    const share = idx === lines.length - 1 ? left : Math.min(round2(l.gross * ratio), left);
    left = round2(left - share);
    return {
      description: l.item.variantName ? `${l.item.productName} - ${l.item.variantName}` : l.item.productName,
      qty: l.qty,
      price: Number(l.item.price), // treated as GST-inclusive by the invoice schema
      discountPercent: l.gross > 0 ? Math.min(100, (share / l.gross) * 100) : 0,
      gstType: "IGST",
      gstPercent: Number(order.gstPercentage) || 0, // 0 stays 0 (model no longer forces 5)
    };
  });
};

const buildAddressString = (addr = {}) =>
  [addr.street, addr.area, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(", ");

/**
 * Creates the invoice right after a manual order is placed, using your
 * existing createInvoiceService. Non-blocking — failures here are logged
 * but never roll back the order itself.
 */
const generateInvoiceForOrder = async (order, employee = null) => {
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
    // Links this invoice back to the manual order that created it, so a
    // refund settled later on the invoice (settleInvoiceRefundService) can
    // mirror its state back onto this order for display purposes.
    sourceOrderId: order.orderId,
    sourceOrderType: "manual",
    // which employee created the order (and so the invoice)
    createdBy: employee?._id || order.createdBy || null,
    createdByName: employee
      ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email
      : "",
    createdByEmail: employee?.email || "",
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
 * The ONE place that keeps an order's linked real Invoice in sync with
 * whatever's currently true about the order — items still active (after
 * any returns), how much the company has actually net-retained after any
 * refunds/credits paid out, AND (new) how much is currently owed back to
 * the customer. Called after EVERY mutation that could change any of
 * that: order creation, a return, a manual payment-status change, a
 * cancellation, or a settlement (which now happens on the invoice side
 * and calls this indirectly via the invoice service's order-sync).
 *
 * IMPORTANT: this function no longer decides HOW a refund gets paid down
 * (cash vs store credit) — it only ever reports "this much is currently
 * owed" (refundableAmount) to the invoice. The invoice's own
 * settleInvoiceRefundService is the single place that actually pays that
 * amount down and writes refund history; once it does, it mirrors the
 * result back onto this order (paymentStatus, partialRefundAmount,
 * refundHistory) purely so anything still reading the order directly
 * keeps showing accurate numbers.
 */
/**
 * keepInvoicePayments — for an order that was NOT marked paid on the order
 * side, keep whatever cash was recorded directly on its invoice (Invoices
 * page → Amount Paid). Pass false only when staff explicitly switch the
 * order back to "pending" (that is a reset of the payment).
 */
export const resyncInvoiceForOrder = async (order, { keepInvoicePayments = true } = {}) => {
  if (!order.invoiceId) return null;

  const items = buildInvoiceItemsFromOrder(order);

  const inv = await Invoice.findOne({ invoiceId: order.invoiceId })
    .select("appliedCredits summary.paidAmount")
    .lean();
  const creditsPaid = (inv?.appliedCredits || []).reduce((s, c) => s + Number(c.amount || 0), 0);
  // cash recorded on the invoice itself (credit-note payments counted separately)
  const invoiceCash = Math.max(Number(inv?.summary?.paidAmount || 0) - creditsPaid, 0);

  const paidOnOrder = Boolean(order.paidAt);
  // Before: when the order was "pending", every resync set the invoice paidAmount to 0
  // tha — Invoices page par record kiya payment chupchaap mit jata tha.
  const grossPaid = paidOnOrder ? Number(order.grandTotal || 0) : keepInvoicePayments ? invoiceCash : 0;

  // value the customer gets back (settled + pending). For an unpaid order
  // a return only lowers the bill; no refund is created.
  const owedBasis =
    order.orderStatus === "cancelled"
      ? Number(order.refundAmount || 0)
      : paidOnOrder
        ? orderReturnedValue(order)
        : 0;
  const refundCommitted = grossPaid > 0 ? Math.max(owedBasis, Number(order.partialRefundAmount || 0)) : 0;

  const netPaid = Math.max(grossPaid - refundCommitted, 0) + creditsPaid; // cap invoice model hook karega

  const status = order.orderStatus === "cancelled" || items.length === 0 ? "cancelled" : undefined;

  const refundableAmount = ["refund_pending", "partial_refunded"].includes(order.paymentStatus)
    ? Math.max(owedBasis - Number(order.partialRefundAmount || 0), 0)
    : 0;
  const refundStatus =
    order.paymentStatus === "refunded"
      ? "refunded"
      : order.paymentStatus === "partial_refunded"
        ? "partial_refunded"
        : order.paymentStatus === "refund_pending"
          ? "refund_pending"
          : "none";

  const updated = await updateInvoiceService({
    invoiceId: order.invoiceId,
    source: "order-sync",
    data: {
      items: items.length > 0 ? items : undefined,
      // shipping always comes from the order too; a freight edited on the invoice used to differ from the order
      summary: { paidAmount: netPaid, freightCost: Number(order.shippingCharge) || 0 },
      ...(status ? { status } : {}),
      notes: `Synced with order ${order.orderId} on ${new Date().toLocaleDateString("en-IN")}`,
      refundStatus,
      refundableAmount,
      partialRefundAmount: Number(order.partialRefundAmount || 0),
      refundedAt: order.refundedAt || null,
    },
  });

  if (!status && updated) {
    // Before: "partially_paid" was set even when nothing was paid
    const newStatus =
      Number(updated.summary?.amountToPay) <= 0.01
        ? "paid"
        : Number(updated.summary?.paidAmount) > 0
          ? "partially_paid"
          : "issued";
    if (updated.status !== newStatus) {
      await updateInvoiceService({
        invoiceId: order.invoiceId,
        source: "order-sync",
        data: { status: newStatus },
      });
    }
  }

  return updated;
};

// Old name kept as an alias — createManualReturnService already calls this.
const syncInvoiceForReturn = resyncInvoiceForOrder;
const requiredAddrFields = ["fullName", "phone"]; // street/city/etc optional since it's manual

/* =========================================================
   CREATE MANUAL ORDER — everything comes from frontend directly,
   nothing is looked up against Product/User/Coupon collections.
========================================================= */
/**
 * Create manual order.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createManualOrderService = async (data, currentUser) => {
  /* ---------- EMPLOYEE (only DB reference we keep, for audit) ---------- */
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
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
    throw new BadRequestError("customerName and customerPhone are required", {
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  }

  /* ---------- PAYMENT VALIDATION ---------- */
  const allowedPaymentStatuses = ["paid", "pending"];
  if (!paymentStatus || !allowedPaymentStatuses.includes(paymentStatus)) {
    throw new BadRequestError(`paymentStatus must be one of: ${allowedPaymentStatuses.join(", ")}`, {
      code: ERROR_CODES.INVALID_PAYMENT_STATUS,
    });
  }

  if (paymentStatus === "paid") {
    const allowedMethods = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
    if (!paymentMethod || !allowedMethods.includes(paymentMethod)) {
      throw new BadRequestError(
        `paymentMethod is required and must be one of: ${allowedMethods.join(", ")} when paymentStatus is "paid"`,
        { code: ERROR_CODES.INVALID_PAYMENT_METHOD }
      );
    }
  }

  /* ---------- ITEMS (name + price sent directly, no lookup) ---------- */
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new BadRequestError("items are required", { code: ERROR_CODES.INVALID_ITEMS });
  }

  let subtotal = 0;
  const items = [];

  for (const item of rawItems) {
    const { productName, variantName, sku, price, quantity, notes: itemNotes } = item;

    if (!productName || !productName.trim()) {
      throw new BadRequestError("productName is required for every item", {
        code: ERROR_CODES.INVALID_ITEM_DATA,
      });
    }
    if (price == null || Number.isNaN(Number(price)) || Number(price) <= 0) {
      throw new BadRequestError(`Invalid price for item "${productName}"`, {
        code: ERROR_CODES.INVALID_PRICE,
      });
    }
    if (!quantity || Number(quantity) <= 0) {
      throw new BadRequestError(`Invalid quantity for item "${productName}"`, {
        code: ERROR_CODES.INVALID_QUANTITY,
      });
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
    throw new BadRequestError("shippingAddress is required", { code: ERROR_CODES.ADDRESS_REQUIRED });
  }
  for (const field of requiredAddrFields) {
    if (!shippingAddress[field]) {
      throw new BadRequestError(`shippingAddress.${field} is required`, {
        code: ERROR_CODES.INVALID_ADDRESS,
      });
    }
  }

  const finalBillingAddress =
    billingAddress && typeof billingAddress === "object" ? billingAddress : shippingAddress;

  /* ---------- CALCULATION (no coupon) ---------- */
  const finalDiscount = Math.max(Number(discount) || 0, 0);
  const finalShippingCharge = Math.max(Number(shippingCharge) || 0, 0);
  const finalGstAmount = Math.max(Number(gstAmount) || 0, 0);

  // When the discount was larger than the items, the invoice (which cannot give more than
  // 100% discount) and the order total ended up different.
  if (finalDiscount > subtotal + 0.001) {
    throw new BadRequestError(
      `Discount (${finalDiscount}) can't be more than the items total (${subtotal})`,
      { code: ERROR_CODES.INVALID_DISCOUNT }
    );
  }

  const grandTotal = Math.max(subtotal + finalShippingCharge + finalGstAmount - finalDiscount, 0);
  if (grandTotal <= 0) {
    throw new BadRequestError("Invalid order amount", { code: ERROR_CODES.INVALID_ORDER_AMOUNT });
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
    await generateInvoiceForOrder(order, employee);
  } catch (err) {
    logger.error("Invoice auto-creation failed on manual order create", { error: err.message });
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
    logger.error("Notification failed on manual order create", { error: err.message });
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
      logger.debug("EMAIL ERROR (manual order)", { error: err.message });
    }
  }

  return order;
};

/* =========================================================
   GET SINGLE MANUAL ORDER
========================================================= */
/**
 * Get manual order.
 *
 * @param {*} orderId
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getManualOrderService = async (orderId) => {
  if (!orderId) {
    throw new BadRequestError("orderId is required");
  }
  const order = await ManualOrder.findOne({ orderId })
    .populate("createdBy", "email firstName lastName")
    .lean();
  if (!order) {
    throw new NotFoundError("Manual order not found");
  }

  // Reverse lookup: did some OTHER order's return get settled as store
  // credit (on ITS invoice) that was then spent on THIS order? Credit
  // notes now live entirely on Invoice.refundHistory (see
  // invoice.service.js -> settleInvoiceRefundService), so this looks
  // straight at Invoice rather than at other ManualOrder documents. Looked
  // up fresh every time, so it works for every order regardless of when
  // it was created.
  const creditsReceived = await Invoice.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$refundHistory" },
    {
      $match: {
        "refundHistory.method": "credit_note",
        "refundHistory.appliedToOrderId": orderId,
      },
    },
    {
      $project: {
        _id: 0,
        sourceOrderId: "$sourceOrderId",
        sourceOrderType: "$sourceOrderType",
        sourceInvoiceNumber: "$invoiceNumber",
        amount: "$refundHistory.amount",
        refundedAt: "$refundHistory.refundedAt",
        // What was actually returned on the source invoice — so it never
        // shows up as just a bare amount with no context.
        returnedItems: "$items",
      },
    },
    { $sort: { refundedAt: -1 } },
  ]);
  order.creditsReceived = creditsReceived;

  // Enrich this order's own refundHistory entries with the short invoice
  // number for whatever they were applied to (credit_note entries only) —
  // so the "Refund history" section can show that instead of a bare
  // MORD-<uuid> for the order the credit ended up on. This still reads
  // order.refundHistory itself (kept in sync by the invoice side whenever
  // a settlement happens — see resyncInvoiceForOrder / invoice.service.js).
  // appliedToOrderId can be EITHER a new order's orderId (credit applied to
  // a fresh manual/ecommerce order — matches Invoice.sourceOrderId) OR a
  // standalone invoice's own invoiceId (credit applied directly on a
  // "Create Invoice" invoice with no source order at all — matches
  // Invoice.invoiceId instead, since that invoice IS the order). Match on
  // both, or a credit settled straight onto a standalone invoice would
  // never resolve to a number here.
  const appliedOrderIds = (order.refundHistory || [])
    .filter((r) => r.method === "credit_note" && r.appliedToOrderId)
    .map((r) => r.appliedToOrderId);
  if (appliedOrderIds.length > 0) {
    const appliedInvoices = await Invoice.find({
      $or: [{ sourceOrderId: { $in: appliedOrderIds } }, { invoiceId: { $in: appliedOrderIds } }],
      isDeleted: false,
    })
      .select("sourceOrderId invoiceId invoiceNumber")
      .lean();
    const invoiceNumberByOrderId = {};
    appliedInvoices.forEach((inv) => {
      if (inv.sourceOrderId) invoiceNumberByOrderId[inv.sourceOrderId] = inv.invoiceNumber;
      invoiceNumberByOrderId[inv.invoiceId] = inv.invoiceNumber;
    });
    order.refundHistory = (order.refundHistory || []).map((r) =>
      r.appliedToOrderId && invoiceNumberByOrderId[r.appliedToOrderId]
        ? { ...r, appliedInvoiceNumber: invoiceNumberByOrderId[r.appliedToOrderId] }
        : r
    );
  }

  return order;
};

/* =========================================================
   GET ALL MANUAL ORDERS (paginated)
========================================================= */
/**
 * Get all manual orders.
 *
 * @param {object} params
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 */
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
/**
 * Update manual order status.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateManualOrderStatusService = async (data, currentUser) => {
  const { orderId, status } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    throw new NotFoundError("Manual order not found");
  }

  const currentStatus = order.orderStatus;

  if (["cancelled", "returned"].includes(currentStatus)) {
    throw new BadRequestError(`Order cannot be updated because it is already ${currentStatus}`);
  }

  const statusFlow = {
    placed: ["packed", "confirmed", "shipped"],
    packed: ["confirmed", "shipped"],
    confirmed: ["shipped"],
    shipped: ["delivered"],
  };

  if (currentStatus === status) {
    throw new BadRequestError(`Order already in status ${status}`);
  }

  const allowedNextStatuses = statusFlow[currentStatus] || [];
  if (!allowedNextStatuses.includes(status)) {
    throw new BadRequestError(`Invalid status update: cannot change from "${currentStatus}" to "${status}"`);
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
    logger.error("Notification failed on manual order status update", { error: err.message });
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
/**
 * Update manual order payment status.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateManualOrderPaymentStatusService = async (data, currentUser) => {
  const { orderId, paymentStatus, paymentMethod, paymentReference } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    throw new NotFoundError("Manual order not found");
  }

  const nonEditableStatuses = ["refunded", "refund_pending", "partial_refunded"];
  if (nonEditableStatuses.includes(order.paymentStatus)) {
    throw new BadRequestError(
      `Payment status cannot be changed manually while it is "${order.paymentStatus}"`
    );
  }

  if (order.paymentStatus === paymentStatus) {
    throw new BadRequestError(`Order payment is already "${paymentStatus}"`);
  }

  const oldPaymentStatus = order.paymentStatus;

  if (paymentStatus === "paid") {
    const allowedMethods = ["cash", "upi", "bank_transfer", "cheque", "card", "other"];
    if (!paymentMethod || !allowedMethods.includes(paymentMethod)) {
      throw new BadRequestError(
        `paymentMethod is required and must be one of: ${allowedMethods.join(", ")} when paymentStatus is "paid"`,
        { code: ERROR_CODES.INVALID_PAYMENT_METHOD }
      );
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

  /* ---------- KEEP LINKED INVOICE IN SYNC (non-blocking) ---------- */
  try {
    // back to "pending" = payment reset; the invoice's paid amount also becomes 0 (credits excluded)
    await resyncInvoiceForOrder(order, { keepInvoicePayments: paymentStatus !== "pending" });
  } catch (err) {
    logger.error("Invoice sync failed on manual order payment status update", { error: err.message });
  }

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
    logger.error("Notification failed on manual order payment status update", { error: err.message });
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
/**
 * Cancel manual order.
 *
 * @param {*} orderId
 * @param {*} currentUser
 * @param {*} reason
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const cancelManualOrderService = async (orderId, currentUser, reason) => {
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    throw new NotFoundError("Manual order not found");
  }

  const nonCancellable = ["delivered", "cancelled", "shipped"];
  if (nonCancellable.includes(order.orderStatus)) {
    throw new BadRequestError(`Order cannot be cancelled once ${order.orderStatus}`);
  }

  order.orderStatus = "cancelled";
  order.cancellationReason = reason?.trim() || "Cancelled by staff";
  order.cancelledAt = new Date();

  if (order.paymentStatus === "paid") {
    order.paymentStatus = "refund_pending";
    order.refundAmount = order.grandTotal;
  } else if (order.paymentStatus === "pending" && order.invoiceId) {
    // The order was "pending" but a payment was recorded on the Invoices page;
    // that money must also be paid back to the customer.
    const inv = await Invoice.findOne({ invoiceId: order.invoiceId })
      .select("summary.paidAmount appliedCredits")
      .lean();
    const credits = (inv?.appliedCredits || []).reduce((s, c) => s + Number(c.amount || 0), 0);
    const cash = round2(Math.max(Number(inv?.summary?.paidAmount || 0) - credits, 0));
    if (cash > 0) {
      order.paymentStatus = "refund_pending";
      order.refundAmount = cash;
    }
  }

  await order.save();

  /* ---------- KEEP LINKED INVOICE IN SYNC (non-blocking) ---------- */
  try {
    await resyncInvoiceForOrder(order);
  } catch (err) {
    logger.error("Invoice sync failed on manual order cancel", { error: err.message });
  }

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
    logger.error("Notification failed on manual order cancel", { error: err.message });
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
   NOTE: the "refund it right now" (refundNow) path below still writes
   directly to order.partialRefundAmount / order.paymentStatus /
   order.refundHistory, because it's an atomic part of recording the
   return itself (staff tick one box: "return + refund together"). Going
   back later to settle a refund that was NOT paid at return time is now
   exclusively done on the invoice (settleInvoiceRefundService) — see
   resyncInvoiceForOrder, which reports the resulting "still owed" amount
   to the invoice right after this saves.
========================================================= */
/**
 * Create manual return.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createManualReturnService = async (data, currentUser) => {
  const { orderId, returnItems, refundNow, refundMethod, notes } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    throw new NotFoundError("Manual order not found");
  }

  const allowedStatuses = ["placed", "packed", "confirmed", "shipped", "delivered", "partial_returned"];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new BadRequestError(`Order cannot be returned. Current status: ${order.orderStatus}`);
  }

  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new BadRequestError("returnItems are required");
  }

  const validatedItems = [];
  let refundableAmount = 0;

  for (const item of returnItems) {
    const { productName, variantName, quantity, reason } = item;
    if (!productName || !quantity || Number(quantity) <= 0) {
      throw new BadRequestError("Invalid return item data");
    }

    const orderItem = order.items.find(
      (o) => o.productName === productName && (o.variantName || "") === (variantName || "")
    );
    if (!orderItem) {
      throw new NotFoundError(`Item not found in order: ${productName}`);
    }

    const availableQty = Number(orderItem.quantity) - Number(orderItem.returnedQuantity || 0);
    if (Number(quantity) > availableQty) {
      throw new BadRequestError(`Return quantity exceeds available quantity for ${orderItem.productName}`);
    }

    orderItem.returnedQuantity = Number(orderItem.returnedQuantity || 0) + Number(quantity);
    // what the customer actually paid after discount is what goes back (ReturnOrderModal shows the same)
    refundableAmount = round2(refundableAmount + returnLineValue(order, orderItem.price, quantity));

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

  const totalActiveQty = order.items.reduce(
    (sum, i) => sum + (Number(i.quantity) - Number(i.returnedQuantity || 0)),
    0
  );
  const totalReturnedQty = order.items.reduce((sum, i) => sum + Number(i.returnedQuantity || 0), 0);
  order.orderStatus = totalActiveQty === 0 && totalReturnedQty > 0 ? "returned" : "partial_returned";

  const wasPaid =
    Boolean(order.paidAt) && ["paid", "refund_pending", "partial_refunded"].includes(order.paymentStatus);

  if (refundNow && !wasPaid) {
    throw new BadRequestError(
      "This order hasn't been paid yet — there is nothing to refund. Record the return without a refund; the invoice total just goes down.",
      { code: ERROR_CODES.ORDER_NOT_PAID }
    );
  }

  if (!wasPaid) {
    // Unpaid order: a return only lowers the bill. Before, this also
    // set "refund_pending" and the ledger showed the company owing money.
  } else if (refundNow) {
    const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other"];
    if (!refundMethod || !allowedMethods.includes(refundMethod)) {
      throw new BadRequestError(`refundMethod is required and must be one of: ${allowedMethods.join(", ")}`);
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
    logger.error("Invoice auto-update failed on manual return", { error: err.message });
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
    logger.error("Notification failed on manual return", { error: err.message });
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
/**
 * Get manual order analytics.
 *
 * @param {*} query
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
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
        throw new BadRequestError("Invalid startDate", { code: ERROR_CODES.VALIDATION_ERROR });
      }
      match.createdAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (Number.isNaN(to.getTime())) {
        throw new BadRequestError("Invalid endDate", { code: ERROR_CODES.VALIDATION_ERROR });
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
                $cond: [{ $eq: ["$totalOrders", 0] }, 0, { $divide: ["$totalRevenue", "$totalOrders"] }],
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
   Groups every INVOICE by customer (billTo phone + name) and works out,
   per customer, whether the company still owes them money (pending
   refunds from returns / cancellations) or the customer still owes the
   company (unpaid invoice balance). The Invoice is the single source of
   truth for money (manual orders, ecommerce orders and standalone
   "Create Invoice" invoices all end up here), so the ledger no longer
   reads ManualOrder at all.

   Per invoice:
     - totalReturnedValue = refundableAmount + partialRefundAmount
                            (everything ever raised as a refund on this
                             invoice: still pending + already settled)
     - owedToCustomer     = refundableAmount
                            (refund still pending — invoice.refundStatus
                             is "refund_pending" / "partial_refunded")
     - owedByCustomer     = summary.amountToPay, only for issued /
                            partially_paid invoices (draft and cancelled
                            invoices never count as receivable)

   netBalance = owedByCustomer - owedToCustomer
     > 0  -> "customer_owes"   (customer still owes the company)
     < 0  -> "company_owes"    (company owes the customer a refund)
     = 0  -> "settled"
========================================================= */
/**
 * Get customer balance ledger.
 *
 * @param {*} query
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getCustomerBalanceLedgerService = async (query) => {
  const { startDate, endDate, search, balanceStatus, sortBy } = query;

  const match = { isDeleted: false };
  if (startDate || endDate) {
    match.invoiceDate = {};
    if (startDate) {
      const from = new Date(startDate);
      if (Number.isNaN(from.getTime())) {
        throw new BadRequestError("Invalid startDate", { code: ERROR_CODES.VALIDATION_ERROR });
      }
      match.invoiceDate.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (Number.isNaN(to.getTime())) {
        throw new BadRequestError("Invalid endDate", { code: ERROR_CODES.VALIDATION_ERROR });
      }
      to.setHours(23, 59, 59, 999);
      match.invoiceDate.$lte = to;
    }
  }

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        // billTo.contactPerson is the customer's own name (companyName can
        // be an organization shared by several people), so prefer it and
        // fall back to companyName only if it was left empty.
        customerName: {
          $cond: [
            { $gt: [{ $strLenCP: { $ifNull: ["$billTo.contactPerson", ""] } }, 0] },
            "$billTo.contactPerson",
            { $ifNull: ["$billTo.companyName", ""] },
          ],
        },
        customerPhone: { $ifNull: ["$billTo.contactNumber", ""] },
        invoiceTotal: { $ifNull: ["$summary.totalPayAmount", 0] },
        owedToCustomer: { $max: [{ $ifNull: ["$refundableAmount", 0] }, 0] },
        owedByCustomer: {
          $cond: [
            { $in: ["$status", ["issued", "partially_paid"]] },
            { $max: [{ $ifNull: ["$summary.amountToPay", 0] }, 0] },
            0,
          ],
        },
        totalReturnedValue: {
          $add: [{ $ifNull: ["$refundableAmount", 0] }, { $ifNull: ["$partialRefundAmount", 0] }],
        },
        isCreditNote: { $literal: false },
      },
    },
    /* ---------- NEW: OPEN CREDIT NOTES ----------
       A credit note's unused balance is money the company still owes the
       customer. Return credit notes were already paid down off the
       invoice's refundableAmount when issued, and manual ones never touch
       the invoice — so adding balance here never double counts. */
    {
      $unionWith: {
        coll: CreditNote.collection.name,
        pipeline: [
          {
            $match: {
              isDeleted: false,
              status: { $in: ["open", "partially_used"] },
              balance: { $gt: 0 },
              ...(match.invoiceDate ? { creditNoteDate: match.invoiceDate } : {}),
            },
          },
          {
            $project: {
              _id: 0,
              isCreditNote: { $literal: true },
              customerName: {
                $cond: [
                  { $gt: [{ $strLenCP: { $ifNull: ["$billTo.contactPerson", ""] } }, 0] },
                  "$billTo.contactPerson",
                  { $ifNull: ["$billTo.companyName", ""] },
                ],
              },
              customerPhone: { $ifNull: ["$billTo.contactNumber", ""] },
              invoiceTotal: { $literal: 0 },
              owedToCustomer: "$balance",
              owedByCustomer: { $literal: 0 },
              // manual credit notes are extra value given back; return ones
              // are already inside the invoice's partialRefundAmount
              totalReturnedValue: {
                $cond: [{ $eq: ["$type", "manual"] }, "$summary.totalAmount", 0],
              },
              invoiceDate: "$creditNoteDate",
              invoiceId: "$creditNoteId",
              invoiceNumber: "$creditNoteNumber",
              sourceOrderId: "$creditNoteNumber",
              sourceOrderType: { $literal: "credit_note" },
              status: { $literal: "credit_note" },
              refundStatus: "$status",
              summary: { paidAmount: { $literal: 0 } },
            },
          },
        ],
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
        totalOrders: { $sum: { $cond: ["$isCreditNote", 0, 1] } },
        totalOrderValue: { $sum: "$invoiceTotal" },
        totalReturnedValue: { $sum: "$totalReturnedValue" },
        totalOwedToCustomer: { $sum: "$owedToCustomer" },
        totalOwedByCustomer: { $sum: "$owedByCustomer" },
        lastOrderAt: { $max: "$invoiceDate" },
        orders: {
          $push: {
            invoiceId: "$invoiceId",
            invoiceNumber: "$invoiceNumber",
            orderId: { $ifNull: ["$sourceOrderId", "$invoiceNumber"] },
            sourceOrderType: "$sourceOrderType",
            invoiceStatus: "$status",
            refundStatus: "$refundStatus",
            grandTotal: "$invoiceTotal",
            paidAmount: { $ifNull: ["$summary.paidAmount", 0] },
            totalReturnedValue: "$totalReturnedValue",
            owedToCustomer: "$owedToCustomer",
            owedByCustomer: "$owedByCustomer",
            createdAt: "$invoiceDate",
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
      $match: { $or: [{ customerName: regex }, { customerPhone: regex }] },
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

  const customers = await Invoice.aggregate(pipeline);

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
/**
 * Update manual order courier.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateManualOrderCourierService = async (data, currentUser) => {
  const { orderId, corourseServiceName, DOCNumber } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const order = await ManualOrder.findOne({ orderId });
  if (!order) {
    throw new NotFoundError("Manual order not found");
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
