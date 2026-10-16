/**
 * HTTP handlers for adminemail.controller.js: read the request, call the service, send the
 * response. No business logic here.
 *
 * Exports: sendLowStockAlertToAdmins
 * Used by: services/order/order.service.js
 */

import { lowStockAlertTemplate } from "../../templates/email/lowstockalert.template.js";
import Employee from "../../models/employee.model.js";
import { sendZohoMail } from "../../services/zoho/zohomail.service.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * @function sendLowStockAlertToAdmins
 *
 * @description
 * Send a low stock alert email to all Admin and Super Admin users
 * whenever one or more products fall below the configured stock threshold.
 *
 * @params
 * lowStockProducts: Array<{
 *   productName: string,
 *   sku: string,
 *   stock: number,
 *   ...
 * }>
 *
 * @process
 * 1. Check if lowStockProducts array is empty.
 * 2. Fetch all Admin and Super Admin employees.
 * 3. Extract valid email addresses.
 * 4. Generate HTML email using lowStockAlertTemplate().
 * 5. Send email via Zoho Mail.
 * 6. Log success or failure.
 *
 * @returns
 * Promise<void>
 *
 * @errors
 * Logs error if email sending fails.
 */
export const sendLowStockAlertToAdmins = async (lowStockProducts) => {
  try {
    if (!lowStockProducts || lowStockProducts.length === 0) return;

    // Fetch Admin & SuperAdmin
    const admins = await Employee.find({
      role: { $in: [0, 1] },
    }).select("email");

    const adminEmails = admins.map((a) => a.email).filter(Boolean);

    if (adminEmails.length === 0) return;

    // Generate Email HTML
    const html = lowStockAlertTemplate(lowStockProducts);

    // Send Mail
    await sendZohoMail(adminEmails.join(","), "⚠ Low Stock Alert (Below 50)", html);
    logger.debug("Low stock alert sent to", { adminEmails });
  } catch (error) {
    logger.error("LOW STOCK ALERT ERROR", { error: error.message });
  }
};
