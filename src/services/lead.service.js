import XLSX from "xlsx";
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
    ordersList, flagReason, flaggedAt, flaggedBy, ...safeData
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
  lead.whatsapp = { ...current, ...whatsappData };
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

/* ─── CONVERT FOLLOW-UP ➔ CLIENT ─────────────────────────────────────────── */
export const convertToClient = async (id) => {
  const lead = await DentalLead.findById(id);
  if (!lead) throw new Error("Lead record not found");
  if (lead.stage === "client") throw new Error("This profile is already registered as a client");

  const clientCount = await DentalLead.countDocuments({ stage: "client" });
  lead.stage = "client";
  lead.clientId = `DIGI-DENT-${String(clientCount + 1).padStart(3, "0")}`;
  return lead.save();
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
 