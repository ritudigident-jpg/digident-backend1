/**
 * Zoho Mail API settings from the ZOHO_* environment variables.
 *
 * Exports: zohoConfig
 * Used by: controllers/zoho/zoho.controller.js, services/zoho/zohoauth.service.js,
 * services/zoho/zohomail.service.js
 */

export const zohoConfig = {
  accountsUrl: "https://accounts.zoho.in",
  mailApiUrl: "https://mail.zoho.in/api/accounts",
  clientId: process.env.ZOHO_CLIENT_ID,
  clientSecret: process.env.ZOHO_CLIENT_SECRET,
  redirectUri: process.env.ZOHO_REDIRECT_URI,
  refreshToken: process.env.ZOHO_REFRESH_TOKEN,
  accountId: process.env.ZOHO_ACCOUNT_ID,
  senderEmail: process.env.ZOHO_EMAIL,
};
