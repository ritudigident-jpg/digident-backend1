/**
 * Business logic for Zoho Mail (account lookup, OAuth setup and sending e-mail). Throws AppError
 * subclasses on failure.
 *
 * Exports: sendZohoMail
 * Used by: 8 files, e.g. controllers/adminemail/adminemail.controller.js,
 * controllers/jobapplication/jobapplication.controller.js, services/contact/contact.service.js,
 * services/employee/employee.service.js
 */

import axios from "axios";
import { getZohoAccessToken } from "./zohoauth.service.js";
import { zohoConfig } from "../../config/zoho.config.js";
import { ExternalServiceError } from "../../helpers/apperror.helper.js";

const ZOHO_TIMEOUT_MS = 10_000;

/**
 * Send zoho mail.
 *
 * @param {*} to
 * @param {*} subject
 * @param {*} content
 * @returns {Promise<*>}
 * @throws {ExternalServiceError} 502 when an external service (S3, Zoho, Razorpay) fails.
 */
export const sendZohoMail = async (to, subject, content) => {
  try {
    const accessToken = await getZohoAccessToken();
    const url = `${zohoConfig.mailApiUrl}/${zohoConfig.accountId}/messages`;
    const body = {
      fromAddress: zohoConfig.senderEmail,
      toAddress: to,
      subject,
      content,
      mailFormat: "html",
    };
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: ZOHO_TIMEOUT_MS,
    });
    return response.data;
  } catch (err) {
    throw new ExternalServiceError("Zoho Mail Sending Failed", { cause: err });
  }
};
