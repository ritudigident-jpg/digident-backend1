import * as svc from "../services/lead.service.js";
import * as asvc from "../services/assignment.service.js";
import { ok, asyncHandler } from "../helpers/error.helper.js";

// constants/roles.js
export const ROLES = { SUPERADMIN: 0, ADMIN: 1, MANAGER: 2, EXECUTIVE: 3, AGENT: 4 };

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
  if (!email) return res.status(401).json({ success: false, message: "Unauthorized" }); // ← FIX
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