/**
 * HTTP handlers for credit notes (create, apply, refund, cancel): read the request,
 * call the service, send the response. No business logic here.
 *
 * Exports: createCreditNote, createCreditNoteFromInvoice, getCreditNotes, getCreditNoteById,
 * applyCreditNote, refundCreditNote, cancelCreditNote, getApplyTargets and 1 more
 * Used by: routes/creditnotes.routes.js
 */

import {
  createCreditNoteService,
  getCreditNotesService,
  getCreditNoteByIdService,
  applyCreditNoteService,
  refundCreditNoteService,
  cancelCreditNoteService,
  getApplyTargetsService,
  applyCreditNoteToInvoiceService,
} from "../../services/creditnote/creditnote.service.js";
import { settleInvoiceRefundService } from "../../services/invoice/invoice.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import Employee from "../../models/employee.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";
import { ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/* Non-blocking audit log — same pattern as invoice.controller.js */
const audit = async (req, action, permission, actionType) => {
  try {
    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) return;
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: null,
      actionForEmail: null,
      action,
      permission: req.body?.permission || permission,
      actionType,
    });
  } catch (err) {
    logger.error("Credit note audit log failed", { error: err.message });
  }
};

/**
 * @function createCreditNote
 * @route POST /api/credit-note/manage/create
 * @description Create a credit note BY HAND — like "Create Invoice".
 * body: {
 *   invoiceId?,                 // recommended; any paid invoice (standalone / manual order / ecommerce)
 *   billTo?,                    // required when there's no invoiceId
 *   reason,                     // required
 *   items?: [{ description, qty, price, gstPercent?, hsnCode? }],
 *   amount?, gstPercent?,       // when no items
 *   creditNoteDate?, notes?,
 *   refundMethod?, reference?   // optional: pay it back immediately
 * }
 */
export const createCreditNote = asyncHandler(async (req, res) => {
  const { reason, items, amount, invoiceId, billTo } = req.body;
  if (!reason || !String(reason).trim()) {
    throw new ValidationError("reason is required");
  }
  const hasItems = Array.isArray(items) && items.length > 0;
  if (!hasItems && (!amount || Number(amount) <= 0)) {
    throw new ValidationError("amount must be a positive number (or send items)");
  }
  if (!invoiceId && !billTo) {
    throw new ValidationError("Either invoiceId or billTo is required");
  }

  const data = await createCreditNoteService(req.body, req.user);
  await audit(req, data.creditNoteNumber, "credit_note.manage.create", "Create");
  return sendCreated(res, { data, message: "Credit note created successfully" });
});

/**
 * @function createCreditNoteFromInvoice
 * @route POST /api/credit-note/manage/from-invoice/:invoiceId
 * @description Turn an invoice's PENDING refund (from a return/cancellation)
 * into a credit note — like "invoice from order". Same as settling it with
 * method "credit_note"; optionally spent straight away (appliedToOrderId).
 * body: { amount, appliedToOrderId?, notes? }
 */
export const createCreditNoteFromInvoice = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const { amount, appliedToOrderId, notes } = req.body;
  if (!amount || Number(amount) <= 0) {
    throw new ValidationError("amount must be a positive number");
  }
  const data = await settleInvoiceRefundService(
    { invoiceId, amount, method: "credit_note", appliedToOrderId, notes },
    req.user
  );
  await audit(req, data.creditNoteNumber || data.invoiceNumber, "credit_note.manage.create", "Create");
  return sendCreated(res, { data, message: "Credit note created from invoice" });
});

/**
 * @function getCreditNotes
 * @route GET /api/credit-note/manage/get/:permission
 * query: { search?, startDate?, endDate?, status?, type?, invoiceId?, phone?, page?, limit? }
 *   status: open | partially_used | used | cancelled (comma separated ok)
 *   type:   manual | return | cancellation
 */
export const getCreditNotes = asyncHandler(async (req, res) => {
  const data = await getCreditNotesService(req.query);
  return sendSuccess(res, { data, message: "Credit notes fetched successfully" });
});

/**
 * @function getCreditNoteById
 * @route GET /api/credit-note/manage/get/:creditNoteId/:permission
 * creditNoteId may also be the credit note number.
 */
export const getCreditNoteById = asyncHandler(async (req, res) => {
  const data = await getCreditNoteByIdService({ creditNoteId: decodeURIComponent(req.params.creditNoteId) });
  return sendSuccess(res, { data, message: "Credit note fetched successfully" });
});

/**
 * @function applyCreditNote
 * @route PUT /api/credit-note/manage/apply/:creditNoteId
 * body: { amount, appliedToId (new orderId or invoiceId), notes? }
 */
export const applyCreditNote = asyncHandler(async (req, res) => {
  const { amount, appliedToId, notes } = req.body;
  if (!appliedToId) {
    throw new ValidationError("appliedToId is required");
  }
  const data = await applyCreditNoteService(
    { creditNoteId: req.params.creditNoteId, amount, appliedToId, notes },
    req.user
  );
  await audit(req, data.creditNoteNumber, "credit_note.manage.apply", "Update");
  return sendSuccess(res, { data, message: "Credit applied successfully" });
});

/**
 * @function refundCreditNote
 * @route PUT /api/credit-note/manage/refund/:creditNoteId
 * body: { amount?, method: "cash"|"upi"|"bank_transfer"|"card"|"other", reference?, notes? }
 */
export const refundCreditNote = asyncHandler(async (req, res) => {
  const { amount, method, reference, notes } = req.body;
  const data = await refundCreditNoteService(
    { creditNoteId: req.params.creditNoteId, amount, method, reference, notes },
    req.user
  );
  await audit(req, data.creditNoteNumber, "credit_note.manage.refund", "Update");
  return sendSuccess(res, { data, message: "Credit note paid back successfully" });
});

/**
 * @function cancelCreditNote
 * @route PUT /api/credit-note/manage/cancel/:creditNoteId
 * body: { reason? } — only an unused MANUAL credit note
 */
export const cancelCreditNote = asyncHandler(async (req, res) => {
  const data = await cancelCreditNoteService(
    { creditNoteId: req.params.creditNoteId, reason: req.body?.reason },
    req.user
  );
  await audit(req, data.creditNoteNumber, "credit_note.manage.cancel", "Delete");
  return sendSuccess(res, { data, message: "Credit note cancelled" });
});

/**
 * @function getApplyTargets
 * @route GET /api/v1/credit-note/manage/apply-targets/:creditNoteId/:permission
 * @description This customer's invoices (same phone) that still have an
 * amount due — the list shown in the credit note's "Use on an invoice" step.
 */
export const getApplyTargets = asyncHandler(async (req, res) => {
  const data = await getApplyTargetsService({ creditNoteId: req.params.creditNoteId });
  return sendSuccess(res, { data, message: "Invoices fetched successfully" });
});

/**
 * @function applyCreditNoteToInvoice
 * @route PUT /api/v1/credit-note/manage/apply-to-invoice/:creditNoteId
 * body: { invoiceId, amount? }  — amount defaults to min(balance, amount due)
 * The credit counts as payment on that invoice (its amount due goes down).
 */
export const applyCreditNoteToInvoice = asyncHandler(async (req, res) => {
  const { invoiceId, amount } = req.body;
  if (!invoiceId) {
    throw new ValidationError("invoiceId is required");
  }
  const data = await applyCreditNoteToInvoiceService(
    { creditNoteId: req.params.creditNoteId, invoiceId, amount },
    req.user
  );
  await audit(
    req,
    `${data.creditNote.creditNoteNumber} → ${data.invoice.invoiceNumber}`,
    "credit_note.manage.apply",
    "Update"
  );
  return sendSuccess(res, { data, message: "Credit applied to invoice" });
});
