import { createInvoiceValidator } from "./invoice.validator.js";
import {
  createInvoiceService,
  getInvoiceByIdService,
  getInvoicesService,
  updateInvoiceService,
  deleteInvoiceService,
} from "../../services/invoice.service.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import Employee from "../../models/manage/employee.model.js";
import { PermissionAudit } from "../../models/manage/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";

/**
 * @function createInvoice
 *
 * @description
 * Create invoice with automatic invoice number, customer number,
 * order number, due date, seller defaults, bank defaults and totals.
 *
 * @response
 * 201 { success: true, message: "Invoice created successfully", data: invoice }
 * 400 { success: false, message: "Validation failed" }
 */
export const createInvoice = async (req, res) => {
  try {
    const { value, error } = createInvoiceValidator.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }

    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const invoice = await createInvoiceService(value);

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

    return sendSuccess(res, invoice, 201, "Invoice created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function updateInvoice
 *
 * @description
 * Update invoice details by invoiceId.
 */
export const updateInvoice = async (req, res) => {
  try {
    const validator = createInvoiceValidator.fork(
      ["billTo", "items"],
      (schema) => schema.optional()
    );

    const { value, error } = validator.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }

    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const invoice = await updateInvoiceService({
      invoiceId: req.params.invoiceId,
      data: value,
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

    return sendSuccess(res, invoice, 200, "Invoice updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function deleteInvoice
 *
 * @description
 * Soft delete invoice by invoiceId.
 */
export const deleteInvoice = async (req, res) => {
  try {
    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const invoice = await deleteInvoiceService({
      invoiceId: req.params.invoiceId,
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

    return sendSuccess(res, null, 200, "Invoice deleted successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getInvoiceById
 *
 * @description
 * Get invoice details by invoiceId.
 */
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await getInvoiceByIdService({
      invoiceId: req.params.invoiceId,
    });
    return sendSuccess(res, invoice, 200, "Invoice fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getInvoices
 *
 * @description
 * Fetch all invoices with pagination and filters.
 */
export const getInvoices = async (req, res) => {
  try {
    const result = await getInvoicesService({
      query: req.query,
    });
    return sendSuccess(res, result, 200, "Invoices fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};