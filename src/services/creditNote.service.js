import CreditNote from "../models/manage/creditNote.model.js"; // apna sahi path check karo
import Order from "../models/ecommarace/order.model.js";      // ⚠️ apna actual Order model path daalo
import Employee from "../models/manage/employee.model.js";
import { v6 as uuidv6 } from "uuid";

export const settleReturnAsCreditService = async ({ orderId, amount, notes }, userEmail) => {
  const employee = await Employee.findOne({ email: userEmail });
  if (!employee) {
    const e = new Error("Employee not found");
    e.statusCode = 404;
    throw e;
  }

  const order = await Order.findOne({ orderId }).populate("user", "email firstName lastName");
  if (!order) {
    const e = new Error("Order not found");
    e.statusCode = 404;
    throw e;
  }

  const creditAmount = Number(amount);
  if (!creditAmount || creditAmount <= 0) {
    const e = new Error("amount must be a positive number");
    e.statusCode = 400;
    throw e;
  }

  const creditNoteId = `CN-${uuidv6()}`;

  await CreditNote.create({
    creditNoteId,
    sourceOrderId: order.orderId,
    sourceOrderType: "order",
    amount: creditAmount,
    method: "credit_note",
    customerId: order.user?._id || null,
    customerName: order.billingAddress?.fullName || order.user?.firstName || "Customer",
    customerPhone: order.billingAddress?.phone || null,
    customerEmail: order.user?.email || null,
    refundedBy: employee.email,
    notes: notes || null,
  });

  // order ko mark karo ki isko store-credit se settle kiya gaya hai —
  // taaki ye dubara "pending refund" list mein na dikhe
  order.paymentStatus = "refund_settled_as_credit"; // ⚠️ apne Order schema ke paymentStatus enum mein ye value add karni hogi
  order.refundedAt = new Date();
  await order.save();

  return { creditNoteId, orderId: order.orderId, amount: creditAmount };
};

export const getCreditNotesService = async ({ search }) => {
  const match = {};
  if (search?.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.$or = [{ customerName: regex }, { customerPhone: regex }, { sourceOrderId: regex }];
  }
  const creditNotes = await CreditNote.find(match).sort({ createdAt: -1 }).lean();
  const totalIssued = creditNotes.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  return { creditNotes, total: creditNotes.length, totalIssued };
};