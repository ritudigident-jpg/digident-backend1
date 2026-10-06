import "dotenv/config";
import mongoose from "mongoose";
import ManualOrder from "../models/manually order/manualOrder.model.js";
import { resyncInvoiceForOrder } from "../services/manualOrder.service.js";

const uri = process.env.MONGODB_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGO_URI / MONGODB_URI .env mein nahi mila");
  process.exit(1);
}

await mongoose.connect(uri);

const orders = await ManualOrder.find({ invoiceId: { $ne: null } });
console.log(`${orders.length} orders mile`);

for (const o of orders) {
  try {
    await resyncInvoiceForOrder(o);
    console.log("Synced", o.orderId);
  } catch (e) {
    console.error("Failed", o.orderId, e.message);
  }
}

await mongoose.disconnect();
console.log("Done");