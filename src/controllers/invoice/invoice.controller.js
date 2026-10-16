/**
 * HTTP handlers for tax invoices for orders and manual sales: read the request, call the service,
 * send the response. No business logic here.
 *
 * Exports: createInvoice, createInvoiceFromOrder, updateInvoice, updateInvoiceByUser,
 * deleteInvoice, deleteInvoiceByUser, getInvoiceByIdForUser, getInvoiceById and 9 more
 * Used by: routes/invoices.routes.js
 */

import { createInvoiceValidator } from "./invoice.validator.js";
import {
  createInvoiceService,
  getInvoiceByIdService,
  getInvoicesService,
  updateInvoiceService,
  deleteInvoiceService,
  settleInvoiceRefundService,
  getInvoiceCreditNotesService,
  createInvoiceReturnService,
  getCustomerCreditLookupService,
  buildInvoiceScope,
  getInvoiceClientsService,
} from "../../services/invoice/invoice.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import Employee from "../../models/employee.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";
import User from "../../models/user.model.js";
import Order from "../../models/order.model.js";
import Invoice from "../../models/invoice.model.js";
import { getClientForInvoice, attachInvoiceToClient } from "../../services/lead/lead.service.js";
import { BadRequestError, NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { logger } from "../../helpers/logger.helper.js";

// logged-in employee (for the role check); null for a shop customer.
const getEmployee = (req) => (req.user?.email ? Employee.findOne({ email: req.user.email }).lean() : null);

/**
 * @function createInvoice
 *
 * @route POST /api/invoice
 *
 * @description
 * Create a new invoice from the provided invoice details.
 *
 * @process
 * 1. Validate request body using Joi.
 * 2. Fetch authenticated employee.
 * 3. Create invoice using createInvoiceService.
 * 4. Generate PermissionAudit entry.
 * 5. Return created invoice.
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Invoice created successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const createInvoice = asyncHandler(async (req, res) => {
  const { value, error } = createInvoiceValidator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  // RULE: "Create Invoice" only for a CRM client — create the client first.
  // (Leads ➔ Convert to Client, ya Create Client), fir invoice.
  // Manual-order and ecommerce invoices are created by their own flows
  // (they call createInvoiceService directly), so this rule does not apply to them.
  // leadId is read from req.body because the validator strips unknown keys.
  if (!req.body.leadId) {
    throw new BadRequestError("Please select a client first — an invoice can only be created for a client", {
      code: ERROR_CODES.CLIENT_REQUIRED,
    });
  }

  // An agent can only invoice clients assigned to them.
  const client = await getClientForInvoice(req.body.leadId, employee);

  // fill empty billTo fields from the client profile
  const billTo = {
    ...value.billTo,
    companyName: value.billTo.companyName || client.clinicName || client.doctorName,
    contactPerson: value.billTo.contactPerson || client.doctorName || "",
    contactNumber: value.billTo.contactNumber || client.contact || "",
    address: value.billTo.address || [client.address, client.city, client.state].filter(Boolean).join(", "),
  };

  const invoice = await createInvoiceService({
    ...value,
    billTo,
    createdBy: employee._id,
    createdByName: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email,
    createdByEmail: employee.email,
    leadId: client?._id || null,
    clientId: client?.clientId || null,
  });

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: invoice._id,
    actionForEmail: null,
    action: invoice.invoiceNumber,
    permission: value.permission || "invoice.manage.create",
    actionType: "Create",
  });

  // Add it to the client's invoice list. Never fails the request —
  // the invoice already carries leadId, and PATCH /leads/:id/link-invoice
  // can re-attach it.
  if (client) {
    try {
      await attachInvoiceToClient(client._id, invoice, employee);
    } catch (linkErr) {
      logger.error("Attach invoice to client failed", { error: linkErr.message });
    }
  }

  return sendCreated(res, { data: invoice, message: "Invoice created successfully" });
});

/**
 * @function createInvoiceFromOrder
 *
 * @route POST /api/invoice/order
 *
 * @description
 * Create an invoice from an existing order and link both records.
 *
 * @process
 * 1. Validate request body using Joi.
 * 2. Fetch authenticated user.
 * 3. Create invoice.
 * 4. Find order using orderId.
 * 5. Update Order with invoiceId and iId.
 * 6. Return created invoice.
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Invoice created successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - USER_NOT_FOUND
 * 404 - ORDER_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const createInvoiceFromOrder = asyncHandler(async (req, res) => {
  const { value, error } = createInvoiceValidator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const user = await User.findOne({ email: req.user.email });
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  const order = await Order.findOne({ orderId: value.orderId });
  if (!order) {
    throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
  }

  // NOTE: sourceOrderId/sourceOrderType link this invoice back to the
  // ecommerce order, so a refund settled later on the invoice
  // (settleInvoiceCredit) can be mirrored back onto this order.
  const invoice = await createInvoiceService({
    ...value,
    sourceOrderId: order.orderId,
    sourceOrderType: "ecommerce",
  });

  order.iId = invoice.orderNumber;
  order.invoiceId = invoice.invoiceId;
  await order.save();

  return sendCreated(res, { data: invoice, message: "Invoice created successfully" });
});

/**
 * @function updateInvoice
 *
 * @route PUT /api/invoice/:invoiceId
 *
 * @description
 * Update an existing invoice by invoiceId.
 *
 * @process
 * 1. Validate request body.
 * 2. Fetch authenticated employee.
 * 3. Update invoice.
 * 4. Create PermissionAudit entry.
 * 5. Return updated invoice.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice updated successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - EMPLOYEE_NOT_FOUND
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const updateInvoice = asyncHandler(async (req, res) => {
  const validator = createInvoiceValidator.fork(["billTo", "items"], (schema) => schema.optional());

  const { value, error } = validator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const invoice = await updateInvoiceService({
    invoiceId: req.params.invoiceId,
    data: value,
    employee,
  });

  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: invoice._id,
    actionForEmail: null,
    action: invoice.invoiceNumber,
    permission: value.permission || "invoice.manage.update",
    actionType: "Update",
  });

  return sendSuccess(res, { data: invoice, message: "Invoice updated successfully" });
});

/**
 * @function updateInvoiceByUser
 *
 * @route PUT /api/user/invoice/:invoiceId
 *
 * @description
 * Update an invoice by the authenticated user.
 *
 * @process
 * 1. Validate request body.
 * 2. Fetch authenticated user.
 * 3. Update invoice.
 * 4. Return updated invoice.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice updated successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - USER_NOT_FOUND
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const updateInvoiceByUser = asyncHandler(async (req, res) => {
  const { value, error } = createInvoiceValidator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const user = await User.findOne({ email: req.user.email });
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  const invoice = await updateInvoiceService({
    invoiceId: req.params.invoiceId,
    data: value,
  });
  // Additional logic for updating invoice by user
  return sendSuccess(res, { data: invoice, message: "Invoice updated successfully" });
});

/**
 * @function deleteInvoice
 *
 * @route DELETE /api/invoice/:invoiceId
 *
 * @description
 * Delete an invoice and create an audit log.
 *
 * @process
 * 1. Fetch authenticated employee.
 * 2. Delete invoice.
 * 3. Create PermissionAudit entry.
 * 4. Return success response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice deleted successfully"
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const deleteInvoice = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const invoice = await deleteInvoiceService({
    invoiceId: req.params.invoiceId,
    employee,
  });
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: invoice._id,
    actionForEmail: null,
    action: invoice.invoiceNumber,
    permission: req.body.permission || "invoice.manage.delete",
    actionType: "Delete",
  });
  return sendSuccess(res, { data: null, message: "Invoice deleted successfully" });
});

/**
 * @function deleteInvoiceByUser
 *
 * @route DELETE /api/user/invoice/:invoiceId
 *
 * @description
 * Delete an invoice by the authenticated user.
 *
 * @process
 * 1. Fetch authenticated user.
 * 2. Delete invoice.
 * 3. Return success response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice deleted successfully"
 * }
 *
 * @errors
 * 404 - USER_NOT_FOUND
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const deleteInvoiceByUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.user.email });
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  await deleteInvoiceService({
    invoiceId: req.params.invoiceId,
  });
  return sendSuccess(res, { data: null, message: "Invoice deleted successfully" });
  // Additional logic for deleting invoice by user
});

/**
 * @function getInvoiceByIdForUser
 *
 * @route GET /api/user/invoice/:invoiceId
 *
 * @description
 * Fetch invoice details for the authenticated user.
 *
 * @process
 * 1. Fetch authenticated user.
 * 2. Fetch invoice.
 * 3. Return invoice details.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice fetched successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 404 - USER_NOT_FOUND
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getInvoiceByIdForUser = asyncHandler(async (req, res) => {
  const user = await User.findOne({ email: req.user.email });
  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  const invoice = await getInvoiceByIdService({
    invoiceId: req.params.invoiceId,
  });
  return sendSuccess(res, { data: invoice, message: "Invoice fetched successfully" });
});

/**
 * @function getInvoiceById
 *
 * @route GET /api/invoice/:invoiceId
 *
 * @description
 * Fetch invoice details by invoiceId.
 *
 * @process
 * 1. Read invoiceId from params.
 * 2. Fetch invoice.
 * 3. Return invoice details.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoice fetched successfully",
 *   data: InvoiceObject
 * }
 *
 * @errors
 * 404 - INVOICE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getInvoiceById = asyncHandler(async (req, res) => {
  const employee = await getEmployee(req);
  const invoice = await getInvoiceByIdService({
    invoiceId: req.params.invoiceId,
    employee,
  });
  return sendSuccess(res, { data: invoice, message: "Invoice fetched successfully" });
});

/**
 * @function getInvoiceCustomers
 *
 * @route GET /api/invoice/customers
 *
 * @description
 * Retrieve unique customers from existing invoices.
 *
 * @process
 * 1. Fetch invoices.
 * 2. Group by customer number.
 * 3. Return unique customer list.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Customers fetched successfully",
 *   data: CustomerList
 * }
 *
 * @errors
 * 500 - FETCH_CUSTOMERS_ERROR
 */
export const getInvoiceCustomers = asyncHandler(async (req, res) => {
  const scope = await buildInvoiceScope(await getEmployee(req));
  const customers = await Invoice.aggregate([
    {
      $match: {
        isDeleted: false,
        ...scope,
      },
    },

    // old customer first
    {
      $sort: {
        createdAt: 1,
      },
    },

    // unique customerNo
    {
      $group: {
        _id: "$customerNo",

        customerNo: {
          $first: "$customerNo",
        },

        contactPerson: {
          $first: "$billTo.contactPerson",
        },

        companyName: {
          $first: "$billTo.companyName",
        },

        contactNumber: {
          $first: "$billTo.contactNumber",
        },

        // CRM client this customer belongs to (if any invoice was raised from a client)
        clientId: {
          $max: "$clientId",
        },

        leadId: {
          $max: "$leadId",
        },
      },
    },

    {
      $project: {
        _id: 0,
        customerNo: 1,
        contactPerson: 1,
        companyName: 1,
        contactNumber: 1,
        clientId: 1,
        leadId: 1,
      },
    },

    {
      $sort: {
        customerNo: 1,
      },
    },
  ]);

  return sendSuccess(res, { data: customers, message: "Customers fetched successfully" });
});

/**
 * @function deleteAllInvoices
 *
 * @route DELETE /api/invoice/all
 *
 * @description
 * Permanently delete all invoices from the database.
 *
 * @process
 * 1. Delete all invoice documents.
 * 2. Return deleted count.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All invoices deleted permanently",
 *   data: {
 *     deletedCount: number
 *   }
 * }
 *
 * @errors
 * 500 - INTERNAL_SERVER_ERROR
 */
export const deleteAllInvoices = asyncHandler(async (req, res) => {
  // Permanently delete all invoices
  const deleted = await Invoice.deleteMany({});

  return sendSuccess(res, {
    data: {
      deletedCount: deleted.deletedCount,
    },
    message: "All invoices deleted permanently",
  });
});

/**
 * @function getInvoicesByCustomerId
 *
 * @route GET /api/invoice/customer/:customerNo
 *
 * @description
 * Fetch all invoices for a specific customer.
 *
 * @process
 * 1. Validate customer number.
 * 2. Fetch invoices.
 * 3. Return invoice list.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Customer invoices fetched successfully",
 *   data: InvoiceList
 * }
 *
 * @errors
 * 400 - CUSTOMER_NO_REQUIRED
 * 404 - INVOICES_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getInvoicesByCustomerId = asyncHandler(async (req, res) => {
  const { customerNo } = req.params;
  if (!customerNo) {
    throw new BadRequestError("Customer number is required", { code: ERROR_CODES.CUSTOMER_NO_REQUIRED });
  }
  const scope = await buildInvoiceScope(await getEmployee(req));
  const invoices = await Invoice.find({
    customerNo,
    isDeleted: false,
    ...scope,
  }).sort({ createdAt: -1 });

  if (!invoices.length) {
    throw new NotFoundError("No invoices found for this customer", { code: ERROR_CODES.INVOICES_NOT_FOUND });
  }

  return sendSuccess(res, { data: invoices, message: "Customer invoices fetched successfully" });
});

/**
 * @function getInvoices
 *
 * @route GET /api/invoice
 *
 * @description
 * Fetch invoices with pagination, search and filters.
 *
 * @process
 * 1. Validate month and year filters.
 * 2. Apply search and status filters.
 * 3. Fetch paginated invoices.
 * 4. Return invoice list.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Invoices fetched successfully",
 *   data: InvoiceList
 * }
 *
 * @errors
 * 400 - INVALID_MONTH
 * 400 - INVALID_YEAR
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getInvoices = asyncHandler(async (req, res) => {
  const { month, year } = req.query;

  /* ---------- MONTH VALIDATION ---------- */
  if (month) {
    const m = parseInt(month);

    if (isNaN(m) || m < 1 || m > 12) {
      throw new BadRequestError("month must be a number between 1 and 12", {
        code: ERROR_CODES.INVALID_MONTH,
      });
    }
  }

  /* ---------- YEAR VALIDATION ---------- */
  if (year) {
    const y = parseInt(year);

    if (isNaN(y) || y < 2000 || y > 2100) {
      throw new BadRequestError("year must be a valid 4-digit year", { code: ERROR_CODES.INVALID_YEAR });
    }
  }

  const employee = await getEmployee(req);
  const data = await getInvoicesService({ query: req.query, employee });

  return sendSuccess(res, {
    data,
    message: month
      ? `Invoices for month ${month}${year ? ` / ${year}` : ""} fetched successfully`
      : "Invoices fetched successfully",
  });
});

/**
 * @function settleInvoiceCredit
 *
 * @route PUT /api/invoice/manage/credit-settle/:invoiceId
 *
 * @description
 * Settles part or all of a pending refund on an invoice — either an
 * actual payout (cash/upi/bank_transfer/card/other, "I've physically
 * refunded this"), or store credit applied to a new order ("customer
 * will take it next time", method: "credit_note"). This is the ONLY
 * way a "refund_pending" / "partial_refunded" invoice can move to
 * "refunded" — regardless of whether the invoice originally came from
 * a manual order, an ecommerce order, or was created directly.
 *
 * @process
 * 1. Validate orderId param + amount in body.
 * 2. Delegate settlement to settleInvoiceRefundService (validates
 *    employee, refund status, method, amount vs outstanding balance).
 * 3. Create PermissionAudit entry.
 * 4. Return settlement details.
 *
 * @params
 * params: { invoiceId: string }
 * body: {
 *   amount: number,
 *   method?: "cash"|"upi"|"bank_transfer"|"card"|"other"|"credit_note" (default "credit_note"),
 *   reference?: string,
 *   appliedToOrderId?: string,
 *   notes?: string
 * }
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Refund settled successfully",
 *   data: { refundId, invoiceId, invoiceNumber, refundStatus, amountSettled, ... }
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - INVOICE_NOT_FOUND / EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const settleInvoiceCredit = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const { amount, method, reference, appliedToOrderId, notes } = req.body;

  if (!invoiceId) {
    throw new ValidationError("invoiceId is required");
  }
  if (!amount || Number(amount) <= 0) {
    throw new ValidationError("amount must be a positive number");
  }

  const data = await settleInvoiceRefundService(
    { invoiceId, amount, method, reference, appliedToOrderId, notes },
    req.user
  );

  /* ---------- AUDIT LOG ---------- */
  try {
    const employee = await Employee.findOne({ email: req.user.email });
    if (employee) {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: null,
        actionForEmail: null,
        action: data.invoiceNumber,
        permission: req.body.permission || "invoice.manage.credit_settle",
        actionType: "Update",
      });
    }
  } catch (auditErr) {
    logger.error("Audit log failed on invoice credit settle", { error: auditErr.message });
  }

  return sendSuccess(res, { data, message: "Refund settled successfully" });
});

/**
 * @function getInvoiceCreditNotes
 *
 * @route GET /api/invoice/manage/credit-notes/:permission
 *
 * @description
 * Every "customer will take it next time" credit note issued across
 * all invoices — regardless of source (manual order, ecommerce order,
 * or a directly created invoice). Used to power a dedicated Credit
 * Notes page.
 *
 * @process
 * 1. Read search/date filters from query.
 * 2. Delegate to getInvoiceCreditNotesService.
 * 3. Return credit notes list + summary.
 *
 * @params
 * query: { search?: string, startDate?: ISO date, endDate?: ISO date }
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Credit notes fetched successfully",
 *   data: { creditNotes: [...], summary: {...} }
 * }
 *
 * @errors
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getInvoiceCreditNotes = asyncHandler(async (req, res) => {
  const data = await getInvoiceCreditNotesService(req.query);
  return sendSuccess(res, { data, message: "Credit notes fetched successfully" });
});

/**
 * @function createInvoiceReturn
 *
 * @route POST /api/invoice/manage/return/:invoiceId
 *
 * @description
 * Records a return directly on a STANDALONE invoice — one created via
 * "Create Invoice" with no source order (sourceOrderId === null). The
 * customer called in, staff pulls up the invoice, picks which line items
 * and quantities came back, and either settles the refund immediately
 * (refundNow) or leaves it pending for the invoice's own "Settle" button
 * (settleInvoiceCredit) to handle later.
 *
 * A manual-order invoice's returns belong on the ManualOrder
 * (createManualReturnService) and an ecommerce invoice's returns belong on
 * the ecommerce return-request flow — this endpoint refuses both and tells
 * the caller where to go instead, so a return is never recorded twice.
 *
 * @process
 * 1. Validate invoiceId param + returnItems in body.
 * 2. Delegate to createInvoiceReturnService (guards sourceOrderId, reduces
 *    item.returnedQty, settles now or marks refundableAmount pending).
 * 3. Create PermissionAudit entry.
 * 4. Return the return/refund summary.
 *
 * @params
 * params: { invoiceId: string }
 * body: {
 *   returnItems: [{ itemId: string, quantity: number, reason?: string }],
 *   refundNow: boolean,
 *   refundMethod?: "cash"|"upi"|"bank_transfer"|"card"|"other" (required if refundNow),
 *   reference?: string,
 *   notes?: string
 * }
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Return recorded successfully",
 *   data: { invoiceId, invoiceNumber, requestId, refundId, refundStatus, refundableAmount, ... }
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR / INVOICE_HAS_SOURCE_ORDER / INVALID_QUANTITY
 * 404 - EMPLOYEE_NOT_FOUND / INVOICE_NOT_FOUND / ITEM_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const createInvoiceReturn = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const { returnItems, refundNow, refundMethod, reference, notes } = req.body;

  if (!invoiceId) {
    throw new ValidationError("invoiceId is required");
  }
  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new ValidationError("returnItems are required");
  }

  const data = await createInvoiceReturnService(
    { invoiceId, returnItems, refundNow, refundMethod, reference, notes },
    req.user
  );

  /* ---------- AUDIT LOG (non-blocking) ---------- */
  try {
    const employee = await Employee.findOne({ email: req.user.email });
    if (employee) {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee._id,
        actionByEmail: employee.email,
        actionFor: null,
        actionForEmail: null,
        action: data.invoiceNumber,
        permission: req.body.permission || "invoice.manage.return_create",
        actionType: "Create",
      });
    }
  } catch (auditErr) {
    logger.error("Audit log failed on invoice return create", { error: auditErr.message });
  }

  return sendCreated(res, { data, message: "Return recorded successfully" });
});

/**
 * @function getCustomerCreditLookup
 *
 * @route GET /api/invoice/manage/credit-lookup/:phone
 *
 * @description
 * "Check credit" — every invoice (manual-order, ecommerce, or standalone)
 * that still owes this phone number money right now, i.e. refundStatus is
 * "refund_pending" or "partial_refunded" and hasn't been settled yet. This
 * powers the "Tarika A" flow used consistently across CreateOrderPage and
 * CreateInvoicePage: a return is left pending — never settled on its own —
 * until the customer's next order/invoice actually exists, at which point
 * staff apply the pending amount as a discount on the new one and, in the
 * same step, settle the old invoice with appliedToOrderId pointing at the
 * new one. Once settled, an invoice's refundStatus is no longer
 * refund_pending/partial_refunded, so it naturally drops out of this list.
 *
 * @process
 * 1. Read phone from params.
 * 2. Delegate to getCustomerCreditLookupService.
 * 3. Return the total available credit + which invoices it's owed from.
 *
 * @params
 * params: { phone: string }
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Credit lookup complete",
 *   data: { available: number, sources: [{ invoiceId, invoiceNumber, sourceOrderId, sourceOrderType, orderDate, owed, ... }] }
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getCustomerCreditLookup = asyncHandler(async (req, res) => {
  const { phone } = req.params;
  if (!phone) {
    throw new ValidationError("phone is required");
  }

  const data = await getCustomerCreditLookupService({ phone });
  return sendSuccess(res, { data, message: "Credit lookup complete" });
});
/**
 * @function getInvoiceClients
 * @route GET /api/v1/invoice/manage/clients/:permission?search=&limit=
 * @description CRM clients for the "Create Invoice" client picker
 * (agent → only their assigned clients).
 */
export const getInvoiceClients = asyncHandler(async (req, res) => {
  const employee = await getEmployee(req);
  const data = await getInvoiceClientsService({
    search: req.query.search,
    limit: req.query.limit,
    employee,
  });
  return sendSuccess(res, { data, message: "Clients fetched successfully" });
});
