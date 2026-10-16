/**
 * Routes for employee attendance: punch-in / punch-out, today's status, calendar, leave, holidays,
 * punch-out corrections and admin approvals. Mounted at /api/v1/attendance (listed in
 * docs/ENDPOINTS.md). Every pre-existing path and method is unchanged; new ones are added.
 *
 * Access: employee routes need a login (auth). Admin routes keep checkAdminRole (Super Admin /
 * Admin) as before; new admin routes use requirePermission with a permission fixed on the server
 * (constants/permissions.constant.js).
 *
 * Used by: app.js
 */
import express from "express";
import {
  punchIn,
  punchOut,
  getTodayStatus,
  sendPunchOutRequest,
  getAllAttendances,
  getMyAttendances,
  getMyCalendar,
  getAttendanceApprovalsByStatus,
  requestLeave,
  getAllLeaveRequestsForAdmin,
  getAllPunchOutRequestsForAdmin,
  updatePunchOutRequestStatus,
  updateLeaveRequestStatus,
  cancelLeaveRequest,
  getMyAttendanceStats,
  getMyLeaveRequests,
  getMyPunchOutRequests,
  getLeaveRequestById,
  getLeaveBalance,
  overrideLeavePaid,
  getTeamLeaveCalendar,
  getHolidays,
  createHoliday,
  listHolidaysForAdmin,
  updateHoliday,
  deleteHoliday,
} from "../controllers/attendance/attendance.controller.js";
import {
  approvalIdParamsSchema,
  createHolidaySchema,
  decisionSchema,
  leaveOverrideSchema,
  leaveRequestSchema,
  listQuerySchema,
  monthQuerySchema,
  punchOutRequestSchema,
  updateHolidaySchema,
} from "../controllers/attendance/attendance.validator.js";
import auth from "../middlewares/auth.middleware.js";
import checkAdminRole from "../middlewares/adminrole.middleware.js";
import { attachCurrentEmployee, requirePermission } from "../middlewares/permission.middleware.js";
import { validate, validateObjectIdParams } from "../middlewares/validate.middleware.js";
import { PERMISSIONS } from "../constants/permissions.constant.js";

const router = express.Router();

/* ================= EMPLOYEE ROUTES ================= */
router.post("/punch-in", auth, punchIn);
router.post("/punch-out", auth, punchOut);
router.get("/today", auth, getTodayStatus);
router.post("/punch-out/request", auth, validate(punchOutRequestSchema), sendPunchOutRequest);
router.get("/my-punchout-requests", auth, getMyPunchOutRequests);
router.get("/my-attendance", auth, validate(listQuerySchema, "query"), getMyAttendances);
router.get("/my-calendar", auth, validate(monthQuerySchema, "query"), getMyCalendar);
router.get("/my-dashboard", auth, validate(monthQuerySchema, "query"), getMyAttendanceStats);
router.post("/leave-request", auth, validate(leaveRequestSchema), requestLeave);
router.get("/my-leave-requests", auth, validate(listQuerySchema, "query"), getMyLeaveRequests);
router.get("/leave-balance", auth, validate(monthQuerySchema, "query"), getLeaveBalance);
router.get("/leave-request/:approvalId", auth, attachCurrentEmployee, validate(approvalIdParamsSchema, "params"), getLeaveRequestById);
// Cancel own pending leave (DELETE kept for older screens; POST .../cancel is the new form)
router.delete("/leave-request/:approvalId", auth, validate(approvalIdParamsSchema, "params"), cancelLeaveRequest);
router.post("/leave-request/:approvalId/cancel", auth, validate(approvalIdParamsSchema, "params"), cancelLeaveRequest);
router.get("/holidays", auth, validate(listQuerySchema, "query"), getHolidays);

/* ================= ADMIN ROUTES ================= */
router.get("/admin/attendances", auth, checkAdminRole, validate(listQuerySchema, "query"), getAllAttendances);
router.get("/admin/attendance-approvals/filter", auth, checkAdminRole, validate(listQuerySchema, "query"), getAttendanceApprovalsByStatus);
router.post("/admin/attendance-approvals/filter", auth, checkAdminRole, getAttendanceApprovalsByStatus);
router.get("/admin/leave-requests", auth, checkAdminRole, validate(listQuerySchema, "query"), getAllLeaveRequestsForAdmin);
router.get("/admin/punchout-requests", auth, checkAdminRole, validate(listQuerySchema, "query"), getAllPunchOutRequestsForAdmin);
router.post(
  "/admin/punchout-requests/action/:approvalId",
  auth,
  checkAdminRole,
  validate(decisionSchema),
  updatePunchOutRequestStatus
);
router.post("/admin/leave-requests/action/:approvalId", auth, checkAdminRole, validate(decisionSchema), updateLeaveRequestStatus);
router.patch(
  "/admin/leave-requests/:approvalId/paid",
  auth,
  requirePermission(PERMISSIONS.PAYROLL_UPDATE),
  validate(leaveOverrideSchema),
  overrideLeavePaid
);
router.get(
  "/admin/team-leaves",
  auth,
  requirePermission(PERMISSIONS.TEAM_ATTENDANCE_READ),
  validate(listQuerySchema, "query"),
  getTeamLeaveCalendar
);

/* ---------------- Holidays ---------------- */
router.post("/admin/holiday", auth, checkAdminRole, validate(createHolidaySchema), createHoliday);
router.get(
  "/admin/holidays",
  auth,
  requirePermission(PERMISSIONS.HOLIDAY_MANAGE),
  validate(listQuerySchema, "query"),
  listHolidaysForAdmin
);
router.put(
  "/admin/holiday/:holidayId",
  auth,
  requirePermission(PERMISSIONS.HOLIDAY_MANAGE),
  validateObjectIdParams("holidayId"),
  validate(updateHolidaySchema),
  updateHoliday
);
router.delete(
  "/admin/holiday/:holidayId",
  auth,
  requirePermission(PERMISSIONS.HOLIDAY_MANAGE),
  validateObjectIdParams("holidayId"),
  deleteHoliday
);

export default router;
