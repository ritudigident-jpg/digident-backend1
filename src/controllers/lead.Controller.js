import * as svc from "../services/lead.service.js";
import * as asvc from "../services/assignment.service.js";
import { ok, asyncHandler } from "../helpers/error.helper.js";

/* ─ CRUD Operations ──────────────────────────────────────────────────────── */

export const getAllLeads = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const result = await svc.getAllLeads(req.query, requestingUser);
  ok(res, result);
});

export const createLead = asyncHandler(async (req, res) => {
  const data = await svc.createLead(req.body, req.user?.email);
  ok(res, { data }, 201);
}, 400);

export const getLeadById = asyncHandler(async (req, res) => {
  const data = await svc.getLeadById(req.params.id);
  ok(res, { data });
});

export const updateLead = asyncHandler(async (req, res) => {
  const data = await svc.updateLead(req.params.id, req.body);
  ok(res, { data });
}, 400);

export const deleteLead = asyncHandler(async (req, res) => {
  await svc.deleteLead(req.params.id);
  ok(res, { message: "Deleted successfully" });
});

/* ─ Pipeline Actions ─────────────────────────────────────────────────────── */

export const moveToFollowup = asyncHandler(async (req, res) => {
  const data = await svc.moveToFollowup(req.params.id, req.body.reason);
  ok(res, { data });
}, 400);

export const moveToFlag = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.moveToFlag(req.params.id, req.body.reason, email);
  ok(res, { data });
}, 400);

export const incrementCallCount = asyncHandler(async (req, res) => {
  const data = await svc.incrementCallCount(req.params.id);
  ok(res, { data });
}, 400);

export const updateWhatsapp = asyncHandler(async (req, res) => {
  const data = await svc.updateWhatsapp(req.params.id, req.body);
  ok(res, { data });
}, 400);

export const logFollowUp = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.logFollowUp(req.params.id, req.params.stageType, email, req.body);
  ok(res, { data });
}, 400);

export const convertToClient = asyncHandler(async (req, res) => {
  const data = await svc.convertToClient(req.params.id);
  ok(res, { data });
}, 400);

export const logOrder = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  const data = await svc.logOrder(req.params.id, email, req.body);
  ok(res, { data });
}, 400);

export const logRemarkFollowUp = asyncHandler(async (req, res) => {
  const email = req.user?.email;
  if (!email) return err(res, "Unauthorized", 401);
  const data = await svc.logRemarkFollowUp(req.params.id, email, req.body);
  ok(res, { data }, 201);
}, 400);

/* ─ Dashboards & Filters ─────────────────────────────────────────────────── */

export const getDashboard = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const data = await svc.getDashboardStats(requestingUser);
  ok(res, { data });
});

export const getUpcomingFollowUps = asyncHandler(async (req, res) => {
  let requestingUser = null;
  if (req.user?.email) {
    try { requestingUser = await asvc.resolveActingEmployee(req.user.email); } catch { requestingUser = null; }
  }
  const data = await svc.getUpcomingFollowUps(req.query.daysAhead, requestingUser);
  ok(res, { data, count: data.length });
});

/* ─ Excel File Import ────────────────────────────────────────────────────── */

export const importExcel = asyncHandler(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }
  const results = await svc.importFromExcel(req.file.buffer);
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
  const actingEmployee = await assertAdmin(req);
  const result = await asvc.distributeUnassignedLeads(actingEmployee);
  ok(res, { data: result });
}, 400);

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