/**
 * Routes for tax invoices for orders and manual sales. Mounted at /api/v1/invoice (16 endpoints,
 * listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import {
  createInvoice,
  getInvoiceById,
  getInvoices,
  updateInvoice,
  deleteInvoice,
  createInvoiceFromOrder,
  getInvoiceByIdForUser,
  deleteInvoiceByUser,
  updateInvoiceByUser,
  getInvoiceCustomers,
  getInvoicesByCustomerId,
  settleInvoiceCredit,
  getInvoiceCreditNotes,
  createInvoiceReturn,
  getCustomerCreditLookup,
  getInvoiceClients,
} from "../controllers/invoice/invoice.controller.js";
import auth from "../middlewares/auth.middleware.js";
import { checkPermission } from "../middlewares/permission.middleware.js";
const router = express.Router();

router.post("/manage/create", auth, checkPermission, createInvoice);
router.put("/manage/update/:invoiceId", auth, checkPermission, updateInvoice);
router.get("/manage/get/:permission", auth, checkPermission, getInvoices);
router.get("/manage/get/:invoiceId/:permission", auth, checkPermission, getInvoiceById);
router.delete("/manage/delete/:invoiceId", auth, checkPermission, deleteInvoice);

// Credit notes live on the invoice
router.put("/manage/credit-settle/:invoiceId", auth, checkPermission, settleInvoiceCredit);
// Deprecated — kept so old frontends keep working; now reads the CreditNote
// collection. Use GET /api/credit-note/manage/get/:permission instead.
router.get("/manage/credit-notes/:permission", auth, checkPermission, getInvoiceCreditNotes);

// Record a return on a STANDALONE invoice (sourceOrderId === null) only.
router.post("/manage/return/:invoiceId", auth, checkPermission, createInvoiceReturn);

// "Check credit": every invoice that still owes this phone number money.
router.get("/manage/credit-lookup/:phone", auth, checkPermission, getCustomerCreditLookup);

// Client picker for "Create Invoice" (invoices are only created for clients)
router.get("/manage/clients/:permission", auth, checkPermission, getInvoiceClients);

router.post("/create", auth, createInvoiceFromOrder);
router.get("/get/:invoiceId", auth, getInvoiceByIdForUser);
router.delete("/delete/:invoiceId", auth, deleteInvoiceByUser);
router.put("/update/:invoiceId", auth, updateInvoiceByUser);
router.get("/customer/:customerNo", auth, getInvoicesByCustomerId);
router.get("/customers", auth, getInvoiceCustomers);
export default router;
