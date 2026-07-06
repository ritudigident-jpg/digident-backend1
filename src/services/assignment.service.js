import DentalLead from "../models/manage/dentalLead.js";
import Employee from "../models/manage/employee.model.js";

/* ─── Split an array into N nearly-equal round-robin chunks ─────────────── */
const chunkEvenly = (items, n) => {
  const chunks = Array.from({ length: n }, () => []);
  items.forEach((item, idx) => chunks[idx % n].push(item));
  return chunks;
};

const fullName = (e) => `${e?.firstName || ""} ${e?.lastName || ""}`.trim();

/* ─── Resolve the logged-in user performing an assignment action ────────── */
export const resolveActingEmployee = async (email) => {
  const employee = await Employee.findOne({ email })
    .select("_id firstName lastName")
    .lean();
  if (!employee) {
    const err = new Error("Acting employee not found");
    err.statusCode = 404;
    throw err;
  }
  return employee;
};

/* ─── Fetch currently active agents ──────────────────────────────────────── */
const getActiveAgents = async (excludeId = null) => {
  const query = { isActive: true };
  if (excludeId) query._id = { $ne: excludeId };
  return Employee.find(query).select("_id firstName lastName").lean();
};

/* ─── Map of agentId -> untouched lead count (defaults to 0) ────────────── */
const getUntouchedCountMap = async (agentIds) => {
  const counts = await DentalLead.aggregate([
    {
      $match: {
        isDeleted: false,
        isTouched: false,
        assignedEmployee: { $in: agentIds },
      },
    },
    { $group: { _id: "$assignedEmployee", count: { $sum: 1 } } },
  ]);
  const map = new Map(agentIds.map((id) => [String(id), 0]));
  counts.forEach((c) => map.set(String(c._id), c.count));
  return map;
};

/* ─── Build bulkWrite ops assigning a batch of leads across agents ───────── */
const buildAssignmentOps = (leads, activeAgents, actingEmployee, reasonText, assignmentType = "auto") => {
  const chunks = chunkEvenly(leads, activeAgents.length);
  const ops = [];
  const summary = [];

  activeAgents.forEach((agent, i) => {
    const agentName = fullName(agent);
    const chunk = chunks[i];
    summary.push({ employeeId: agent._id, agent: agentName, count: chunk.length });

    chunk.forEach((lead) => {
      ops.push({
        updateOne: {
          filter: { _id: lead._id },
          update: {
            $set: {
              assignedEmployee: agent._id,
              assignedAgent: agentName,
              assignedAt: new Date(),
              assignmentType,
            },
            $push: {
              assignmentHistory: {
                fromEmployee: lead.assignedEmployee || null,
                fromAgent: lead.assignedAgent || "",
                toEmployee: agent._id,
                toAgent: agentName,
                transferredBy: actingEmployee._id,
                transferredByName: fullName(actingEmployee),
                reason: reasonText,
              },
            },
          },
        },
      });
    });
  });

  return { ops, summary };
};

/* ═══════════════════════════════════════════════════════════════════════
   SINGLE NEW INQUIRY → assign to agent with least UNTOUCHED workload
   Fails soft: if no active agents exist, lead is simply left unassigned.
═══════════════════════════════════════════════════════════════════════ */
export const autoAssignNewLead = async (lead, actingEmployee) => {
  const activeAgents = await getActiveAgents();
  if (!activeAgents.length) return lead;

  const countMap = await getUntouchedCountMap(activeAgents.map((a) => a._id));
  const target = activeAgents.reduce((least, agent) =>
    countMap.get(String(agent._id)) < countMap.get(String(least._id)) ? agent : least
  , activeAgents[0]);

  const agentName = fullName(target);
  lead.assignedEmployee = target._id;
  lead.assignedAgent = agentName;
  lead.assignedAt = new Date();
  lead.assignmentType = "auto";
  lead.assignmentHistory.push({
    fromEmployee: null,
    fromAgent: "",
    toEmployee: target._id,
    toAgent: agentName,
    transferredBy: actingEmployee._id,
    transferredByName: fullName(actingEmployee),
    reason: "New inquiry auto-assignment (least untouched workload)",
  });

  return lead;
};

/* ═══════════════════════════════════════════════════════════════════════
   BULK DISTRIBUTE — assigns all currently UNASSIGNED leads (e.g. after
   an Excel import) evenly across active agents.
═══════════════════════════════════════════════════════════════════════ */
export const distributeUnassignedLeads = async (actingEmployee) => {
  const activeAgents = await getActiveAgents();
  if (!activeAgents.length) throw new Error("No active agents available for distribution");

  const unassigned = await DentalLead.find({ assignedEmployee: null, isDeleted: false })
    .select("_id assignedEmployee assignedAgent")
    .lean();
  if (!unassigned.length) return { distributed: 0, perAgent: [] };

  const { ops, summary } = buildAssignmentOps(
    unassigned,
    activeAgents,
    actingEmployee,
    "Initial bulk distribution",
    "auto"
  );
  await DentalLead.bulkWrite(ops);

  return { distributed: unassigned.length, perAgent: summary };
};

/* ═══════════════════════════════════════════════════════════════════════
   REBALANCE — call after a NEW agent is added. Redistributes ONLY
   untouched leads (system-wide) evenly across ALL active agents.
   Touched leads are never moved by this.
═══════════════════════════════════════════════════════════════════════ */
export const rebalanceUntouchedLeads = async (actingEmployee) => {
  const activeAgents = await getActiveAgents();
  if (!activeAgents.length) throw new Error("No active agents available for rebalancing");

  const untouched = await DentalLead.find({ isTouched: false, isDeleted: false })
    .select("_id assignedEmployee assignedAgent")
    .lean();
  if (!untouched.length) return { rebalanced: 0, perAgent: [] };

  const { ops, summary } = buildAssignmentOps(
    untouched,
    activeAgents,
    actingEmployee,
    "Rebalance after new agent added",
    "auto"
  );
  await DentalLead.bulkWrite(ops);

  return { rebalanced: untouched.length, perAgent: summary };
};

/* ═══════════════════════════════════════════════════════════════════════
   AGENT DEPARTURE — mode "transfer": move ALL of the departing agent's
   leads (touched + untouched) to one specific agent, history preserved.
═══════════════════════════════════════════════════════════════════════ */
const transferAgentLeads = async (departingEmployeeId, targetEmployeeId, actingEmployee, reason) => {
  const targetAgent = await Employee.findById(targetEmployeeId)
    .select("_id firstName lastName isActive")
    .lean();
  if (!targetAgent) throw new Error("Target agent not found");
  if (!targetAgent.isActive) throw new Error("Target agent is not active");
  if (String(targetEmployeeId) === String(departingEmployeeId)) {
    throw new Error("Target agent must be different from the departing agent");
  }

  const leads = await DentalLead.find({ assignedEmployee: departingEmployeeId, isDeleted: false })
    .select("_id assignedEmployee assignedAgent")
    .lean();
  if (!leads.length) return { transferred: 0, targetAgent: fullName(targetAgent) };

  const { ops } = buildAssignmentOps(
    leads,
    [targetAgent],
    actingEmployee,
    reason || "Agent departure - full transfer",
    "transfer"
  );
  await DentalLead.bulkWrite(ops);

  return { transferred: leads.length, targetAgent: fullName(targetAgent) };
};

/* ═══════════════════════════════════════════════════════════════════════
   AGENT DEPARTURE — mode "auto": redistribute ONLY the departing agent's
   untouched leads among the remaining active agents. Touched leads stay
   assigned to the departing (now inactive) employee record.
═══════════════════════════════════════════════════════════════════════ */
const autoDistributeDepartingAgentLeads = async (departingEmployeeId, actingEmployee) => {
  const remainingAgents = await getActiveAgents(departingEmployeeId);
  if (!remainingAgents.length) throw new Error("No other active agents available to redistribute to");

  const untouched = await DentalLead.find({
    assignedEmployee: departingEmployeeId,
    isTouched: false,
    isDeleted: false,
  })
    .select("_id assignedEmployee assignedAgent")
    .lean();

  const touchedRemaining = await DentalLead.countDocuments({
    assignedEmployee: departingEmployeeId,
    isTouched: true,
    isDeleted: false,
  });

  if (!untouched.length) {
    return { redistributed: 0, perAgent: [], touchedLeadsRemainingWithDepartingAgent: touchedRemaining };
  }

  const { ops, summary } = buildAssignmentOps(
    untouched,
    remainingAgents,
    actingEmployee,
    "Agent departure - untouched auto-distribution",
    "auto"
  );
  await DentalLead.bulkWrite(ops);

  return {
    redistributed: untouched.length,
    perAgent: summary,
    touchedLeadsRemainingWithDepartingAgent: touchedRemaining,
  };
};

/* ─── Entry point used by the controller ─────────────────────────────────── */
export const handleAgentDeparture = async (departingEmployeeId, mode, options, actingEmployee) => {
  if (mode === "transfer") {
    if (!options?.targetEmployeeId) throw new Error("targetEmployeeId is required for transfer mode");
    return transferAgentLeads(departingEmployeeId, options.targetEmployeeId, actingEmployee, options.reason);
  }
  if (mode === "auto") {
    return autoDistributeDepartingAgentLeads(departingEmployeeId, actingEmployee);
  }
  throw new Error("mode must be 'transfer' or 'auto'");
};