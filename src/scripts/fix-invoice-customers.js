/* ────────────────────────────────────────────────────────────────────────
   ONE-TIME REPAIR — invoice customers + CRM client links

   Before the generateCustomerNo fix, an invoice's customer was picked by
   the contact person's NAME only, so different customers with the same
   name (e.g. "DEMO2") were merged under one customerNo and showed up in
   the wrong group on the Invoices page.

   This script:
     1. Regroups existing invoices by mobile number (last 10 digits).
        Each group keeps the customerNo of its OLDEST invoice; if that
        number already belongs to an older, different customer, the group
        gets a new number. Invoices that were already right don't change.
     2. Links invoices that have no leadId to the CRM client (stage
        "client") with the same mobile number — sets invoice.leadId /
        clientId and adds it to the client's invoices[] with the creator.

   Usage (from the backend root):
     node scripts/fix-invoice-customers.js            → DRY RUN, prints the plan
     node scripts/fix-invoice-customers.js --apply    → writes the changes

   Take a DB backup before --apply. Changing customerNo also changes the
   "CUSTOMER NO" printed on those invoices' PDFs.
──────────────────────────────────────────────────────────────────────── */
import "dotenv/config";
import mongoose from "mongoose";
import { pathToFileURL } from "url";
import Invoice from "../models/manage/invoice.model.js";
import DentalLead from "../models/manage/dentalLead.js";
import "../models/manage/employee.model.js";
import "../models/manage/permissionaudit.model.js";
import { linkInvoice } from "../services/lead.service.js";
import { phoneKey } from "../services/invoice.service.js";

const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, " ");

/* Pure planning step — no DB access, so it can be checked on its own.
   invoices: non-deleted, sorted oldest first
   clients:  [{ _id, clientId, contact }] — CRM clients
   maxCustomerNo: highest customerNo in the collection (deleted included) */
export const planCustomerFix = (invoices, clients, maxCustomerNo = 0) => {
  const clientByPhone = new Map();
  for (const c of clients) {
    const k = phoneKey(c.contact);
    if (k.length === 10 && !clientByPhone.has(k)) clientByPhone.set(k, c);
  }

  // 1. group invoices by customer identity, oldest first
  const groups = new Map();
  const links = [];
  for (const inv of invoices) {
    const k = phoneKey(inv.billTo?.contactNumber);
    const gKey = k.length === 10 ? `ph:${k}`
      : inv.leadId ? `lead:${inv.leadId}`
      : `nm:${norm(inv.billTo?.companyName)}|${norm(inv.billTo?.contactPerson)}`;
    if (!groups.has(gKey)) groups.set(gKey, []);
    groups.get(gKey).push(inv);

    if (!inv.leadId && k.length === 10 && clientByPhone.has(k)) {
      const c = clientByPhone.get(k);
      links.push({ _id: inv._id, invoiceNumber: inv.invoiceNumber, leadId: c._id, clientId: c.clientId });
    }
  }

  // 2. one customerNo per group; an older group keeps a disputed number
  const claimed = new Set();
  let next = maxCustomerNo;
  const renumber = [];
  for (const [gKey, list] of groups) {
    const wanted = list[0].customerNo;
    const assigned = wanted != null && !claimed.has(wanted) ? wanted : ++next;
    claimed.add(assigned);
    for (const inv of list) {
      if (inv.customerNo !== assigned) {
        renumber.push({
          _id: inv._id,
          invoiceNumber: inv.invoiceNumber,
          customer: `${inv.billTo?.companyName || "?"} / ${inv.billTo?.contactPerson || "?"} / ${inv.billTo?.contactNumber || "no phone"}`,
          from: inv.customerNo,
          to: assigned,
          group: gKey,
        });
      }
    }
  }

  return { renumber, links, groups: groups.size };
};

const main = async () => {
  const apply = process.argv.includes("--apply");
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) throw new Error("Set MONGO_URI (or MONGODB_URI / DATABASE_URL) in .env");

  await mongoose.connect(uri);

  const [invoices, clients, top] = await Promise.all([
    Invoice.find({ isDeleted: false })
      .sort({ createdAt: 1 })
      .select("_id invoiceNumber customerNo billTo leadId createdAt")
      .lean(),
    DentalLead.find({ stage: "client", isDeleted: false }).select("_id clientId contact").lean(),
    Invoice.findOne({}).sort({ customerNo: -1 }).select("customerNo").lean(),
  ]);

  const plan = planCustomerFix(invoices, clients, top?.customerNo || 0);

  console.log(`\n${invoices.length} invoices → ${plan.groups} customers\n`);
  console.log(`customerNo changes (${plan.renumber.length}):`);
  console.table(plan.renumber.map(({ _id, group, ...r }) => r));
  console.log(`\nlink to CRM client (${plan.links.length}):`);
  console.table(plan.links.map(({ _id, leadId, ...r }) => r));

  if (!apply) {
    console.log("\nDRY RUN — nothing written. Re-run with --apply to save.\n");
    return;
  }

  for (const r of plan.renumber) {
    await Invoice.updateOne({ _id: r._id }, { $set: { customerNo: r.to } });
  }
  let linked = 0;
  for (const l of plan.links) {
    try {
      await linkInvoice(l.leadId, l._id, null);
      linked++;
    } catch (err) {
      console.warn(`skip ${l.invoiceNumber}: ${err.message}`);
    }
  }
  console.log(`\nDone: ${plan.renumber.length} customerNo updated, ${linked} invoices linked to clients.\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}