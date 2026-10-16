/**
 * Business logic for tax invoices for orders and manual sales. Throws AppError subclasses on
 * failure.
 *
 * Exports: ROLES, isAgent, buildInvoiceScope, assertInvoiceAccess, getInvoiceClientsService,
 * phoneKey, generateCustomerNo, createInvoiceService and 8 more
 * Used by: controllers/creditnote/creditnote.controller.js,
 * controllers/invoice/invoice.controller.js, services/manualorder/manualorder.service.js
 */

// export const generateCustomerNo = async ({
//   customerNo,
//   contactPerson,
// }) => {

//   const existingCustomer = await Invoice.findOne({
//     isDeleted: false,

import mongoose from "mongoose";
import Invoice from "../../models/invoice.model.js";
import { generateInvoiceNumbers } from "../../helpers/invoicenumber.helper.js";
import { getDefaultSellerDetails, getDefaultBankDetails } from "../../helpers/invoicedefault.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import { v6 as uuidv6 } from "uuid";
import Employee from "../../models/employee.model.js";
import ManualOrder from "../../models/manualorder.model.js";
import {
  createCreditNoteFromInvoiceService,
  getCreditNotesService,
  getOpenCreditNotesForPhone,
  toCreditNoteListShape,
  getInvoiceCreditCap,
} from "../creditnote/creditnote.service.js";
import { syncCustomerFromInvoice } from "../../helpers/linkedsync.helper.js";
import DentalLead from "../../models/lead.model.js";
import { fuzzySearch } from "../../helpers/fuzzysearch.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/* =========================================================================
   ROLE-WISE VISIBILITY
   AGENT (role 4) → only their own invoices:
       • the ones they created (createdBy), and
       • the ones of clients currently assigned to them (after a client
         transfer, the new agent also sees the old invoices)
   All other roles (Super Admin / Admin / Manager / Executive) → all invoices
   ========================================================================= */
export const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };
/**
 * Is agent.
 *
 * @param {*} employee
 * @returns {*}
 */
export const isAgent = (employee) => Number(employee?.role) === ROLES.AGENT;

/**
 * Build invoice scope.
 *
 * @param {*} employee
 * @returns {Promise<*>}
 */
export const buildInvoiceScope = async (employee) => {
  if (!employee || !isAgent(employee)) return {};
  const myClients = await DentalLead.find({
    assignedEmployee: employee._id,
    stage: "client",
    isDeleted: false,
  }).distinct("_id");
  return { $or: [{ createdBy: employee._id }, { leadId: { $in: myClients } }] };
};

/**
 * Assert invoice access.
 *
 * @param {*} invoice
 * @param {*} employee
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const assertInvoiceAccess = async (invoice, employee) => {
  if (!employee || !isAgent(employee)) return;
  if (invoice.createdBy && String(invoice.createdBy) === String(employee._id)) return;
  if (invoice.leadId) {
    const mine = await DentalLead.exists({
      _id: invoice.leadId,
      assignedEmployee: employee._id,
      isDeleted: false,
    });
    if (mine) return;
  }
  throw new ForbiddenError("You do not have access to this invoice", { code: ERROR_CODES.INVOICE_FORBIDDEN });
};

/* =========================================================================
   CLIENT PICKER for "Create Invoice"
   Invoices are only created for a CRM client (DentalLead, stage "client";
   the controller answers CLIENT_REQUIRED otherwise). This list fills the
   client dropdown of the Create Invoice page. Agent → only assigned clients.
   query: { search?, limit? }   search = name / clinic / phone / client id
   ========================================================================= */
/**
 * Get invoice clients.
 *
 * @param {object} params
 * @param {*} params.search
 * @param {*} [params.limit]
 * @param {*} [params.employee]
 * @returns {Promise<*>}
 */
export const getInvoiceClientsService = async ({ search, limit = 20, employee = null }) => {
  const filter = { stage: "client", isDeleted: false };
  if (employee && isAgent(employee)) filter.assignedEmployee = employee._id;

  const q = String(search || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    const or = [{ doctorName: rx }, { clinicName: rx }, { clientId: rx }, { contact: rx }, { email: rx }];
    const key = phoneKey(q);
    if (key.length >= 4) or.push({ contact: { $regex: new RegExp(key.split("").join("[^0-9]*")) } });
    filter.$or = or;
  }

  const leads = await DentalLead.find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 50))
    .lean();

  return leads.map((l) => ({
    leadId: l._id,
    clientId: l.clientId || null,
    doctorName: l.doctorName || "",
    clinicName: l.clinicName || "",
    contact: l.contact || "",
    email: l.email || "",
    address: [l.address, l.city, l.state].filter(Boolean).join(", "),
    gstin: l.gstin || l.gstNumber || "",
  }));
};

/* Invoice "type", for the tabs of the list page
   client    → created from a CRM client (leadId set)
   manual    → created automatically from a Manual Order
   ecommerce → from a website order
   other     → old invoices linked to neither a client nor an order          */
const TYPE_FILTERS = {
  client: { leadId: { $ne: null } },
  manual: { sourceOrderType: "manual" },
  ecommerce: { sourceOrderType: "ecommerce" },
  other: { leadId: null, sourceOrderType: null },
};

const getDueDateFromTerms = (invoiceDate, paymentTerms) => {
  const date = new Date(invoiceDate);
  const text = String(paymentTerms || "").toLowerCase();
  const match = text.match(/(\d+)\s*days?/);
  const days = match ? Number(match[1]) : 10;
  date.setDate(date.getDate() + days);
  return date;
};

/* ── Customer identity helpers ─────────────────────────────────────────
   A customer is identified by (in order):
     1. the CRM client (leadId) the invoice was raised for
     2. the mobile number — last 10 digits, so "+91 98765 43210",
        "9876543210" and "098765-43210" are the same customer
        (credit lookup already treats the phone as the customer)
     3. only when there is no phone: company name + contact person
   Never by contact person alone — two different people/companies with the
   same name (e.g. "DEMO2") were being merged into one customer.        */
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * Phone key.
 *
 * @param {*} s
 * @returns {*}
 */
export const phoneKey = (s) =>
  String(s ?? "")
    .replace(/\D/g, "")
    .slice(-10);
// matches the 10 digits at the end, with any spaces/dashes in between
const phoneRegex = (key) => new RegExp(key.split("").join("[^0-9]*") + "$");

/**
 * Generate customer no.
 *
 * @param {object} params
 * @param {*} params.customerNo
 * @param {*} params.contactNumber
 * @param {*} params.contactPerson
 * @param {*} params.companyName
 * @param {*} params.leadId
 * @returns {Promise<*>}
 */
export const generateCustomerNo = async ({
  customerNo,
  contactNumber,
  contactPerson,
  companyName,
  leadId,
}) => {
  // CASE 1 — customerNo already sent from frontend
  if (customerNo) {
    return customerNo;
  }

  // CASE 2 — same CRM client → same customer
  if (leadId) {
    const prev = await Invoice.findOne({ isDeleted: false, leadId, customerNo: { $ne: null } })
      .sort({ createdAt: 1 })
      .select("customerNo")
      .lean();
    if (prev) return prev.customerNo;
  }

  // CASE 3 — same mobile number → same customer
  const key = phoneKey(contactNumber);
  if (key.length === 10) {
    const prev = await Invoice.findOne({
      isDeleted: false,
      "billTo.contactNumber": { $regex: phoneRegex(key) },
    })
      .sort({ createdAt: 1 })
      .select("customerNo")
      .lean();
    if (prev) return prev.customerNo;
  } else if (contactPerson?.trim()) {
    // CASE 4 — no phone: exact company + person (person alone only for
    // callers that don't pass a company, as before)
    const query = {
      isDeleted: false,
      "billTo.contactPerson": { $regex: new RegExp(`^${escapeRegex(contactPerson.trim())}$`, "i") },
    };
    if (companyName?.trim()) {
      query["billTo.companyName"] = { $regex: new RegExp(`^${escapeRegex(companyName.trim())}$`, "i") };
    }
    const prev = await Invoice.findOne(query).sort({ createdAt: 1 }).select("customerNo").lean();
    if (prev) return prev.customerNo;
  }

  // CASE 5 — new customer
  const lastCustomer = await Invoice.findOne({}).sort({ customerNo: -1 }).select("customerNo").lean();

  return lastCustomer ? lastCustomer.customerNo + 1 : 1;
};

/**
 * Create invoice.
 *
 * @param {*} data
 * @returns {Promise<*>}
 */
export const createInvoiceService = async (data) => {
  const numbers = await generateInvoiceNumbers();
  const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
  const paymentTerms = data.paymentTerms || "Payable due amount in 10 days";
  const customerNo = await generateCustomerNo({
    customerNo: data.customerNo,
    contactNumber: data.billTo?.contactNumber,
    contactPerson: data.billTo?.contactPerson,
    companyName: data.billTo?.companyName,
    leadId: data.leadId,
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
    // link back to whichever order created this invoice, so a
    // refund settled here can be mirrored back onto that order.
    sourceOrderId: data.sourceOrderId || null,
    sourceOrderType: data.sourceOrderType || null,
    // who created it (employee) + which CRM client it belongs to
    createdBy: data.createdBy || null,
    createdByName: data.createdByName || "",
    createdByEmail: data.createdByEmail || "",
    leadId: data.leadId || null,
    clientId: data.clientId || null,
  });

  return invoice;
};

/**
 * source: "api"        -> normal edit from UI/controller
 *         "order-sync" -> called by resyncInvoiceForOrder (manualOrder.service.js)
 */
export const updateInvoiceService = async ({ invoiceId, data, source = "api", employee = null }) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });

  if (!invoice) {
    throw new NotFoundError("Invoice not found", { code: ERROR_CODES.INVOICE_NOT_FOUND });
  }

  // an agent can only edit their own invoice (order sync is internal and not checked)
  if (source === "api") await assertInvoiceAccess(invoice, employee);

  // Items of a manual / ecommerce order invoice only change through the order,
  // otherwise the next resync would overwrite the edit made in the UI.
  if (data.items && invoice.sourceOrderId && source !== "order-sync") {
    throw new BadRequestError("This invoice's items come from its order — edit them on the order instead", {
      code: ERROR_CODES.ITEMS_MANAGED_BY_ORDER,
    });
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
    // keep itemId, returnedQty and hsnCode, otherwise the link to returns / credit notes breaks
    const oldItems = invoice.items.map((i) => (i.toObject ? i.toObject() : i));
    invoice.items = data.items.map((item, index) => {
      const old = oldItems.find((i) => item.itemId && i.itemId === item.itemId);
      return {
        itemId: item.itemId || old?.itemId,
        returnedQty: old?.returnedQty || 0,
        articleNo: item.articleNo || String(index + 1),
        hsnCode: item.hsnCode || old?.hsnCode || "90212900",
        description: item.description,
        qty: item.qty,
        price: item.price,
        discountPercent: item.discountPercent || 0,
        discountValue: item.discountValue || 0,
        gstType: item.gstType || "IGST",
        gstPercent: item.gstPercent ?? 5,
      };
    });
  }
  if (data.summary) {
    const summary = { ...data.summary };
    // The freight of an order invoice is the order's shipping. Editing it in the UI
    // made the two differ, so only the order sync may change it.
    if (invoice.sourceOrderId && source !== "order-sync") delete summary.freightCost;
    invoice.summary = { ...invoice.summary.toObject?.(), ...summary };
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
    // lets an order (manual/ecommerce) report "this much is owed
    // back to the customer" without touching refundHistory itself.
    "refundStatus",
    "refundableAmount",
    "partialRefundAmount",
    "refundedAt",
  ];

  for (const field of directFields) {
    if (data[field] !== undefined) {
      invoice[field] = data[field];
    }
  }

  await invoice.save();

  // When customer details change, copy them to the CreditNotes and the source ManualOrder too
  if (data.billTo) {
    try {
      await syncCustomerFromInvoice(invoice);
    } catch (e) {
      logger.error("Customer sync failed", { error: e.message });
    }
  }

  return invoice;
};

/**
 * Delete invoice.
 *
 * @param {object} params
 * @param {*} params.invoiceId
 * @param {*} [params.employee]
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const deleteInvoiceService = async ({ invoiceId, employee = null }) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) {
    throw new NotFoundError("Invoice not found", { code: ERROR_CODES.INVOICE_NOT_FOUND });
  }
  await assertInvoiceAccess(invoice, employee);

  // Do not allow deleting an invoice that has linked credit notes
  if ((invoice.creditNoteIds || []).length || (invoice.appliedCredits || []).length) {
    throw new BadRequestError("This invoice has credit notes linked to it and cannot be deleted", {
      code: ERROR_CODES.INVOICE_HAS_CREDIT_NOTES,
    });
  }

  invoice.isDeleted = true;
  await invoice.save();
  return invoice;
};

/**
 * Get invoice by id.
 *
 * @param {object} params
 * @param {*} params.invoiceId
 * @param {*} [params.employee]
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getInvoiceByIdService = async ({ invoiceId, employee = null }) => {
  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false }).lean();
  if (!invoice) {
    throw new NotFoundError("Invoice not found", { code: ERROR_CODES.INVOICE_NOT_FOUND });
  }
  await assertInvoiceAccess(invoice, employee);
  return invoice;
};

/**
 * Invoice list.
 * query: {
 *   page, limit,
 *   search    — fuzzy: name / clinic / phone / invoice no. / client id / agent
 *               (works with small spelling mistakes)
 *   type      — "client" | "manual" | "ecommerce" | "other" (default: all)
 *   status    — draft | issued | paid | partially_paid | cancelled
 *   createdBy — employee _id (admins only: "invoices of this agent")
 *   leadId    — invoices of one client
 *   month, year
 * }
 * employee — logged-in Employee (an agent only sees their own invoices)
 */
export const getInvoicesService = async ({ query, employee = null }) => {
  const { page, limit, skip } = getPagination(query);
  const { search, status, month, year, type, createdBy, leadId } = query;

  const scope = await buildInvoiceScope(employee);
  const base = { isDeleted: false, ...scope };

  const filter = { ...base };
  if (status) filter.status = status;
  if (type && TYPE_FILTERS[type]) Object.assign(filter, TYPE_FILTERS[type]);
  if (createdBy && !isAgent(employee) && mongoose.Types.ObjectId.isValid(createdBy)) {
    filter.createdBy = new mongoose.Types.ObjectId(createdBy);
  }
  if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
    filter.leadId = new mongoose.Types.ObjectId(leadId);
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

  // Tabs ke upar count badges: "Client (420) · Manual Order (310) · ..."
  // (counted inside the role scope only)
  const typeCountsPromise = Invoice.aggregate([
    { $match: base },
    {
      $group: {
        _id: null,
        all: { $sum: 1 },
        client: { $sum: { $cond: [{ $ne: [{ $ifNull: ["$leadId", null] }, null] }, 1, 0] } },
        manual: { $sum: { $cond: [{ $eq: ["$sourceOrderType", "manual"] }, 1, 0] } },
        ecommerce: { $sum: { $cond: [{ $eq: ["$sourceOrderType", "ecommerce"] }, 1, 0] } },
        other: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: [{ $ifNull: ["$leadId", null] }, null] },
                  { $eq: [{ $ifNull: ["$sourceOrderType", null] }, null] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
    { $project: { _id: 0 } },
  ]);

  let invoices;
  let totalItems;
  if (search && String(search).trim()) {
    const result = await fuzzySearch(Invoice, { filter, q: search, skip, limit });
    invoices = result.items;
    totalItems = result.total;
  } else {
    [invoices, totalItems] = await Promise.all([
      Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Invoice.countDocuments(filter),
    ]);
  }

  const [typeCounts] = await typeCountsPromise;
  const totalPages = Math.ceil(totalItems / limit);
  return {
    invoices,
    typeCounts: typeCounts || { all: 0, client: 0, manual: 0, ecommerce: 0, other: 0 },
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

/* =========================================================================
   MIRROR A SETTLED REFUND BACK TO THE ORDER IT CAME FROM
   Purely a display-sync — this invoice is the source of truth for the
   money; the order just needs to keep showing the same numbers.
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
   SETTLE A PENDING REFUND (cash payout OR store credit)
   Works off invoice.refundableAmount. This is the ONLY function that
   decrements it and writes refundHistory.
   ========================================================================= */
/**
 * Settle invoice refund.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const settleInvoiceRefundService = async (data, currentUser) => {
  const { invoiceId, amount, method = "credit_note", reference, appliedToOrderId, notes } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) {
    throw new NotFoundError("Invoice not found", { code: ERROR_CODES.INVOICE_NOT_FOUND });
  }

  if (!["refund_pending", "partial_refunded"].includes(invoice.refundStatus)) {
    throw new BadRequestError(
      `This invoice has no pending refund to settle (currently "${invoice.refundStatus}")`
    );
  }

  const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other", "credit_note"];
  if (!allowedMethods.includes(method)) {
    throw new BadRequestError(`method must be one of: ${allowedMethods.join(", ")}`);
  }

  const settleAmount = Number(amount);
  if (!settleAmount || settleAmount <= 0) {
    throw new BadRequestError("amount must be a positive number");
  }

  const outstanding = Number(invoice.refundableAmount || 0);
  if (settleAmount > outstanding + 0.01) {
    throw new BadRequestError(
      `Amount (${settleAmount}) is more than what's actually owed on this invoice (${outstanding.toFixed(2)})`
    );
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

  /* ---------- CREDIT NOTE DOCUMENT (store credit only) ---------- */
  let creditNote = null;
  if (method === "credit_note") {
    creditNote = await createCreditNoteFromInvoiceService({
      invoice,
      amount: settleAmount,
      refundId,
      employeeEmail: employee.email,
      appliedToOrderId,
      notes,
    });
    const entry = invoice.refundHistory.find((r) => r.refundId === refundId);
    if (entry) {
      entry.creditNoteId = creditNote.creditNoteId;
      entry.creditNoteNumber = creditNote.creditNoteNumber;
    }
    if (!invoice.creditNoteIds.includes(creditNote.creditNoteId)) {
      invoice.creditNoteIds.push(creditNote.creditNoteId);
    }
    await invoice.save();
  }

  /* ---------- KEEP SOURCE ORDER IN SYNC (non-blocking) ---------- */
  try {
    await syncRefundStateToSourceOrder(invoice);
  } catch (err) {
    logger.error("Order sync failed after invoice refund settle", { error: err.message });
  }

  const avgGstPercent =
    invoice.items.length > 0
      ? invoice.items.reduce((s, i) => s + Number(i.gstPercent || 0), 0) / invoice.items.length
      : 0;

  let appliedOrderDate = null;
  let appliedOrderGrandTotal = null;
  let appliedOrderItems = [];
  let appliedInvoiceNumber = null;
  if (appliedToOrderId) {
    // appliedToOrderId is a new order's id (→ its invoice's sourceOrderId)
    // OR a new standalone invoice's own invoiceId — match both.
    const appliedInvoice = await Invoice.findOne({
      $or: [{ sourceOrderId: appliedToOrderId }, { invoiceId: appliedToOrderId }],
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
    ...(creditNote ? toCreditNoteListShape(creditNote.toObject()) : {}),
    refundId: creditNote ? creditNote.creditNoteNumber : refundId,
    invoiceRefundId: refundId,
    creditNoteId: creditNote?.creditNoteId || null,
    creditNoteNumber: creditNote?.creditNoteNumber || null,
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
    returnedItems: creditNote ? toCreditNoteListShape(creditNote.toObject()).items : invoice.items,
  };
};

/* =========================================================================
   CREDIT NOTES LIST — kept for backward compatibility with
   GET /invoice/manage/credit-notes; delegates to the CreditNote collection.
   ========================================================================= */
/**
 * Get invoice credit notes.
 *
 * @param {*} query
 * @returns {Promise<*>}
 */
export const getInvoiceCreditNotesService = async (query) => getCreditNotesService(query);

/* =========================================================================
   "CHECK CREDIT" LOOKUP — every invoice that still owes this phone number
   money + open credit notes.
   ========================================================================= */
/**
 * Get customer credit lookup.
 *
 * @param {object} params
 * @param {*} params.phone
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getCustomerCreditLookupService = async ({ phone }) => {
  const trimmed = String(phone || "").trim();
  if (!trimmed) {
    throw new BadRequestError("phone is required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  const invoices = await Invoice.find({
    isDeleted: false,
    "billTo.contactNumber": trimmed,
    refundStatus: { $in: ["refund_pending", "partial_refunded"] },
    refundableAmount: { $gt: 0 },
  })
    .sort({ createdAt: 1 })
    .select(
      "invoiceId invoiceNumber refundableAmount refundStatus sourceOrderId sourceOrderType orderDate invoiceDate billTo.companyName billTo.contactPerson"
    )
    .lean();

  const sources = invoices.map((inv) => ({
    kind: "invoice", // settle via PUT /invoice/manage/credit-settle/:invoiceId
    invoiceId: inv.invoiceId,
    invoiceNumber: inv.invoiceNumber,
    sourceOrderId: inv.sourceOrderId,
    sourceOrderType: inv.sourceOrderType, // "manual" | "ecommerce" | null (standalone)
    orderDate: inv.orderDate || inv.invoiceDate,
    companyName: inv.billTo?.companyName,
    contactPerson: inv.billTo?.contactPerson,
    owed: Number(inv.refundableAmount || 0),
  }));

  // open credit notes — use via PUT /credit-note/manage/apply/:creditNoteId
  const openNotes = await getOpenCreditNotesForPhone(trimmed);
  for (const cn of openNotes) {
    sources.push({
      kind: "credit_note",
      creditNoteId: cn.creditNoteId,
      creditNoteNumber: cn.creditNoteNumber,
      invoiceId: cn.invoiceId,
      invoiceNumber: cn.creditNoteNumber, // shown in the UI list
      sourceOrderId: cn.sourceOrderId,
      sourceOrderType: cn.sourceOrderType,
      orderDate: cn.creditNoteDate,
      companyName: cn.billTo?.companyName,
      contactPerson: cn.billTo?.contactPerson,
      owed: Number(cn.balance || 0),
    });
  }

  const available = Math.round(sources.reduce((sum, s) => sum + s.owed, 0) * 100) / 100;

  return { available, sources };
};

/* =========================================================================
   RECORD A RETURN DIRECTLY ON A STANDALONE INVOICE
   (sourceOrderId === null only)
   ========================================================================= */
const computeRefundStatus = (refundableAmount, partialRefundAmount) => {
  if (refundableAmount > 0.01) {
    return partialRefundAmount > 0.01 ? "partial_refunded" : "refund_pending";
  }
  return partialRefundAmount > 0.01 ? "refunded" : "none";
};

/**
 * Create invoice return.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createInvoiceReturnService = async (data, currentUser) => {
  const { invoiceId, returnItems, refundNow, refundMethod, reference, notes } = data;

  const employee = await Employee.findOne({ email: currentUser.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const invoice = await Invoice.findOne({ invoiceId, isDeleted: false });
  if (!invoice) {
    throw new NotFoundError("Invoice not found", { code: ERROR_CODES.INVOICE_NOT_FOUND });
  }

  if (invoice.sourceOrderId) {
    throw new BadRequestError(
      invoice.sourceOrderType === "manual"
        ? "This invoice belongs to a manual order — record the return on that order instead."
        : "This invoice belongs to an ecommerce order — record the return through the order's return-request flow instead.",
      { code: ERROR_CODES.INVOICE_HAS_SOURCE_ORDER }
    );
  }

  if (!["paid", "partially_paid"].includes(invoice.status)) {
    throw new BadRequestError(
      `Return not allowed — this invoice is "${invoice.status}" and no payment has been received yet, so there is nothing to refund.`,
      { code: ERROR_CODES.INVOICE_NOT_PAID }
    );
  }

  if (!Array.isArray(returnItems) || returnItems.length === 0) {
    throw new BadRequestError("returnItems are required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  const validatedItems = [];
  let refundableAmountDelta = 0;

  for (const ret of returnItems) {
    const { itemId, quantity, reason } = ret;
    const qty = Number(quantity);

    if (!itemId || !qty || qty <= 0) {
      throw new BadRequestError("Each return item needs a valid itemId and quantity", {
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }

    const item = invoice.items.find((i) => i.itemId === itemId);
    if (!item) {
      throw new NotFoundError(`Invoice item not found: ${itemId}`, { code: ERROR_CODES.ITEM_NOT_FOUND });
    }

    const availableQty = Number(item.qty) - Number(item.returnedQty || 0);
    if (qty > availableQty) {
      throw new BadRequestError(
        `Return quantity exceeds available quantity for "${item.description}" (available: ${availableQty})`,
        { code: ERROR_CODES.INVALID_QUANTITY }
      );
    }

    // Per-unit rate from what the customer was actually charged for this
    // line (GST-inclusive, post-discount), not the raw MRP.
    const perUnitAmount = Number(item.qty) > 0 ? Number(item.totalAmount) / Number(item.qty) : 0;
    const lineRefundAmount = Math.round(perUnitAmount * qty * 100) / 100;

    item.returnedQty = Number(item.returnedQty || 0) + qty;
    refundableAmountDelta += lineRefundAmount;

    validatedItems.push({
      itemId: item.itemId,
      description: item.description,
      quantity: qty,
      price: perUnitAmount,
      reason: reason || "Return",
    });
  }

  // The cap also counts manual credit notes; otherwise a credit note and a
  // return could both be created for the same money
  const maxRefundable = await getInvoiceCreditCap(invoice);

  if (refundableAmountDelta > maxRefundable + 0.01) {
    throw new BadRequestError(
      `Refund amount (${refundableAmountDelta.toFixed(2)}) is more than what's left to give back on this invoice (${maxRefundable.toFixed(2)}). ` +
        `A credit note / refund has already been issued on this invoice.`,
      { code: ERROR_CODES.REFUND_EXCEEDS_PAID }
    );
  }

  const requestId = `RET-${uuidv6()}`;
  invoice.returns.push({
    requestId,
    items: validatedItems,
    processedBy: employee.email,
    requestedAt: new Date(),
    processedAt: new Date(),
  });

  let refundId = null;

  if (refundNow) {
    const allowedMethods = ["cash", "upi", "bank_transfer", "card", "other"];
    if (!refundMethod || !allowedMethods.includes(refundMethod)) {
      throw new BadRequestError(`refundMethod is required and must be one of: ${allowedMethods.join(", ")}`, {
        code: ERROR_CODES.VALIDATION_ERROR,
      });
    }

    refundId = `CN-${uuidv6()}`;
    invoice.partialRefundAmount = Number(invoice.partialRefundAmount || 0) + refundableAmountDelta;
    invoice.refundedAt = new Date();
    invoice.refundHistory.push({
      refundId,
      amount: refundableAmountDelta,
      method: refundMethod,
      reference: reference || null,
      refundedBy: employee.email,
      refundedAt: new Date(),
      refundStatus: "processed",
      appliedToOrderId: null,
      notes: notes || null,
    });
    invoice.refundStatus = computeRefundStatus(
      Number(invoice.refundableAmount || 0),
      invoice.partialRefundAmount
    );
  } else {
    invoice.refundableAmount = Number(invoice.refundableAmount || 0) + refundableAmountDelta;
    invoice.refundStatus = computeRefundStatus(
      invoice.refundableAmount,
      Number(invoice.partialRefundAmount || 0)
    );
  }

  await invoice.save();

  return {
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    requestId,
    refundId,
    refundStatus: invoice.refundStatus,
    refundableAmount: invoice.refundableAmount,
    partialRefundAmount: invoice.partialRefundAmount,
    refundProcessed: !!refundNow,
    refundedAmount: refundableAmountDelta,
    items: validatedItems,
  };
};
