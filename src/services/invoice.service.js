// import Invoice from "../models/manage/invoice.model.js";
// import { generateInvoiceNumbers } from "../helpers/generateInvoiceNumbers.js";
// import {getDefaultSellerDetails,getDefaultBankDetails} from "../helpers/invoiceDefault.helper.js";
// import { getPagination } from "../helpers/pagination.helper.js";

// const getDueDateFromTerms = (invoiceDate, paymentTerms) => {
//   const date = new Date(invoiceDate);
//   const text = String(paymentTerms || "").toLowerCase();
//   const match = text.match(/(\d+)\s*days?/);
//   const days = match ? Number(match[1]) : 10;
//   date.setDate(date.getDate() + days);
//   return date;
// };

// export const generateCustomerNo = async ({
//   customerNo,
//   contactPerson,
// }) => {

//   // CASE 1
//   // customerNo already sent from frontend

//   if (customerNo) {
//     return customerNo;
//   }

//   // CASE 2
//   // find existing customer by contactPerson

//   const existingCustomer = await Invoice.findOne({
//     isDeleted: false,

//     "billTo.contactPerson": {
//       $regex: new RegExp(
//         `^${contactPerson.trim()}$`,
//         "i"
//       ),
//     },
//   }).sort({ createdAt: 1 });

//   // Existing customer found

//   if (existingCustomer) {
//     return existingCustomer.customerNo;
//   }

//   // CASE 3
//   // generate next customer number

//   const lastCustomer = await Invoice.findOne({})
//     .sort({ customerNo: -1 })
//     .select("customerNo");

//   return lastCustomer
//     ? lastCustomer.customerNo + 1 : 1; 
// };


// export const createInvoiceService = async (data) => {
//   const numbers = await generateInvoiceNumbers();
//   const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
//   const paymentTerms = data.paymentTerms || "Payable due amount in 10 days";
//   let customerNo = await generateCustomerNo({
//     customerNo: data.customerNo,
//     contactPerson: data.billTo?.contactPerson,
//   });
//   const seller = {
//     ...getDefaultSellerDetails(),
//     ...(data.seller || {}),
//   };

//   const bankDetails = {
//     ...getDefaultBankDetails(),
//     ...(data.bankDetails || {}),
//   };

//   const invoice = await Invoice.create({
//     invoiceNumber: numbers.invoiceNumber,
//     customerNo,
//     orderNumber: numbers.orderNumber,
//     invoiceDate,
//     dueDate: data.dueDate || getDueDateFromTerms(invoiceDate, paymentTerms),
//     orderDate: data.orderDate || invoiceDate,
//     deliveryDate: data.deliveryDate || invoiceDate,
//     paymentTerms,
//     termsOfDelivery: data.termsOfDelivery || "",
//     shippingCondition: data.shippingCondition || "Normal",
//     customerServiceRep: data.customerServiceRep || "",
//     seller,
//     billTo: {
//       companyName: data.billTo.companyName,
//       address: data.billTo.address || "",
//       gstin: data.billTo.gstin || "",
//       contactPerson: data.billTo.contactPerson || "",
//       contactNumber: data.billTo.contactNumber || "",
//     },
//     bankDetails,
//     items: (data.items || []).map((item, index) => ({
//       articleNo: item.articleNo || String(index + 1),
//       description: item.description,
//        hsnCode: item.hsnCode || "90212900",
//       qty: item.qty,
//       price: item.price,
//       discountPercent: item.discountPercent || 0,
//       discountValue: item.discountValue || 0,
//       gstType: item.gstType || "IGST",
//       gstPercent: item.gstPercent || 0,
//     })),
//     summary: {
//       freightCost: data?.summary?.freightCost || 0,
//       paidAmount: data?.summary?.paidAmount || 0,
//     },
//     notes: data.notes || "",
//     status: data.status || "issued",
//   });

//   return invoice;
// };



// export const updateInvoiceService = async ({ invoiceId, data }) => {
//   const invoice = await Invoice.findOne({
//     invoiceId,
//     isDeleted: false,
//   });

//   if (!invoice) {
//     const error = new Error("Invoice not found");
//     error.statusCode = 404;
//     error.errorCode = "INVOICE_NOT_FOUND";
//     throw error;
//   }

//   if (data.billTo) {
//     invoice.billTo = {
//       ...invoice.billTo.toObject?.(),
//       ...data.billTo,
//     };
//   }

//   if (data.seller) {
//     invoice.seller = {
//       ...invoice.seller.toObject?.(),
//       ...data.seller,
//     };
//   }

//   if (data.bankDetails) {
//     invoice.bankDetails = {
//       ...invoice.bankDetails.toObject?.(),
//       ...data.bankDetails,
//     };
//   }

//   if (data.items) {
//     invoice.items = data.items.map((item, index) => ({
//       articleNo: item.articleNo || String(index + 1),
//       description: item.description,
//       qty: item.qty,
//       price: item.price,
//       discountPercent: item.discountPercent || 0,
//       discountValue: item.discountValue || 0,
//       gstType: item.gstType || "IGST",
//       gstPercent: item.gstPercent || 0,
//     }));
//   }

//   if (data.summary) {
//     invoice.summary = {
//       ...invoice.summary.toObject?.(),
//       ...data.summary,
//     };
//   }

//   const directFields = [
//     "invoiceDate",
//     "dueDate",
//     "orderDate",
//     "deliveryDate",
//     "paymentTerms",
//     "termsOfDelivery",
//     "shippingCondition",
//     "customerServiceRep",
//     "notes",
//     "status",
//   ];

//   for (const field of directFields) {
//     if (data[field] !== undefined) {
//       invoice[field] = data[field];
//     }
//   }

//   await invoice.save();

//   return invoice;
// };

// export const deleteInvoiceService = async ({ invoiceId }) => {
//   const invoice = await Invoice.findOne({
//     invoiceId,
//     isDeleted: false,
//   });

//   if (!invoice) {
//     const error = new Error("Invoice not found");
//     error.statusCode = 404;
//     error.errorCode = "INVOICE_NOT_FOUND";
//     throw error;
//   }

//   invoice.isDeleted = true;
//   await invoice.save();

//   return invoice;
// };

// export const getInvoiceByIdService = async ({ invoiceId }) => {
//   const invoice = await Invoice.findOne({
//     invoiceId,
//     isDeleted: false,
//   }).lean();

//   if (!invoice) {
//     const error = new Error("Invoice not found");
//     error.statusCode = 404;
//     error.errorCode = "INVOICE_NOT_FOUND";
//     throw error;
//   }

//   return invoice;
// };

// export const getInvoicesService = async ({ query }) => {
//   const { page, limit, skip } = getPagination(query);
//   const { search, status, month, year } = query;

//   const filter = {
//     isDeleted: false,
//   };

//   if (status) {
//     filter.status = status;
//   }

//   if (search) {
//     filter.$or = [
//       { invoiceNumber: { $regex: search, $options: "i" } },
//       { "billTo.companyName": { $regex: search, $options: "i" } },
//       { orderNumber: { $regex: search, $options: "i" } },
//     ];
//   }

//   // ---- MONTH / YEAR FILTER ----
//   if (month || year) {
//     const now = new Date();
//     const y = year ? parseInt(year) : now.getFullYear();

//     let startDate, endDate;

//     if (month) {
//       const m = parseInt(month) - 1; // JS months are 0-indexed
//       startDate = new Date(Date.UTC(y, m, 1, 0, 0, 0));
//       endDate = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0)); // first day of next month
//     } else {
//       // only year given
//       startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
//       endDate = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
//     }

//     filter.invoiceDate = { $gte: startDate, $lt: endDate };
//   }

//   const [invoices, totalItems] = await Promise.all([
//     Invoice.find(filter)
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(),
//     Invoice.countDocuments(filter),
//   ]);

//   const totalPages = Math.ceil(totalItems / limit);

//   return {
//     invoices,
//     pagination: {
//       totalItems,
//       totalPages,
//       currentPage: page,
//       nextPage: page < totalPages ? page + 1 : null,
//       prevPage: page > 1 ? page - 1 : null,
//       limit,
//     },
//   };
// };

import Invoice from "../models/manage/invoice.model.js";
import { generateInvoiceNumbers } from "../helpers/generateInvoiceNumbers.js";
import {getDefaultSellerDetails,getDefaultBankDetails} from "../helpers/invoiceDefault.helper.js";
import { getPagination } from "../helpers/pagination.helper.js";
import { v6 as uuidv6 } from "uuid";

const getDueDateFromTerms = (invoiceDate, paymentTerms) => {
  const date = new Date(invoiceDate);
  const text = String(paymentTerms || "").toLowerCase();
  const match = text.match(/(\d+)\s*days?/);
  const days = match ? Number(match[1]) : 10;
  date.setDate(date.getDate() + days);
  return date;
};

export const generateCustomerNo = async ({
  customerNo,
  contactPerson,
}) => {

  // CASE 1
  // customerNo already sent from frontend

  if (customerNo) {
    return customerNo;
  }

  // CASE 2
  // find existing customer by contactPerson

  const existingCustomer = await Invoice.findOne({
    isDeleted: false,

    "billTo.contactPerson": {
      $regex: new RegExp(
        `^${contactPerson.trim()}$`,
        "i"
      ),
    },
  }).sort({ createdAt: 1 });

  // Existing customer found

  if (existingCustomer) {
    return existingCustomer.customerNo;
  }

  // CASE 3
  // generate next customer number

  const lastCustomer = await Invoice.findOne({})
    .sort({ customerNo: -1 })
    .select("customerNo");

  return lastCustomer
    ? lastCustomer.customerNo + 1 : 1; 
};


export const createInvoiceService = async (data) => {
  const numbers = await generateInvoiceNumbers();
  const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
  const paymentTerms = data.paymentTerms || "Payable due amount in 10 days";
  let customerNo = await generateCustomerNo({
    customerNo: data.customerNo,
    contactPerson: data.billTo?.contactPerson,
  });
  const seller = {
    ...getDefaultSellerDetails(),
    ...(data.seller || {}),
  };

  const bankDetails = {
    ...getDefaultBankDetails(),
    ...(data.bankDetails || {}),
  };

  const invoice = await Invoice.create({
    invoiceNumber: numbers.invoiceNumber,
    customerNo,
    orderNumber: numbers.orderNumber,
    invoiceDate,
    dueDate: data.dueDate || getDueDateFromTerms(invoiceDate, paymentTerms),
    orderDate: data.orderDate || invoiceDate,
    deliveryDate: data.deliveryDate || invoiceDate,
    paymentTerms,
    termsOfDelivery: data.termsOfDelivery || "",
    shippingCondition: data.shippingCondition || "Normal",
    customerServiceRep: data.customerServiceRep || "",
    seller,
    billTo: {
      companyName: data.billTo.companyName,
      address: data.billTo.address || "",
      gstin: data.billTo.gstin || "",
      contactPerson: data.billTo.contactPerson || "",
      contactNumber: data.billTo.contactNumber || "",
      email: data.billTo.email || "",
    },
    bankDetails,
    items: (data.items || []).map((item, index) => ({
      articleNo: item.articleNo || String(index + 1),
      description: item.description,
       hsnCode: item.hsnCode || "90212900",
      qty: item.qty,
      price: item.price,
      discountPercent: item.discountPercent || 0,
      discountValue: item.discountValue || 0,
      gstType: item.gstType || "IGST",
      gstPercent: item.gstPercent || 0,
    })),
    summary: {
      freightCost: data?.summary?.freightCost || 0,
      paidAmount: data?.summary?.paidAmount || 0,
    },
    notes: data.notes || "",
    status: data.status || "issued",
  });

  return invoice;
};



export const updateInvoiceService = async ({ invoiceId, data }) => {
  const invoice = await Invoice.findOne({
    invoiceId,
    isDeleted: false,
  });

  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }

  if (data.billTo) {
    invoice.billTo = {
      ...invoice.billTo.toObject?.(),
      ...data.billTo,
    };
  }

  if (data.seller) {
    invoice.seller = {
      ...invoice.seller.toObject?.(),
      ...data.seller,
    };
  }

  if (data.bankDetails) {
    invoice.bankDetails = {
      ...invoice.bankDetails.toObject?.(),
      ...data.bankDetails,
    };
  }

  if (data.items) {
    invoice.items = data.items.map((item, index) => ({
      articleNo: item.articleNo || String(index + 1),
      description: item.description,
      qty: item.qty,
      price: item.price,
      discountPercent: item.discountPercent || 0,
      discountValue: item.discountValue || 0,
      gstType: item.gstType || "IGST",
      gstPercent: item.gstPercent || 0,
    }));
  }

  if (data.summary) {
    invoice.summary = {
      ...invoice.summary.toObject?.(),
      ...data.summary,
    };
  }

  const directFields = [
    "invoiceDate",
    "dueDate",
    "orderDate",
    "deliveryDate",
    "paymentTerms",
    "termsOfDelivery",
    "shippingCondition",
    "customerServiceRep",
    "notes",
    "status",
  ];

  for (const field of directFields) {
    if (data[field] !== undefined) {
      invoice[field] = data[field];
    }
  }

  await invoice.save();

  return invoice;
};

export const deleteInvoiceService = async ({ invoiceId }) => {
  const invoice = await Invoice.findOne({
    invoiceId,
    isDeleted: false,
  });

  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }

  invoice.isDeleted = true;
  await invoice.save();

  return invoice;
};

export const getInvoiceByIdService = async ({ invoiceId }) => {
  const invoice = await Invoice.findOne({
    invoiceId,
    isDeleted: false,
  }).lean();

  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }

  return invoice;
};

export const getInvoicesService = async ({ query }) => {
  const { page, limit, skip } = getPagination(query);
  const { search, status, month, year } = query;

  const filter = {
    isDeleted: false,
  };

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.$or = [
      { invoiceNumber: { $regex: search, $options: "i" } },
      { "billTo.companyName": { $regex: search, $options: "i" } },
      { orderNumber: { $regex: search, $options: "i" } },
    ];
  }

  // ---- MONTH / YEAR FILTER ----
  if (month || year) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();

    let startDate, endDate;

    if (month) {
      const m = parseInt(month) - 1; // JS months are 0-indexed
      startDate = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0)); // first day of next month
    } else {
      // only year given
      startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
    }

    filter.invoiceDate = { $gte: startDate, $lt: endDate };
  }

  const [invoices, totalItems] = await Promise.all([
    Invoice.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Invoice.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  return {
    invoices,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };
};

// ═════════════════════════════════════════════════════════════════════════
//  NEW — RETURN / REFUND / CREDIT-NOTE (invoice-level, source-agnostic)
//
//  These work on ANY invoice — one created by hand (createInvoice), one
//  created from an ecommerce Order (createInvoiceFromOrder), or one
//  auto-generated for a ManualOrder. manualOrder.service.js calls these
//  same functions internally so a manual order's returns/refunds are
//  mirrored onto its linked invoice automatically (see resyncInvoiceForOrder
//  / createManualReturnService / settleOrderRefundService there) — that's
//  what makes "manual order ka invoice bhi apne aap add ho jayega" true.
//  If/when the ecommerce Order side gets its own return/cancel flow, wire
//  it up the same way: call addInvoiceReturnService / settleInvoiceRefundService
//  with order.invoiceId whenever a return or refund happens there too.
// ═════════════════════════════════════════════════════════════════════════

const notFound = (message = "Invoice not found") => {
  const error = new Error(message);
  error.statusCode = 404;
  error.errorCode = "INVOICE_NOT_FOUND";
  return error;
};

const badRequest = (message, errorCode = "VALIDATION_ERROR") => {
  const error = new Error(message);
  error.statusCode = 400;
  error.errorCode = errorCode;
  return error;
};

const sumReturnedValue = (invoice) =>
  (invoice.returnedItems || []).reduce((sum, it) => sum + Number(it.price) * Number(it.qty), 0);

const sumRefunded = (invoice) =>
  (invoice.refundHistory || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

/**
 * @function addInvoiceReturnService
 * @description Records a return against an invoice (doesn't touch the
 * invoice's own line items/totals — those stay the source of truth for
 * what was billed; this is a separate ledger of what came back). Works the
 * same regardless of whether the invoice came from a manual invoice, an
 * ecommerce order, or a manual order.
 */
export const addInvoiceReturnService = async ({ invoiceId, items, notes }, currentUser) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) throw notFound();

  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest("returnItems are required");
  }

  const validated = items.map((it) => {
    if (!it.description || it.qty == null || it.price == null) {
      throw badRequest("Each return item needs description, qty and price");
    }
    return {
      description: it.description,
      qty: Number(it.qty),
      price: Number(it.price),
      reason: it.reason || notes || "Return",
      returnedAt: new Date(),
      processedByEmail: currentUser?.email || "",
    };
  });

  invoice.returnedItems = [...(invoice.returnedItems || []), ...validated];

  // Nothing settled yet — just flag that a refund is now owed, unless it's
  // already further along (partial_refunded/refunded) in which case leave
  // that as-is; the next settle call will move it forward.
  if (!["refund_pending", "partial_refunded", "refunded"].includes(invoice.status)) {
    invoice.status = "refund_pending";
  }

  await invoice.save();
  return invoice;
};

/**
 * @function settleInvoiceRefundService
 * @description Settles part or all of what's owed back on an invoice —
 * either a real cash/UPI/bank/card payout, or a credit_note applied toward
 * another invoice. This is the single place that moves an invoice from
 * "refund_pending"/"partial_refunded" to "refunded".
 */
export const settleInvoiceRefundService = async (
  { invoiceId, amount, method = "credit_note", reference, appliedToInvoiceId, notes },
  currentUser
) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) throw notFound();

  const allowedMethods = ["cash", "upi", "bank_transfer", "card", "cheque", "other", "credit_note"];
  if (!allowedMethods.includes(method)) {
    throw badRequest(`method must be one of: ${allowedMethods.join(", ")}`);
  }

  const creditAmount = Number(amount);
  if (!creditAmount || creditAmount <= 0) {
    throw badRequest("amount must be a positive number");
  }

  const totalReturnedValue = sumReturnedValue(invoice);
  const alreadyRefunded = sumRefunded(invoice);
  const outstanding = Math.max(totalReturnedValue - alreadyRefunded, 0);

  if (outstanding <= 0) {
    throw badRequest('This invoice has no pending refund to settle');
  }

  if (creditAmount > outstanding + 0.01) {
    throw badRequest(
      `Amount (${creditAmount}) is more than what's actually owed on this invoice (${outstanding.toFixed(2)})`
    );
  }

  const refundId = `INV-RF-${uuidv6()}`;
  invoice.refundHistory = [
    ...(invoice.refundHistory || []),
    {
      refundId,
      amount: creditAmount,
      method,
      reference: reference || null,
      appliedToInvoiceId: appliedToInvoiceId || null,
      refundedBy: currentUser?.email || "",
      refundedAt: new Date(),
      refundStatus: "processed",
      notes: notes || null,
    },
  ];

  const newAlreadyRefunded = alreadyRefunded + creditAmount;
  invoice.status = newAlreadyRefunded >= totalReturnedValue - 0.01 ? "refunded" : "partial_refunded";

  await invoice.save();

  return {
    invoice,
    refundId,
    remainingOwed: Math.max(totalReturnedValue - newAlreadyRefunded, 0),
  };
};

/**
 * @function getInvoiceCustomerLedgerService
 * @description Per-customer balance ledger built from the Invoice
 * collection directly — covers manual invoices, ecommerce-order invoices
 * and manual-order invoices in one place, grouped by customerNo.
 */
export const getInvoiceCustomerLedgerService = async (query = {}) => {
  const { startDate, endDate, search, balanceStatus, sortBy } = query;

  const match = { isDeleted: false };
  if (startDate || endDate) {
    match.createdAt = {};
    if (startDate) {
      const from = new Date(startDate);
      if (Number.isNaN(from.getTime())) throw badRequest("Invalid startDate");
      match.createdAt.$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (Number.isNaN(to.getTime())) throw badRequest("Invalid endDate");
      to.setHours(23, 59, 59, 999);
      match.createdAt.$lte = to;
    }
  }

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        totalReturnedValue: {
          $sum: {
            $map: {
              input: { $ifNull: ["$returnedItems", []] },
              as: "it",
              in: { $multiply: ["$$it.price", "$$it.qty"] },
            },
          },
        },
        totalRefunded: {
          $sum: {
            $map: {
              input: { $ifNull: ["$refundHistory", []] },
              as: "r",
              in: "$$r.amount",
            },
          },
        },
      },
    },
    {
      $addFields: {
        pendingReturnRefund: {
          $max: [{ $subtract: ["$totalReturnedValue", "$totalRefunded"] }, 0],
        },
        cancellationRefundOwed: {
          $cond: [
            {
              $and: [
                { $eq: ["$status", "cancelled"] },
                { $gt: [{ $subtract: [{ $ifNull: ["$summary.paidAmount", 0] }, "$totalRefunded"] }, 0] },
              ],
            },
            { $subtract: [{ $ifNull: ["$summary.paidAmount", 0] }, "$totalRefunded"] },
            0,
          ],
        },
        unpaidDue: {
          $cond: [
            {
              $and: [
                { $ne: ["$status", "cancelled"] },
                { $gt: [{ $ifNull: ["$summary.amountToPay", 0] }, 0] },
              ],
            },
            "$summary.amountToPay",
            0,
          ],
        },
      },
    },
    {
      $addFields: {
        owedToCustomer: { $add: ["$pendingReturnRefund", "$cancellationRefundOwed"] },
        owedByCustomer: "$unpaidDue",
      },
    },
    {
      $group: {
        _id: "$customerNo",
        customerNo: { $last: "$customerNo" },
        customerName: { $last: "$billTo.contactPerson" },
        companyName: { $last: "$billTo.companyName" },
        customerPhone: { $last: "$billTo.contactNumber" },
        customerEmail: { $last: "$billTo.email" },
        totalInvoices: { $sum: 1 },
        totalInvoiceValue: { $sum: "$summary.totalPayAmount" },
        totalReturnedValue: { $sum: "$totalReturnedValue" },
        totalOwedToCustomer: { $sum: "$owedToCustomer" },
        totalOwedByCustomer: { $sum: "$owedByCustomer" },
        lastInvoiceAt: { $max: "$createdAt" },
        invoices: {
          $push: {
            invoiceId: "$invoiceId",
            invoiceNumber: "$invoiceNumber",
            status: "$status",
            totalPayAmount: "$summary.totalPayAmount",
            totalReturnedValue: "$totalReturnedValue",
            owedToCustomer: "$owedToCustomer",
            owedByCustomer: "$owedByCustomer",
            createdAt: "$createdAt",
          },
        },
      },
    },
    {
      $addFields: {
        netBalance: { $subtract: ["$totalOwedByCustomer", "$totalOwedToCustomer"] },
      },
    },
    {
      $addFields: {
        balanceStatus: {
          $switch: {
            branches: [
              { case: { $gt: ["$netBalance", 0] }, then: "customer_owes" },
              { case: { $lt: ["$netBalance", 0] }, then: "company_owes" },
            ],
            default: "settled",
          },
        },
      },
    },
  ];

  if (search && search.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: {
        $or: [
          { customerName: regex },
          { customerPhone: regex },
          { customerEmail: regex },
          { companyName: regex },
        ],
      },
    });
  }

  const allowedStatusFilters = ["customer_owes", "company_owes", "settled"];
  if (balanceStatus && allowedStatusFilters.includes(balanceStatus)) {
    pipeline.push({ $match: { balanceStatus } });
  }

  pipeline.push({
    $project: {
      _id: 0,
      customerNo: 1,
      customerName: 1,
      companyName: 1,
      customerPhone: 1,
      customerEmail: 1,
      totalOrders: "$totalInvoices",
      totalOrderValue: "$totalInvoiceValue",
      totalReturnedValue: 1,
      totalOwedToCustomer: 1,
      totalOwedByCustomer: 1,
      netBalance: 1,
      balanceStatus: 1,
      lastOrderAt: "$lastInvoiceAt",
      invoices: 1,
    },
  });

  pipeline.push({
    $sort:
      sortBy === "name"
        ? { customerName: 1 }
        : sortBy === "recent"
        ? { lastOrderAt: -1 }
        : { netBalance: -1 },
  });

  const customers = await Invoice.aggregate(pipeline);

  const summary = customers.reduce(
    (acc, c) => {
      if (c.balanceStatus === "customer_owes") {
        acc.totalCustomerOwesCompany += c.netBalance;
        acc.customersWhoOwe += 1;
      } else if (c.balanceStatus === "company_owes") {
        acc.totalCompanyOwesCustomers += Math.abs(c.netBalance);
        acc.customersOwed += 1;
      } else {
        acc.settledCustomers += 1;
      }
      return acc;
    },
    {
      totalCustomerOwesCompany: 0,
      totalCompanyOwesCustomers: 0,
      customersWhoOwe: 0,
      customersOwed: 0,
      settledCustomers: 0,
    }
  );

  return {
    customers,
    summary: { ...summary, totalCustomers: customers.length },
    filters: {
      startDate: startDate || null,
      endDate: endDate || null,
      search: search || null,
      balanceStatus: balanceStatus || null,
    },
  };
};

/**
 * @function getInvoiceCreditNotesService
 * @description Every refundHistory entry across every invoice where
 * method === "credit_note".
 */
export const getInvoiceCreditNotesService = async (query = {}) => {
  const { search, startDate, endDate } = query;

  const refundedAtMatch = {};
  if (startDate) {
    const from = new Date(startDate);
    if (!Number.isNaN(from.getTime())) refundedAtMatch.$gte = from;
  }
  if (endDate) {
    const to = new Date(endDate);
    if (!Number.isNaN(to.getTime())) {
      to.setHours(23, 59, 59, 999);
      refundedAtMatch.$lte = to;
    }
  }

  const pipeline = [
    { $match: { isDeleted: false } },
    { $unwind: "$refundHistory" },
    {
      $match: {
        "refundHistory.method": "credit_note",
        ...(Object.keys(refundedAtMatch).length ? { "refundHistory.refundedAt": refundedAtMatch } : {}),
      },
    },
    {
      $project: {
        _id: 0,
        refundId: "$refundHistory.refundId",
        amount: "$refundHistory.amount",
        refundedBy: "$refundHistory.refundedBy",
        refundedAt: "$refundHistory.refundedAt",
        refundStatus: "$refundHistory.refundStatus",
        notes: "$refundHistory.notes",
        appliedToInvoiceId: "$refundHistory.appliedToInvoiceId",
        sourceInvoiceId: "$invoiceId",
        sourceInvoiceNumber: "$invoiceNumber",
        sourceInvoiceDate: "$invoiceDate",
        sourceInvoiceTotal: "$summary.totalPayAmount",
        customerName: "$billTo.contactPerson",
        customerPhone: "$billTo.contactNumber",
        customerEmail: "$billTo.email",
        companyName: "$billTo.companyName",
        returnedItems: { $ifNull: ["$returnedItems", []] },
      },
    },
    {
      $lookup: {
        from: Invoice.collection.name,
        localField: "appliedToInvoiceId",
        foreignField: "invoiceId",
        as: "_appliedInvoice",
      },
    },
    { $unwind: { path: "$_appliedInvoice", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        appliedInvoiceNumber: "$_appliedInvoice.invoiceNumber",
        appliedInvoiceDate: "$_appliedInvoice.invoiceDate",
        appliedInvoiceTotal: "$_appliedInvoice.summary.totalPayAmount",
      },
    },
    { $project: { _appliedInvoice: 0 } },
    { $sort: { refundedAt: -1 } },
  ];

  if (search && search.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    pipeline.push({
      $match: {
        $or: [
          { customerName: regex },
          { customerPhone: regex },
          { customerEmail: regex },
          { sourceInvoiceNumber: regex },
          { refundId: regex },
        ],
      },
    });
  }

  const creditNotes = await Invoice.aggregate(pipeline);

  const totalIssued = creditNotes.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const totalApplied = creditNotes
    .filter((c) => c.appliedToInvoiceId)
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  return {
    creditNotes,
    summary: {
      totalCreditNotes: creditNotes.length,
      totalIssued,
      totalApplied,
      totalUnapplied: Math.max(totalIssued - totalApplied, 0),
    },
  };
};