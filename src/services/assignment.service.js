import DentalLead from "../models/manage/dentalLead.js";
import Employee from "../models/manage/employee.model.js";

const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };

/* ─── Split an array into N nearly-equal round-robin chunks ─────────────── */
/* Diagram: "Divide Equally (750 Each Agent)" for 3000 inquiries / 4 agents */
const chunkEvenly = (items, n) => {
  const chunks = Array.from({ length: n }, () => []);
  items.forEach((item, idx) => chunks[idx % n].push(item));
  return chunks;
};

const fullName = (e) => `${e?.firstName || ""} ${e?.lastName || ""}`.trim();

/* ─── Resolve the logged-in user performing an assignment action ────────── */
export const resolveActingEmployee = async (email) => {
  const employee = await Employee.findOne({ email, isDeleted: false })
    .select("_id employeeId firstName lastName role")
    .lean();
  if (!employee) {
    const err = new Error("Acting employee not found");
    err.statusCode = 404;
    throw err;
  }
  return employee;
};

/* ─── Resolve a business employeeId (string) to the Mongo document ──────── */
export const resolveEmployeeByEmployeeId = async (employeeId) => {
  const employee = await Employee.findOne({ employeeId, isDeleted: false })
    .select("_id employeeId firstName lastName role isActive")
    .lean();
  if (!employee) {
    const err = new Error(`Employee not found for employeeId "${employeeId}"`);
    err.statusCode = 404;
    throw err;
  }
  return employee;
};

/* ─── Diagram: "Count Active Agents" ─────────────────────────────────────
   isActive: { $ne: false } treats missing field (legacy records) as active,
   same as isActive matching true. Only role 4 (agent) counts. ────────── */

const getActiveAgents = async (excludeMongoId = null) => {
  const query = {
    role: ROLES.AGENT,        // role = 4
    isDeleted: false,
    isActive: { $ne: false },
  };
  if (excludeMongoId) query._id = { $ne: excludeMongoId };
  return Employee.find(query).select("_id employeeId firstName lastName").lean();
};

/* ─── Map of agentMongoId -> untouched lead count (defaults to 0) ────────── */
/* Diagram: "Assign to Agent with Least Untouched/Pending Workload" ──────── */
const getUntouchedCountMap = async (agentMongoIds) => {
  const counts = await DentalLead.aggregate([
    {
      $match: {
        isDeleted: false,
        isTouched: false,
        assignedEmployee: { $in: agentMongoIds },
      },
    },
    { $group: { _id: "$assignedEmployee", count: { $sum: 1 } } },
  ]);
  const map = new Map(agentMongoIds.map((id) => [String(id), 0]));
  counts.forEach((c) => map.set(String(c._id), c.count));
  return map;
};

/* ─── Build bulkWrite ops assigning a batch of leads across agents ───────── */
/* Diagram: "Assign Each Inquiry to One Agent Only" + "Assignment history is stored" */
const buildAssignmentOps = (leads, activeAgents, actingEmployee, reasonText, assignmentType = "auto") => {
  const chunks = chunkEvenly(leads, activeAgents.length);
  const ops = [];
  const summary = [];

  activeAgents.forEach((agent, i) => {
    const agentName = fullName(agent);
    const chunk = chunks[i];
    summary.push({ employeeId: agent.employeeId, mongoId: agent._id, agent: agentName, count: chunk.length });

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
   Diagram: "New Inquiry Arrives" → "Assign to Agent with Least
   Untouched/Pending Workload"
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
   Diagram: "Import 3000 Inquiries" → "Count Active Agents" → "Divide
   Equally" → "Assign Each Inquiry to One Agent Only"
   Distributes all currently UNASSIGNED leads evenly across active agents.
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
   Diagram: "New Agent Added" → "Redistribute ONLY Untouched Inquiries
   among all active agents" → "Touched/Processed Leads remain with
   original agent"
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
   Diagram: "Agent Leaves Company" → "Transfer to Specific Agent" branch.
   ALL leads (touched + untouched) move to target. "Processing continues
   from the same call count, remarks, follow-ups and next call date.
   Nothing is reset." — we only mutate assignment fields, never
   callCount/remarkFollowups/etc, so this holds true automatically.
═══════════════════════════════════════════════════════════════════════ */
const transferAgentLeads = async (departingEmployee, targetEmployeeIdStr, actingEmployee, reason) => {
  const targetAgent = await resolveEmployeeByEmployeeId(targetEmployeeIdStr);

  if (targetAgent.role !== ROLES.AGENT) {
    throw new Error(`Target employee "${targetEmployeeIdStr}" is not an agent (role must be 4)`);
  }
  if (targetAgent.isActive === false) {
    throw new Error("Target agent is not active");
  }
  if (String(targetAgent._id) === String(departingEmployee._id)) {
    throw new Error("Target agent must be different from the departing agent");
  }

  const leads = await DentalLead.find({ assignedEmployee: departingEmployee._id, isDeleted: false })
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

  return { transferred: leads.length, targetAgent: fullName(targetAgent), targetEmployeeId: targetAgent.employeeId };
};

/* ═══════════════════════════════════════════════════════════════════════
   Diagram: "Agent Leaves Company" → "Auto Distribute" branch.
   Only untouched leads move to remaining active agents. Touched leads
   stay with the departing (now inactive) employee record.
═══════════════════════════════════════════════════════════════════════ */
const autoDistributeDepartingAgentLeads = async (departingEmployee, actingEmployee) => {
  const remainingAgents = await getActiveAgents(departingEmployee._id);
  if (!remainingAgents.length) throw new Error("No other active agents available to redistribute to");

  const untouched = await DentalLead.find({
    assignedEmployee: departingEmployee._id,
    isTouched: false,
    isDeleted: false,
  })
    .select("_id assignedEmployee assignedAgent")
    .lean();

  const touchedRemaining = await DentalLead.countDocuments({
    assignedEmployee: departingEmployee._id,
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

/* ─── Entry point — Diagram: "Only Admin/Super Admin can perform this
   transfer" is enforced at the controller layer via assertAdmin. ──────── */
export const handleAgentDeparture = async (departingEmployeeIdStr, mode, options, actingEmployee) => {
  const departingEmployee = await resolveEmployeeByEmployeeId(departingEmployeeIdStr);

  if (mode === "transfer") {
    if (!options?.targetEmployeeId) throw new Error("targetEmployeeId is required for transfer mode");
    return transferAgentLeads(departingEmployee, options.targetEmployeeId, actingEmployee, options.reason);
  }
  if (mode === "auto") {
    return autoDistributeDepartingAgentLeads(departingEmployee, actingEmployee);
  }
  throw new Error("mode must be 'transfer' or 'auto'");
};


