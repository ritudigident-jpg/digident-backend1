/**
 * Routes for payroll. Mounted at /api/v1/payroll (listed in docs/ENDPOINTS.md).
 * Every route needs a login; the admin routes check a permission fixed here on the server.
 * GET /my-salary only ever returns the caller's own data.
 *
 * Used by: app.js
 */
import express from "express";
import auth from "../middlewares/auth.middleware.js";
import { requirePermission } from "../middlewares/permission.middleware.js";
import { validate, validateObjectIdParams } from "../middlewares/validate.middleware.js";
import { PERMISSIONS } from "../constants/permissions.constant.js";
import {
  finalizeMonth,
  getEmployeePayroll,
  getMySalary,
  getPayrollSettings,
  getSalaryProfile,
  listPayroll,
  listPayrollMonths,
  reopenMonth,
  setExtraApproval,
  updatePayrollSettings,
  updateSalaryProfile,
} from "../controllers/payroll/payroll.controller.js";
import {
  extraApprovalSchema,
  finalizeSchema,
  monthOnlyQuerySchema,
  payrollListQuerySchema,
  payrollSettingsSchema,
  reopenSchema,
  salaryProfileSchema,
  yearQuerySchema,
} from "../controllers/payroll/payroll.validator.js";

const router = express.Router();
const { PAYROLL_READ, PAYROLL_UPDATE, PAYROLL_FINALIZE, PAYROLL_SETTINGS_UPDATE } = PERMISSIONS;

/* ---------------- Employee ---------------- */
router.get("/my-salary", auth, validate(monthOnlyQuerySchema, "query"), getMySalary);

/* ---------------- Admin ---------------- */
router.get("/settings", auth, requirePermission(PAYROLL_READ, PAYROLL_SETTINGS_UPDATE), getPayrollSettings);
router.put("/settings", auth, requirePermission(PAYROLL_SETTINGS_UPDATE), validate(payrollSettingsSchema), updatePayrollSettings);
router.get("/", auth, requirePermission(PAYROLL_READ), validate(payrollListQuerySchema, "query"), listPayroll);
router.get("/months", auth, requirePermission(PAYROLL_READ), validate(yearQuerySchema, "query"), listPayrollMonths);
router.get(
  "/employee/:employeeId",
  auth,
  requirePermission(PAYROLL_READ),
  validateObjectIdParams("employeeId"),
  validate(monthOnlyQuerySchema, "query"),
  getEmployeePayroll
);
router.post("/finalize", auth, requirePermission(PAYROLL_FINALIZE), validate(finalizeSchema), finalizeMonth);
router.post("/reopen", auth, requirePermission(PAYROLL_FINALIZE), validate(reopenSchema), reopenMonth);
router.get("/salary-profile/:employeeId", auth, requirePermission(PAYROLL_READ), validateObjectIdParams("employeeId"), getSalaryProfile);
router.put(
  "/salary-profile/:employeeId",
  auth,
  requirePermission(PAYROLL_UPDATE),
  validateObjectIdParams("employeeId"),
  validate(salaryProfileSchema),
  updateSalaryProfile
);
router.patch(
  "/extra/:attendanceId",
  auth,
  requirePermission(PAYROLL_UPDATE),
  validateObjectIdParams("attendanceId"),
  validate(extraApprovalSchema),
  setExtraApproval
);

export default router;
