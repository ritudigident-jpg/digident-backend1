/**
 * HTTP handlers for CRM leads: inquiry -> follow-up -> client, call remarks, agent assignment:
 * read the request, call the service, send the response. No business logic here.
 *
 * Exports: ROLES, getAllLeads, createLead, getLeadById, updateLead, deleteLead, moveToFollowup,
 * moveToFlag and 23 more
 * Used by: routes/leads.routes.js
 */

import * as svc from "../../services/lead/lead.service.js";
import * as asvc from "../../services/lead/assignment.service.js";
import * as psvc from "../../services/lead/agentperformance.service.js";
import { sendCreated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { ForbiddenError, UnauthorizedError, BadRequestError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";

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
    try {
      requestingUser = await asvc.resolveActingEmployee(req.user.email);
    } catch {
      requestingUser = null;
    }
  }
  const result = await svc.getAllLeads(req.query, requestingUser);
  sendSuccess(res, { legacyTopLevel: result });
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
      try {
        actingEmployee = await asvc.resolveActingEmployee(req.user.email);
      } catch {
        actingEmployee = null;
      }
    }
    await asvc.distributeUnassignedLeads(actingEmployee);
  } catch (err) {
    logger.error("Auto-distribute after createLead failed", { error: err.message });
  }

  sendCreated(res, { data });
});

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
  sendSuccess(res, { data });
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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { message: "Deleted successfully" });
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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  sendSuccess(res, { data });
});

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
  if (!email) throw new UnauthorizedError("Unauthorized");
  const data = await svc.logRemarkFollowUp(req.params.id, email, req.body);
  sendCreated(res, { data });
});

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
    try {
      requestingUser = await asvc.resolveActingEmployee(req.user.email);
    } catch {
      requestingUser = null;
    }
  }
  const data = await svc.getDashboardStats(requestingUser);
  sendSuccess(res, { data });
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
    try {
      requestingUser = await asvc.resolveActingEmployee(req.user.email);
    } catch {
      requestingUser = null;
    }
  }
  const data = await svc.getUpcomingFollowUps(req.query.daysAhead, requestingUser);
  sendSuccess(res, { data, legacyTopLevel: { count: data.length } });
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
    throw new BadRequestError("No file uploaded", { code: ERROR_CODES.NO_FILE_UPLOADED });
  }
  const results = await svc.importFromExcel(req.file.buffer);

  // ── Auto-distribute ────────────────────────────────────────────────
  // A bulk import is just many new leads at once — run the same
  // best-effort distribute pass so imported leads don't sit unassigned.
  try {
    let actingEmployee = null;
    if (req.user?.email) {
      try {
        actingEmployee = await asvc.resolveActingEmployee(req.user.email);
      } catch {
        actingEmployee = null;
      }
    }
    await asvc.distributeUnassignedLeads(actingEmployee);
  } catch (err) {
    logger.error("Auto-distribute after importExcel failed", { error: err.message });
  }

  sendSuccess(res, { data: results });
});

/* ─ Assignment / Distribution (Admin only) ──────────────────────────────── */

/* req.user only carries `email` — the JWT has no role claim — so we must
   resolve the real employee record from the DB to check the actual role. */
const assertRole = async (req, allowedRoles, message) => {
  if (!req.user?.email) {
    throw new UnauthorizedError("Not authenticated");
  }
  const employee = await asvc.resolveActingEmployee(req.user.email);
  if (!allowedRoles.includes(employee.role)) {
    throw new ForbiddenError(message);
  }
  return employee;
};

const assertAdmin = (req) =>
  assertRole(req, [ROLES.SUPERADMIN, ROLES.ADMIN], "Only Admin/Super Admin can perform this action");

/* ─ Direct Client Creation (Manager / Admin / Super Admin) ──────────────── */

const CLIENT_CREATOR_ROLES = [ROLES.SUPERADMIN, ROLES.ADMIN, ROLES.MANAGER];
const CLIENT_CREATOR_MESSAGE = "Only Manager/Admin/Super Admin can create clients";

/**
 * @function getClientOwners
 *
 * @route GET /api/leads/client-owners
 *
 * @description
 * Options for the Create Client "Contact By" field:
 * "Vithal Sir" (default) + active employees. "Other" is a free-text entry on the form.
 *
 * @response
 * 200 { success: true, data: { defaultContactBy, employees } }
 *
 * @errors
 * 401 - UNAUTHORIZED
 * 403 - FORBIDDEN
 */
export const getClientOwners = asyncHandler(async (req, res) => {
  await assertRole(req, CLIENT_CREATOR_ROLES, CLIENT_CREATOR_MESSAGE);
  const data = await svc.getClientOwners();
  sendSuccess(res, { data });
});

/**
 * @function createClient
 *
 * @route POST /api/leads/create-client
 *
 * @description
 * Create a client directly as a DentalLead with stage "client" and clientOrigin "direct".
 *
 * @body
 * doctorName | clinicName (one required), contact (required),
 * email, city, state, address, enquiry, remarks,
 * contactByEmployeeId (existing employee) OR contactBy (custom "Other" name);
 * neither → "Vithal Sir"
 *
 * @response
 * 201 { success: true, data: Client }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 401 - UNAUTHORIZED
 * 403 - FORBIDDEN
 * 409 - CONTACT_ALREADY_EXISTS
 */
export const createClient = asyncHandler(async (req, res) => {
  const actingEmployee = await assertRole(req, CLIENT_CREATOR_ROLES, CLIENT_CREATOR_MESSAGE);
  const data = await svc.createClient(req.body, actingEmployee);
  sendCreated(res, { data });
});

/**
 * @function linkInvoice
 *
 * @route PATCH /api/leads/:id/link-invoice
 *
 * @description
 * Attach an EXISTING invoice to a client (both directions: invoice.leadId/clientId
 * and the client's invoices[] list with who created it). New invoices raised from
 * a client are linked automatically by createInvoice. Agents can only link their own clients.
 *
 * @body
 * invoiceId (required) — invoice _id or its invoiceId UUID
 *
 * @response
 * 200 { success: true, data: Client }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - CLIENT_NOT_FOUND / INVOICE_NOT_FOUND
 */
export const linkInvoice = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try {
      requestingUser = await asvc.resolveActingEmployee(req.user.email);
    } catch {
      requestingUser = null;
    }
  }
  const data = await svc.linkInvoice(req.params.id, req.body.invoiceId, requestingUser);
  sendSuccess(res, { data });
});

const resolveRequestingUser = async (req) => {
  if (!req.user?.email) return null;
  try {
    return await asvc.resolveActingEmployee(req.user.email);
  } catch {
    return null;
  }
};

/**
 * @function searchClients
 *
 * @route GET /api/leads/clients/search?q=rmesh&limit=20
 *
 * @description
 * The "Select Client" dropdown of the "Create Invoice" page. Fuzzy search: finds a match even with
 * spelling mistakes (name, clinic, phone, client id, city). Agents only see their own clients.
 * Empty q -> the 20 most recent clients.
 *
 * @response
 * 200 { success: true, data: [Client] }
 */
export const searchClients = asyncHandler(async (req, res) => {
  const requestingUser = await resolveRequestingUser(req);
  const data = await svc.searchClients(req.query.q || "", requestingUser, req.query.limit);
  sendSuccess(res, { data });
});

/**
 * @function getClientProfile
 *
 * @route GET /api/leads/:id/profile
 *
 * @description
 * Client Profile page: client details, summary (billed / paid / due / overdue / refund pending),
 * all invoices (live), follow-ups and timeline. An agent can only open clients assigned to them.
 *
 * @response
 * 200 { success: true, data: { client, summary, invoices, followups, assignmentHistory, timeline } }
 *
 * @errors
 * 400 - Invalid client id
 * 404 - Client not found / not assigned to you
 */
export const getClientProfile = asyncHandler(async (req, res) => {
  const requestingUser = await resolveRequestingUser(req);
  const data = await svc.getClientProfile(req.params.id, requestingUser);
  sendSuccess(res, { data });
});

export const distributeUnassigned = asyncHandler(async (req, res) => {
  const result = await asvc.distributeUnassignedLeads(req);
  sendSuccess(res, { data: result });
});

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
  sendSuccess(res, { data: result });
});

export const handleDeparture = asyncHandler(async (req, res) => {
  const actingEmployee = await assertAdmin(req);
  const { mode, targetEmployeeId, reason } = req.body;
  const result = await asvc.handleAgentDeparture(
    req.params.employeeId,
    mode,
    { targetEmployeeId, reason },
    actingEmployee
  );
  sendSuccess(res, { data: result });
});

// TODO(team, 2026-11-01): leads are not rebalanced automatically when a new agent is created.
// To add it, call asvc.rebalanceUntouchedLeads(null) (best-effort, in a try/catch with a log)
// at the end of createEmployee in controllers/employee/employee.controller.js.

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
  sendSuccess(res, { data });
});

/**
 * @function getAgentPerformance
 *
 * @route GET /api/leads/admin/agent-performance?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * @description
 * Admin / Super Admin only. Per agent for the period: clients won, products sold, invoices created /
 * paid, money received. No incentive % here: the admin decides it from the paid amount.
 * Default period: the 1st of this month until today.
 *
 * @response
 * 200 { success: true, data: { range, totals, agents: [...] } }
 *
 * @errors
 * 401 - Not authenticated
 * 403 - Only Admin/Super Admin
 */
export const getAgentPerformance = asyncHandler(async (req, res) => {
  await assertAdmin(req);
  const data = await psvc.getAgentPerformance(req.query);
  sendSuccess(res, { data });
});

/**
 * @function getAgentPerformanceDetail
 *
 * @route GET /api/leads/admin/agent-performance/:employeeId?from=&to=
 *
 * @description
 * Admin / Super Admin only. One agent's invoices (status / paid / due / products), the product
 * breakdown, and the clients won in the period.
 *
 * @response
 * 200 { success: true, data: { range, agent, summary, invoices, products, newClients } }
 */
export const getAgentPerformanceDetail = asyncHandler(async (req, res) => {
  await assertAdmin(req);
  const data = await psvc.getAgentPerformanceDetail(req.params.employeeId, req.query);
  sendSuccess(res, { data });
});

export const getLeadsByAgent = asyncHandler(async (req, res) => {
  await assertAdmin(req);
  const result = await svc.getLeadsByAgent(req.params.employeeId, req.query);
  sendSuccess(res, { legacyTopLevel: result });
});

/* ─ Debug (temporary) ──────────────────────────────────────────────────── */

// TODO(team, 2026-11-01): the two debug endpoints below were added "temporarily" and are open to
// every logged-in employee. Remove them (and their routes) once they are no longer needed.

/**
 * GET /api/v1/leads/debug/unassigned-count: how many leads have no agent.
 * Response keeps the old top-level keys next to `data`.
 */
export const getUnassignedCountDebug = asyncHandler(async (req, res) => {
  const counts = await svc.getUnassignedCountsDebug();
  sendSuccess(res, { legacyTopLevel: counts });
});

/**
 * GET /api/v1/leads/debug/agents: the active agents that leads can be assigned to.
 * Response keeps the old top-level keys next to `data`.
 */
export const getActiveAgentsDebug = asyncHandler(async (req, res) => {
  const agents = await svc.getActiveAgentsDebug();
  sendSuccess(res, { legacyTopLevel: { count: agents.length, agents } });
});
