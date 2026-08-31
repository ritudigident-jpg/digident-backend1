// models/creditNote.model.js
import mongoose from "mongoose";

const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteId: { type: String, unique: true, required: true },
    sourceOrderId: { type: String, required: true },
    sourceOrderType: { type: String, enum: ["order", "manual"], default: "order" },
    sourceOrderDate: { type: Date, default: null },
    sourceOrderGrandTotal: { type: Number, default: 0 },
    sourceOrderGstPercentage: { type: Number, default: 0 },

    amount: { type: Number, required: true },
    method: { type: String, enum: ["credit_note"], default: "credit_note" },

    // Return mein jo products the, unki readable copy — taaki page/PDF
    // dobara Order document dhoondhne na jaaye
    returnedItems: [
      {
        productName: { type: String, default: "" },
        variantName: { type: String, default: "" },
        quantity: { type: Number, default: 0 },
        price: { type: Number, default: 0 },
      },
    ],

    appliedToOrderId: { type: String, default: null },
    appliedOrderDate: { type: Date, default: null },
    appliedOrderGrandTotal: { type: Number, default: null },
    appliedOrderItems: [{ productName: String, variantName: String, quantity: Number }],

    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    customerName: { type: String, default: null },
    customerPhone: { type: String, default: null },
    customerEmail: { type: String, default: null },

    refundedBy: { type: String, required: true },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("CreditNote", creditNoteSchema);