/**
 * HTTP handlers for Zoho payment webhook (not mounted): read the request, call the service, send
 * the response. No business logic here.
 *
 * Exports: zohoWebhookHandler
 * Used by: routes/zohowebhook.routes.js
 */

/**
 * Zoho payment webhook: the service checks the HMAC signature and updates the order.
 * NOTE: routes/zohowebhook.routes.js is not mounted in app.js, so this endpoint is not live.
 *
 * Used by: routes/zohowebhook.routes.js
 */
import { zohoWebhookService } from "../../services/zohowebhook/zohowebhook.service.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";

/**
 * Handles one Zoho webhook call. The raw body is required for the signature check.
 * Errors: 401 invalid signature (thrown by the service with statusCode 401).
 */
export const zohoWebhookHandler = asyncHandler(async (req, res) => {
  const result = await zohoWebhookService(req.body, req.headers);
  return sendSuccess(res, { data: result, message: "Webhook processed successfully" });
});
