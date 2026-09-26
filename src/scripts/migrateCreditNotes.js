/**
 * ONE-TIME MIGRATION — copy old credit notes into the new CreditNote collection.
 *
 * Before this change a credit note was only a refundHistory entry on an
 * invoice (method: "credit_note"). This creates a proper CreditNote document
 * for every such entry that doesn't have one yet (entry.creditNoteId empty),
 * with its original date, and links both ways. Safe to run more than once.
 *
 *   node scripts/migrateCreditNotes.js            # dry run — just counts
 *   node scripts/migrateCreditNotes.js --apply    # actually writes
 *
 * Needs MONGO_URI (or MONGODB_URI) in the environment / .env.
 */
import "dotenv/config";
import mongoose from "mongoose";
import Invoice from "../models/manage/invoice.model.js";
import { createCreditNoteFromInvoiceService } from "../services/creditNote.service.js";

const APPLY = process.argv.includes("--apply");
const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!uri) {
  console.error("Set MONGO_URI first");
  process.exit(1);
}

await mongoose.connect(uri);

const invoices = await Invoice.find({
  isDeleted: false,
  "refundHistory.method": "credit_note", // entries already migrated are skipped below
});

let created = 0;
for (const invoice of invoices) {
  const pending = invoice.refundHistory
    .filter((r) => r.method === "credit_note" && !r.creditNoteId)
    .sort((a, b) => new Date(a.refundedAt) - new Date(b.refundedAt));

  for (const entry of pending) {
    console.log(
      `${APPLY ? "Creating" : "Would create"} credit note for ${invoice.invoiceNumber} — ₹${entry.amount}` +
        (entry.appliedToOrderId ? ` (applied → ${entry.appliedToOrderId})` : " (unused → will show as open credit)")
    );
    if (!APPLY) continue;

    const cn = await createCreditNoteFromInvoiceService({
      invoice,
      amount: entry.amount,
      refundId: entry.refundId,
      employeeEmail: entry.refundedBy || "migration",
      appliedToOrderId: entry.appliedToOrderId,
      notes: entry.notes,
      date: entry.refundedAt,
    });
    entry.creditNoteId = cn.creditNoteId;
    entry.creditNoteNumber = cn.creditNoteNumber;
    if (!invoice.creditNoteIds.includes(cn.creditNoteId)) invoice.creditNoteIds.push(cn.creditNoteId);
    created += 1;
  }
  if (APPLY && pending.length) await invoice.save();
}

console.log(APPLY ? `\nDone — ${created} credit notes created.` : "\nDry run only. Re-run with --apply to write.");
await mongoose.disconnect();
