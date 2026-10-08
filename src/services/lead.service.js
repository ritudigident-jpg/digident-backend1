import XLSX from "xlsx";
import mongoose from "mongoose";
import DentalLead from "../models/manage/dentalLead.js";
import Employee from "../models/manage/employee.model.js";
import { autoAssignNewLead, resolveActingEmployee } from "./assignment.service.js";
const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };

const baseQuery = { isDeleted: false };
const norm = (s) => String(s ?? "").toLowerCase().trim().replace(/[\s_\-\/\.]+/g, " ");

const COL_MAP = {
  "doctor name":     "doctorName",
  "name":            "doctorName",
  "clinic name":     "clinicName",
  "clinic":          "clinicName",
  "hospital":        "clinicName",
  "contact":         "contact",
  "contact no":      "contact",
  "contact number":  "contact",
  "phone":           "contact",
  "mobile":          "contact",
  "email":           "email",
  "city":            "city",
  "state":           "state",
  "address":         "address",
  "enquiry":         "enquiry",
  "product":         "enquiry",
  "remarks":         "remarks",
  "remark":          "remarks",
  "contact by":      "contactBy",
  "assigned to":     "contactBy",
};

/* ═══════════════════════════════════════════════════════════════════════
   GET ALL LEADS — role-scoped. Agents (role 4) only see leads assigned
   to them. Admin/superadmin/manager/executive see everything.
═══════════════════════════════════════════════════════════════════════ */
export const getAllLeads = async (filters = {}, requestingUser = null) => {
  const { stage, search, page = 1, limit = 200 } = filters;
  const query = { ...baseQuery };

  if (stage) query.stage = stage;

  if (search) {
    query.$or = [
      { doctorName: new RegExp(search, "i") },
      { clinicName: new RegExp(search, "i") },
      { city: new RegExp(search, "i") },
      { contact: new RegExp(search, "i") },
      { remarks: new RegExp(search, "i") },
    ];
  }

  if (requestingUser && requestingUser.role === ROLES.AGENT) {
    query.assignedEmployee = requestingUser._id;
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [leads, totalResult] = await Promise.all([
    DentalLead.aggregate([
      { $match: query },
      { $addFields: { sortOrder: { $cond: [{ $eq: ["$nextFollowUpDate", null] }, 1, 0] } } },
      { $sort: { sortOrder: 1, nextFollowUpDate: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]),
    DentalLead.aggregate([{ $match: query }, { $count: "total" }]),
  ]);

  const total = totalResult.length ? totalResult[0].total : 0;

  return {
    leads,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
  };
};

/* ─── CREATE INQUIRY (auto-assigns to agent with least untouched load) ──── */
export const createLead = async (data, email) => {
  const lead = new DentalLead({ ...data, stage: "inquiry" });

  if (email) {
    try {
      const actingEmployee = await resolveActingEmployee(email);
      await autoAssignNewLead(lead, actingEmployee);
    } catch (err) {
      console.error("Auto-assignment skipped:", err.message);
    }
  }

  return lead.save();
};

/* ─── GET BY ID ──────────────────────────────────────────────────────────── */
export const getLeadById = async (id) => {
  return DentalLead.findOne({ _id: id, ...baseQuery }).lean();
};

/* ─── UPDATE LEAD ─────────────────────────────────────────────────────────── */
export const updateLead = async (id, data) => {
  const {
    stage, clientId, preSaleFollowups, postSaleFollowups,
    ordersList, flagReason, flaggedAt, flaggedBy,
    clientOrigin, convertedAt, invoices, ...safeData
  } = data;

  const lead = await DentalLead.findOne({ _id: id, ...baseQuery });
  if (!lead) throw new Error("Lead record not found");

  Object.assign(lead, safeData);
  return lead.save();
};

/* ─── SOFT DELETE ────────────────────────────────────────────────────────── */
export const deleteLead = async (id) => {
  return DentalLead.findOneAndUpdate({ _id: id, ...baseQuery }, { isDeleted: true }, { new: true });
};

/* ─── MOVE INQUIRY ➔ FOLLOW-UP ───────────────────────────────────────────── */
export const moveToFollowup = async (id, reason = "") => {
  const lead = await DentalLead.findOne({ _id: id, ...baseQuery });
  if (!lead) throw new Error("Lead not found");
  if (lead.stage !== "inquiry") throw new Error("Lead must be in the inquiry stage to transition");

  lead.stage = "followup";
  if (reason) lead.moveReason = reason;
  return lead.save();
};

/* ─── MOVE ANY LEAD ➔ FLAG ───────────────────────────────────────────────── */
export const moveToFlag = async (id, reason, email) => {
  if (!reason || !reason.trim()) throw new Error("A reason is required to flag a lead");

  const employee = await Employee.findOne({ email }, { firstName: 1, lastName: 1 }).lean();
  const lead = await DentalLead.findOne({ _id: id, ...baseQuery });
  if (!lead) throw new Error("Lead not found");

  lead.stage = "flag";
  lead.flagReason = reason.trim();
  lead.flaggedAt = new Date();
  lead.flaggedBy = employee ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() : email || "";

  return lead.save();
};

/* ─── INCREMENT CALL COUNT — marks lead as touched ──────────────────────── */
export const incrementCallCount = async (id) => {
  const lead = await DentalLead.findOne({ _id: id, ...baseQuery });
  if (!lead) throw new Error("Lead not found");

  lead.callCount = (lead.callCount || 0) + 1;
  lead.isTouched = true;
  return lead.save();
};

/* ─── UPDATE WHATSAPP STATUS ─────────────────────────────────────────────── */
export const updateWhatsapp = async (id, whatsappData = {}) => {
  const lead = await DentalLead.findOne({ _id: id, ...baseQuery });
  if (!lead) throw new Error("Lead not found");

  const current = lead.whatsapp?.toObject ? lead.whatsapp.toObject() : (lead.whatsapp || {});
  const next = { ...current, ...whatsappData };

  if (whatsappData.sent === true && !whatsappData.sentAt && !current.sentAt) {
    next.sentAt = new Date();
  }

  lead.whatsapp = next;
  return lead.save();
};

/* ─── PRE/POST SALE FOLLOW-UP — marks lead as touched ───────────────────── */
export const logFollowUp = async (leadId, stageType, email, body) => {
  const lead = await DentalLead.findById(leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.statusCode = 404;
    throw err;
  }

  const employee = await Employee.findOne({ email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const agent = `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email;

  if (stageType === "pre-sale") {
    lead.preSaleFollowups.push({
      agent, employeeId: employee._id, notes: body.notes,
      hurdle: body.hurdle || "", nextCallDate: body.nextCallDate,
    });
    lead.isTouched = true;
    await lead.save();
    return lead;
  }

  if (stageType === "post-sale") {
    lead.postSaleFollowups.push({
      agent, employeeId: employee._id, notes: body.notes,
      hurdle: body.hurdle || "", nextCallDate: body.nextCallDate,
    });
    lead.isTouched = true;
    await lead.save();
    return lead;
  }

  throw new Error("Invalid stage type");
};

/* ─── CLIENT ID — unique, never reused ──────────────────────────────────────
   Next id = highest existing DIGI-DENT-### number + 1 (deleted and flagged
   records included, so an id is never handed out twice). The unique index
   on clientId in dentalLead.js catches two saves racing for the same
   number; we then pick the next number and retry.
─────────────────────────────────────────────────────────────────────────── */
const CLIENT_ID_PATTERN = /^DIGI-DENT-\d+$/;

const nextClientId = async () => {
  const [last] = await DentalLead.aggregate([
    { $match: { clientId: CLIENT_ID_PATTERN } },
    { $project: { n: { $toInt: { $arrayElemAt: [{ $split: ["$clientId", "-"] }, 2] } } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  return `DIGI-DENT-${String((last?.n || 0) + 1).padStart(3, "0")}`;
};

const saveWithUniqueClientId = async (lead, attempts = 5) => {
  // A record that already had a client id (e.g. client ➔ flag ➔ client) keeps it.
  if (lead.clientId && CLIENT_ID_PATTERN.test(lead.clientId)) return lead.save();

  for (let i = 0; i < attempts; i++) {
    lead.clientId = await nextClientId();
    try {
      return await lead.save();
    } catch (err) {
      if (err?.code === 11000 && err?.keyPattern?.clientId) continue;
      throw err;
    }
  }
  throw new Error("Could not generate a unique client ID. Please try again.");
};

/* ─── CONVERT FOLLOW-UP ➔ CLIENT ─────────────────────────────────────────── */
export const convertToClient = async (id) => {
  const lead = await DentalLead.findById(id);
  if (!lead) throw new Error("Lead record not found");
  if (lead.stage === "client") throw new Error("This profile is already registered as a client");

  lead.stage = "client";
  lead.clientOrigin = "converted";
  lead.convertedAt = new Date();
  return saveWithUniqueClientId(lead);
};

/* ═══════════════════════════════════════════════════════════════════════
   DIRECT CLIENT CREATION
   Same DentalLead document and same client structure as a converted
   client, so follow-ups, orders and the invoice flow work unchanged.
═══════════════════════════════════════════════════════════════════════ */
const DEFAULT_CONTACT_BY = "Vithal Sir";

const DIRECT_CLIENT_FIELDS = [
  "doctorName", "clinicName", "email", "contact",
  "city", "state", "address", "enquiry", "remarks",
];

const activeEmployeeQuery = { isDeleted: false, isActive: { $ne: false } };

const employeeName = (e) =>
  (e ? `${e.firstName || ""} ${e.lastName || ""}`.trim() || e.email || "" : "");

const httpError = (message, statusCode) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

/* ─── CONTACT BY OPTIONS — "Vithal Sir" default + active employees ──────── */
export const getClientOwners = async () => {
  const employees = await Employee.find(activeEmployeeQuery)
    .select("_id employeeId firstName lastName email role")
    .sort({ firstName: 1, lastName: 1 })
    .lean();

  return {
    defaultContactBy: DEFAULT_CONTACT_BY,
    employees: employees.map((e) => ({ ...e, name: employeeName(e) })),
  };
};

/* ─── CREATE CLIENT (direct) ─────────────────────────────────────────────
   Contact By:
     contactByEmployeeId → that employee (name stored in contactBy, and the
                           client is assigned to them)
     contactBy (text)    → "Other": custom name stored as-is
     neither             → "Vithal Sir"
   When Contact By is not an employee, the client is assigned to the
   manager creating it, so it is never left unassigned for auto-distribute.
─────────────────────────────────────────────────────────────────────────── */
export const createClient = async (data = {}, actingEmployee) => {
  if (!actingEmployee?._id) throw httpError("Not authenticated", 401);

  const fields = {};
  for (const key of DIRECT_CLIENT_FIELDS) {
    if (data[key] !== undefined && data[key] !== null) fields[key] = String(data[key]).trim();
  }

  // Same minimum as Excel import: a name (doctor or clinic) + contact.
  if (!fields.doctorName && !fields.clinicName) throw httpError("Doctor name or clinic name is required", 400);
  if (!fields.contact) throw httpError("Contact number is required", 400);

  const existing = await DentalLead.findOne({ contact: fields.contact, ...baseQuery })
    .select("_id stage clientId")
    .lean();
  if (existing) {
    throw httpError(
      existing.stage === "client"
        ? `This contact is already a client (${existing.clientId || existing._id})`
        : `A lead with this contact already exists in the "${existing.stage}" stage. Convert that lead instead.`,
      409
    );
  }

  let contactBy = DEFAULT_CONTACT_BY;
  let contactEmployee = null;

  if (data.contactByEmployeeId) {
    if (!mongoose.Types.ObjectId.isValid(data.contactByEmployeeId)) {
      throw httpError("Invalid Contact By employee", 400);
    }
    contactEmployee = await Employee.findOne({ _id: data.contactByEmployeeId, ...activeEmployeeQuery })
      .select("_id firstName lastName email role")
      .lean();
    if (!contactEmployee) throw httpError("Selected Contact By employee is not an active employee", 400);
    contactBy = employeeName(contactEmployee);
  } else if (String(data.contactBy ?? "").trim()) {
    contactBy = String(data.contactBy).trim();
  }

  const assignee = contactEmployee || actingEmployee;
  const assigneeName = employeeName(assignee);
  const now = new Date();

  const lead = new DentalLead({
    ...fields,
    contactBy,
    stage: "client",
    clientOrigin: "direct",
    source: "manual",
    isTouched: true,

    assignedEmployee: assignee._id,
    assignedAgent: assigneeName,
    assignedAt: now,
    assignmentType: "manual",
    assignmentHistory: [{
      fromEmployee: null,
      fromAgent: "",
      toEmployee: assignee._id,
      toAgent: assigneeName,
      transferredBy: actingEmployee._id,
      transferredByName: employeeName(actingEmployee),
      reason: "Direct client creation",
      transferredAt: now,
    }],
  });

  return saveWithUniqueClientId(lead);
};

/* ═══════════════════════════════════════════════════════════════════════
   CLIENT ⇄ INVOICE
   Invoice side: leadId, clientId, createdBy* (set by createInvoice)
   Lead side:    invoices[] with who created each one + invoiceId (latest)
═══════════════════════════════════════════════════════════════════════ */

/* ─── Client an invoice is being raised for (used by createInvoice) ─────
   Agents can only invoice clients assigned to them.                      */
export const getClientForInvoice = async (leadId, employee = null) => {
  if (!mongoose.Types.ObjectId.isValid(leadId)) throw httpError("Invalid client id", 400);

  const query = { _id: leadId, stage: "client", ...baseQuery };
  if (employee && employee.role === ROLES.AGENT) query.assignedEmployee = employee._id;

  const lead = await DentalLead.findOne(query)
    .select("_id clientId doctorName clinicName assignedEmployee")
    .lean();
  if (!lead) throw httpError("Client not found, or not assigned to you", 404);
  return lead;
};

/* ─── Record an invoice on the client (idempotent) ──────────────────────
   creator = the employee who created the invoice.                        */
export const attachInvoiceToClient = async (leadId, invoice, creator = null) => {
  const entry = {
    invoice: invoice._id,
    invoiceId: invoice.invoiceId || "",
    invoiceNumber: invoice.invoiceNumber || "",
    totalAmount: Number(invoice.summary?.totalPayAmount || 0),
    createdBy: creator?._id || invoice.createdBy || null,
    createdByName: creator ? employeeName(creator) : (invoice.createdByName || ""),
    createdByEmail: creator?.email || invoice.createdByEmail || "",
    createdAt: invoice.createdAt || new Date(),
  };

  // $ne guard: the same invoice is never listed twice
  await DentalLead.updateOne(
    { _id: leadId, "invoices.invoice": { $ne: invoice._id } },
    { $push: { invoices: entry } }
  );
  await DentalLead.updateOne({ _id: leadId }, { $set: { invoiceId: invoice._id } });

  return entry;
};

/* Who created an older invoice that has no createdBy stored:
   the "Create" PermissionAudit entry written by createInvoice. */
const findInvoiceCreator = async (invoice) => {
  if (invoice.createdBy) {
    return Employee.findById(invoice.createdBy).select("_id firstName lastName email").lean();
  }
  const PermissionAudit = mongoose.models.PermissionAudit;
  if (!PermissionAudit) return null;
  const audit = await PermissionAudit.findOne({ actionFor: invoice._id, actionType: "Create" })
    .select("actionBy")
    .lean();
  if (!audit?.actionBy) return null;
  return Employee.findById(audit.actionBy).select("_id firstName lastName email").lean();
};

/* ─── LINK INVOICE — attach an EXISTING invoice to a client ──────────────
   New invoices raised from a client are linked automatically by
   createInvoice (it receives leadId). This endpoint is for invoices
   created before that, or from the invoice list page.
   invoiceRef = invoice _id (ObjectId) or its invoiceId (UUID).           */
export const linkInvoice = async (id, invoiceRef, requestingUser = null) => {
  if (!invoiceRef) throw httpError("invoiceId is required", 400);

  const lead = await getClientForInvoice(id, requestingUser);

  const Invoice = mongoose.models.Invoice;
  if (!Invoice) throw httpError("Invoice model is not loaded", 500);

  const invoice = await Invoice.findOne({
    isDeleted: false,
    ...(mongoose.Types.ObjectId.isValid(invoiceRef) && String(invoiceRef).length === 24
      ? { _id: invoiceRef }
      : { invoiceId: String(invoiceRef) }),
  }).lean();
  if (!invoice) throw httpError("Invoice not found", 404);

  if (invoice.leadId && String(invoice.leadId) !== String(lead._id)) {
    throw httpError("This invoice is already linked to another client", 409);
  }

  await Invoice.updateOne(
    { _id: invoice._id },
    { $set: { leadId: lead._id, clientId: lead.clientId || null } }
  );

  const creator = await findInvoiceCreator(invoice);
  await attachInvoiceToClient(lead._id, invoice, creator);

  return DentalLead.findById(lead._id).lean();
};

/* ─── LOG ORDERS FOR CLIENTS ─────────────────────────────────────────────── */
export const logOrder = async (id, data) => {
  const lead = await DentalLead.findOne({ _id: id, stage: "client", ...baseQuery });
  if (!lead) throw new Error("Active converted client portfolio profile not found");

  lead.remarks = `${lead.remarks}\n[Order Logged]: ${data.product || "Product"} - Price: ${data.price || 0} by ${data.loggedBy}`;
  return lead.save();
};

/* ─── FILTER UPCOMING SCHEDULE ───────────────────────────────────────────── */


/* ─── GET DASHBOARD ANALYTICS ────────────────────────────────────────────── */

export const getDashboardStats = async (requestingUser = null) => {
  const scopeQuery = { ...baseQuery };
  if (requestingUser && requestingUser.role === ROLES.AGENT) {
    scopeQuery.assignedEmployee = requestingUser._id;
  }

  const [counts, upcoming] = await Promise.all([
    DentalLead.aggregate([
      { $match: scopeQuery },
      { $group: { _id: "$stage", count: { $sum: 1 } } },
    ]),
    getUpcomingFollowUps(7, requestingUser),
  ]);

  const summary = { inquiry: 0, followup: 0, client: 0, flag: 0 };
  counts.forEach((c) => { if (c._id in summary) summary[c._id] = c.count; });

  return {
    ...summary,
    total: summary.inquiry + summary.followup + summary.client + summary.flag,
    upcomingCount: upcoming.length,
  };
};

// Scope upcoming follow-ups the same way
export const getUpcomingFollowUps = async (daysAhead = 7, requestingUser = null) => {
  const startRange = new Date(); startRange.setHours(0, 0, 0, 0);
  const endRange = new Date(startRange); endRange.setDate(endRange.getDate() + parseInt(daysAhead));

  const query = {
    ...baseQuery,
    stage: { $in: ["followup", "client"] },
    nextFollowUpDate: { $gte: startRange, $lte: endRange },
  };
  if (requestingUser && requestingUser.role === ROLES.AGENT) {
    query.assignedEmployee = requestingUser._id;
  }

  return DentalLead.find(query).sort({ nextFollowUpDate: 1 }).lean();
};

/* ─── EXCEL IMPORT — inserts unassigned; distribute is a separate step ──── */
export const importFromExcel = async (fileBuffer) => {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", cellDates: true });
  const results = { inserted: 0, skipped: 0, errors: [] };

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrixRows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (!matrixRows.length) continue;

    for (const row of matrixRows) {
      try {
        const mappedData = {};
        for (const [rawKey, rawValue] of Object.entries(row)) {
          const schemaField = COL_MAP[norm(rawKey)];
          if (schemaField && String(rawValue).trim()) {
            mappedData[schemaField] = String(rawValue).trim();
          }
        }

        const fallbackIdentifier = mappedData.doctorName || mappedData.clinicName;
        if (!fallbackIdentifier || !mappedData.contact) {
          results.skipped++;
          continue;
        }

        const matchFound = await DentalLead.findOne({ contact: mappedData.contact, ...baseQuery });
        if (matchFound) {
          results.skipped++;
          continue;
        }

        await new DentalLead({
          doctorName: mappedData.doctorName || "",
          clinicName: mappedData.clinicName || "",
          email: mappedData.email || "",
          contact: mappedData.contact,
          city: mappedData.city || "",
          state: mappedData.state || "",
          address: mappedData.address || "",
          enquiry: mappedData.enquiry || "",
          remarks: mappedData.remarks || "",
          contactBy: mappedData.contactBy || "",
          stage: "inquiry",
          source: "excel",
        }).save();

        results.inserted++;
      } catch (err) {
        results.errors.push({
          contactId: row["CONTACT"] || row["CONTACT NO"] || "Missing identifier row",
          error: err.message,
        });
      }
    }
  }

  return results;
};

/* ─── REMARK FOLLOW-UP — marks lead as touched ──────────────────────────── */
export const logRemarkFollowUp = async (leadId, email, body) => {
  const lead = await DentalLead.findById(leadId);
  if (!lead) {
    const err = new Error("Lead not found");
    err.statusCode = 404;
    throw err;
  }

  const employee = await Employee.findOne({ email });
  if (!employee) {
    const err = new Error("Employee not found");
    err.statusCode = 404;
    throw err;
  }

  const agent = `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email;

  const previous = lead.remarkFollowups;
  let round = 1;
  let touchNumber = 1;

  if (previous.length) {
    const last = previous[previous.length - 1];
    if (last.touchNumber >= 3) {
      round = last.round + 1;
      touchNumber = 1;
    } else {
      round = last.round;
      touchNumber = last.touchNumber + 1;
    }
  }

  lead.remarkFollowups.push({
    agent, employeeId: employee._id, callStatus: body.callStatus,
    reason: body.reason || "", nextCallDate: body.nextCallDate, round, touchNumber,
  });
  lead.isTouched = true;
  await lead.save();

  return lead;
};


export const getAgentsOverview = async () => {
  const agents = await Employee.find({ role: ROLES.AGENT, isDeleted: false })
    .select("_id employeeId firstName lastName email isActive")
    .lean();
 
  const counts = await DentalLead.aggregate([
    { $match: baseQuery },
    {
      $group: {
        _id: { agent: "$assignedEmployee", stage: "$stage" },
        count: { $sum: 1 },
      },
    },
  ]);
 
  const byAgent = {};
  counts.forEach((c) => {
    const agentId = c._id.agent ? String(c._id.agent) : "unassigned";
    if (!byAgent[agentId]) {
      byAgent[agentId] = { inquiry: 0, followup: 0, client: 0, flag: 0, total: 0 };
    }
    if (c._id.stage in byAgent[agentId]) byAgent[agentId][c._id.stage] = c.count;
    byAgent[agentId].total += c.count;
  });
 
  const unassignedCounts = byAgent["unassigned"] || { inquiry: 0, followup: 0, client: 0, flag: 0, total: 0 };
 
  return {
    agents: agents.map((a) => ({
      ...a,
      counts: byAgent[String(a._id)] || { inquiry: 0, followup: 0, client: 0, flag: 0, total: 0 },
    })),
    unassigned: unassignedCounts,
  };
};
 
/* ─── ADMIN: LEADS BY AGENT — full lead list for one specific agent, by ID ──
   Unlike getAllLeads (which self-scopes an AGENT caller to their own leads),
   this is explicitly for an admin/superadmin picking *any* agent's ID and
   viewing that agent's complete lead data — every stage, every touch.
─────────────────────────────────────────────────────────────────────────── */
export const getLeadsByAgent = async (employeeId, filters = {}) => {
  // Guard against malformed IDs (aggregate would otherwise throw a
  // confusing "Cast to ObjectId failed" error, or silently return []
  // depending on the exact bad input).
  if (!mongoose.Types.ObjectId.isValid(employeeId)) {
    const err = new Error("Invalid agent id");
    err.statusCode = 400;
    throw err;
  }
  const agentObjectId = new mongoose.Types.ObjectId(employeeId);
 
  const { stage, search, page = 1, limit = 200 } = filters;
 
  // ← THE FIX: use agentObjectId, not the raw string employeeId
  const query = { ...baseQuery, assignedEmployee: agentObjectId };
 
  if (stage) query.stage = stage;
 
  if (search) {
    query.$or = [
      { doctorName: new RegExp(search, "i") },
      { clinicName: new RegExp(search, "i") },
      { city: new RegExp(search, "i") },
      { contact: new RegExp(search, "i") },
      { remarks: new RegExp(search, "i") },
    ];
  }
 
  const skip = (parseInt(page) - 1) * parseInt(limit);
 
  const [leads, totalResult, agent] = await Promise.all([
    DentalLead.aggregate([
      { $match: query },
      { $addFields: { sortOrder: { $cond: [{ $eq: ["$nextFollowUpDate", null] }, 1, 0] } } },
      { $sort: { sortOrder: 1, nextFollowUpDate: 1, createdAt: -1 } },
      { $skip: skip },
      { $limit: parseInt(limit) },
    ]),
    DentalLead.aggregate([{ $match: query }, { $count: "total" }]),
    // Employee.findById is a normal Mongoose query method, so it casts
    // the string employeeId to ObjectId automatically — this part was
    // never the problem.
    Employee.findById(employeeId).select("_id employeeId firstName lastName email role isActive").lean(),
  ]);
 
  if (!agent) {
    const err = new Error("Agent not found");
    err.statusCode = 404;
    throw err;
  }
 
  const total = totalResult.length ? totalResult[0].total : 0;
 
  return {
    agent,
    leads,
    total,
    page: parseInt(page),
    totalPages: Math.ceil(total / parseInt(limit)),
  };
};