/* =========================================================================
   AGENT PERFORMANCE (Admin / Super Admin only)

   Har employee (agent) ka ek period ka kaam:
     • clients     — kitne client banaye (is period mein client bane +
                     abhi us agent ko assigned), converted vs direct,
                     aur total clients jo abhi uske paas hain
     • sales       — kitne invoice banaye, kitne products / units beche
     • payments    — kitne invoice PAID / partial / unpaid, kitna amount
                     aaya, kitna baaki, paid invoices ki total value
     • activity    — kitne follow-ups / call remarks log kiye

   Incentive ka koi % ya calculation yahan NAHI hai — admin "Paid invoices
   value" / "Received" dekh ke khud incentive tay karta hai.

   Invoice "agent ka" tab hai jab invoice.createdBy = us employee ka _id
   (migration script purane invoices par bhi createdBy bhar deta hai).
   Period invoice ki invoiceDate se ginta hai.
   ========================================================================= */
import mongoose from "mongoose";
import DentalLead from "../models/manage/dentalLead.js";
import Employee from "../models/manage/employee.model.js";

const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };
const BILLABLE = ["issued", "partially_paid", "paid"]; // draft + cancelled are not counted as sales

/* "Paid" = status is paid AND the money is actually recorded (paidAmount
   covers the total). An invoice marked "paid" by hand with no payment
   entered is reported separately as "marked paid, payment missing" so it
   never inflates the incentive basis. */
const FULLY_PAID_EXPR = {
  $and: [
    { $eq: ["$status", "paid"] },
    { $gte: [{ $ifNull: ["$summary.paidAmount", 0] }, { $subtract: [{ $ifNull: ["$summary.totalPayAmount", 0] }, 0.01] }] },
  ],
};
const isFullyPaid = (inv) =>
  inv.status === "paid" && Number(inv.summary?.paidAmount || 0) >= Number(inv.summary?.totalPayAmount || 0) - 0.01;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const employeeName = (e) =>
  e ? `${e.firstName || ""} ${e.lastName || ""}`.trim() || e.email || "" : "";

const httpError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

/* from / to = "YYYY-MM-DD" (India time). Default: is mahine ki 1 tareekh → aaj */
const parseRange = ({ from, to } = {}) => {
  const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  const now = new Date();
  const istNow = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const firstOfMonth = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const today = istNow.toISOString().slice(0, 10);

  const f = isYmd(from) ? from : firstOfMonth;
  const t = isYmd(to) ? to : today;
  const start = new Date(`${f}T00:00:00.000+05:30`);
  const end = new Date(`${t}T23:59:59.999+05:30`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw httpError("Invalid date range", 400);
  if (start > end) throw httpError("'from' date must be on or before the 'to' date", 400);
  return { start, end, from: f, to: t };
};

const getInvoiceModel = () => {
  const Invoice = mongoose.models.Invoice;
  if (!Invoice) throw httpError("Invoice model is not loaded", 500);
  return Invoice;
};

const emptyRow = () => ({
  clients: { won: 0, converted: 0, direct: 0, current: 0 },
  invoices: { total: 0, billable: 0, paid: 0, partial: 0, unpaid: 0, cancelled: 0, draft: 0, clientsBilled: 0, paidPaymentMissing: 0 },
  amounts: { billed: 0, received: 0, due: 0, paidInvoicesValue: 0, returned: 0, paymentMissing: 0 },
  products: { unitsSold: 0, distinct: 0, top: [] },
  activity: { followups: 0 },
});

/* ═══════════════════════════════════════════════════════════════════════
   LEADERBOARD — GET /leads/admin/agent-performance?from=&to=
═══════════════════════════════════════════════════════════════════════ */
export const getAgentPerformance = async (query = {}) => {
  const { start, end, from, to } = parseRange(query);
  const Invoice = getInvoiceModel();
  const invMatch = {
    isDeleted: false,
    createdBy: { $ne: null },
    invoiceDate: { $gte: start, $lte: end },
  };

  const [employees, invAgg, productAgg, wonAgg, currentAgg, activityAgg] = await Promise.all([
    Employee.find({ isDeleted: { $ne: true } })
      .select("_id employeeId firstName lastName email role isActive")
      .lean(),

    /* invoices + paise */
    Invoice.aggregate([
      { $match: invMatch },
      {
        $addFields: {
          _billable: { $in: ["$status", BILLABLE] },
          _total: { $ifNull: ["$summary.totalPayAmount", 0] },
          _paidAmt: { $ifNull: ["$summary.paidAmount", 0] },
          _fullyPaid: FULLY_PAID_EXPR,
        },
      },
      {
        $group: {
          _id: "$createdBy",
          total: { $sum: 1 },
          billable: { $sum: { $cond: ["$_billable", 1, 0] } },
          paid: { $sum: { $cond: ["$_fullyPaid", 1, 0] } },
          paidPaymentMissing: {
            $sum: { $cond: [{ $and: [{ $eq: ["$status", "paid"] }, { $not: ["$_fullyPaid"] }] }, 1, 0] },
          },
          paymentMissing: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$status", "paid"] }, { $not: ["$_fullyPaid"] }] },
                { $max: [{ $subtract: ["$_total", "$_paidAmt"] }, 0] },
                0,
              ],
            },
          },
          partial: { $sum: { $cond: [{ $eq: ["$status", "partially_paid"] }, 1, 0] } },
          unpaid: { $sum: { $cond: [{ $eq: ["$status", "issued"] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
          draft: { $sum: { $cond: [{ $eq: ["$status", "draft"] }, 1, 0] } },
          billed: { $sum: { $cond: ["$_billable", "$_total", 0] } },
          received: { $sum: { $cond: ["$_billable", { $ifNull: ["$summary.paidAmount", 0] }, 0] } },
          due: {
            $sum: {
              $cond: [
                { $in: ["$status", ["issued", "partially_paid"]] },
                { $ifNull: ["$summary.amountToPay", 0] },
                0,
              ],
            },
          },
          paidInvoicesValue: { $sum: { $cond: ["$_fullyPaid", "$_total", 0] } },
          returned: {
            $sum: {
              $cond: [
                "$_billable",
                { $add: [{ $ifNull: ["$refundableAmount", 0] }, { $ifNull: ["$partialRefundAmount", 0] }] },
                0,
              ],
            },
          },
          clientsBilled: { $addToSet: "$leadId" },
        },
      },
    ]),

    /* products / units (return hua maal ghata ke) */
    Invoice.aggregate([
      { $match: { ...invMatch, status: { $in: BILLABLE } } },
      { $unwind: "$items" },
      {
        $project: {
          createdBy: 1,
          name: { $trim: { input: { $ifNull: ["$items.description", ""] } } },
          units: {
            $max: [{ $subtract: [{ $ifNull: ["$items.qty", 0] }, { $ifNull: ["$items.returnedQty", 0] }] }, 0],
          },
          amount: { $ifNull: ["$items.totalAmount", 0] },
        },
      },
      {
        $group: {
          _id: { agent: "$createdBy", name: { $toLower: "$name" } },
          name: { $first: "$name" },
          units: { $sum: "$units" },
          amount: { $sum: "$amount" },
        },
      },
      { $sort: { units: -1 } },
      {
        $group: {
          _id: "$_id.agent",
          unitsSold: { $sum: "$units" },
          distinct: { $sum: 1 },
          top: { $push: { name: "$name", units: "$units", amount: "$amount" } },
        },
      },
      { $project: { unitsSold: 1, distinct: 1, top: { $slice: ["$top", 3] } } },
    ]),

    /* is period mein bane clients (abhi jis agent ke paas hain) */
    DentalLead.aggregate([
      { $match: { isDeleted: false, stage: "client", assignedEmployee: { $ne: null } } },
      { $addFields: { clientSince: { $ifNull: ["$convertedAt", "$createdAt"] } } },
      { $match: { clientSince: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: "$assignedEmployee",
          won: { $sum: 1 },
          direct: { $sum: { $cond: [{ $eq: ["$clientOrigin", "direct"] }, 1, 0] } },
        },
      },
    ]),

    /* abhi kitne clients us agent ke paas hain (all time) */
    DentalLead.aggregate([
      { $match: { isDeleted: false, stage: "client", assignedEmployee: { $ne: null } } },
      { $group: { _id: "$assignedEmployee", current: { $sum: 1 } } },
    ]),

    /* follow-ups / call remarks jo is period mein log kiye */
    DentalLead.aggregate([
      { $match: { isDeleted: false } },
      {
        $project: {
          acts: {
            $concatArrays: [
              { $ifNull: ["$remarkFollowups", []] },
              { $ifNull: ["$preSaleFollowups", []] },
              { $ifNull: ["$postSaleFollowups", []] },
            ],
          },
        },
      },
      { $unwind: "$acts" },
      { $match: { "acts.loggedAt": { $gte: start, $lte: end } } },
      { $group: { _id: "$acts.employeeId", followups: { $sum: 1 } } },
    ]),
  ]);

  const rows = new Map();
  const row = (id) => {
    const k = String(id);
    if (!rows.has(k)) rows.set(k, emptyRow());
    return rows.get(k);
  };

  for (const a of invAgg) {
    const r = row(a._id);
    r.invoices = {
      total: a.total, billable: a.billable, paid: a.paid, partial: a.partial,
      unpaid: a.unpaid, cancelled: a.cancelled, draft: a.draft,
      paidPaymentMissing: a.paidPaymentMissing,
      clientsBilled: (a.clientsBilled || []).filter(Boolean).length,
    };
    r.amounts = {
      billed: r2(a.billed), received: r2(a.received), due: r2(a.due),
      paidInvoicesValue: r2(a.paidInvoicesValue), returned: r2(a.returned),
      paymentMissing: r2(a.paymentMissing),
    };
  }
  for (const p of productAgg) {
    row(p._id).products = {
      unitsSold: p.unitsSold,
      distinct: p.distinct,
      top: p.top.map((t) => ({ name: t.name, units: t.units, amount: r2(t.amount) })),
    };
  }
  for (const w of wonAgg) {
    const r = row(w._id);
    r.clients.won = w.won;
    r.clients.direct = w.direct;
    r.clients.converted = w.won - w.direct;
  }
  for (const c of currentAgg) row(c._id).clients.current = c.current;
  for (const f of activityAgg) if (f._id) row(f._id).activity.followups = f.followups;

  const hasWork = (r) =>
    r.invoices.total || r.clients.won || r.clients.current || r.activity.followups;

  const agents = employees
    .filter((e) => e.role === ROLES.AGENT || (rows.has(String(e._id)) && hasWork(rows.get(String(e._id)))))
    .map((e) => {
      const r = rows.get(String(e._id)) || emptyRow();
      return {
        employeeId: String(e._id),
        code: e.employeeId || "",
        name: employeeName(e),
        email: e.email,
        role: e.role,
        isActive: e.isActive !== false,
        ...r,
        collectionRate: r.amounts.billed > 0 ? Math.round((r.amounts.received / r.amounts.billed) * 100) : 0,
      };
    })
    .sort(
      (a, b) =>
        b.amounts.paidInvoicesValue - a.amounts.paidInvoicesValue ||
        b.amounts.received - a.amounts.received ||
        b.clients.won - a.clients.won ||
        b.invoices.total - a.invoices.total
    )
    .map((a, i) => ({ ...a, rank: i + 1 }));

  const sum = (fn) => agents.reduce((s, a) => s + fn(a), 0);
  const totals = {
    agents: agents.length,
    clientsWon: sum((a) => a.clients.won),
    invoices: sum((a) => a.invoices.billable),
    paidInvoices: sum((a) => a.invoices.paid),
    unitsSold: sum((a) => a.products.unitsSold),
    billed: r2(sum((a) => a.amounts.billed)),
    received: r2(sum((a) => a.amounts.received)),
    due: r2(sum((a) => a.amounts.due)),
    paidInvoicesValue: r2(sum((a) => a.amounts.paidInvoicesValue)),
    paidPaymentMissing: sum((a) => a.invoices.paidPaymentMissing),
    paymentMissing: r2(sum((a) => a.amounts.paymentMissing)),
    followups: sum((a) => a.activity.followups),
  };

  return { range: { from, to }, totals, agents };
};

/* ═══════════════════════════════════════════════════════════════════════
   EK AGENT KA DETAIL — GET /leads/admin/agent-performance/:employeeId
   invoices (har ek ka status / paid / baaki / products), products ka
   breakdown, aur is period mein bane clients.
═══════════════════════════════════════════════════════════════════════ */
export const getAgentPerformanceDetail = async (employeeId, query = {}) => {
  if (!mongoose.Types.ObjectId.isValid(employeeId)) throw httpError("Invalid agent id", 400);
  const { start, end, from, to } = parseRange(query);
  const Invoice = getInvoiceModel();
  const empId = new mongoose.Types.ObjectId(employeeId);

  const [employee, invoices, wonClients] = await Promise.all([
    Employee.findById(empId).select("_id employeeId firstName lastName email role isActive").lean(),
    Invoice.find({ isDeleted: false, createdBy: empId, invoiceDate: { $gte: start, $lte: end } })
      .select(
        "invoiceId invoiceNumber invoiceDate dueDate status billTo.companyName billTo.contactPerson " +
        "billTo.contactNumber clientId leadId sourceOrderType items.description items.qty items.returnedQty " +
        "items.totalAmount summary.totalPayAmount summary.paidAmount summary.amountToPay " +
        "refundableAmount partialRefundAmount"
      )
      .sort({ invoiceDate: -1 })
      .lean(),
    DentalLead.aggregate([
      { $match: { isDeleted: false, stage: "client", assignedEmployee: empId } },
      { $addFields: { clientSince: { $ifNull: ["$convertedAt", "$createdAt"] } } },
      { $match: { clientSince: { $gte: start, $lte: end } } },
      { $project: { doctorName: 1, clinicName: 1, clientId: 1, contact: 1, city: 1, clientOrigin: 1, clientSince: 1 } },
      { $sort: { clientSince: -1 } },
    ]),
  ]);
  if (!employee) throw httpError("Agent not found", 404);

  // is period ke clients ke invoices (agent ne banaye, kisi bhi date ke)
  const wonIds = wonClients.map((c) => c._id);
  const invCounts = wonIds.length
    ? await Invoice.aggregate([
        { $match: { isDeleted: false, leadId: { $in: wonIds }, status: { $in: BILLABLE } } },
        {
          $group: {
            _id: "$leadId",
            count: { $sum: 1 },
            billed: { $sum: { $ifNull: ["$summary.totalPayAmount", 0] } },
            paidCount: { $sum: { $cond: [FULLY_PAID_EXPR, 1, 0] } },
          },
        },
      ])
    : [];
  const byClient = new Map(invCounts.map((c) => [String(c._id), c]));

  const products = new Map();
  const rows = invoices.map((inv) => {
    const billable = BILLABLE.includes(inv.status);
    let units = 0;
    for (const it of inv.items || []) {
      const u = Math.max(Number(it.qty || 0) - Number(it.returnedQty || 0), 0);
      units += u;
      if (!billable) continue;
      const name = String(it.description || "").trim() || "—";
      const key = name.toLowerCase();
      const p = products.get(key) || { name, units: 0, amount: 0, invoices: 0 };
      p.units += u;
      p.amount += Number(it.totalAmount || 0);
      p.invoices += 1;
      products.set(key, p);
    }
    return {
      invoiceId: inv.invoiceId,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      status: inv.status,
      source: inv.leadId ? "client" : inv.sourceOrderType || "other",
      leadId: inv.leadId || null,
      clientId: inv.clientId || "",
      client: inv.billTo?.contactPerson || inv.billTo?.companyName || "",
      company: inv.billTo?.companyName || "",
      phone: inv.billTo?.contactNumber || "",
      items: (inv.items || []).map((i) => `${i.description} ×${i.qty}`).join(", "),
      units,
      total: r2(inv.summary?.totalPayAmount),
      paid: r2(inv.summary?.paidAmount),
      due: ["issued", "partially_paid"].includes(inv.status) ? r2(inv.summary?.amountToPay) : 0,
      fullyPaid: isFullyPaid(inv),
      // marked "paid" but the payment was never entered
      paymentMissing: inv.status === "paid" && !isFullyPaid(inv)
        ? r2(Math.max(Number(inv.summary?.totalPayAmount || 0) - Number(inv.summary?.paidAmount || 0), 0))
        : 0,
      returned: r2(Number(inv.refundableAmount || 0) + Number(inv.partialRefundAmount || 0)),
    };
  });

  const billableRows = rows.filter((r) => BILLABLE.includes(r.status));
  const sum = (list, k) => r2(list.reduce((s, r) => s + Number(r[k] || 0), 0));

  return {
    range: { from, to },
    agent: {
      employeeId: String(employee._id),
      code: employee.employeeId || "",
      name: employeeName(employee),
      email: employee.email,
      role: employee.role,
      isActive: employee.isActive !== false,
    },
    summary: {
      invoices: billableRows.length,
      paidInvoices: billableRows.filter((r) => r.fullyPaid).length,
      paidPaymentMissingInvoices: billableRows.filter((r) => r.paymentMissing > 0).length,
      paymentMissing: sum(billableRows, "paymentMissing"),
      partialInvoices: billableRows.filter((r) => r.status === "partially_paid").length,
      unpaidInvoices: billableRows.filter((r) => r.status === "issued").length,
      cancelledInvoices: rows.filter((r) => r.status === "cancelled").length,
      billed: sum(billableRows, "total"),
      received: sum(billableRows, "paid"),
      due: sum(billableRows, "due"),
      paidInvoicesValue: sum(billableRows.filter((r) => r.fullyPaid), "total"),
      returned: sum(billableRows, "returned"),
      unitsSold: billableRows.reduce((s, r) => s + r.units, 0),
      clientsWon: wonClients.length,
    },
    invoices: rows,
    products: [...products.values()]
      .map((p) => ({ ...p, amount: r2(p.amount) }))
      .sort((a, b) => b.units - a.units || b.amount - a.amount),
    newClients: wonClients.map((c) => {
      const s = byClient.get(String(c._id));
      return {
        _id: c._id,
        doctorName: c.doctorName,
        clinicName: c.clinicName,
        clientId: c.clientId,
        contact: c.contact,
        city: c.city,
        clientOrigin: c.clientOrigin || "converted",
        clientSince: c.clientSince,
        invoiceCount: s?.count || 0,
        paidInvoiceCount: s?.paidCount || 0,
        billed: r2(s?.billed),
      };
    }),
  };
};
