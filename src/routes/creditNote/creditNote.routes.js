import express from "express";
import {
  createCreditNote,
  createCreditNoteFromInvoice,
  getCreditNotes,
  getCreditNoteById,
  applyCreditNote,
  refundCreditNote,
  cancelCreditNote,
  getApplyTargets,
  applyCreditNoteToInvoice,
} from "../../controllers/creditNote/creditNote.controller.js";
import auth from "../../middlewares/auth.middleware.js";
import { checkPermission } from "../../middlewares/permission.middleware.js";

// Mount in app.js / index.js:
//   import creditNoteRoutes from "./routes/creditNote/creditNote.routes.js";
//   app.use("/api/v1/credit-note", creditNoteRoutes);
const router = express.Router();

// Create — by hand (like POST /invoice/manage/create)
router.post("/manage/create", auth, checkPermission, createCreditNote);
// Create — from an invoice's pending refund (like invoice from order)
router.post("/manage/from-invoice/:invoiceId", auth, checkPermission, createCreditNoteFromInvoice);

// Read
router.get("/manage/get/:permission", auth, checkPermission, getCreditNotes);
router.get("/manage/get/:creditNoteId/:permission", auth, checkPermission, getCreditNoteById);

// Use it up
// — on an EXISTING unpaid invoice of the same customer (one-screen flow)
router.get("/manage/apply-targets/:creditNoteId/:permission", auth, checkPermission, getApplyTargets);
router.put("/manage/apply-to-invoice/:creditNoteId", auth, checkPermission, applyCreditNoteToInvoice);
// — as a discount on a NEW order/invoice (Check credit flow)
router.put("/manage/apply/:creditNoteId", auth, checkPermission, applyCreditNote);
router.put("/manage/refund/:creditNoteId", auth, checkPermission, refundCreditNote);

// Cancel (unused manual ones only)
router.put("/manage/cancel/:creditNoteId", auth, checkPermission, cancelCreditNote);

export default router;
