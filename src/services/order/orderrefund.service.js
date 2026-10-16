/**
 * Refunds of shop orders through Razorpay (customer-requested and admin-triggered). Re-exported by order.service.js.
 */
import { v6 as uuidv6 } from "uuid";
import Order from "../../models/order.model.js";
import Employee from "../../models/employee.model.js";
import { razorpayInstance } from "../../config/razorpay.config.js";
import mongoose from "mongoose";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendNotification } from "../notification/notification.service.js";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Mark refund completed.
 *
 * @param {*} orderId
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const markRefundCompletedService = async (orderId, currentUser) => {
  if (!currentUser?._id) {
    throw new UnauthorizedError("Unauthorized user");
  }

  const order = await Order.findOne({ orderId });
  if (!order) throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });

  // Allow either the order's owner (typical post-cancel flow triggered by the
  // customer) or an authorized employee to complete the refund.
  const isOwner = order.user?.toString() === currentUser._id.toString();
  const employee = await Employee.findOne({ email: currentUser.email });
  if (!isOwner && !employee) {
    throw new ForbiddenError("Not authorized to process this refund");
  }

  if (order.orderStatus !== "cancelled") throw new BadRequestError("Order is not cancelled");
  if (order.paymentStatus === "refunded") throw new BadRequestError("Refund already completed");
  if (order.paymentStatus !== "refund_pending") throw new BadRequestError("Refund not in pending state");
  if (!order.razorpayPaymentId) throw new BadRequestError("Razorpay paymentId not found");
  if (!order.refundAmount || order.refundAmount <= 0) throw new BadRequestError("Invalid refund amount");

  // Process Razorpay refund
  const refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
    amount: Math.round(order.refundAmount * 100),
    speed: "normal",
    notes: {
      orderId: order.orderId,
      reason: order.cancellationReason || "Order cancelled refund",
    },
  });

  // Update order after refund
  order.paymentStatus = "refunded";
  order.refundedAt = new Date();
  order.razorpayRefundId = refund.id;
  order.refundHistory = order.refundHistory || [];
  order.refundHistory.push({
    refundId: refund.id,
    amount: order.refundAmount,
    refundStatus: refund.status || "processed",
    refundedAt: new Date(),
  });

  await order.save();

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: currentUser._id,
      permission: "sales.order.update",
      title: "Order Refunded",
      message: `Refund completed for order ${order.orderId}`,
      type: "ORDER_REFUNDED",
      entityId: order._id,
      entityModel: "Order",
      metadata: {
        orderId: order.orderId,
        processedBy: employee?.email || currentUser.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on refund complete", { error: err.message });
  }

  return {
    orderId: order.orderId,
    orderStatus: order.orderStatus,
    paymentStatus: order.paymentStatus,
    refundAmount: order.refundAmount,
    refundedAt: order.refundedAt,
    razorpayRefundId: refund.id,
    razorpayRefundStatus: refund.status,
  };
};

/**
 * Mark refund complete admin.
 *
 * @param {object} params
 * @param {*} params.orderId
 * @param {*} params.amount
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const markRefundCompleteAdminService = async ({ orderId, amount }, currentUser) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ---------- EMPLOYEE ---------- */
    const employee = await Employee.findOne({ email: currentUser.email }).session(session);

    if (!employee) {
      throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
    }

    /* ---------- ORDER ---------- */
    const order = await Order.findOne({ orderId }).session(session);

    if (!order) {
      throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
    }

    /* ---------- STATUS VALIDATION ---------- */
    if (!["returned", "partial_returned"].includes(order.orderStatus)) {
      throw new BadRequestError(`Order is not eligible for refund. Current status: ${order.orderStatus}`);
    }

    if (!["refund_pending", "partial_refunded"].includes(order.paymentStatus)) {
      throw new BadRequestError(`Refund not allowed. Current paymentStatus: ${order.paymentStatus}`);
    }

    if (!order.razorpayPaymentId) {
      throw new BadRequestError("Razorpay paymentId not found");
    }

    /* ---------- RAZORPAY FETCH ---------- */
    let paymentDetails;
    try {
      paymentDetails = await razorpayInstance.payments.fetch(order.razorpayPaymentId);
    } catch (rzpErr) {
      throw new BadRequestError(
        rzpErr?.error?.description || `Could not fetch payment ${order.razorpayPaymentId} from Razorpay`
      );
    }

    /* ---------- PAYMENT STATE GUARD ----------
       Razorpay can only refund a payment that is in the "captured" state.
       An "authorized" (not captured) payment, or one already "refunded",
       makes payments.refund() throw an opaque error — catch it early with
       a message the operator can act on. */
    if (paymentDetails.status === "refunded") {
      throw new BadRequestError("This payment is already fully refunded on Razorpay");
    }
    if (paymentDetails.status !== "captured") {
      throw new BadRequestError(
        `Payment is "${paymentDetails.status}", not "captured" — Razorpay cannot refund it yet`
      );
    }

    const totalPaidAmount = paymentDetails.amount / 100;

    // Trust Razorpay's own refunded figure, not just our local counter — a
    // refund done straight from the Razorpay dashboard would otherwise be missed.
    const rzpAlreadyRefunded = (paymentDetails.amount_refunded || 0) / 100;
    const alreadyRefundedAmount = Math.max(order.partialRefundAmount || 0, rzpAlreadyRefunded);
    const remainingRefundableAmount = totalPaidAmount - alreadyRefundedAmount;

    if (remainingRefundableAmount <= 0) {
      throw new BadRequestError("No refundable amount left");
    }

    /* ---------- REFUND AMOUNT ---------- */
    let refundAmount = remainingRefundableAmount;

    if (amount !== undefined && amount !== null) {
      if (typeof amount !== "number" || amount <= 0) {
        throw new BadRequestError("Invalid refund amount");
      }

      if (amount > remainingRefundableAmount) {
        throw new BadRequestError(
          `Refund amount exceeds remaining refundable amount ₹${remainingRefundableAmount}`
        );
      }

      refundAmount = amount;
    }

    /* ---------- PROCESS REFUND ---------- */
    let refund;
    try {
      refund = await razorpayInstance.payments.refund(order.razorpayPaymentId, {
        amount: Math.round(refundAmount * 100),
        notes: {
          orderId: order.orderId,
          refundedBy: employee.email,
        },
      });
    } catch (rzpErr) {
      throw new BadRequestError(rzpErr?.error?.description || rzpErr?.message || "Razorpay refund failed");
    }

    /* ---------- UPDATE ORDER ---------- */
    const newTotalRefunded = alreadyRefundedAmount + refundAmount;
    const newRemainingAmount = totalPaidAmount - newTotalRefunded;

    order.partialRefundAmount = newTotalRefunded;
    order.remainingRefundAmount = newRemainingAmount;
    order.paymentStatus = newTotalRefunded >= totalPaidAmount ? "refunded" : "partial_refunded";

    order.refundedAt = new Date();
    order.razorpayRefundId = refund.id;

    order.refundHistory = order.refundHistory || [];
    order.refundHistory.push({
      refundId: refund.id,
      amount: refundAmount,
      refundedBy: employee.email,
      refundedAt: new Date(),
      refundStatus: refund.status,
    });

    await order.save({ session });

    /* ---------- AUDIT LOG ---------- */
    await PermissionAudit.create(
      [
        {
          permissionAuditId: uuidv6(),
          actionBy: employee._id,
          actionByEmail: employee.email,
          actionFor: order._id,
          actionForEmail: null,
          permission: "initiate_refund",
          action: "refund",
          meta: {
            orderId: order.orderId,
            amount: refundAmount,
          },
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    /* ---------- NOTIFICATION (after commit) ---------- */
    try {
      await sendNotification({
        sender: employee._id,
        permission: "sales.order.update",
        title: "Order Refund Updated",
        message: `Order refund processed for ${order.orderId}`,
        type: "ORDER_REFUND_UPDATED",
        entityId: order._id,
        entityModel: "Order",
        metadata: {
          orderId: order.orderId,
          amount: refundAmount,
          processedBy: employee.email || null,
        },
      });
    } catch (err) {
      logger.error("Notification failed on admin refund complete", { error: err.message });
    }

    return {
      orderId: order.orderId,
      orderStatus: order.orderStatus,
      paymentStatus: order.paymentStatus,
      totalPaidAmount,
      totalRefundedAmount: newTotalRefunded,
      remainingRefundableAmount: newRemainingAmount,
      refundedNow: refundAmount,
      refundedAt: order.refundedAt,
      razorpayRefundId: refund.id,
      refundHistory: order.refundHistory,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};
