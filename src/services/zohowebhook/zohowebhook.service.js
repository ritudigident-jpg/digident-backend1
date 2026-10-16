/**
 * Business logic for Zoho payment webhook (not mounted). Throws AppError subclasses on failure.
 *
 * Exports: zohoWebhookService
 * Used by: controllers/zohowebhook/zohowebhook.controller.js
 */

import crypto from "crypto";
import Order from "../../models/order.model.js";
import { UnauthorizedError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Zoho webhook.
 *
 * @param {*} rawBody
 * @param {*} headers
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const zohoWebhookService = async (rawBody, headers) => {
  const zohoSignature = headers["x-zoho-signature"];
  const secret = process.env.ZOHO_WEBHOOK_SECRET;

  // 1️⃣ Verify signature
  const generatedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

  if (generatedSignature !== zohoSignature) {
    throw new UnauthorizedError("Invalid webhook signature");
  }

  // 2️⃣ Parse payload
  const payload = JSON.parse(rawBody.toString());
  const eventType = payload.event_type;
  logger.debug("Zoho Webhook Event", { eventType });

  // 3️⃣ Handle events
  if (eventType === "payment.success") {
    const payment = payload.data.payment;
    await Order.findOneAndUpdate(
      { orderId: payment.reference_number },
      {
        isPaid: true,
        paymentId: payment.payment_id,
        paymentStatus: "SUCCESS",
      }
    );
  }

  if (eventType === "payment.failed") {
    const payment = payload.data.payment;
    await Order.findOneAndUpdate({ orderId: payment.reference_number }, { paymentStatus: "FAILED" });
  }

  if (eventType === "refund.processed") {
    logger.debug("Refund processed for order", { refund: payload.data.refund });
  }

  return { processed: true };
};
