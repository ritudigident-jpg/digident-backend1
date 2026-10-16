/**
 * Business logic for Razorpay webhook (refund events). Throws AppError subclasses on failure.
 *
 * Exports: REFUND_EVENTS, applyRefundEventService
 * Used by: controllers/razorpaywebhook/razorpaywebhook.controller.js
 */

/**
 * Applies Razorpay refund events to the matching order (inside the caller's transaction).
 * refund.created  -> paymentStatus "refund_pending" (unless already refunded)
 * refund.processed -> adds the refund amount; "refunded" when the total refunds reach the order's
 *                    grand total, else "partially_refunded". The same refund id twice is ignored.
 * refund.failed   -> paymentStatus "refund_failed" (unless already refunded)
 * Example: grand total 1,000, refund of 400 processed -> refundAmount 400, "partially_refunded".
 *
 * Used by: controllers/razorpaywebhook/razorpaywebhook.controller.js
 */
import Order from "../../models/order.model.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";

export const REFUND_EVENTS = new Set(["refund.created", "refund.processed", "refund.failed"]);
const PAISE_PER_RUPEE = 100;

/**
 * Updates the order for one refund event.
 *
 * @param {object} params
 * @param {string} params.event One of REFUND_EVENTS.
 * @param {object} params.refund Razorpay refund entity (payload.payload.refund.entity).
 * @param {import("mongoose").ClientSession} params.session Open transaction.
 * @returns {Promise<string>} The message to send back ("Refund webhook processed" / "Refund already processed").
 * @throws {BadRequestError} When the payload has no refund entity.
 * @throws {NotFoundError} When no order has this payment id.
 */
export const applyRefundEventService = async ({ event, refund, session }) => {
  if (!refund) throw new BadRequestError("Invalid refund payload");

  const razorpayRefundId = refund.id;
  const refundAmount = refund.amount / PAISE_PER_RUPEE;
  const order = await Order.findOne({ razorpayPaymentId: refund.payment_id }).session(session);
  if (!order) throw new NotFoundError("Order not found for refund");

  if (event === "refund.created" && order.paymentStatus !== "refunded") {
    order.paymentStatus = "refund_pending";
  }

  if (event === "refund.processed") {
    // Razorpay can send the same event twice: apply each refund id only once.
    if (order.razorpayRefundId === razorpayRefundId) return "Refund already processed";
    order.razorpayRefundId = razorpayRefundId;
    order.refundAmount = (order.refundAmount || 0) + refundAmount;
    order.paymentStatus = order.refundAmount >= order.grandTotal ? "refunded" : "partially_refunded";
    order.refundedAt = new Date();
  }

  if (event === "refund.failed" && order.paymentStatus !== "refunded") {
    order.paymentStatus = "refund_failed";
  }

  await order.save({ session });
  return "Refund webhook processed";
};
