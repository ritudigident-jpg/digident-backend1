// import { createInvoiceValidator } from "./invoice.validator.js";
// import {
//   createInvoiceService,
//   getInvoiceByIdService,
//   getInvoicesService,
//   updateInvoiceService,
//   deleteInvoiceService,
  
// } from "../../services/invoice.service.js";
// import { sendError, handleError } from "../../helpers/error.helper.js";
// import { sendSuccess } from "../../helpers/response.helper.js";
// import Employee from "../../models/manage/employee.model.js";
// import { PermissionAudit } from "../../models/manage/permissionaudit.model.js";
// import { v6 as uuidv6 } from "uuid";
// import User from "../../models/ecommarace/user.model.js";
// import Order from "../../models/ecommarace/order.model.js";
// import Invoice from "../../models/manage/invoice.model.js";

// /**
//  * @function createInvoice
//  *
//  * @route POST /api/invoice
//  *
//  * @description
//  * Create a new invoice from the provided invoice details.
//  *
//  * @process
//  * 1. Validate request body using Joi.
//  * 2. Fetch authenticated employee.
//  * 3. Create invoice using createInvoiceService.
//  * 4. Generate PermissionAudit entry.
//  * 5. Return created invoice.
//  *
//  * @response
//  * 201 {
//  *   success: true,
//  *   message: "Invoice created successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 400 - VALIDATION_ERROR
//  * 404 - EMPLOYEE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const createInvoice = async (req, res) => {
//   try {
//     const { value, error } = createInvoiceValidator.validate(req.body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });

//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }

//     const employee = await Employee.findOne({ email: req.user.email });
//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }

//     const invoice = await createInvoiceService(value);

//     await PermissionAudit.create({
//       permissionAuditId: uuidv6(),
//       actionBy: employee._id,
//       actionByEmail: employee.email,
//       actionFor: invoice._id,
//       actionForEmail: null,
//       action: invoice.invoiceNumber,
//       permission: value.permission || "invoice.manage.create",
//       actionType: "Create",
//     });

//     return sendSuccess(res, invoice, 201, "Invoice created successfully");
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function createInvoiceFromOrder
//  *
//  * @route POST /api/invoice/order
//  *
//  * @description
//  * Create an invoice from an existing order and link both records.
//  *
//  * @process
//  * 1. Validate request body using Joi.
//  * 2. Fetch authenticated user.
//  * 3. Create invoice.
//  * 4. Find order using orderId.
//  * 5. Update Order with invoiceId and iId.
//  * 6. Return created invoice.
//  *
//  * @response
//  * 201 {
//  *   success: true,
//  *   message: "Invoice created successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 400 - VALIDATION_ERROR
//  * 404 - USER_NOT_FOUND
//  * 404 - ORDER_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const createInvoiceFromOrder = async(req,res)=>{
//   try{
//      const { value, error } = createInvoiceValidator.validate(req.body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });

//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }
//     const user = await User.findOne({email: req.user.email});
//     if (!user) {
//       return sendError(res, {
//         message: "User not found",
//         statusCode: 404,
//         errorCode: "USER_NOT_FOUND",
//       });
//     }
//     const invoice = await createInvoiceService(value);
//     // call here a order and stroge a iId value in order same as  OrderId in Invoice for tracking the order and invoice relation
//     console.log("value OrderId -------",value.orderId);
//     const order = await Order.findOne({orderId: value.orderId});
//     if(!order){
//       return sendError(res, {
//         message: "Order not found",
//         statusCode: 404,
//         errorCode: "ORDER_NOT_FOUND",
//       });
//     }
//     order.iId = invoice.orderNumber;
//     order.invoiceId = invoice.invoiceId;  
//     await order.save();
//     console.log("order iId:", order.iId);
//       console.log("order found for invoice creation", order);
//     return sendSuccess(res, invoice, 201, "Invoice created successfully");
//   }catch(error){
//     return handleError(res, error);
//   }
// }

// /**
//  * @function updateInvoice
//  *
//  * @route PUT /api/invoice/:invoiceId
//  *
//  * @description
//  * Update an existing invoice by invoiceId.
//  *
//  * @process
//  * 1. Validate request body.
//  * 2. Fetch authenticated employee.
//  * 3. Update invoice.
//  * 4. Create PermissionAudit entry.
//  * 5. Return updated invoice.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice updated successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 400 - VALIDATION_ERROR
//  * 404 - EMPLOYEE_NOT_FOUND
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const updateInvoice = async (req, res) => {
//   try {
//     const validator = createInvoiceValidator.fork(
//       ["billTo", "items"],
//       (schema) => schema.optional()
//     );

//     const { value, error } = validator.validate(req.body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });

//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }

//     const employee = await Employee.findOne({ email: req.user.email });
//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }

//     const invoice = await updateInvoiceService({
//       invoiceId: req.params.invoiceId,
//       data: value,
//     });

//     await PermissionAudit.create({
//       permissionAuditId: uuidv6(),
//       actionBy: employee._id,
//       actionByEmail: employee.email,
//       actionFor: invoice._id,
//       actionForEmail: null,
//       action: invoice.invoiceNumber,
//       permission: value.permission || "invoice.manage.update",
//       actionType: "Update",
//     });

//     return sendSuccess(res, invoice, 200, "Invoice updated successfully");
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function updateInvoiceByUser
//  *
//  * @route PUT /api/user/invoice/:invoiceId
//  *
//  * @description
//  * Update an invoice by the authenticated user.
//  *
//  * @process
//  * 1. Validate request body.
//  * 2. Fetch authenticated user.
//  * 3. Update invoice.
//  * 4. Return updated invoice.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice updated successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 400 - VALIDATION_ERROR
//  * 404 - USER_NOT_FOUND
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const updateInvoiceByUser = async (req, res) => {
//   try {
//     const { value, error } = createInvoiceValidator.validate(req.body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });
//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }
//     const user = await User.findOne({ email: req.user.email });
//     if (!user) {
//       return sendError(res, {
//         message: "User not found",
//         statusCode: 404,
//         errorCode: "USER_NOT_FOUND",
//       });
//     }
//     const invoice = await updateInvoiceService({
//       invoiceId: req.params.invoiceId,
//       data: value,
//     });
//       // Additional logic for updating invoice by user
//     return sendSuccess(res, invoice, 200, "Invoice updated successfully");
//   }
//     catch (error) {
//       return handleError(res, error);
//     }
// }

// /**
//  * @function deleteInvoice
//  *
//  * @route DELETE /api/invoice/:invoiceId
//  *
//  * @description
//  * Delete an invoice and create an audit log.
//  *
//  * @process
//  * 1. Fetch authenticated employee.
//  * 2. Delete invoice.
//  * 3. Create PermissionAudit entry.
//  * 4. Return success response.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice deleted successfully"
//  * }
//  *
//  * @errors
//  * 404 - EMPLOYEE_NOT_FOUND
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const deleteInvoice = async (req, res) => {
//   try {
//     const employee = await Employee.findOne({ email: req.user.email });
//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }
//     const invoice = await deleteInvoiceService({
//       invoiceId: req.params.invoiceId,
//     });
//     await PermissionAudit.create({
//       permissionAuditId: uuidv6(),
//       actionBy: employee._id,
//       actionByEmail: employee.email,
//       actionFor: invoice._id,
//       actionForEmail: null,
//       action: invoice.invoiceNumber,
//       permission: req.body.permission || "invoice.manage.delete",
//       actionType: "Delete",
//     });
//     return sendSuccess(res, null, 200, "Invoice deleted successfully");
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function deleteInvoiceByUser
//  *
//  * @route DELETE /api/user/invoice/:invoiceId
//  *
//  * @description
//  * Delete an invoice by the authenticated user.
//  *
//  * @process
//  * 1. Fetch authenticated user.
//  * 2. Delete invoice.
//  * 3. Return success response.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice deleted successfully"
//  * }
//  *
//  * @errors
//  * 404 - USER_NOT_FOUND
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const deleteInvoiceByUser = async (req, res) => {  
//   try {
//     const user = await User.findOne({ email: req.user.email });
//     if (!user) {
//       return sendError(res, {
//         message: "User not found",
//         statusCode: 404,
//         errorCode: "USER_NOT_FOUND",
//       });
//     }
//     const invoice = await deleteInvoiceService({
//       invoiceId: req.params.invoiceId,
//     }); 
//     return sendSuccess(res, null, 200, "Invoice deleted successfully");
//     // Additional logic for deleting invoice by user
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function getInvoiceByIdForUser
//  *
//  * @route GET /api/user/invoice/:invoiceId
//  *
//  * @description
//  * Fetch invoice details for the authenticated user.
//  *
//  * @process
//  * 1. Fetch authenticated user.
//  * 2. Fetch invoice.
//  * 3. Return invoice details.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice fetched successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 404 - USER_NOT_FOUND
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const getInvoiceByIdForUser = async (req, res) => {
//   try {
//     const user = await User.findOne({ email: req.user.email }); 
//     if (!user) {
//       return sendError(res, {
//         message: "User not found",  
//         statusCode: 404,  
//         errorCode: "USER_NOT_FOUND",
//       });
//     }
//     const invoice = await getInvoiceByIdService({
//       invoiceId: req.params.invoiceId,
//     }); 
//     return sendSuccess(res, invoice, 200, "Invoice fetched successfully");
//   } catch (error) { 
//     return handleError(res, error);
//     }
//   };

// /**
//  * @function getInvoiceById
//  *
//  * @route GET /api/invoice/:invoiceId
//  *
//  * @description
//  * Fetch invoice details by invoiceId.
//  *
//  * @process
//  * 1. Read invoiceId from params.
//  * 2. Fetch invoice.
//  * 3. Return invoice details.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoice fetched successfully",
//  *   data: InvoiceObject
//  * }
//  *
//  * @errors
//  * 404 - INVOICE_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const getInvoiceById = async (req, res) => {
//   try {
//     const invoice = await getInvoiceByIdService({
//       invoiceId: req.params.invoiceId,
//     });
//     return sendSuccess(res, invoice, 200, "Invoice fetched successfully");
//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function getInvoiceCustomers
//  *
//  * @route GET /api/invoice/customers
//  *
//  * @description
//  * Retrieve unique customers from existing invoices.
//  *
//  * @process
//  * 1. Fetch invoices.
//  * 2. Group by customer number.
//  * 3. Return unique customer list.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Customers fetched successfully",
//  *   data: CustomerList
//  * }
//  *
//  * @errors
//  * 500 - FETCH_CUSTOMERS_ERROR
//  */

// export const getInvoiceCustomers = async (req, res) => {
//   try {

//     const customers = await Invoice.aggregate([
//       {
//         $match: {
//           isDeleted: false,
//         },
//       },

//       // old customer first
//       {
//         $sort: {
//           createdAt: 1,
//         },
//       },

//       // unique customerNo
//       {
//         $group: {
//           _id: "$customerNo",

//           customerNo: {
//             $first: "$customerNo",
//           },

//           contactPerson: {
//             $first: "$billTo.contactPerson",
//           },

//           companyName: {
//             $first: "$billTo.companyName",
//           },

//           contactNumber: {
//             $first: "$billTo.contactNumber",
//           },
//         },
//       },

//       {
//         $project: {
//           _id: 0,
//           customerNo: 1,
//           contactPerson: 1,
//           companyName: 1,
//           contactNumber: 1,
//         },
//       },

//       {
//         $sort: {
//           customerNo: 1,
//         },
//       },
//     ]);

//     return sendSuccess(
//       res,
//       customers,
//       200,
//       "Customers fetched successfully"
//     );

//   } catch (error) {

//     return sendError(res, {
//       message: error.message || "Failed to fetch customers",
//       statusCode: 500,
//       errorCode: "FETCH_CUSTOMERS_ERROR",
//     });

//   }
// };

// /**
//  * @function deleteAllInvoices
//  *
//  * @route DELETE /api/invoice/all
//  *
//  * @description
//  * Permanently delete all invoices from the database.
//  *
//  * @process
//  * 1. Delete all invoice documents.
//  * 2. Return deleted count.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "All invoices deleted permanently",
//  *   data: {
//  *     deletedCount: number
//  *   }
//  * }
//  *
//  * @errors
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const deleteAllInvoices = async (req, res) => {
//   try {


//     // Permanently delete all invoices
//     const deleted = await Invoice.deleteMany({});

//     return sendSuccess(
//       res,
//       {
//         deletedCount: deleted.deletedCount,
//       },
//       200,
//       "All invoices deleted permanently"
//     );

//   } catch (error) {
//     return handleError(res, error);
//   }
// };

// /**
//  * @function getInvoicesByCustomerId
//  *
//  * @route GET /api/invoice/customer/:customerNo
//  *
//  * @description
//  * Fetch all invoices for a specific customer.
//  *
//  * @process
//  * 1. Validate customer number.
//  * 2. Fetch invoices.
//  * 3. Return invoice list.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Customer invoices fetched successfully",
//  *   data: InvoiceList
//  * }
//  *
//  * @errors
//  * 400 - CUSTOMER_NO_REQUIRED
//  * 404 - INVOICES_NOT_FOUND
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const getInvoicesByCustomerId = async (req, res) => {
//   try {
//     const { customerNo } = req.params;
//     if (!customerNo) {
//       return sendError(res, {
//         message: "Customer number is required",
//         statusCode: 400,
//         errorCode: "CUSTOMER_NO_REQUIRED",
//       });
//     }
//     const invoices = await Invoice.find({
//       customerNo,
//       isDeleted: false,
//     }).sort({ createdAt: -1 });

//     if (!invoices.length) {
//       return sendError(res, {
//         message: "No invoices found for this customer",
//         statusCode: 404,
//         errorCode: "INVOICES_NOT_FOUND",
//       });
//     }

//     return sendSuccess(
//       res,
//       invoices,
//       200,
//       "Customer invoices fetched successfully"
//     );

//   } catch (error) {
//     return handleError(res, error);
//   }
// };


// /**
//  * @function getInvoices
//  *
//  * @route GET /api/invoice
//  *
//  * @description
//  * Fetch invoices with pagination, search and filters.
//  *
//  * @process
//  * 1. Validate month and year filters.
//  * 2. Apply search and status filters.
//  * 3. Fetch paginated invoices.
//  * 4. Return invoice list.
//  *
//  * @response
//  * 200 {
//  *   success: true,
//  *   message: "Invoices fetched successfully",
//  *   data: InvoiceList
//  * }
//  *
//  * @errors
//  * 400 - INVALID_MONTH
//  * 400 - INVALID_YEAR
//  * 500 - INTERNAL_SERVER_ERROR
//  */
// export const getInvoices = async (req, res) => {
//   try {
//     const { month, year } = req.query;

//     /* ---------- MONTH VALIDATION ---------- */
//     if (month) {
//       const m = parseInt(month);

//       if (isNaN(m) || m < 1 || m > 12) {
//         return sendError(res, {
//           message: "month must be a number between 1 and 12",
//           statusCode: 400,
//           errorCode: "INVALID_MONTH",
//         });
//       }
//     }

//     /* ---------- YEAR VALIDATION ---------- */
//     if (year) {
//       const y = parseInt(year);

//       if (isNaN(y) || y < 2000 || y > 2100) {
//         return sendError(res, {
//           message: "year must be a valid 4-digit year",
//           statusCode: 400,
//           errorCode: "INVALID_YEAR",
//         });
//       }
//     }

//     const data = await getInvoicesService({ query: req.query });

//     return sendSuccess(
//       res,
//       data,
//       200,
//       month
//         ? `Invoices for month ${month}${year ? ` / ${year}` : ""} fetched successfully`
//         : "Invoices fetched successfully"
//     );
//   } catch (error) {
//     return handleError(res, error);
//   }
// };


import { createInvoiceValidator } from "./invoice.validator.js";
import {
  createInvoiceService,
  getInvoiceByIdService,
  getInvoicesService,
  updateInvoiceService,
  deleteInvoiceService,
  settleInvoiceRefundService,
  getInvoiceCreditNotesService,
} from "../../services/invoice.service.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import Employee from "../../models/manage/employee.model.js";
import { PermissionAudit } from "../../models/manage/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";
import User from "../../models/ecommarace/user.model.js";
import Order from "../../models/ecommarace/order.model.js";
import Invoice from "../../models/manage/invoice.model.js";

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
export const createInvoiceFromOrder = async (req, res) => {
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
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return sendError(res, {
        message: "User not found",
        statusCode: 404,
        errorCode: "USER_NOT_FOUND",
      });
    }

    const order = await Order.findOne({ orderId: value.orderId });
    if (!order) {
      return sendError(res, {
        message: "Order not found",
        statusCode: 404,
        errorCode: "ORDER_NOT_FOUND",
      });
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

    return sendSuccess(res, invoice, 201, "Invoice created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const updateInvoiceByUser = async (req, res) => {
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
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return sendError(res, {
        message: "User not found",
        statusCode: 404,
        errorCode: "USER_NOT_FOUND",
      });
    }
    const invoice = await updateInvoiceService({
      invoiceId: req.params.invoiceId,
      data: value,
    });
    // Additional logic for updating invoice by user
    return sendSuccess(res, invoice, 200, "Invoice updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const deleteInvoiceByUser = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return sendError(res, {
        message: "User not found",
        statusCode: 404,
        errorCode: "USER_NOT_FOUND",
      });
    }
    await deleteInvoiceService({
      invoiceId: req.params.invoiceId,
    });
    return sendSuccess(res, null, 200, "Invoice deleted successfully");
    // Additional logic for deleting invoice by user
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getInvoiceByIdForUser = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.user.email });
    if (!user) {
      return sendError(res, {
        message: "User not found",
        statusCode: 404,
        errorCode: "USER_NOT_FOUND",
      });
    }
    const invoice = await getInvoiceByIdService({
      invoiceId: req.params.invoiceId,
    });
    return sendSuccess(res, invoice, 200, "Invoice fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getInvoiceCustomers = async (req, res) => {
  try {
    const customers = await Invoice.aggregate([
      {
        $match: {
          isDeleted: false,
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
        },
      },

      {
        $project: {
          _id: 0,
          customerNo: 1,
          contactPerson: 1,
          companyName: 1,
          contactNumber: 1,
        },
      },

      {
        $sort: {
          customerNo: 1,
        },
      },
    ]);

    return sendSuccess(res, customers, 200, "Customers fetched successfully");
  } catch (error) {
    return sendError(res, {
      message: error.message || "Failed to fetch customers",
      statusCode: 500,
      errorCode: "FETCH_CUSTOMERS_ERROR",
    });
  }
};

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
export const deleteAllInvoices = async (req, res) => {
  try {
    // Permanently delete all invoices
    const deleted = await Invoice.deleteMany({});

    return sendSuccess(
      res,
      {
        deletedCount: deleted.deletedCount,
      },
      200,
      "All invoices deleted permanently"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getInvoicesByCustomerId = async (req, res) => {
  try {
    const { customerNo } = req.params;
    if (!customerNo) {
      return sendError(res, {
        message: "Customer number is required",
        statusCode: 400,
        errorCode: "CUSTOMER_NO_REQUIRED",
      });
    }
    const invoices = await Invoice.find({
      customerNo,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    if (!invoices.length) {
      return sendError(res, {
        message: "No invoices found for this customer",
        statusCode: 404,
        errorCode: "INVOICES_NOT_FOUND",
      });
    }

    return sendSuccess(
      res,
      invoices,
      200,
      "Customer invoices fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getInvoices = async (req, res) => {
  try {
    const { month, year } = req.query;

    /* ---------- MONTH VALIDATION ---------- */
    if (month) {
      const m = parseInt(month);

      if (isNaN(m) || m < 1 || m > 12) {
        return sendError(res, {
          message: "month must be a number between 1 and 12",
          statusCode: 400,
          errorCode: "INVALID_MONTH",
        });
      }
    }

    /* ---------- YEAR VALIDATION ---------- */
    if (year) {
      const y = parseInt(year);

      if (isNaN(y) || y < 2000 || y > 2100) {
        return sendError(res, {
          message: "year must be a valid 4-digit year",
          statusCode: 400,
          errorCode: "INVALID_YEAR",
        });
      }
    }

    const data = await getInvoicesService({ query: req.query });

    return sendSuccess(
      res,
      data,
      200,
      month
        ? `Invoices for month ${month}${year ? ` / ${year}` : ""} fetched successfully`
        : "Invoices fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const settleInvoiceCredit = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { amount, method, reference, appliedToOrderId, notes } = req.body;

    if (!invoiceId) {
      return sendError(res, {
        message: "invoiceId is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }
    if (!amount || Number(amount) <= 0) {
      return sendError(res, {
        message: "amount must be a positive number",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
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
      console.error("Audit log failed on invoice credit settle:", auditErr.message);
    }

    return sendSuccess(res, data, 200, "Refund settled successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getInvoiceCreditNotes = async (req, res) => {
  try {
    const data = await getInvoiceCreditNotesService(req.query);
    return sendSuccess(res, data, 200, "Credit notes fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};