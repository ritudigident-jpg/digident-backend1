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
  deleteAllInvoices,
  getInvoicesByCustomerId,
  // NEW
  addInvoiceReturn,
  settleInvoiceRefund,
  getInvoiceCustomerLedger,
  getInvoiceCreditNotes,
} from "../../controllers/invoice/invoice.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";
const router = express.Router();

router.post("/manage/create", auth, checkPermission, createInvoice);
router.put("/manage/update/:invoiceId", auth, checkPermission,updateInvoice);
router.get("/manage/get/:permission", auth, checkPermission, getInvoices);
router.get("/manage/get/:invoiceId/:permission", auth, checkPermission, getInvoiceById);
router.delete("/manage/delete/:invoiceId", auth,checkPermission, deleteInvoice);  
router.post("/create", auth, createInvoiceFromOrder);
router.get("/get/:invoiceId", auth, getInvoiceByIdForUser);
router.delete("/delete/:invoiceId", auth, deleteInvoiceByUser); // Allow users to delete their own invoices
router.put("/update/:invoiceId", auth, updateInvoiceByUser); // Allow users to update their own invoices
router.get("/customer/:customerNo", auth, getInvoicesByCustomerId);
router.get("/customers",auth, getInvoiceCustomers );

/* ────────────────────────────────────────────────────────────────────────
   NEW — invoice-level return / refund / credit-note / customer ledger.
   These work no matter which flow created the invoice (manual invoice,
   ecommerce Order via /invoice/create, or a ManualOrder's auto-invoice) —
   see invoice.service.js for the aggregation logic, and
   manualOrder.service.js for how ManualOrder mirrors its own
   returns/refunds onto these same fields automatically.
   ──────────────────────────────────────────────────────────────────────── */
router.get("/manage/ledger/:permission", auth, checkPermission, getInvoiceCustomerLedger);
router.get("/manage/credit-notes/:permission", auth, checkPermission, getInvoiceCreditNotes);
router.put("/manage/:invoiceId/return", auth, checkPermission, addInvoiceReturn);
router.put("/manage/:invoiceId/settle-refund", auth, checkPermission, settleInvoiceRefund);

export default router;