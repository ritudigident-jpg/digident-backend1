import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
const { Schema, model } = mongoose;

/* =============================================================================
   CREDIT NOTE — its own collection, same way Invoice has its own.

   Just like an Invoice can be made two ways —
     • by hand            ("Create Invoice"            → createInvoiceService)
     • from an order      (manual/ecommerce order      → createInvoiceService with sourceOrderId)
   — a Credit Note can be made two ways too:
     • by hand            (type "manual")        → createCreditNoteService
         rate difference, discount after billing, short supply, goodwill…
     • from an invoice    (type "return" / "cancellation")
         → createCreditNoteFromInvoiceService, called automatically by
           settleInvoiceRefundService when a pending refund is settled as
           store credit (method "credit_note").

   MONEY RULES
     • type "manual": never touches the invoice's refund fields. Its own
       `balance` is what the company owes the customer.
     • type "return"/"cancellation": the invoice's refundableAmount has
       already been paid down by the settle call, and the owed amount now
       lives here as `balance` instead — never counted twice.
     • `balance` goes down only through `usage` entries:
         kind "applied"  → used as a discount on a new order/invoice
         kind "refunded" → paid back (cash/upi/bank_transfer/card/other)

   CALCULATION (GST-INCLUSIVE, same as invoice.model.js)
     lineTotal  = qty × price
     totalNet   = lineTotal / (1 + gstPercent/100)
     gstAmount  = lineTotal − totalNet
   ============================================================================= */

const creditNoteItemSchema = new Schema(
  {
    itemId: { type: String, default: () => uuidv6() },
    description: { type: String, required: true, trim: true },
    hsnCode: { type: String, trim: true, default: "90212900" },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 }, // GST-inclusive rate
    gstType: { type: String, enum: ["IGST", "CGST", "SGST", "NONE"], default: "IGST" },
    gstPercent: { type: Number, default: 0, min: 0 },
    // computed in pre-save
    totalNet: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
  },
  { _id: false }
);

const creditNoteUsageSchema = new Schema(
  {
    usageId: { type: String, default: () => uuidv6() },
    kind: { type: String, enum: ["applied", "refunded"], required: true },
    amount: { type: Number, required: true, min: 0 },

    // kind "applied" — where the credit was spent
    appliedToType: { type: String, enum: ["manual_order", "ecommerce_order", "invoice", null], default: null },
    appliedToId: { type: String, default: null }, // orderId or invoiceId
    appliedToNumber: { type: String, default: null }, // human-readable invoice number

    // kind "refunded" — how it was paid back
    method: { type: String, enum: ["cash", "upi", "bank_transfer", "card", "other", null], default: null },
    reference: { type: String, trim: true, default: null },

    notes: { type: String, trim: true, default: null },
    by: { type: String, trim: true, default: "" }, // employee email
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const creditNoteSchema = new Schema(
  {
    creditNoteId: { type: String, unique: true, default: () => uuidv6() },
    creditNoteNumber: { type: String, required: true, unique: true, trim: true },
    creditNoteDate: { type: Date, default: Date.now },

    type: { type: String, enum: ["manual", "return", "cancellation"], required: true },
    reason: { type: String, trim: true, required: true },

    /* ---------- AGAINST WHICH INVOICE (snapshot) ----------
       Optional only for type "manual" (a credit with no invoice behind it).
       For GST, a credit note should normally reference the original invoice. */
    invoiceId: { type: String, default: null, index: true },
    invoiceNumber: { type: String, default: null },
    invoiceDate: { type: Date, default: null },
    sourceOrderId: { type: String, default: null },
    sourceOrderType: { type: String, enum: ["manual", "ecommerce", null], default: null },
    // refundHistory.refundId on the invoice (only for return/cancellation)
    invoiceRefundId: { type: String, default: null },

    /* ---------- PARTIES (snapshot, same shape as Invoice) ---------- */
    customerNo: { type: Number, default: null },
    seller: {
      companyName: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      gstin: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      contactNumber: { type: String, trim: true, default: "" },
    },
    billTo: {
      companyName: { type: String, trim: true, required: true },
      address: { type: String, trim: true, default: "" },
      gstin: { type: String, trim: true, default: "" },
      contactPerson: { type: String, trim: true, default: "" },
      contactNumber: { type: String, trim: true, default: "", index: true },
    },

    items: {
      type: [creditNoteItemSchema],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    summary: {
      totalNet: { type: Number, default: 0 },
      totalTax: { type: Number, default: 0 },
      totalAmount: { type: Number, default: 0 }, // = credit value
    },

    /* ---------- USAGE ---------- */
    balance: { type: Number, default: 0, min: 0 }, // still usable right now
    usage: { type: [creditNoteUsageSchema], default: [] },
    status: {
      type: String,
      enum: ["open", "partially_used", "used", "cancelled"],
      default: "open",
      index: true,
    },

    notes: { type: String, trim: true, default: "" },
    createdBy: { type: String, trim: true, default: "" },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, trim: true, default: null },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

creditNoteSchema.pre("validate", function () {
  let sumNet = 0;
  let sumTax = 0;
  let sumTotal = 0;

  for (const item of this.items || []) {
    const qty = Math.max(0, Number(item.qty) || 0);
    const price = Math.max(0, Number(item.price) || 0);
    const gst = Math.max(0, Number(item.gstPercent) || 0);

    const lineTotal = round2(qty * price);
    const net = round2(lineTotal / (1 + gst / 100));
    item.totalAmount = lineTotal;
    item.totalNet = net;
    item.gstAmount = round2(lineTotal - net);

    sumNet += net;
    sumTax += item.gstAmount;
    sumTotal += lineTotal;
  }

  this.summary.totalNet = round2(sumNet);
  this.summary.totalTax = round2(sumTax);
  this.summary.totalAmount = round2(sumTotal);

  // balance on first save = full value; afterwards = value − usage
  const used = (this.usage || []).reduce((s, u) => s + Number(u.amount || 0), 0);
  if (this.status !== "cancelled") {
    this.balance = Math.max(round2(this.summary.totalAmount - used), 0);
    this.status =
      this.balance <= 0.01 ? "used" : used > 0.01 ? "partially_used" : "open";
  } else {
    this.balance = 0;
  }
});

const CreditNote = model("CreditNote", creditNoteSchema);

/* Atomic running number per financial year: { _id: "CN/2026-27", seq: 17 }.
   findOneAndUpdate + $inc is atomic, so two staff saving at the same
   moment can never get the same credit note number. */
export const CreditNoteCounter = model(
  "CreditNoteCounter",
  new Schema({ _id: { type: String }, seq: { type: Number, default: 0 } }, { versionKey: false })
);

export default CreditNote;
