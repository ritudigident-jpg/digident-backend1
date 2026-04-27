import mongoose from "mongoose";
import { v6 as uuidv6 } from "uuid";
const { Schema, model } = mongoose;

const invoiceItemSchema = new Schema(
  {
    itemId:{
      type: String,
      default: () => uuidv6(),
    },
    articleNo:{
      type: String,
      trim: true,
      default: "",
    },
    description:{
      type: String,
      required: true,
      trim: true,
    },
    qty: {
      type: Number,
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    discountPercent: {
      type: Number,
      default: 0,
      min: 0,
    },
    discountValue: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalNet:{
      type: Number,
      default: 0,
      min: 0,
    },
    gstType:{
      type: String,
      enum: ["IGST", "CGST", "SGST", "NONE"],
      default: "IGST",
    },
    gstPercent:{
      type: Number,
      default: 5,
      min: 0,
    },
    gstAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
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
      type: String,
      trim: true,
      default: "",
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
      companyName: {
        type: String,
        trim: true,
        default: "",
      },
      address: {
        type: String,
        trim: true,
        default: "",
      },
      gstin: {
        type: String,
        trim: true,
        default: "",
      },
      email: {
        type: String,
        trim: true,
        default: "",
      },
      contactNumber: {
        type: String,
        trim: true,
        default: "",
      },
    },

    billTo: {
      companyName: {
        type: String,
        required: true,
        trim: true,
      },
      address: {
        type: String,
        trim: true,
        default: "",
      },
      gstin: {
        type: String,
        trim: true,
        default: "",
      },
      contactPerson: {
        type: String,
        trim: true,
        default: "",
      },
      contactNumber: {
        type: String,
        trim: true,
        default: "",
      },
    },

    bankDetails: {
      accountNo: {
        type: String,
        trim: true,
        default: "",
      },
      accountType: {
        type: String,
        trim: true,
        default: "",
      },
      ifscCode: {
        type: String,
        trim: true,
        default: "",
      },
      holderName: {
        type: String,
        trim: true,
        default: "",
      },
    },

    items: {
      type: [invoiceItemSchema],
      default: [],
    },

    summary: {
      totalGrossValue: {
        type: Number,
        default: 0,
      },
      totalDiscount: {
        type: Number,
        default: 0,
      },
      totalNet: {
        type: Number,
        default: 0,
      },
      freightCost: {
        type: Number,
        default: 0,
      },
      totalTax: {
        type: Number,
        default: 0,
      },
      totalPayAmount: {
        type: Number,
        default: 0,
      },
      paidAmount: {
        type: Number,
        default: 0,
      },
      amountToPay: {
        type: Number,
        default: 0,
      },
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    status: {
      type: String,
      enum: ["draft", "issued", "paid", "cancelled"],
      default: "draft",
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// invoiceSchema.pre("save", function () {
//   let totalGrossValue = 0;
//   let totalDiscount = 0;
//   let totalNet = 0;
//   let totalTax = 0;
//   for (const item of this.items) {
//     const gross = Number(item.qty || 0) * Number(item.price || 0);
//     const discountValue =
//       item.discountPercent > 0
//         ? (gross * Number(item.discountPercent || 0)) / 100
//         : Number(item.discountValue || 0);
//     const net = gross - discountValue;
//     const gstAmount = (net * Number(item.gstPercent || 0)) / 100;
//     const totalAmount = net + gstAmount;
//     item.discountValue = discountValue;
//     item.totalNet = net;
//     item.gstAmount = gstAmount;
//     item.totalAmount = totalAmount;
//     totalGrossValue += gross;
//     totalDiscount += discountValue;
//     totalNet += net;
//     totalTax += gstAmount;
//   }
//   this.summary.totalGrossValue = totalGrossValue;
//   this.summary.totalDiscount = totalDiscount;
//   this.summary.totalNet = totalNet;
//   this.summary.totalTax = totalTax;
//   this.summary.totalPayAmount =
//     totalNet + Number(this.summary.freightCost || 0) + totalTax;
//   this.summary.amountToPay =
//     this.summary.totalPayAmount - Number(this.summary.paidAmount || 0);
// });
const Invoice = model("Invoice", invoiceSchema);
export default Invoice;