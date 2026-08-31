import mongoose from "mongoose";

const creditNoteSchema = new mongoose.Schema(
  {
    creditNoteId: { type: String, unique: true, required: true },
    sourceOrderId: { type: String, required: true },
    sourceOrderType: { type: String, enum: ["order", "manual"], default: "order" },

    amount: { type: Number, required: true },
    method: { type: String, enum: ["credit_note"], default: "credit_note" },

    appliedToOrderId: { type: String, default: null },

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