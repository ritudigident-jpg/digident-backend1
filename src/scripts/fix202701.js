import "dotenv/config";
import mongoose from "mongoose";
import Invoice from "../models/manage/invoice.model.js";
import CreditNote from "../models/manage/creditNote.model.js";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const r = await Invoice.updateOne(
  { invoiceId: "1f1b980f-ee35-65e0-9863-68cd5243d2f2" },
  { $set: { refundableAmount: 0, refundStatus: "refunded" } }
);
console.log("Invoice:", r.modifiedCount);

const c = await CreditNote.updateOne(
  { creditNoteNumber: "CN/2026-27/00004" },
  { $set: { notes: "Is credit note se product1 (10 qty) ke return ka paisa adjust hua" } }
);
console.log("CreditNote:", c.modifiedCount);

await mongoose.disconnect();