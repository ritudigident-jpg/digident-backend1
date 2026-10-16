/**
 * HTTP handlers for payroll: settings, monthly list, employee detail, my salary, finalize /
 * re-open, salary profiles and extra-time approval. Read the request, call the service, send the
 * response. Permissions are checked in routes/payroll.routes.js.
 *
 * Used by: routes/payroll.routes.js
 */
import { sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  finalizeMonthService,
  getEmployeePayrollService,
  getMySalaryService,
  listPayrollMonthsService,
  listPayrollService,
  reopenMonthService,
  setExtraApprovalService,
} from "../../services/payroll/payroll.service.js";
import { getPayrollSettingsService, updatePayrollSettingsService } from "../../services/payroll/payrollsettings.service.js";
import { getSalaryProfileService, updateSalaryProfileService } from "../../services/payroll/salaryprofile.service.js";

/** GET /payroll/settings */
export const getPayrollSettings = asyncHandler(async (req, res) => {
  const data = await getPayrollSettingsService();
  return sendSuccess(res, { data, message: "Payroll settings fetched" });
});

/** PUT /payroll/settings */
export const updatePayrollSettings = asyncHandler(async (req, res) => {
  const data = await updatePayrollSettingsService(req.body, req.currentUser);
  return sendSuccess(res, { data: { settings: data }, message: "Payroll settings updated" });
});

/** GET /payroll?month&year&search&page&limit - rows in data, month state and totals in meta-like fields. */
export const listPayroll = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 20, maxLimit: 200 });
  const { items, total, month, summary } = await listPayrollService({ ...req.query, ...pagination });
  return sendPaginated(res, {
    data: items,
    pagination: { ...pagination, total },
    message: "Payroll fetched",
    legacyTopLevel: { month, summary },
  });
});

/** GET /payroll/months?year */
export const listPayrollMonths = asyncHandler(async (req, res) => {
  const data = await listPayrollMonthsService(req.query.year);
  return sendSuccess(res, { data, message: "Payroll months fetched" });
});

/** GET /payroll/employee/:employeeId?month&year */
export const getEmployeePayroll = asyncHandler(async (req, res) => {
  const data = await getEmployeePayrollService({ employeeId: req.params.employeeId, ...req.query });
  return sendSuccess(res, { data, message: "Employee payroll fetched" });
});

/** GET /payroll/my-salary?month&year - only the logged-in employee's own data. */
export const getMySalary = asyncHandler(async (req, res) => {
  const data = await getMySalaryService(req.user, req.query.month, req.query.year);
  return sendSuccess(res, { data, message: "Salary fetched" });
});

/** POST /payroll/finalize { month, year, force? } */
export const finalizeMonth = asyncHandler(async (req, res) => {
  const data = await finalizeMonthService(req.currentUser, req.body);
  return sendSuccess(res, { data, message: `Payroll ${data.monthKey} finalized` });
});

/** POST /payroll/reopen { month, year, reason } */
export const reopenMonth = asyncHandler(async (req, res) => {
  const data = await reopenMonthService(req.currentUser, req.body);
  return sendSuccess(res, { data, message: `Payroll ${data.monthKey} re-opened` });
});

/** GET /payroll/salary-profile/:employeeId */
export const getSalaryProfile = asyncHandler(async (req, res) => {
  const data = await getSalaryProfileService(req.params.employeeId, req.currentUser);
  return sendSuccess(res, { data, message: "Salary profile fetched" });
});

/** PUT /payroll/salary-profile/:employeeId { baseSalary, effectiveFrom, note? } */
export const updateSalaryProfile = asyncHandler(async (req, res) => {
  const data = await updateSalaryProfileService(req.params.employeeId, req.body, req.currentUser);
  return sendSuccess(res, { data, message: "Salary updated" });
});

/** PATCH /payroll/extra/:attendanceId { approved } */
export const setExtraApproval = asyncHandler(async (req, res) => {
  const data = await setExtraApprovalService(req.currentUser, req.params.attendanceId, req.body.approved);
  return sendSuccess(res, { data, message: data.extraApproved ? "Extra time approved" : "Extra time approval removed" });
});
