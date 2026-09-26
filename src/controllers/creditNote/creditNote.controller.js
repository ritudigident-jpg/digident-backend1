import {
  createCreditNoteService,
  getCreditNotesService,
  getCreditNoteByIdService,
  applyCreditNoteService,
  refundCreditNoteService,
  cancelCreditNoteService,
} from "../../services/creditNote.service.js";
import { settleInvoiceRefundService } from "../../services/invoice.service.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import Employee from "../../models/manage/employee.model.js";
import { PermissionAudit } from "../../models/manage/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";

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
    console.error("Credit note audit log failed:", err.message);
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
export const createCreditNote = async (req, res) => {
  try {
    const { reason, items, amount, invoiceId, billTo } = req.body;
    if (!reason || !String(reason).trim()) {
      return sendError(res, { message: "reason is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!hasItems && (!amount || Number(amount) <= 0)) {
      return sendError(res, {
        message: "amount must be a positive number (or send items)",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }
    if (!invoiceId && !billTo) {
      return sendError(res, {
        message: "Either invoiceId or billTo is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }

    const data = await createCreditNoteService(req.body, req.user);
    await audit(req, data.creditNoteNumber, "credit_note.manage.create", "Create");
    return sendSuccess(res, data, 201, "Credit note created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function createCreditNoteFromInvoice
 * @route POST /api/credit-note/manage/from-invoice/:invoiceId
 * @description Turn an invoice's PENDING refund (from a return/cancellation)
 * into a credit note — like "invoice from order". Same as settling it with
 * method "credit_note"; optionally spent straight away (appliedToOrderId).
 * body: { amount, appliedToOrderId?, notes? }
 */
export const createCreditNoteFromInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { amount, appliedToOrderId, notes } = req.body;
    if (!amount || Number(amount) <= 0) {
      return sendError(res, { message: "amount must be a positive number", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    const data = await settleInvoiceRefundService(
      { invoiceId, amount, method: "credit_note", appliedToOrderId, notes },
      req.user
    );
    await audit(req, data.creditNoteNumber || data.invoiceNumber, "credit_note.manage.create", "Create");
    return sendSuccess(res, data, 201, "Credit note created from invoice");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getCreditNotes
 * @route GET /api/credit-note/manage/get/:permission
 * query: { search?, startDate?, endDate?, status?, type?, invoiceId?, phone?, page?, limit? }
 *   status: open | partially_used | used | cancelled (comma separated ok)
 *   type:   manual | return | cancellation
 */
export const getCreditNotes = async (req, res) => {
  try {
    const data = await getCreditNotesService(req.query);
    return sendSuccess(res, data, 200, "Credit notes fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getCreditNoteById
 * @route GET /api/credit-note/manage/get/:creditNoteId/:permission
 * creditNoteId may also be the credit note number.
 */
export const getCreditNoteById = async (req, res) => {
  try {
    const data = await getCreditNoteByIdService({ creditNoteId: decodeURIComponent(req.params.creditNoteId) });
    return sendSuccess(res, data, 200, "Credit note fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function applyCreditNote
 * @route PUT /api/credit-note/manage/apply/:creditNoteId
 * body: { amount, appliedToId (new orderId or invoiceId), notes? }
 */
export const applyCreditNote = async (req, res) => {
  try {
    const { amount, appliedToId, notes } = req.body;
    if (!appliedToId) {
      return sendError(res, { message: "appliedToId is required", statusCode: 400, errorCode: "VALIDATION_ERROR" });
    }
    const data = await applyCreditNoteService(
      { creditNoteId: req.params.creditNoteId, amount, appliedToId, notes },
      req.user
    );
    await audit(req, data.creditNoteNumber, "credit_note.manage.apply", "Update");
    return sendSuccess(res, data, 200, "Credit applied successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function refundCreditNote
 * @route PUT /api/credit-note/manage/refund/:creditNoteId
 * body: { amount?, method: "cash"|"upi"|"bank_transfer"|"card"|"other", reference?, notes? }
 */
export const refundCreditNote = async (req, res) => {
  try {
    const { amount, method, reference, notes } = req.body;
    const data = await refundCreditNoteService(
      { creditNoteId: req.params.creditNoteId, amount, method, reference, notes },
      req.user
    );
    await audit(req, data.creditNoteNumber, "credit_note.manage.refund", "Update");
    return sendSuccess(res, data, 200, "Credit note paid back successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function cancelCreditNote
 * @route PUT /api/credit-note/manage/cancel/:creditNoteId
 * body: { reason? } — only an unused MANUAL credit note
 */
export const cancelCreditNote = async (req, res) => {
  try {
    const data = await cancelCreditNoteService(
      { creditNoteId: req.params.creditNoteId, reason: req.body?.reason },
      req.user
    );
    await audit(req, data.creditNoteNumber, "credit_note.manage.cancel", "Delete");
    return sendSuccess(res, data, 200, "Credit note cancelled");
  } catch (error) {
    return handleError(res, error);
  }
};
