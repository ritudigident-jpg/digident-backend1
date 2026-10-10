/* =========================================================================
   ONE-TIME MIGRATION — deploy ke baad ek baar chalao:

     node scripts/backfillInvoiceClientSearch.js            (dry run, kuch save nahi)
     node scripts/backfillInvoiceClientSearch.js --apply    (asli update)

   Kya karta hai:
   1. Purane invoices par leadId / clientId / createdBy wapas bharta hai.
      (Ye fields pehle schema mein nahi the isliye DB mein save hi nahi
      hue — par DentalLead.invoices[] mein link + creator save hua tha,
      wahan se recover karte hain.)
   2. Manual-order invoices par createdBy = jis employee ne order banaya.
   3. Baaki bina-creator invoices par createdBy = PermissionAudit "Create" entry.
   4. Saare invoices + leads par fuzzy searchIndex banata hai.

   updateOne / bulkWrite use karta hai — pre-save hook (totals, status)
   dobara NAHI chalta, isliye paise ke numbers bilkul nahi badlenge.
   ========================================================================= */
import "dotenv/config";
import mongoose from "mongoose";
import Invoice from "../models/manage/invoice.model.js";
import DentalLead from "../models/manage/dentalLead.js";
import ManualOrder from "../models/manually order/manualOrder.model.js";
import Employee from "../models/manage/employee.model.js";
import { PermissionAudit } from "../models/manage/permissionaudit.model.js";
import {
  buildInvoiceSearchIndex,
  buildClientSearchIndex,
} from "../helpers/fuzzySearch.helper.js";

const APPLY = process.argv.includes("--apply");
const URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DB_URI;

const flush = async (Model, ops, label) => {
  if (!ops.length) return 0;
  if (APPLY) await Model.bulkWrite(ops, { ordered: false });
  console.log(`  ${label}: ${ops.length} ${APPLY ? "updated" : "(dry run)"}`);
  return ops.length;
};

const run = async () => {
  if (!URI) throw new Error("Set the MONGO_URI environment variable");
  await mongoose.connect(URI);
  console.log(APPLY ? "APPLY mode — changes will be saved\n" : "DRY RUN — nothing is saved (add --apply to save)\n");

  /* ---------- 1. client link from DentalLead.invoices[] ---------- */
  const leads = await DentalLead.find({ "invoices.0": { $exists: true } })
    .select("_id clientId invoices")
    .lean();
  const linkByInvoice = new Map();
  for (const lead of leads) {
    for (const e of lead.invoices || []) {
      if (!e.invoice) continue;
      linkByInvoice.set(String(e.invoice), {
        leadId: lead._id,
        clientId: lead.clientId || null,
        createdBy: e.createdBy || null,
        createdByName: e.createdByName || "",
        createdByEmail: e.createdByEmail || "",
      });
    }
  }

  /* ---------- 2. manual-order creators ---------- */
  // populate ki jagah seedha Employee collection se (script mein model
  // registration par depend nahi karna)
  const orders = await ManualOrder.find({ invoiceId: { $ne: null } })
    .select("invoiceId createdBy")
    .lean();
  const empIds = [...new Set(orders.map((o) => String(o.createdBy || "")).filter(Boolean))];
  const emps = empIds.length
    ? await Employee.find({ _id: { $in: empIds } }).select("_id firstName lastName email").lean()
    : [];
  const empById = new Map(emps.map((e) => [String(e._id), e]));
  const orderCreatorByInvoiceId = new Map(
    orders
      .filter((o) => o.createdBy)
      .map((o) => [o.invoiceId, empById.get(String(o.createdBy)) || { _id: o.createdBy }])
  );

  /* ---------- invoices ---------- */
  const cursor = Invoice.find({}).select("+searchIndex").lean().cursor();
  let ops = [];
  let total = 0;
  let linked = 0;
  let creators = 0;

  for await (const inv of cursor) {
    const set = {};

    const link = linkByInvoice.get(String(inv._id));
    if (link && !inv.leadId) {
      set.leadId = link.leadId;
      set.clientId = link.clientId;
      linked++;
    }

    if (!inv.createdBy) {
      let creator = null;
      if (link?.createdBy) {
        creator = { _id: link.createdBy, name: link.createdByName, email: link.createdByEmail };
      } else if (inv.sourceOrderType === "manual" && orderCreatorByInvoiceId.get(inv.invoiceId)) {
        const e = orderCreatorByInvoiceId.get(inv.invoiceId);
        creator = {
          _id: e._id,
          name: `${e.firstName || ""} ${e.lastName || ""}`.trim() || e.email,
          email: e.email,
        };
      } else {
        const audit = await PermissionAudit.findOne({ actionFor: inv._id, actionType: "Create" })
          .select("actionBy actionByEmail")
          .lean();
        if (audit?.actionBy) creator = { _id: audit.actionBy, name: "", email: audit.actionByEmail || "" };
      }
      if (creator) {
        set.createdBy = creator._id;
        if (!inv.createdByName && creator.name) set.createdByName = creator.name;
        if (!inv.createdByEmail && creator.email) set.createdByEmail = creator.email;
        creators++;
      }
    }

    set.searchIndex = buildInvoiceSearchIndex({ ...inv, ...set });
    ops.push({ updateOne: { filter: { _id: inv._id }, update: { $set: set } } });
    total++;

    if (ops.length >= 500) {
      await flush(Invoice, ops, "invoices batch");
      ops = [];
    }
  }
  await flush(Invoice, ops, "invoices batch");
  console.log(`\nInvoices: ${total} indexed, ${linked} client-linked, ${creators} creators filled\n`);

  /* ---------- leads ---------- */
  ops = [];
  let leadTotal = 0;
  for await (const lead of DentalLead.find({}).lean().cursor()) {
    ops.push({
      updateOne: {
        filter: { _id: lead._id },
        update: { $set: { searchIndex: buildClientSearchIndex(lead) } },
      },
    });
    leadTotal++;
    if (ops.length >= 500) {
      await flush(DentalLead, ops, "leads batch");
      ops = [];
    }
  }
  await flush(DentalLead, ops, "leads batch");
  console.log(`\nLeads: ${leadTotal} indexed`);

  if (APPLY) {
    // createIndexes sirf naye indexes banata hai, purane kabhi drop nahi karta
    await Invoice.createIndexes();
    await DentalLead.createIndexes();
    console.log("MongoDB indexes created");
  }

  await mongoose.disconnect();
  console.log("\nDone.");
};

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect();
  process.exit(1);
});
