import CreditNote from "../models/manage/creditNote.model.js";
import Order from "../models/ecommarace/order.model.js"; // apna sahi path
import Employee from "../models/manage/employee.model.js";
import { v6 as uuidv6 } from "uuid";

export const settleReturnAsCreditService = async ({ orderId, amount, notes, items }, userEmail) => {
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

  const doc = await CreditNote.create({
    creditNoteId,
    sourceOrderId: order.orderId,
    sourceOrderType: "order",
    sourceOrderDate: order.createdAt,
    sourceOrderGrandTotal: order.grandTotal,
    sourceOrderGstPercentage: order.gstPercentage || 0,
    amount: creditAmount,
    method: "credit_note",
    returnedItems: Array.isArray(items) ? items : [],
    customerId: order.user?._id || null,
    customerName: order.billingAddress?.fullName || order.user?.firstName || "Customer",
    customerPhone: order.billingAddress?.phone || null,
    customerEmail: order.user?.email || null,
    refundedBy: employee.email,
    notes: notes || null,
  });

  order.paymentStatus = "refund_settled_as_credit"; // apne Order schema ke enum mein add karo
  order.refundedAt = new Date();
  await order.save();

  return { creditNoteId: doc.creditNoteId, orderId: order.orderId, amount: creditAmount };
};

export const getCreditNotesService = async ({ search }) => {
  const match = {};
  if (search?.trim()) {
    const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.$or = [{ customerName: regex }, { customerPhone: regex }, { sourceOrderId: regex }];
  }
  const docs = await CreditNote.find(match).sort({ createdAt: -1 }).lean();

  // Field names ko manual-order wale shape ke saath match kar diya, taaki
  // wahi CreditNotesPage.jsx aur generateCreditNotePdf.js reuse ho sake
  const creditNotes = docs.map((d) => ({
    refundId: d.creditNoteId,
    amount: d.amount,
    refundedAt: d.createdAt,
    refundedBy: d.refundedBy,
    sourceOrderId: d.sourceOrderId,
    sourceOrderDate: d.sourceOrderDate,
    sourceOrderGrandTotal: d.sourceOrderGrandTotal,
    sourceOrderGstPercentage: d.sourceOrderGstPercentage,
    sourceInvoiceNumber: null, // ecommerce mein invoice-number system nahi hai abhi
    customerName: d.customerName,
    customerPhone: d.customerPhone,
    customerEmail: d.customerEmail,
    returnedItems: d.returnedItems || [],
    appliedToOrderId: d.appliedToOrderId,
    appliedInvoiceNumber: null,
    appliedOrderDate: d.appliedOrderDate,
    appliedOrderGrandTotal: d.appliedOrderGrandTotal,
    appliedOrderItems: d.appliedOrderItems || [],
  }));

  const totalIssued = creditNotes.reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const totalApplied = creditNotes.filter((c) => c.appliedToOrderId).reduce((sum, c) => sum + Number(c.amount || 0), 0);

  return {
    creditNotes,
    summary: {
      totalCreditNotes: creditNotes.length,
      totalIssued,
      totalApplied,
      totalUnapplied: Math.max(totalIssued - totalApplied, 0),
    },
  };
};