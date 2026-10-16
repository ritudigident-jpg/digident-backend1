/**
 * HTTP handlers for Zoho Mail (account lookup, OAuth setup and sending e-mail): read the request,
 * call the service, send the response. No business logic here.
 *
 * Exports: getAccountId, exchangeZohoAuthCode
 * Used by: routes/zoho.routes.js, routes/zohoauth.routes.js
 */

/**
 * Zoho Mail account lookup: returns the primary accountId needed to send mail through Zoho.
 *
 * Route: GET /api/zoho/accounts
 * Used by: routes/zoho.routes.js
 */
import axios from "axios";
import { getZohoAccessToken } from "../../services/zoho/zohoauth.service.js";
import { zohoConfig } from "../../config/zoho.config.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import {
  AppError,
  BadRequestError,
  ExternalServiceError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { sendSuccess } from "../../helpers/response.helper.js";

const ZOHO_TIMEOUT_MS = 10_000;

/**
 * Fetches the Zoho Mail accounts and returns the first accountId.
 *
 * Errors: 401 ZOHO_AUTH_FAILED, 404 ZOHO_ACCOUNT_NOT_FOUND, 502 ZOHO_API_ERROR,
 * 500 ZOHO_INVALID_RESPONSE.
 */
export const getAccountId = asyncHandler(async (req, res) => {
  const accessToken = await getZohoAccessToken();
  if (!accessToken) {
    throw new UnauthorizedError("Failed to generate Zoho access token", {
      code: ERROR_CODES.ZOHO_AUTH_FAILED,
    });
  }

  let data;
  try {
    const response = await axios.get(`${zohoConfig.mailApiUrl}/v1/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      timeout: ZOHO_TIMEOUT_MS,
    });
    data = response?.data;
  } catch (error) {
    throw new ExternalServiceError(error.response?.data?.message || "Zoho API error", {
      code: ERROR_CODES.ZOHO_API_ERROR,
      cause: error,
    });
  }

  if (!data?.data || data.data.length === 0) {
    throw new NotFoundError("No Zoho accounts found", { code: ERROR_CODES.ZOHO_ACCOUNT_NOT_FOUND });
  }

  const accountId = data.data[0]?.accountId;
  if (!accountId) {
    throw new AppError("Invalid Zoho response structure", { code: ERROR_CODES.ZOHO_INVALID_RESPONSE });
  }

  return sendSuccess(res, {
    data: { accountId, accounts: data.data },
    message: "Zoho accounts fetched successfully",
  });
});

/**
 * One-time Zoho setup: Zoho redirects here with ?code=..., which is exchanged for an access and
 * refresh token. Put the refresh token in ZOHO_REFRESH_TOKEN. Tokens are never logged.
 *
 * Route: GET /oauth/redirect
 * Response keeps the old top-level token keys next to `data`.
 */
export const exchangeZohoAuthCode = asyncHandler(async (req, res) => {
  const { code } = req.query;
  if (!code) throw new BadRequestError("No code provided");

  const params = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    redirect_uri: process.env.ZOHO_REDIRECT_URI,
  });

  let data;
  try {
    const response = await axios.post(`${zohoConfig.accountsUrl}/oauth/v2/token`, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: ZOHO_TIMEOUT_MS,
    });
    data = response.data;
  } catch (error) {
    throw new ExternalServiceError("Token exchange failed", {
      code: ERROR_CODES.ZOHO_AUTH_FAILED,
      cause: error,
    });
  }

  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    api_domain: data.api_domain,
    token_type: data.token_type,
  };
  return sendSuccess(res, { data: tokens, message: "Zoho tokens issued", legacyTopLevel: tokens });
});
