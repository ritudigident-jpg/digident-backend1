import { lowStockAlertTemplate } from "../config/templates/lowStockAlertTemplate.js";
import Employee from "../models/employeeModel.js";
import { sendZohoMail } from "../services/ZohoEmail/zohoMail.service.js";

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
    await sendZohoMail(
      adminEmails.join(","), 
      "⚠ Low Stock Alert (Below 50)",
      html
    );
    console.log("Low stock alert sent to:", adminEmails);
  } catch (error) {
    console.error("LOW STOCK ALERT ERROR:", error.message);
  }
};