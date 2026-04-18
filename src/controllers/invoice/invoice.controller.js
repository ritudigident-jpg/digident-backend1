import { createInvoiceValidator } from "./invoice.validator.js";
import { createInvoiceService, getInvoiceByIdService, getInvoicesService, updateInvoiceService } from "../../services/invoice.service.js";
import {sendError,handleError} from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";

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

    const invoice = await createInvoiceService(value);

    return sendSuccess(res, invoice, 201, "Invoice created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};


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

    const invoice = await updateInvoiceService({
      invoiceId: req.params.invoiceId,
      data: value,
    });

    return sendSuccess(res, invoice, 200, "Invoice updated successfully");
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