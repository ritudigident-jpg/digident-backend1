import mongoose from "mongoose";

/* ---------- ADDRESS (plain, no ref) ---------- */
const addressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    street: { type: String, default: "" },
    area: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

/* ---------- ORDER ITEM (free text, no productId/variantId) ---------- */
const manualOrderItemSchema = new mongoose.Schema(
  {
    productName: { type: String, required: true },
    variantName: { type: String, default: "" },
    sku: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    returnedQuantity: { type: Number, default: 0 },
    notes: { type: String, default: "" }, // e.g. "blue color", "size L" typed by staff
  },
  { _id: false }
);

/* ---------- RETURN REQUEST (manual, decided instantly) ---------- */
const manualReturnRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true },
    items: [
      {
        productName: { type: String, required: true },
        variantName: { type: String, default: "" },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        reason: { type: String, default: null },
      },
    ],
    status: {
      type: String,
      enum: ["approved", "rejected"],
      default: "approved",
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
  },
  { _id: false }
);

/* ---------- MANUAL ORDER ---------- */
const manualOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      required: true,
    },

    /* ---------- CUSTOMER (plain text, no User ref) ---------- */
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerEmail: { type: String, default: null },

    items: {
      type: [manualOrderItemSchema],
      required: true,
      validate: (v) => Array.isArray(v) && v.length > 0,
    },

    shippingCharge: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true },

    organizationName: { type: String, default: null },
    gstAmount: { type: Number, default: 0 },
    gstPercentage: { type: Number, default: 0 },
    gstNumber: { type: String, default: null },

    billingAddress: { type: addressSchema, required: true },
    shippingAddress: { type: addressSchema, required: true },

    /* ---------- PAYMENT ---------- */
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "refunded", "refund_pending", "partial_refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["cash", "upi", "bank_transfer", "cheque", "card", "other", null],
      default: null,
    },
    paymentReference: { type: String, default: null },
    paidAt: { type: Date, default: null },

    /* ---------- ORDER STATUS ---------- */
    orderStatus: {
      type: String,
      enum: [
        "placed", "packed", "confirmed", "shipped",
        "delivered", "cancelled", "partial_returned", "returned",
      ],
      default: "placed",
    },
    statusUpdatedAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    /* ---------- COURIER ---------- */
    corourseServiceName: { type: String, default: null },
    DOCNumber: { type: String, default: null },

    /* ---------- RETURN / REFUND ---------- */
    returnRequests: [manualReturnRequestSchema],
    refundAmount: { type: Number, default: 0 },
    partialRefundAmount: { type: Number, default: 0 },
    refundHistory: [
      {
        refundId: String,
        amount: Number,
        method: String,
        refundedBy: String,
        refundedAt: Date,
        refundStatus: String,
      },
    ],
    refundedAt: { type: Date, default: null },

    /* ---------- META ---------- */
    isManualOrder: { type: Boolean, default: true },
    notes: { type: String, default: null },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ManualOrder", manualOrderSchema);