import * as svc from "../services/lead.service.js";
import * as asvc from "../services/assignment.service.js";
import { ok, asyncHandler } from "../helpers/error.helper.js";

// constants/roles.js
export const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };

/* ─ CRUD Operations ──────────────────────────────────────────────────────── */

/**
 * @function getAllLeads
 *
 * @route GET /api/leads
 *
 * @description
 * Fetch all leads with pagination, filters and role-based access control.
 *
 * @process
 * 1. Resolve logged-in employee.
 * 2. Apply role-based visibility.
 * 3. Apply filters, search and pagination.
 * 4. Return lead list.
 *
 * @response
 * 200 { success: true, data: Leads }
 *
 * @errors
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getAllLeads = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const result = await svc.getAllLeads(req.query, requestingUser);
  ok(res, result);
});

/**
 * @function createLead
 *
 * @route POST /api/leads
 *
 * @description
 * Create a new lead and automatically distribute unassigned leads among active agents.
 *
 * @process
 * 1. Validate request body.
 * 2. Create lead.
 * 3. Resolve acting employee.
 * 4. Auto distribute unassigned leads.
 * 5. Return created lead.
 *
 * @response
 * 201 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 500 - INTERNAL_SERVER_ERROR
 */
export const createLead = asyncHandler(async (req, res) => {
  const data = await svc.createLead(req.body, req.user?.email);

  // ── Auto-distribute ────────────────────────────────────────────────
  // Whenever a new lead is added, immediately spread any currently
  // unassigned leads across active agents. This runs best-effort:
  // if it fails for any reason, lead creation itself still succeeds
  // and the error is only logged, never surfaced to the caller.
  try {
    let actingEmployee = null;
    if (req.user?.email) {
      try { actingEmployee = await asvc.resolveActingEmployee(req.user.email); } catch { actingEmployee = null; }
    }
    await asvc.distributeUnassignedLeads(actingEmployee);
  } catch (err) {
    console.error("Auto-distribute after createLead failed:", err.message);
  }

  ok(res, { data }, 201);
}, 400);

/**
 * @function getLeadById
 *
 * @route GET /api/leads/:id
 *
 * @description
 * Fetch complete lead details by lead ID.
 *
 * @process
 * 1. Read lead id.
 * 2. Fetch lead.
 * 3. Return lead.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 404 - LEAD_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getLeadById = asyncHandler(async (req, res) => {
  const data = await svc.getLeadById(req.params.id);
  ok(res, { data });
});

/**
 * @function updateLead
 *
 * @route PUT /api/leads/:id
 *
 * @description
 * Update lead information.
 *
 * @process
 * 1. Read lead id.
 * 2. Validate payload.
 * 3. Update lead.
 * 4. Return updated lead.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const updateLead = asyncHandler(async (req, res) => {
  const data = await svc.updateLead(req.params.id, req.body);
  ok(res, { data });
}, 400);

/**
 * @function deleteLead
 *
 * @route DELETE /api/leads/:id
 *
 * @description
 * Delete a lead.
 *
 * @process
 * 1. Read lead id.
 * 2. Delete lead.
 * 3. Return success.
 *
 * @response
 * 200 { success: true, message: "Deleted successfully" }
 *
 * @errors
 * 404 - LEAD_NOT_FOUND
 */
export const deleteLead = asyncHandler(async (req, res) => {
  await svc.deleteLead(req.params.id);
  ok(res, { message: "Deleted successfully" });
});

/* ─ Pipeline Actions ─────────────────────────────────────────────────────── */

/**
 * @function moveToFollowup
 *
 * @route PATCH /api/leads/:id/followup
 *
 * @description
 * Move a lead into follow-up stage.
 *
 * @process
 * 1. Read lead id.
 * 2. Save follow-up reason.
 * 3. Update lead stage.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const moveToFollowup = asyncHandler(async (req, res) => {
  const data = await svc.moveToFollowup(req.params.id, req.body.reason);
  ok(res, { data });
}, 400);

/**
 * @function moveToFlag
 *
 * @route PATCH /api/leads/:id/flag
 *
 * @description
 * Flag a lead with reason and employee details.
 *
 * @process
 * 1. Read lead id.
 * 2. Resolve logged-in employee.
 * 3. Save flag reason.
 * 4. Update lead status.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const moveToFlag = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.moveToFlag(req.params.id, req.body.reason, email);
  ok(res, { data });
}, 400);

/**
 * @function incrementCallCount
 *
 * @route PATCH /api/leads/:id/call-count
 *
 * @description
 * Increase lead call count.
 *
 * @process
 * 1. Read lead id.
 * 2. Increment call counter.
 * 3. Return updated lead.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 404 - LEAD_NOT_FOUND
 */
export const incrementCallCount = asyncHandler(async (req, res) => {
  const data = await svc.incrementCallCount(req.params.id);
  ok(res, { data });
}, 400);

/**
 * @function updateWhatsapp
 *
 * @route PATCH /api/leads/:id/whatsapp
 *
 * @description
 * Update WhatsApp status/details for a lead.
 *
 * @process
 * 1. Read lead id.
 * 2. Update WhatsApp information.
 * 3. Return updated lead.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const updateWhatsapp = asyncHandler(async (req, res) => {
  const data = await svc.updateWhatsapp(req.params.id, req.body);
  ok(res, { data });
}, 400);

/**
 * @function logFollowUp
 *
 * @route POST /api/leads/:id/followup/:stageType
 *
 * @description
 * Add follow-up activity for a lead.
 *
 * @process
 * 1. Resolve employee.
 * 2. Read stage type.
 * 3. Save follow-up record.
 * 4. Return updated lead.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const logFollowUp = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.logFollowUp(req.params.id, req.params.stageType, email, req.body);
  ok(res, { data });
}, 400);

/**
 * @function convertToClient
 *
 * @route PATCH /api/leads/:id/convert
 *
 * @description
 * Convert an existing lead into a client.
 *
 * @process
 * 1. Read lead id.
 * 2. Convert lead.
 * 3. Return updated client.
 *
 * @response
 * 200 { success: true, data: Client }
 *
 * @errors
 * 404 - LEAD_NOT_FOUND
 */
export const convertToClient = asyncHandler(async (req, res) => {
  const data = await svc.convertToClient(req.params.id);
  ok(res, { data });
}, 400);

/**
 * @function logOrder
 *
 * @route POST /api/leads/:id/order
 *
 * @description
 * Record an order against a lead.
 *
 * @process
 * 1. Resolve employee.
 * 2. Save order information.
 * 3. Update lead history.
 *
 * @response
 * 200 { success: true, data: Lead }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - LEAD_NOT_FOUND
 */
export const logOrder = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.logOrder(req.params.id, email, req.body);
  ok(res, { data });
}, 400);

/**
 * @function logRemarkFollowUp
 *
 * @route POST /api/leads/:id/remark
 *
 * @description
 * Save a follow-up remark for a lead.
 *
 * @process
 * 1. Validate logged-in user.
 * 2. Save remark.
 * 3. Return updated lead.
 *
 * @response
 * 201 { success: true, data: Lead }
 *
 * @errors
 * 401 - UNAUTHORIZED
 * 400 - VALIDATION_ERROR
 */
export const logRemarkFollowUp = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.status(401).json({ success: false, message: "Unauthorized" }); // ← FIX
  const data = await svc.logRemarkFollowUp(req.params.id, email, req.body);
  ok(res, { data }, 201);
}, 400);

/* ─ Dashboards & Filters ─────────────────────────────────────────────────── */

/**
 * @function getDashboard
 *
 * @route GET /api/leads/dashboard
 *
 * @description
 * Fetch dashboard statistics based on logged-in employee role.
 *
 * @process
 * 1. Resolve employee.
 * 2. Apply role-based access.
 * 3. Generate dashboard statistics.
 *
 * @response
 * 200 { success: true, data: Dashboard }
 */
export const getDashboard = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const data = await svc.getDashboardStats(requestingUser);
  ok(res, { data });
});

/**
 * @function getUpcomingFollowUps
 *
 * @route GET /api/leads/upcoming-followups
 *
 * @description
 * Fetch upcoming follow-ups within specified days.
 *
 * @process
 * 1. Resolve employee.
 * 2. Apply role filters.
 * 3. Fetch upcoming follow-ups.
 *
 * @response
 * 200 { success: true, data: FollowUps }
 */
export const getUpcomingFollowUps = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const data = await svc.getUpcomingFollowUps(req.query.daysAhead, requestingUser);
  ok(res, { data, count: data.length });
});

/* ─ Excel File Import ────────────────────────────────────────────────────── */
/**
 * @function importExcel
 *
 * @route POST /api/leads/import
 *
 * @description
 * Import leads from Excel file and auto distribute unassigned leads.
 *
 * @process
 * 1. Validate uploaded file.
 * 2. Import Excel data.
 * 3. Resolve employee.
 * 4. Auto distribute leads.
 * 5. Return import summary.
 *
 * @response
 * 200 { success: true, data: ImportResult }
 *
 * @errors
 * 400 - NO_FILE_UPLOADED
 */
export const importExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }
  const results = await svc.importFromExcel(req.file.buffer);

  // ── Auto-distribute ────────────────────────────────────────────────
  // A bulk import is just many new leads at once — run the same
  // best-effort distribute pass so imported leads don't sit unassigned.
  try {
    let actingEmployee = null;
    if (req.user?.email) {
      try { actingEmployee = await asvc.resolveActingEmployee(req.user.email); } catch { actingEmployee = null; }
    }
    await asvc.distributeUnassignedLeads(actingEmployee);
  } catch (err) {
    console.error("Auto-distribute after importExcel failed:", err.message);
  }

  ok(res, { data: results });
}, 400);

/* ─ Assignment / Distribution (Admin only) ──────────────────────────────── */

/* req.user only carries `email` — the JWT has no role claim — so we must
   resolve the real employee record from the DB to check the actual role. */
const assertAdmin = async (req) => {
  if (!req.user?.email) {
    const authErr = new Error("Not authenticated");
    authErr.statusCode = 401;
    throw authErr;
  }
  const employee = await asvc.resolveActingEmployee(req.user.email);
  if (employee.role !== 0 && employee.role !== 1) {
    const adminErr = new Error("Only Admin/Super Admin can perform this action");
    adminErr.statusCode = 403;
    throw adminErr;
  }
  return employee;
};

export const distributeUnassigned = asyncHandler(async (req, res) => {
  // const actingEmployee = await assertAdmin(req);
  const result = await asvc.distributeUnassignedLeads(req);
  ok(res, { data: result });
}, 400);

/**
 * @function distributeUnassigned
 *
 * @route POST /api/leads/distribute
 *
 * @description
 * Distribute all unassigned leads among available agents.
 *
 * @process
 * 1. Distribute leads.
 * 2. Return assignment summary.
 *
 * @response
 * 200 { success: true, data: DistributionResult }
 */
export const rebalanceUntouched = asyncHandler(async (req, res) => {
  const actingEmployee = await assertAdmin(req);
  const result = await asvc.rebalanceUntouchedLeads(actingEmployee);
  ok(res, { data: result });
}, 400);

export const handleDeparture = asyncHandler(async (req, res) => {
  const actingEmployee = await assertAdmin(req);
  const { mode, targetEmployeeId, reason } = req.body;
  const result = await asvc.handleAgentDeparture(
    req.params.employeeId,
    mode,
    { targetEmployeeId, reason },
    actingEmployee
  );
  ok(res, { data: result });
}, 400);

/* ─────────────────────────────────────────────────────────────────────────
   Rebalance-on-new-agent hook — NOT wired in yet
   ─────────────────────────────────────────────────────────────────────────
   This controller only owns LEAD routes. Agent/employee creation lives in
   a separate controller (the one behind AUTH_API's `/employee/...` routes,
   e.g. employee.controller.js or auth.controller.js — not shown to me).

   To make "rebalance runs automatically when a new agent is added" work,
   add this same pattern to the END of that employee-creation handler,
   right after the new employee document is saved successfully:

     import * as asvc from "<path-to>/services/assignment.service.js";
     ...
     // inside e.g. createEmployee handler, after `await newEmployee.save()`:
     try {
       await asvc.rebalanceUntouchedLeads(null); // or resolve an acting admin if you have one
     } catch (err) {
       console.error("Auto-rebalance after createEmployee failed:", err.message);
     }

   Paste that controller/route file here and I'll wire it in precisely,
   matching whatever `actingEmployee` argument shape rebalanceUntouchedLeads
   expects.
──────────────────────────────────────────────────────────────────────────── */

/**
 * @function getAgentsOverview
 *
 * @route GET /api/leads/agents
 *
 * @description
 * Fetch lead statistics for all agents.
 *
 * @process
 * 1. Verify Admin.
 * 2. Fetch agent overview.
 * 3. Return statistics.
 *
 * @response
 * 200 { success: true, data: AgentsOverview }
 */
export const getAgentsOverview = asyncHandler(async (req, res) => {
  await assertAdmin(req);
  const data = await svc.getAgentsOverview();
  ok(res, { data });
});
 
export const getLeadsByAgent = asyncHandler(async (req, res) => {
  await assertAdmin(req);
  const result = await svc.getLeadsByAgent(req.params.employeeId, req.query);
  ok(res, result);
}, 400);