/**
 * Business logic for Zoho Mail (account lookup, OAuth setup and sending e-mail). Throws AppError
 * subclasses on failure.
 *
 * Exports: getZohoAccessToken
 * Used by: controllers/zoho/zoho.controller.js, services/zoho/zohomail.service.js
 */

import axios from "axios";
import { zohoConfig } from "../../config/zoho.config.js";
import { ExternalServiceError } from "../../helpers/apperror.helper.js";

const ZOHO_TIMEOUT_MS = 10_000;
// Refresh the token 2 minutes before Zoho says it expires.
const TOKEN_EXPIRY_MARGIN_SECONDS = 120;

let accessTokenCache = null;
let accessTokenExpiry = null;
/**
 * Get zoho access token.
 *
 * @returns {Promise<*>}
 * @throws {ExternalServiceError} 502 when an external service (S3, Zoho, Razorpay) fails.
 */
export const getZohoAccessToken = async () => {
  const currentTime = Date.now();
  //  If token is cached and NOT expired
  if (accessTokenCache && accessTokenExpiry && currentTime < accessTokenExpiry) {
    return accessTokenCache;
  }
  try {
    const response = await axios.post(`${zohoConfig.accountsUrl}/oauth/v2/token`, null, {
      timeout: ZOHO_TIMEOUT_MS,
      params: {
        grant_type: "refresh_token",
        client_id: zohoConfig.clientId,
        client_secret: zohoConfig.clientSecret,
        refresh_token: zohoConfig.refreshToken,
      },
    });
    const { access_token, expires_in } = response.data;
    accessTokenCache = access_token;
    accessTokenExpiry = Date.now() + (expires_in - TOKEN_EXPIRY_MARGIN_SECONDS) * 1000;
    return access_token;
  } catch (err) {
    throw new ExternalServiceError("Failed to refresh Zoho access token", { cause: err });
  }
};
