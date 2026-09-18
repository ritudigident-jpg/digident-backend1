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
import { getDefaultSellerDetails, getDefaultBankDetails } from "../helpers/invoiceDefault.helper.js";
import { getPagination } from "../helpers/pagination.helper.js";
import { v6 as uuidv6 } from "uuid";
import Employee from "../models/manage/employee.model.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";

// ... getDueDateFromTerms, generateCustomerNo unchanged ...

export const createInvoiceService = async (data) => {
  const numbers = await generateInvoiceNumbers();
  const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
  const paymentTerms = data.paymentTerms || "Payable due amount in 10 days";
  let customerNo = await generateCustomerNo({
    customerNo: data.customerNo,
    contactPerson: data.billTo?.contactPerson,
  });
  const seller = { ...getDefaultSellerDetails(), ...(data.seller || {}) };
  const bankDetails = { ...getDefaultBankDetails(), ...(data.bankDetails || {}) };

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
    // NEW — link back to whichever order created this invoice, so a
    // refund settled here can be mirrored back onto that order.
    sourceOrderId: data.sourceOrderId || null,
    sourceOrderType: data.sourceOrderType || null,
  });

  return invoice;
};

export const updateInvoiceService = async ({ invoiceId, data }) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });

  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }

  if (data.billTo) {
    invoice.billTo = { ...invoice.billTo.toObject?.(), ...data.billTo };
  }
  if (data.seller) {
    invoice.seller = { ...invoice.seller.toObject?.(), ...data.seller };
  }
  if (data.bankDetails) {
    invoice.bankDetails = { ...invoice.bankDetails.toObject?.(), ...data.bankDetails };
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
    invoice.summary = { ...invoice.summary.toObject?.(), ...data.summary };
  }

  const directFields = [
    "invoiceDate", "dueDate", "orderDate", "deliveryDate",
    "paymentTerms", "termsOfDelivery", "shippingCondition",
    "customerServiceRep", "notes", "status",
    // NEW — lets an order (manual/ecommerce) report "this much is owed
    // back to the customer" without touching refundHistory itself.
    "refundStatus", "refundableAmount", "partialRefundAmount", "refundedAt",
  ];

  for (const field of directFields) {
    if (data[field] !== undefined) {
      invoice[field] = data[field];
    }
  }

  await invoice.save();
  return invoice;
};

export const deleteInvoiceService = async ({ invoiceId }) => { /* unchanged */ 
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
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

export const getInvoiceByIdService = async ({ invoiceId }) => { /* unchanged */
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false }).lean();
  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }
  return invoice;
};

export const getInvoicesService = async ({ query }) => { /* unchanged, same as your original */
  const { page, limit, skip } = getPagination(query);
  const { search, status, month, year } = query;
  const filter = { isDeleted: false };
  if (status) filter.status = status;
  if (search) {
    filter.$or = [
      { invoiceNumber: { $regex: search, $options: "i" } },
      { "billTo.companyName": { $regex: search, $options: "i" } },
      { orderNumber: { $regex: search, $options: "i" } },
    ];
  }
  if (month || year) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    let startDate, endDate;
    if (month) {
      const m = parseInt(month) - 1;
      startDate = new Date(Date.UTC(y, m, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
    } else {
      startDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
      endDate = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
    }
    filter.invoiceDate = { $gte: startDate, $lt: endDate };
  }
  const [invoices, totalItems] = await Promise.all([
    Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);
  const totalPages = Math.ceil(totalItems / limit);
  return {
    invoices,
    pagination: {
      totalItems, totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };
};

/* =========================================================================
   MIRROR A SETTLED REFUND BACK TO THE ORDER IT CAME FROM
   Purely a display-sync — this invoice is the source of truth for the
   money; the order just needs to keep showing the same numbers it always
   has (paymentStatus, partialRefundAmount, refundHistory) so nothing else
   in the app that reads the order breaks.
   ========================================================================= */
const syncRefundStateToSourceOrder = async (invoice) => {
  if (!invoice.sourceOrderId || invoice.sourceOrderType !== "manual") return; // only manual orders wired up for now

  const order = await ManualOrder.findOne({ orderId: invoice.sourceOrderId });
  if (!order) return;

  order.partialRefundAmount = invoice.partialRefundAmount;
  order.refundedAt = invoice.refundedAt;

  if (invoice.refundStatus === "refunded") order.paymentStatus = "refunded";
  else if (invoice.refundStatus === "partial_refunded") order.paymentStatus = "partial_refunded";

  const lastEntry = invoice.refundHistory[invoice.refundHistory.length - 1];
  if (lastEntry) {
    order.refundHistory.push({
      refundId: lastEntry.refundId,
      amount: lastEntry.amount,
      method: lastEntry.method,
      refundedBy: lastEntry.refundedBy,
      refundedAt: lastEntry.refundedAt,
      refundStatus: lastEntry.refundStatus,
      appliedToOrderId: lastEntry.appliedToOrderId,
    });
  }

  await order.save();
};

/* =========================================================================
   SETTLE A PENDING REFUND (cash payout OR store credit) — moved here from
   manualOrder.service.js. Works off invoice.refundableAmount, which any
   order type sets via updateInvoiceService whenever it creates/changes a
   pending refund (return, cancellation, ...). This is the ONLY function
   that decrements it and writes refundHistory.
   ========================================================================= */
// services/invoice.service.js — sirf settleInvoiceRefundService ka return block change karo

export const settleInvoiceRefundService = async (data, currentUser) => {
  const { invoiceId, amount, method = "credit_note", reference, appliedToOrderId, notes } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    const error = new Error("Employee not found");
    error.statusCode = 404;
    throw error;
  }

  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    error.errorCode = "INVOICE_NOT_FOUND";
    throw error;
  }

  if (!["refund_pending", "partial_refunded"].includes(invoice.refundStatus)) {
    const error = new Error(
      `This invoice has no pending refund to settle (currently "${invoice.refundStatus}")`
    );
    error.statusCode = 400;
    throw error;
  }

  const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other", "credit_note"];
  if (!allowedMethods.includes(method)) {
    const error = new Error(`method must be one of: ${allowedMethods.join(", ")}`);
    error.statusCode = 400;
    throw error;
  }

  const settleAmount = Number(amount);
  if (!settleAmount || settleAmount <= 0) {
    const error = new Error("amount must be a positive number");
    error.statusCode = 400;
    throw error;
  }

  const outstanding = Number(invoice.refundableAmount || 0);
  if (settleAmount > outstanding + 0.01) {
    const error = new Error(
      `Amount (${settleAmount}) is more than what's actually owed on this invoice (${outstanding.toFixed(2)})`
    );
    error.statusCode = 400;
    throw error;
  }

  const refundId = `CN-${uuidv6()}`;

  invoice.refundableAmount = Math.max(outstanding - settleAmount, 0);
  invoice.partialRefundAmount = Number(invoice.partialRefundAmount || 0) + settleAmount;
  invoice.refundStatus = invoice.refundableAmount <= 0.01 ? "refunded" : "partial_refunded";
  invoice.refundedAt = new Date();
  invoice.refundHistory.push({
    refundId,
    amount: settleAmount,
    method,
    reference: reference || null,
    refundedBy: employee.email,
    refundedAt: new Date(),
    refundStatus: "processed",
    appliedToOrderId: appliedToOrderId || null,
    notes: notes || null,
  });

  await invoice.save();

  /* ---------- KEEP SOURCE ORDER IN SYNC (non-blocking) ---------- */
  try {
    await syncRefundStateToSourceOrder(invoice);
  } catch (err) {
    console.error("Order sync failed after invoice refund settle:", err.message);
  }

  // Average GST% across this invoice's items — used only for the credit
  // note PDF's tax breakdown when the frontend has no better source.
  const avgGstPercent =
    invoice.items.length > 0
      ? invoice.items.reduce((s, i) => s + Number(i.gstPercent || 0), 0) / invoice.items.length
      : 0;

  // If this credit was applied straight onto a new manual order, pull that
  // order's/invoice's details so the response (and any PDF built from it)
  // has real context instead of a bare order ID.
  let appliedOrderDate = null;
  let appliedOrderGrandTotal = null;
  let appliedOrderItems = [];
  let appliedInvoiceNumber = null;
  if (appliedToOrderId) {
    const appliedInvoice = await Invoice.findOne({
      sourceOrderId: appliedToOrderId,
      isDeleted: false,
    }).lean();
    if (appliedInvoice) {
      appliedOrderDate = appliedInvoice.orderDate;
      appliedOrderGrandTotal = appliedInvoice.summary?.totalPayAmount || 0;
      appliedOrderItems = appliedInvoice.items || [];
      appliedInvoiceNumber = appliedInvoice.invoiceNumber;
    }
  }

  return {
    refundId,
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    sourceInvoiceNumber: invoice.invoiceNumber,
    sourceOrderId: invoice.sourceOrderId,
    sourceOrderType: invoice.sourceOrderType,
    orderDate: invoice.orderDate,
    customerName: invoice.billTo?.contactPerson,
    customerCompany: invoice.billTo?.companyName,
    customerPhone: invoice.billTo?.contactNumber,
    customerEmail: null, // billTo has no email field on the invoice schema
    refundStatus: invoice.refundStatus,
    paymentStatus: invoice.refundStatus, // alias, some UI reads this name
    amount: settleAmount,
    amountSettled: settleAmount,
    method,
    refundedBy: employee.email,
    refundedAt: invoice.refundedAt,
    appliedToOrderId: appliedToOrderId || null,
    appliedInvoiceNumber,
    appliedOrderDate,
    appliedOrderGrandTotal,
    appliedOrderItems,
    remainingOwed: invoice.refundableAmount,
    sourceOrderGstPercentage: Math.round(avgGstPercent * 100) / 100,
    // Best-effort: the invoice's current line items. On an invoice whose
    // source order still exists, these are the items still active after
    // the return (not literally "what was returned") — good enough for a
    // credit note issued straight from the Invoice pages. The manual-order
    // "Settle" flow (SettleRefundModal) builds a proper returnedItems list
    // itself from the order's own returnRequests, which is more accurate.
    returnedItems: invoice.items,
  };
};

/* =========================================================================
   CREDIT NOTES LIST — moved here from manualOrder.service.js. Every
   refundHistory entry across every invoice where method === "credit_note",
   regardless of whether that invoice came from a manual order or an
   ecommerce order.
   ========================================================================= */
export const getInvoiceCreditNotesService = async (query) => {
  const { search, startDate, endDate } = query;

  const refundMatch = { "refundHistory.method": "credit_note" };
  if (startDate || endDate) {
    refundMatch["refundHistory.refundedAt"] = {};
    if (startDate) {
      const from = new Date(startDate);
      if (!Number.isNaN(from.getTime())) refundMatch["refundHistory.refundedAt"].$gte = from;
    }
    if (endDate) {
      const to = new Date(endDate);
      if (!Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        refundMatch["refundHistory.refundedAt"].$lte = to;
      }
    }
  }

  const pipeline = [
    { $match: { isDeleted: false } },
    { $unwind: "$refundHistory" },
    { $match: refundMatch },
    {
      $project: {
        _id: 0,
        refundId: "$refundHistory.refundId",
        amount: "$refundHistory.amount",
        refundedBy: "$refundHistory.refundedBy",
        refundedAt: "$refundHistory.refundedAt",
        refundStatus: "$refundHistory.refundStatus",
        appliedToOrderId: "$refundHistory.appliedToOrderId",
        notes: "$refundHistory.notes",
        sourceInvoiceId: "$invoiceId",
        sourceInvoiceNumber: "$invoiceNumber",
        sourceOrderId: "$sourceOrderId",
        sourceOrderType: "$sourceOrderType",
        sourceOrderGrandTotal: "$summary.totalPayAmount",
        customerName: "$billTo.contactPerson",
        customerCompany: "$billTo.companyName",
        customerPhone: "$billTo.contactNumber",
        items: "$items",
      },
    },
    // The order this credit was actually spent on — matched via that
    // order's own invoice's sourceOrderId — so a bare order ID doesn't
    // show up with no context.
    {
      $lookup: {
        from: Invoice.collection.name,
        localField: "appliedToOrderId",
        foreignField: "sourceOrderId",
        as: "_appliedInvoice",
      },
    },
    { $unwind: { path: "$_appliedInvoice", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        appliedInvoiceNumber: "$_appliedInvoice.invoiceNumber",
        appliedOrderDate: "$_appliedInvoice.orderDate",
        appliedOrderGrandTotal: "$_appliedInvoice.summary.totalPayAmount",
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
          { customerCompany: regex },
          { customerPhone: regex },
          { sourceOrderId: regex },
          { sourceInvoiceNumber: regex },
          { refundId: regex },
        ],
      },
    });
  }

  const creditNotes = await Invoice.aggregate(pipeline);

  const totalIssued = creditNotes.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const totalApplied = creditNotes
    .filter((c) => c.appliedToOrderId)
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