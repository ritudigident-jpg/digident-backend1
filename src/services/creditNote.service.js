import CreditNote, { CreditNoteCounter } from "../models/manage/creditNote.model.js";
import Invoice from "../models/manage/invoice.model.js";
import Employee from "../models/manage/employee.model.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";
import { getDefaultSellerDetails } from "../helpers/invoiceDefault.helper.js";

/* =============================================================================
   CREDIT NOTE SERVICE
   Mirrors invoice.service.js: one place that creates / reads / changes
   CreditNote documents.

   Two ways to create (like Invoice):
     createCreditNoteService            → by hand ("Create Credit Note")
     createCreditNoteFromInvoiceService → from an invoice's refund, called
                                          by settleInvoiceRefundService

   Two ways to use one up:
     applyCreditNoteService  → discount on a new order / invoice
     refundCreditNoteService → pay it back (cash/upi/…)

   NOTE: this file must NOT import invoice.service.js (invoice.service.js
   imports this one — keep the dependency one-way).
   ============================================================================= */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const fail = (message, statusCode = 400, errorCode = "VALIDATION_ERROR") => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  return error;
};

const getEmployee = async (currentUser) => {
  const employee = await Employee.findOne({ email: currentUser?.email });
  if (!employee) throw fail("Employee not found", 404, "EMPLOYEE_NOT_FOUND");
  return employee;
};

const avgGstPercent = (items = []) =>
  items.length ? round2(items.reduce((s, i) => s + Number(i.gstPercent || 0), 0) / items.length) : 0;

/* ---------- NUMBER: CN/2026-27/00001 (Indian financial year, Apr–Mar) ---------- */
const financialYearLabel = (date = new Date()) => {
  const d = new Date(date);
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};

export const generateCreditNoteNumber = async (date = new Date()) => {
  const fy = `CN/${financialYearLabel(date)}`;
  let counter = await CreditNoteCounter.findOneAndUpdate(
    { _id: fy },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();

  // First number of a year (or counter missing after a migration): make
  // sure we start after anything already stored with this prefix.
  if (counter.seq === 1) {
    const last = await CreditNote.findOne({ creditNoteNumber: { $regex: `^${fy.replace(/\//g, "\\/")}\\/` } })
      .sort({ creditNoteNumber: -1 })
      .select("creditNoteNumber")
      .lean();
    const lastSeq = last ? Number(String(last.creditNoteNumber).split("/").pop()) || 0 : 0;
    if (lastSeq >= 1) {
      counter = await CreditNoteCounter.findOneAndUpdate(
        { _id: fy },
        { $max: { seq: lastSeq + 1 } },
        { new: true }
      ).lean();
    }
  }
  return `${fy}/${String(counter.seq).padStart(5, "0")}`;
};

// Create with a fresh number. The counter already prevents clashes; the
// retry only covers a manually inserted/migrated number colliding.
const createWithNumber = async (doc) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const creditNoteNumber = await generateCreditNoteNumber(doc.creditNoteDate || new Date());
      return await CreditNote.create({ ...doc, creditNoteNumber });
    } catch (err) {
      if (err?.code === 11000) continue; // creditNoteId is a uuid, so this is the number
      throw err;
    }
  }
  throw fail("Could not generate a credit note number, please retry", 500, "CREDIT_NOTE_NUMBER_CONFLICT");
};

// invoice.seller is a nested path on a mongoose doc — read it off a plain copy,
// and drop empty strings so they don't overwrite the defaults.
const plainSeller = (invoice) => {
  const seller = (invoice?.toObject ? invoice.toObject() : invoice)?.seller || {};
  return Object.fromEntries(Object.entries(seller).filter(([, v]) => v !== "" && v != null));
};

const linkToInvoice = (invoiceId, creditNoteId) =>
  invoiceId
    ? Invoice.updateOne({ invoiceId }, { $addToSet: { creditNoteIds: creditNoteId } })
    : Promise.resolve();

/* ---------- where was a credit spent? (orderId OR invoiceId) ---------- */
const resolveTarget = async (appliedToId) => {
  if (!appliedToId) return { appliedToType: null, appliedToNumber: null };
  const inv = await Invoice.findOne({
    isDeleted: false,
    $or: [{ invoiceId: appliedToId }, { sourceOrderId: appliedToId }],
  })
    .select("invoiceId invoiceNumber sourceOrderId sourceOrderType")
    .lean();
  if (!inv) return { appliedToType: null, appliedToNumber: null };
  const appliedToType =
    inv.invoiceId === appliedToId
      ? "invoice"
      : inv.sourceOrderType === "ecommerce"
      ? "ecommerce_order"
      : "manual_order";
  return { appliedToType, appliedToNumber: inv.invoiceNumber };
};

/* ---------- how much more can still be credited against an invoice ----------
   received − (already refunded + still pending refund) − (other MANUAL credit
   notes on it). Return/cancellation credit notes are already inside
   partialRefundAmount, so they are not subtracted again. */
export const getInvoiceCreditCap = async (invoice) => {
  const totalPayable = Number(invoice.summary?.totalPayAmount || 0);
  const recordedPaid = Number(invoice.summary?.paidAmount || 0);
  const received = invoice.status === "paid" ? Math.max(recordedPaid, totalPayable) : recordedPaid;
  const committedOnInvoice =
    Number(invoice.partialRefundAmount || 0) + Number(invoice.refundableAmount || 0);

  const [agg] = await CreditNote.aggregate([
    { $match: { invoiceId: invoice.invoiceId, type: "manual", status: { $ne: "cancelled" }, isDeleted: false } },
    { $group: { _id: null, total: { $sum: "$summary.totalAmount" } } },
  ]);
  const manualCredited = Number(agg?.total || 0);

  return Math.max(round2(received - committedOnInvoice - manualCredited), 0);
};

const cleanItems = (items = [], defaultGst = 0) =>
  (Array.isArray(items) ? items : [])
    .map((i) => ({
      description: String(i.description || "").trim(),
      hsnCode: i.hsnCode || "90212900",
      qty: Math.max(1, Number(i.qty) || 1),
      price: Math.max(0, Number(i.price) || 0),
      gstType: i.gstType || "IGST",
      gstPercent: i.gstPercent !== undefined && i.gstPercent !== "" ? Math.max(0, Number(i.gstPercent) || 0) : defaultGst,
    }))
    .filter((i) => i.description && i.price > 0);

/* =============================================================================
   1) CREATE BY HAND  ("Create Credit Note")
   body: {
     invoiceId?,                          // recommended — snapshots customer + caps amount
     billTo?: { companyName, contactPerson, contactNumber, address, gstin }, // required if no invoiceId
     customerNo?,
     reason,                              // required
     items?: [{ description, qty, price, gstPercent?, hsnCode? }],
     amount?, gstPercent?,                // used when no items → one line = reason
     creditNoteDate?, notes?,
     refundMethod?, reference?            // optional: pay it back immediately
   }
   Works for ANY invoice (standalone, manual-order or ecommerce) because a
   manual credit note never touches the invoice's own refund fields — so the
   manual-order resync can't wipe it.
   ============================================================================= */
export const createCreditNoteService = async (data, currentUser) => {
  const employee = await getEmployee(currentUser);

  const reason = String(data.reason || "").trim();
  if (!reason) throw fail("reason is required");

  let invoice = null;
  if (data.invoiceId) {
    invoice = await Invoice.findOne({ invoiceId: data.invoiceId, isDeleted: false });
    if (!invoice) throw fail("Invoice not found", 404, "INVOICE_NOT_FOUND");
    if (!["paid", "partially_paid"].includes(invoice.status)) {
      throw fail(
        `Credit note not allowed — invoice ${invoice.invoiceNumber} is "${invoice.status}" and nothing has been received yet. Edit the invoice instead.`,
        400,
        "INVOICE_NOT_PAID"
      );
    }
  } else if (!data.billTo?.companyName?.trim() && !data.billTo?.contactPerson?.trim()) {
    throw fail("Either invoiceId or billTo (customer) is required");
  }

  const defaultGst =
    data.gstPercent !== undefined && data.gstPercent !== ""
      ? Math.max(0, Number(data.gstPercent) || 0)
      : invoice
      ? avgGstPercent(invoice.items)
      : 0;

  let items = cleanItems(data.items, defaultGst);
  if (items.length === 0) {
    const amount = round2(data.amount);
    if (!amount || amount <= 0) throw fail("amount must be a positive number (or send items)");
    items = [{ description: reason, hsnCode: "90212900", qty: 1, price: amount, gstType: "IGST", gstPercent: defaultGst }];
  }
  const total = round2(items.reduce((s, i) => s + i.qty * i.price, 0));

  if (invoice) {
    const cap = await getInvoiceCreditCap(invoice);
    if (total > cap + 0.01) {
      throw fail(
        `Credit amount (${total.toFixed(2)}) is more than what the customer paid on ${invoice.invoiceNumber} and hasn't already got back (${cap.toFixed(2)}).`,
        400,
        "CREDIT_EXCEEDS_PAID"
      );
    }
  }

  const billTo = invoice
    ? {
        companyName: invoice.billTo?.companyName || invoice.billTo?.contactPerson || "",
        address: invoice.billTo?.address || "",
        gstin: invoice.billTo?.gstin || "",
        contactPerson: invoice.billTo?.contactPerson || "",
        contactNumber: invoice.billTo?.contactNumber || "",
      }
    : {
        companyName: (data.billTo.companyName || data.billTo.contactPerson).trim(),
        address: data.billTo.address || "",
        gstin: data.billTo.gstin || "",
        contactPerson: data.billTo.contactPerson || "",
        contactNumber: String(data.billTo.contactNumber || "").trim(),
      };

  const cn = await createWithNumber({
    type: "manual",
    reason,
    creditNoteDate: data.creditNoteDate ? new Date(data.creditNoteDate) : new Date(),
    invoiceId: invoice?.invoiceId || null,
    invoiceNumber: invoice?.invoiceNumber || null,
    invoiceDate: invoice?.invoiceDate || null,
    sourceOrderId: invoice?.sourceOrderId || null,
    sourceOrderType: invoice?.sourceOrderType || null,
    customerNo: invoice?.customerNo ?? data.customerNo ?? null,
    seller: { ...getDefaultSellerDetails(), ...plainSeller(invoice) },
    billTo,
    items,
    notes: data.notes || "",
    createdBy: employee.email,
  });

  await linkToInvoice(cn.invoiceId, cn.creditNoteId);

  if (data.refundMethod) {
    return refundCreditNoteService(
      {
        creditNoteId: cn.creditNoteId,
        amount: cn.balance,
        method: data.refundMethod,
        reference: data.reference,
        notes: "Paid back at creation",
      },
      currentUser
    );
  }
  return toCreditNoteListShape(cn.toObject());
};

/* =============================================================================
   2) CREATE FROM AN INVOICE'S REFUND  (like "invoice from order")
   Called ONLY by settleInvoiceRefundService when method === "credit_note".
   At that point the invoice's refundableAmount has already been paid down,
   so this credit note now carries that value as its balance. If the credit
   was spent straight away on a new order/invoice (appliedToOrderId), it is
   created already "used".
   ============================================================================= */
const pickLines = (candidates, amount) => {
  // Use the real returned items only if they add up to what's being
  // credited — otherwise the PDF would show a total that doesn't match.
  for (const lines of candidates) {
    const total = round2(lines.reduce((s, l) => s + l.qty * l.price, 0));
    if (lines.length && Math.abs(total - amount) <= 0.5) return lines;
  }
  return null;
};

export const createCreditNoteFromInvoiceService = async ({
  invoice,
  amount,
  refundId,
  employeeEmail,
  appliedToOrderId,
  notes,
  date, // optional — only the migration passes the original date
}) => {
  const value = round2(amount);
  const when = date ? new Date(date) : new Date();
  const gst = avgGstPercent(invoice.items);
  let type = "return";
  const candidates = [];

  if (invoice.sourceOrderType === "manual" && invoice.sourceOrderId) {
    const order = await ManualOrder.findOne({ orderId: invoice.sourceOrderId }).lean();
    if (order?.orderStatus === "cancelled") {
      type = "cancellation";
      candidates.push(
        (order.items || []).map((i) => ({
          description: i.variantName ? `${i.productName} - ${i.variantName}` : i.productName,
          qty: Number(i.quantity),
          price: Number(i.price),
        }))
      );
    } else if (order?.returnRequests?.length) {
      const toLines = (rr) =>
        (rr.items || []).map((i) => ({
          description: i.variantName ? `${i.productName} - ${i.variantName}` : i.productName,
          qty: Number(i.quantity),
          price: Number(i.price),
        }));
      candidates.push(toLines(order.returnRequests[order.returnRequests.length - 1]));
      candidates.push(order.returnRequests.flatMap(toLines));
    }
  } else if (invoice.returns?.length) {
    const toLines = (r) =>
      (r.items || []).map((i) => ({ description: i.description, qty: Number(i.quantity), price: Number(i.price) }));
    candidates.push(toLines(invoice.returns[invoice.returns.length - 1]));
    candidates.push(invoice.returns.flatMap(toLines));
  }

  const lines =
    pickLines(candidates, value) || [
      {
        description:
          type === "cancellation"
            ? `Order cancelled — credit against invoice ${invoice.invoiceNumber}`
            : `Goods returned — credit against invoice ${invoice.invoiceNumber}`,
        qty: 1,
        price: value,
      },
    ];

  const usage = [];
  if (appliedToOrderId) {
    const target = await resolveTarget(appliedToOrderId);
    usage.push({
      kind: "applied",
      amount: value,
      appliedToId: appliedToOrderId,
      ...target,
      notes: notes || null,
      by: employeeEmail,
      at: when,
    });
  }

  const cn = await createWithNumber({
    type,
    reason: type === "cancellation" ? "Order cancelled" : "Goods returned",
    creditNoteDate: when,
    invoiceId: invoice.invoiceId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    sourceOrderId: invoice.sourceOrderId || null,
    sourceOrderType: invoice.sourceOrderType || null,
    invoiceRefundId: refundId,
    customerNo: invoice.customerNo ?? null,
    seller: { ...getDefaultSellerDetails(), ...plainSeller(invoice) },
    billTo: {
      companyName: invoice.billTo?.companyName || invoice.billTo?.contactPerson || "Customer",
      address: invoice.billTo?.address || "",
      gstin: invoice.billTo?.gstin || "",
      contactPerson: invoice.billTo?.contactPerson || "",
      contactNumber: invoice.billTo?.contactNumber || "",
    },
    items: lines.map((l) => ({ ...l, gstPercent: gst, gstType: "IGST" })),
    usage,
    notes: notes || "",
    createdBy: employeeEmail,
  });

  return cn;
};

/* =============================================================================
   3) USE IT — apply as discount on a new order/invoice
   ============================================================================= */
export const applyCreditNoteService = async ({ creditNoteId, amount, appliedToId, notes }, currentUser) => {
  const employee = await getEmployee(currentUser);
  const cn = await CreditNote.findOne({ creditNoteId, isDeleted: false });
  if (!cn) throw fail("Credit note not found", 404, "CREDIT_NOTE_NOT_FOUND");
  if (!["open", "partially_used"].includes(cn.status)) {
    throw fail(`Credit note ${cn.creditNoteNumber} is "${cn.status}" — nothing left to use`);
  }
  if (!appliedToId) throw fail("appliedToId (new orderId or invoiceId) is required");

  const value = round2(amount);
  if (!value || value <= 0) throw fail("amount must be a positive number");
  if (value > cn.balance + 0.01) {
    throw fail(`Only ${cn.balance.toFixed(2)} is left on ${cn.creditNoteNumber}`, 400, "CREDIT_EXCEEDS_BALANCE");
  }

  const target = await resolveTarget(appliedToId);
  cn.usage.push({
    kind: "applied",
    amount: value,
    appliedToId,
    ...target,
    notes: notes || null,
    by: employee.email,
    at: new Date(),
  });
  await cn.save();
  return toCreditNoteListShape(cn.toObject());
};

/* =============================================================================
   4) USE IT — pay it back
   ============================================================================= */
export const refundCreditNoteService = async ({ creditNoteId, amount, method, reference, notes }, currentUser) => {
  const employee = await getEmployee(currentUser);
  const cn = await CreditNote.findOne({ creditNoteId, isDeleted: false });
  if (!cn) throw fail("Credit note not found", 404, "CREDIT_NOTE_NOT_FOUND");
  if (!["open", "partially_used"].includes(cn.status)) {
    throw fail(`Credit note ${cn.creditNoteNumber} is "${cn.status}" — nothing left to pay back`);
  }

  const allowed = ["cash", "upi", "bank_transfer", "card", "other"];
  if (!allowed.includes(method)) throw fail(`method must be one of: ${allowed.join(", ")}`);

  const value = round2(amount ?? cn.balance);
  if (!value || value <= 0) throw fail("amount must be a positive number");
  if (value > cn.balance + 0.01) {
    throw fail(`Only ${cn.balance.toFixed(2)} is left on ${cn.creditNoteNumber}`, 400, "CREDIT_EXCEEDS_BALANCE");
  }

  cn.usage.push({
    kind: "refunded",
    amount: value,
    method,
    reference: reference || null,
    notes: notes || null,
    by: employee.email,
    at: new Date(),
  });
  await cn.save();
  return toCreditNoteListShape(cn.toObject());
};

/* =============================================================================
   5) CANCEL — only an unused MANUAL credit note (raised by mistake).
   A return/cancellation credit note came out of the invoice's refund; undo
   that on the invoice/order side instead, or pay it back.
   ============================================================================= */
export const cancelCreditNoteService = async ({ creditNoteId, reason }, currentUser) => {
  const employee = await getEmployee(currentUser);
  const cn = await CreditNote.findOne({ creditNoteId, isDeleted: false });
  if (!cn) throw fail("Credit note not found", 404, "CREDIT_NOTE_NOT_FOUND");
  if (cn.type !== "manual") {
    throw fail("Only a manually created credit note can be cancelled", 400, "NOT_MANUAL");
  }
  if (cn.usage.length > 0) {
    throw fail("This credit note has already been used — it can't be cancelled", 400, "ALREADY_USED");
  }

  cn.status = "cancelled";
  cn.cancelledAt = new Date();
  cn.cancelReason = String(reason || "").trim() || `Cancelled by ${employee.email}`;
  await cn.save();
  return toCreditNoteListShape(cn.toObject());
};

/* =============================================================================
   READS
   ============================================================================= */

// Flattens a CreditNote into the shape CreditNotesPage / CustomerDetailPage /
// generateCreditNotePdf already understand (they were built against the old
// refundHistory-based list), plus the new fields.
export const toCreditNoteListShape = (cn) => {
  const applied = (cn.usage || []).filter((u) => u.kind === "applied");
  const lastApplied = applied[applied.length - 1] || null;
  const items = (cn.items || []).map((i) => ({
    itemId: i.itemId,
    description: i.description,
    hsnCode: i.hsnCode,
    qty: i.qty,
    quantity: i.qty,
    price: i.price,
    gstPercent: i.gstPercent,
    totalAmount: i.totalAmount,
  }));
  return {
    ...cn,
    // legacy aliases
    refundId: cn.creditNoteNumber,
    amount: cn.summary?.totalAmount || 0,
    refundedAt: cn.creditNoteDate,
    refundedBy: cn.createdBy,
    customerName: cn.billTo?.contactPerson || cn.billTo?.companyName,
    customerCompany: cn.billTo?.companyName,
    customerPhone: cn.billTo?.contactNumber,
    customerEmail: null,
    sourceInvoiceId: cn.invoiceId,
    sourceInvoiceNumber: cn.invoiceNumber,
    sourceOrderDate: cn.invoiceDate,
    sourceOrderGstPercentage: avgGstPercent(cn.items),
    items,
    returnedItems: items,
    appliedToOrderId: lastApplied?.appliedToId || null,
    appliedInvoiceNumber: lastApplied?.appliedToNumber || null,
    appliedOrderDate: lastApplied?.at || null,
    // new
    totalApplied: round2(applied.reduce((s, u) => s + u.amount, 0)),
    totalRefunded: round2((cn.usage || []).filter((u) => u.kind === "refunded").reduce((s, u) => s + u.amount, 0)),
  };
};

export const getCreditNotesService = async (query = {}) => {
  const { search, startDate, endDate, status, type, invoiceId, phone } = query;
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(Math.max(1, Number(query.limit) || 200), 1000);

  const filter = { isDeleted: false };
  if (status) filter.status = { $in: String(status).split(",") };
  if (type) filter.type = { $in: String(type).split(",") };
  if (invoiceId) filter.invoiceId = invoiceId;
  if (phone) filter["billTo.contactNumber"] = String(phone).trim();
  if (startDate || endDate) {
    filter.creditNoteDate = {};
    if (startDate) filter.creditNoteDate.$gte = new Date(startDate);
    if (endDate) {
      const to = new Date(endDate);
      to.setHours(23, 59, 59, 999);
      filter.creditNoteDate.$lte = to;
    }
  }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { creditNoteNumber: regex },
      { invoiceNumber: regex },
      { sourceOrderId: regex },
      { "billTo.companyName": regex },
      { "billTo.contactPerson": regex },
      { "billTo.contactNumber": regex },
      { reason: regex },
    ];
  }

  const [docs, totalItems, forSummary] = await Promise.all([
    CreditNote.find(filter).sort({ creditNoteDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    CreditNote.countDocuments(filter),
    CreditNote.find({ ...filter, status: { $ne: "cancelled" } })
      .select("summary.totalAmount balance usage.kind usage.amount")
      .lean(),
  ]);

  const totals = forSummary.reduce(
    (acc, cn) => {
      acc.count += 1;
      acc.totalIssued += Number(cn.summary?.totalAmount || 0);
      acc.totalUnapplied += Number(cn.balance || 0);
      for (const u of cn.usage || []) {
        if (u.kind === "applied") acc.totalApplied += Number(u.amount || 0);
        if (u.kind === "refunded") acc.totalRefunded += Number(u.amount || 0);
      }
      return acc;
    },
    { count: 0, totalIssued: 0, totalApplied: 0, totalRefunded: 0, totalUnapplied: 0 }
  );

  return {
    creditNotes: docs.map(toCreditNoteListShape),
    summary: {
      totalCreditNotes: totals?.count || 0,
      totalIssued: round2(totals?.totalIssued || 0),
      totalApplied: round2(totals?.totalApplied || 0),
      totalRefunded: round2(totals?.totalRefunded || 0),
      totalUnapplied: round2(totals?.totalUnapplied || 0),
    },
    pagination: {
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      limit,
    },
  };
};

export const getCreditNoteByIdService = async ({ creditNoteId }) => {
  const cn = await CreditNote.findOne({
    isDeleted: false,
    $or: [{ creditNoteId }, { creditNoteNumber: creditNoteId }],
  }).lean();
  if (!cn) throw fail("Credit note not found", 404, "CREDIT_NOTE_NOT_FOUND");
  return toCreditNoteListShape(cn);
};

// Open credit notes for a phone — merged into the "Check credit" lookup.
export const getOpenCreditNotesForPhone = async (phone) =>
  CreditNote.find({
    isDeleted: false,
    "billTo.contactNumber": String(phone || "").trim(),
    status: { $in: ["open", "partially_used"] },
    balance: { $gt: 0 },
  })
    .sort({ creditNoteDate: 1 })
    .lean();
