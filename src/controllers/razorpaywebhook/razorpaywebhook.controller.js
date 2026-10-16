/**
 * HTTP handlers for Razorpay webhook (refund events): read the request, call the service, send the
 * response. No business logic here.
 *
 * Exports: razorpayWebhook
 * Used by: routes/razorpaywebhook.routes.js
 */

/**
 * Razorpay webhook: checks the signature first, then applies refund events to the order in one
 * transaction. Other events are acknowledged and ignored.
 *
 * Route: POST /api/webhook/razorpay
 * Used by: routes/razorpaywebhook.routes.js
 */
import crypto from "node:crypto";
import mongoose from "mongoose";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { AppError, UnauthorizedError } from "../../helpers/apperror.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { logger } from "../../helpers/logger.helper.js";
import {
  REFUND_EVENTS,
  applyRefundEventService,
} from "../../services/razorpaywebhook/razorpaywebhook.service.js";

/**
 * Handles one Razorpay webhook call. Expects the raw request body (Buffer) for the signature.
 */
export const razorpayWebhook = asyncHandler(async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) throw new AppError("Webhook secret not configured");

  const razorpaySignature = req.headers["x-razorpay-signature"];
  if (!razorpaySignature) throw new UnauthorizedError("Signature missing");

  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(req.body).digest("hex");
  if (expectedSignature !== razorpaySignature) throw new UnauthorizedError("Invalid webhook signature");

  const payload = JSON.parse(req.body.toString());
  const { event } = payload;
  logger.info("Razorpay webhook received", { requestId: req.id, event });

  if (!REFUND_EVENTS.has(event)) return sendSuccess(res, { data: {}, message: "Event ignored" });

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const message = await applyRefundEventService({
      event,
      refund: payload?.payload?.refund?.entity,
      session,
    });
    await session.commitTransaction();
    return sendSuccess(res, { data: {}, message });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
});
