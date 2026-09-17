/**
 * backfillOrdersFromInvoices.js
 *
 * PURPOSE
 * -------
 * You already have Invoice documents that were created directly through the
 * invoice backend (/invoice/manage/create), completely bypassing the
 * ManualOrder flow. Because Orders List / Customer Ledger / Credit Notes are
 * all powered by the ManualOrder collection (not Invoice), those pages show
 * empty even though invoices exist.
 *
 * This script reads every existing Invoice and creates a matching
 * ManualOrder document for it — directly via Mongoose (NOT via
 * createManualOrderService / POST /manual-order/create), so it will NOT
 * auto-generate a duplicate invoice. The new ManualOrder is linked to the
 * EXISTING invoice via order.invoiceId.
 *
 * SAFETY
 * ------
 * - Idempotent: skips any invoice that already has a ManualOrder pointing
 *   to it (order.invoiceId === invoice.invoiceId), so re-running is safe.
 * - Dry-run by default. Nothing is written unless you pass --confirm.
 *
 * USAGE
 * -----
 *   node backfillOrdersFromInvoices.js --employee-email=someone@digident.in
 *       -> dry run, just prints what WOULD be created
 *
 *   node backfillOrdersFromInvoices.js --employee-email=someone@digident.in --confirm
 *       -> actually creates the ManualOrder documents
 *
 * Run this from inside your backend project (needs access to the same
 * Mongoose models + MONGODB_URI env var / .env file the backend uses).
 * Copy this file into your backend repo root (or a /scripts folder) before
 * running, and fix the import paths below to match your project structure.
 */

import "dotenv/config";
import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";

// ---- FIX THESE IMPORT PATHS to match your backend project structure ----
import Invoice from "./models/manage/invoice.model.js";
import ManualOrder from "./models/manually order/manualOrder.model.js";
import Employee from "./models/manage/employee.model.js";
// --------------------------------------------------------------------------

const args = process.argv.slice(2);
const isConfirmed = args.includes("--confirm");
const employeeEmailArg = args.find((a) => a.startsWith("--employee-email="));
const employeeEmail = employeeEmailArg ? employeeEmailArg.split("=")[1] : null;

if (!employeeEmail) {
  console.error(
    "\nERROR: pass the employee whose account historical orders should be attributed to.\n" +
      "Example: node backfillOrdersFromInvoices.js --employee-email=you@digident.in --confirm\n"
  );
  process.exit(1);
}

const buildAddress = (invoice) => {
  const name = invoice.billTo?.contactPerson || invoice.billTo?.companyName || "Unknown";
  const phone = invoice.billTo?.contactNumber || "0000000000";
  return {
    fullName: name,
    phone,
    street: invoice.billTo?.address || "",
    area: "",
    city: "",
    state: "",
    country: "India",
    pincode: "",
  };
};

const buildItems = (invoice) =>
  (invoice.items || []).map((i) => ({
    productName: i.description,
    variantName: "",
    sku: i.articleNo || "",
    price: i.price, // GST-inclusive, same convention manual orders already use
    quantity: i.qty,
    returnedQuantity: 0,
    notes: "",
  }));

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB. Mode:", isConfirmed ? "CONFIRM (writing)" : "DRY RUN (no writes)");

  const employee = await Employee.findOne({ email: employeeEmail });
  if (!employee) {
    console.error(`No Employee found with email ${employeeEmail}. Aborting.`);
    process.exit(1);
  }

  const invoices = await Invoice.find({ isDeleted: false }).sort({ createdAt: 1 });
  console.log(`Found ${invoices.length} invoices.`);

  let created = 0;
  let skippedAlreadyLinked = 0;
  let skippedInvalid = 0;
  const problems = [];

  for (const invoice of invoices) {
    const existingOrder = await ManualOrder.findOne({ invoiceId: invoice.invoiceId });
    if (existingOrder) {
      skippedAlreadyLinked += 1;
      continue;
    }

    const items = buildItems(invoice);
    if (items.length === 0) {
      skippedInvalid += 1;
      problems.push(`${invoice.invoiceNumber}: no items`);
      continue;
    }

    const totalPayAmount = Number(invoice.summary?.totalPayAmount || 0);
    const paidAmount = Number(invoice.summary?.paidAmount || 0);
    const discount = Number(invoice.summary?.totalDiscount || 0);
    const shippingCharge = Number(invoice.summary?.freightCost || 0);
    const isFullyPaid = paidAmount > 0 && paidAmount >= totalPayAmount - 0.01;
    // NOTE: ManualOrder's paymentStatus only supports "paid" / "pending" at
    // creation time (no partial-paid state). Invoices with a partial
    // payment (0 < paidAmount < totalPayAmount) are recorded as "pending"
    // here so the ledger still shows the outstanding balance correctly —
    // the fact that SOME amount was already paid is preserved in notes.
    const paymentStatus = isFullyPaid ? "paid" : "pending";

    const gstPercentages = (invoice.items || []).map((i) => Number(i.gstPercent) || 0);
    const gstPercentage = gstPercentages.length
      ? gstPercentages.reduce((a, b) => a + b, 0) / gstPercentages.length
      : 5;

    const notesParts = [`Imported from existing invoice ${invoice.invoiceNumber} on ${new Date().toISOString().slice(0, 10)}.`];
    if (paidAmount > 0 && !isFullyPaid) {
      notesParts.push(`Partial payment of ₹${paidAmount} already received against this invoice.`);
    }
    if (invoice.notes) notesParts.push(invoice.notes);

    const orderDoc = {
      orderId: `MORD-${uuidv6()}`,
      customerName: invoice.billTo?.contactPerson || invoice.billTo?.companyName || "Unknown",
      customerPhone: invoice.billTo?.contactNumber || "0000000000",
      customerEmail: null,
      items,
      shippingCharge,
      discount,
      grandTotal: totalPayAmount,
      billingAddress: buildAddress(invoice),
      shippingAddress: buildAddress(invoice),
      organizationName: invoice.billTo?.companyName || null,
      gstAmount: 0,
      gstPercentage,
      gstNumber: invoice.billTo?.gstin || null,
      paymentStatus,
      paymentMethod: paymentStatus === "paid" ? "other" : null,
      paymentReference: null,
      paidAt: paymentStatus === "paid" ? invoice.invoiceDate : null,
      orderStatus: "delivered", // these are historical, already-fulfilled sales
      statusUpdatedAt: invoice.deliveryDate || invoice.invoiceDate,
      notes: notesParts.join(" "),
      invoiceId: invoice.invoiceId, // <-- links to the EXISTING invoice, no new one created
      isManualOrder: true,
      createdBy: employee._id,
      createdAt: invoice.createdAt, // preserve original timeline
    };

    if (isConfirmed) {
      await ManualOrder.create(orderDoc);
    } else {
      console.log(`[DRY RUN] Would create order for invoice ${invoice.invoiceNumber} — grandTotal ₹${totalPayAmount}, paymentStatus: ${paymentStatus}`);
    }
    created += 1;
  }

  console.log("\n----- SUMMARY -----");
  console.log("Total invoices scanned:", invoices.length);
  console.log(isConfirmed ? "Orders created:" : "Orders that WOULD be created:", created);
  console.log("Skipped (already linked to an order):", skippedAlreadyLinked);
  console.log("Skipped (invalid / no items):", skippedInvalid);
  if (problems.length) {
    console.log("Problem invoices:", problems);
  }
  if (!isConfirmed) {
    console.log("\nThis was a DRY RUN — nothing was written. Re-run with --confirm to actually create the orders.");
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});