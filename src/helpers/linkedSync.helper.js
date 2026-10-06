import Invoice from "../models/manage/invoice.model.js";
import CreditNote from "../models/manage/creditNote.model.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";

/* Invoice ka customer edit -> us invoice ke saare CreditNotes + source ManualOrder */
export const syncCustomerFromInvoice = async (invoice) => {
  const b = invoice.billTo?.toObject ? invoice.billTo.toObject() : invoice.billTo || {};

  await CreditNote.updateMany(
    { invoiceId: invoice.invoiceId, isDeleted: false },
    {
      $set: {
        "billTo.companyName": b.companyName,
        "billTo.address": b.address,
        "billTo.gstin": b.gstin,
        "billTo.contactPerson": b.contactPerson,
        "billTo.contactNumber": b.contactNumber,
        invoiceNumber: invoice.invoiceNumber,
        customerNo: invoice.customerNo,
      },
    }
  );

  if (invoice.sourceOrderType === "manual" && invoice.sourceOrderId) {
    await ManualOrder.updateOne(
      { orderId: invoice.sourceOrderId },
      {
        $set: {
          customerName: b.contactPerson || b.companyName,
          customerPhone: b.contactNumber,
          organizationName: b.companyName && b.companyName !== b.contactPerson ? b.companyName : null,
          gstNumber: b.gstin || null,
        },
      }
    );
  }
};

/* Credit se invoice poora paid hua -> manual order bhi "paid" dikhe */
export const syncPaymentToOrder = async (invoice) => {
  if (invoice.sourceOrderType !== "manual" || !invoice.sourceOrderId) return;
  if (invoice.status !== "paid") return;

  await ManualOrder.updateOne(
    { orderId: invoice.sourceOrderId, paymentStatus: "pending" },
    { $set: { paymentStatus: "paid", paymentMethod: "other", paymentReference: "Credit note", paidAt: new Date() } }
  );
};

/* Credit note cancel -> invoice ke creditNoteIds se hatao */
export const unlinkCreditNote = (invoiceId, creditNoteId) =>
  invoiceId ? Invoice.updateOne({ invoiceId }, { $pull: { creditNoteIds: creditNoteId } }) : null;