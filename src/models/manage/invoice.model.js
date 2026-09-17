import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
const { Schema, model } = mongoose;

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATION LOGIC (GST-INCLUSIVE)
//
//  Given: price is GST-inclusive (MRP)
//
//  Step 1 — Extract base & GST from inclusive price
//    grossAmount  = qty × price                        (e.g. 1 × 1200 = 1200)
//    baseAmount   = grossAmount / (1 + gstPercent/100) (e.g. 1200/1.05 = 1142.86)
//    gstOnGross   = grossAmount - baseAmount           (e.g. 57.14)
//
//  Step 2 — Apply discount on grossAmount (inclusive price)
//    discountValue = grossAmount × discountPercent/100 (e.g. 1200 × 50% = 600)
//    discountedTotal = grossAmount - discountValue     (e.g. 1200 - 600 = 600)
//
//  Step 3 — Re-extract base & GST from discounted total
//    totalNet    = discountedTotal / (1 + gstPercent/100) (e.g. 600/1.05 = 571.43)
//    gstAmount   = discountedTotal - totalNet             (e.g. 28.57)
//    totalAmount = discountedTotal                        (e.g. 600)
// ─────────────────────────────────────────────────────────────────────────────

const invoiceItemSchema = new Schema(
  {
    itemId: {
      type: String,
      default: () => uuidv6(),
    },
    articleNo: {
      type: String,
      trim: true,
      default: "",
    },
     hsnCode: {                    // ← NEW
      type: String,
      trim: true,
      default: "90212900",
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      // GST-inclusive price (MRP)
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // ── Computed fields (set by pre-save hook) ──────────────────────────────
    grossAmount: {
      // qty × price (before discount, inclusive of GST)
      type: Number,
      default: 0,
      min: 0,
    },
    discountValue: {
      // grossAmount × discountPercent / 100
      type: Number,
      default: 0,
      min: 0,
    },
    totalNet: {
      // base price after discount (ex-GST)
      type: Number,
      default: 0,
      min: 0,
    },
    gstType: {
      type: String,
      enum: ["IGST", "CGST", "SGST", "NONE"],
      default: "IGST",
    },
    gstPercent: {
      type: Number,
      default: 5,
      min: 0,
    },
    gstAmount: {
      // GST on discounted amount
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      // final payable = discountedTotal (inclusive of GST after discount)
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────────────
//  NEW — RETURN / REFUND / CREDIT-NOTE TRACKING (lives directly on Invoice)
//
//  Previously this lived only on ManualOrder, which meant the Customer
//  Ledger and Credit Notes pages only ever saw manual orders — a plain
//  invoice created by hand, or one created from an ecommerce Order, never
//  showed up there even though it's exactly the same kind of "customer
//  returned something / is owed a refund" situation. Moving it here means
//  the ledger and credit notes can be computed from ONE collection
//  (Invoice) no matter which of the three ways the invoice was created:
//    1. createInvoice          — manual invoice, no order behind it
//    2. createInvoiceFromOrder — linked to an ecommerce Order
//    3. ManualOrder auto-invoice — linked to a ManualOrder
// ─────────────────────────────────────────────────────────────────────────────

const invoiceReturnedItemSchema = new Schema(
  {
    description: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 0 },
    price: { type: Number, required: true, min: 0 }, // per-unit, same convention as items[].price
    reason: { type: String, trim: true, default: "" },
    returnedAt: { type: Date, default: Date.now },
    processedByEmail: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const invoiceRefundHistorySchema = new Schema(
  {
    refundId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    method: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "card", "cheque", "other", "credit_note"],
      required: true,
    },
    reference: { type: String, trim: true, default: null }, // payment reference, for cash-style methods
    // Only meaningful when method === "credit_note": which OTHER invoice
    // this credit was actually applied to.
    appliedToInvoiceId: { type: String, default: null },
    refundedBy: { type: String, trim: true, default: "" }, // employee email
    refundedAt: { type: Date, default: Date.now },
    refundStatus: { type: String, default: "processed" },
    notes: { type: String, trim: true, default: null },
  },
  { _id: false }
);

const invoiceSchema = new Schema(
  {
    invoiceId: {
      type: String,
      unique: true,
      default: () => uuidv6(),
    },
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    customerNo: {
      type: Number,
      required: true,
    },
    invoiceDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    orderNumber: {
      type: String,
      trim: true,
      default: "",
    },
    orderDate: {
      type: Date,
      default: null,
    },
    deliveryDate: {
      type: Date,
      default: null,
    },
    paymentTerms: {
      type: String,
      trim: true,
      default: "",
    },
    termsOfDelivery: {
      type: String,
      trim: true,
      default: "",
    },
    shippingCondition: {
      type: String,
      trim: true,
      default: "",
    },
    customerServiceRep: {
      type: String,
      trim: true,
      default: "",
    },
    seller: {
      companyName: { type: String, trim: true, default: "" },
      address:     { type: String, trim: true, default: "" },
      gstin:       { type: String, trim: true, default: "" },
      email:       { type: String, trim: true, default: "" },
      contactNumber: { type: String, trim: true, default: "" },
    },
    billTo: {
      companyName:   { type: String, required: true, trim: true },
      address:       { type: String, trim: true, default: "" },
      gstin:         { type: String, trim: true, default: "" },
      contactPerson: { type: String, trim: true, default: "" },
      contactNumber: { type: String, trim: true, default: "" },
      email:         { type: String, trim: true, default: "" }, // ← NEW, needed for ledger/credit-note contact info
    },
    bankDetails: {
      accountNo:   { type: String, trim: true, default: "" },
      accountType: { type: String, trim: true, default: "" },
      ifscCode:    { type: String, trim: true, default: "" },
      holderName:  { type: String, trim: true, default: "" },
    },
    items: {
      type: [invoiceItemSchema],
      default: [],
    },
    summary: {
      totalGrossValue: { type: Number, default: 0 }, // sum of all grossAmounts
      totalDiscount:   { type: Number, default: 0 }, // sum of all discountValues
      totalNet:        { type: Number, default: 0 }, // sum of all totalNet (ex-GST after discount)
      totalTax:        { type: Number, default: 0 }, // sum of all gstAmounts
      freightCost:     { type: Number, default: 0 },
      totalPayAmount:  { type: Number, default: 0 }, // totalNet + totalTax + freightCost
      paidAmount:      { type: Number, default: 0 },
      amountToPay:     { type: Number, default: 0 }, // totalPayAmount - paidAmount
    },

    // ── NEW — return / refund / credit-note tracking ────────────────────────
    returnedItems: {
      type: [invoiceReturnedItemSchema],
      default: [],
    },
    refundHistory: {
      type: [invoiceRefundHistorySchema],
      default: [],
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: [
        "draft",
        "issued",
        "paid",
        "cancelled",
        "partially_paid",
        // ← NEW — refund lifecycle states, mirroring ManualOrder.paymentStatus
        // so the invoice itself can tell the full "does the company owe the
        // customer / does the customer owe the company" story.
        "refund_pending",
        "partial_refunded",
        "refunded",
      ],
      default: "draft",
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// ─────────────────────────────────────────────────────────────────────────────
//  PRE-SAVE HOOK — recalculate all values
// ─────────────────────────────────────────────────────────────────────────────

invoiceSchema.pre("save", function () {
  let sumGrossAmount  = 0; // total MRP before discount
  let sumDiscount     = 0; // total discount given
  let sumNet          = 0; // total base price after discount (ex-GST)
  let sumTax          = 0; // total GST after discount

  for (const item of this.items) {
    const qty         = Math.max(0, Number(item.qty)         || 0);
    const price       = Math.max(0, Number(item.price)       || 0);
    const gstPercent  = Math.max(0, Number(item.gstPercent)  || 5);
    const discPct     = Math.min(100, Math.max(0, Number(item.discountPercent) || 0));

    // Step 1 — Gross amount (qty × GST-inclusive price)
    const grossAmount = qty * price;

    // Step 2 — Discount on gross amount
    const discountValue   = round2(grossAmount * discPct / 100);
    const discountedTotal = round2(grossAmount - discountValue);

    // Step 3 — Extract base & GST from discounted total
    const divisor   = 1 + gstPercent / 100;
    const totalNet  = round2(discountedTotal / divisor);
    const gstAmount = round2(discountedTotal - totalNet);

    // Write back to item
    item.grossAmount    = round2(grossAmount);
    item.discountValue  = discountValue;
    item.totalNet       = totalNet;
    item.gstAmount      = gstAmount;
    item.totalAmount    = discountedTotal; // final payable for this line

    // Accumulate summary
    sumGrossAmount += grossAmount;
    sumDiscount    += discountValue;
    sumNet         += totalNet;
    sumTax         += gstAmount;
  }

  const freightCost = Math.max(0, Number(this.summary.freightCost) || 0);
  const paidAmount  = Math.max(0, Number(this.summary.paidAmount)  || 0);

  this.summary.totalGrossValue = round2(sumGrossAmount);
  this.summary.totalDiscount   = round2(sumDiscount);
  this.summary.totalNet        = round2(sumNet);
  this.summary.totalTax        = round2(sumTax);
  this.summary.totalPayAmount  = round2(sumNet + sumTax + freightCost);
  this.summary.amountToPay     = round2(this.summary.totalPayAmount - paidAmount);
});

function round2(n) {
  return Math.round(n * 100) / 100;
}

const Invoice = model("Invoice", invoiceSchema);
export default Invoice;