import mongoose from "mongoose";
/* ---------- ADDRESS ---------- */
const addressSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },

    street: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },

    area: {
      type: String,
      required: true,
      trim: true,
      maxlength: 255,
    },

    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    country: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    pincode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
  },
  { _id: false }
);
/* ---------- ORDER ITEM ---------- */
const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true,
    },
    variantId: {
      type: String,
      required: true,
      trim: true,
    },
   sku: {
  type: String,
  trim: true,
  default: "",
  maxlength: 100,
},

productName: {
  type: String,
  trim: true,
  required: true,
  maxlength: 200,
},

variantName: {
  type: String,
  trim: true,
  default: "",
  maxlength: 200,
},
   categoryName: {
  type: String,
  trim: true,
  default: "",
  maxlength: 100,
},
price: {
  type: Number,
  required: true,
  min: 0,
},
quantity: {
  type: Number,
  required: true,
},
    // Added for return tracking
    returnedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    attributes: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },
  image: {
  type: String,
  trim: true,
  default: "",
},
  },
  { _id: false }
);

/* ---------- COUPON SNAPSHOT ---------- */
const couponSchema = new mongoose.Schema(
  {
    couponRef:{
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },
  couponId: {
  type: String,
  trim: true,
  default: null,
},
code: {
  type: String,
  trim: true,
  uppercase: true,
  default: null,
},
    couponType:{
      type: String,
      enum: [
        "PERCENT",
        "FIXED",
        "FREESHIP",
        "BUY_X_GET_Y_FREE",
        "BUY_X_GET_Y_DISCOUNT",
        "CASHBACK",
      ],
      default: null,
    },
    discountAmount: { type: Number, default: 0 },
    freeShipping: { type: Boolean, default: false },
  },
  { _id: false }
);

/* ---------- ORDER ---------- */
const orderSchema = new mongoose.Schema(
  {
    invoiceId: { type: String},
    iId:{ type: String, unique: true,trim: true, },
    orderId: {
      type: String,
      unique: true,
      required: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    shippingCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    grandTotal: {
      type: Number,
      required: true,
    },
    coupon: {
      type: couponSchema,
      default: null,
    },
    organizationName: { type: String, default: null },
    gstAmount: { type: Number, default: 0 },
    gstPercentage: { type: Number, default: 0 },
    gstNumber: { type: String, default: null },
    billingAddress: {
      type: addressSchema,
      required: true,
    },
    shippingAddress: {
      type: addressSchema,
      required: true,
    },
    paymentMode: {
      type: String,
      enum: ["RAZORPAY"],
      default: "RAZORPAY",
    },

    paymentStatus: {
      type: String,
      enum: [
        "pending",
        "paid",
        "failed",
        "refunded",
        "refund_pending",
        "partial_refunded",
        "refund_failed"
      ],
      default: "pending",
    },
    orderStatus: {
      type: String,
      enum: [
        "pending",
        "placed",
        "packed",
        "confirmed",
        "shipped",
        "delivered",
        "cancelled",
        "partial_returned",
        "returned",
      ],
      default: "pending",
    },
    cancellationReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    /* ================= RETURN SYSTEM ================= */
    returnRequests: [
      {
        requestId: { type: String, required: true },
        items: [
          {
            productId: { type: String, required: true },
            variantId: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
            reason: { type: String, default: null },
          },
        ],
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        isManual: { type: Boolean, default: false },  
        processedBy: {                                 
          type: mongoose.Schema.Types.ObjectId,
          ref: "Employee",
          default: null,
        },
        requestedAt: {
          type: Date,
          default: Date.now,
        },
        processedAt: {
          type: Date,
          default: null,
        },
      },
    ],
    corourseServiceName: { type: String, default: null },
    DOCNumber:{ type: String, default: null },
    /* ================= REFUND SYSTEM ================= */
    refundAmount: {
      type: Number,
      default: 0,
    },
    partialRefundAmount: {
      type: Number,
      default: 0,
    },
    remainingRefundAmount: {
      type: Number,
      default: 0,
    },
refundHistory: [
  {
    refundId: {
      type: String,
      trim: true,
    },

    amount: {
      type: Number,
      min: 0,
    },

    refundedBy: {
      type: String,
      trim: true,
    },

    refundedAt: Date,

    refundStatus: {
      type: String,
      trim: true,
    },

    method: {
      type: String,
      trim: true,
      default: null,
    },
  },
],
    razorpayOrderId: { type: String, default: null },
    razorpayPaymentId: { type: String, default: null },
    razorpaySignature: { type: String, default: null },
    razorpayRefundId: { type: String, default: null },
    refundedAt: { type: Date, default: null },
    statusUpdatedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true }
);
export default  mongoose.model("Order", orderSchema);