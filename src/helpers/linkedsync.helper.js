/**
 * Keeps linked records in step: invoice customer -> credit notes and manual order; credit-paid
 * invoice -> order paid; cancelled credit note -> removed from the invoice.
 *
 * Exports: syncCustomerFromInvoice, syncPaymentToOrder, unlinkCreditNote
 * Used by: services/creditnote/creditnote.service.js, services/invoice/invoice.service.js
 */

import Invoice from "../models/invoice.model.js";
import CreditNote from "../models/creditnote.model.js";
import ManualOrder from "../models/manualorder.model.js";

/* Invoice customer edited -> update all CreditNotes of that invoice + the source ManualOrder */
/**
 * Sync customer from invoice.
 *
 * @param {*} invoice
 * @returns {Promise<*>}
 */
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

/* Invoice fully paid with credit -> the manual order shows "paid" too */
/**
 * Sync payment to order.
 *
 * @param {*} invoice
 * @returns {Promise<*>}
 */
export const syncPaymentToOrder = async (invoice) => {
  if (invoice.sourceOrderType !== "manual" || !invoice.sourceOrderId) return;
  if (invoice.status !== "paid") return;

  await ManualOrder.updateOne(
    { orderId: invoice.sourceOrderId, paymentStatus: "pending" },
    {
      $set: {
        paymentStatus: "paid",
        paymentMethod: "other",
        paymentReference: "Credit note",
        paidAt: new Date(),
      },
    }
  );
};

/* Credit note cancelled -> remove it from the invoice's creditNoteIds */
/**
 * Unlink credit note.
 *
 * @param {*} invoiceId
 * @param {*} creditNoteId
 * @returns {*}
 */
export const unlinkCreditNote = (invoiceId, creditNoteId) =>
  invoiceId ? Invoice.updateOne({ invoiceId }, { $pull: { creditNoteIds: creditNoteId } }) : null;
