/**
 * Monthly payroll for all employees, one employee's day-by-day breakdown, "my salary", and
 * finalize / re-open. All numbers come from services/payroll/payrollcalculator.js (the frontend
 * never calculates salary).
 *
 *   - An OPEN month is LIVE: computed on every request from attendance, leave, holidays, settings
 *     and the salary in force for that month.
 *   - FINALIZE writes an immutable PayrollSnapshot per employee (new version) and locks the month:
 *     changes that would alter it are refused (payrolllock.service.js) and screens read the snapshot.
 *   - RE-OPEN unlocks it (reason required, audited); the old snapshot versions are kept.
 *
 * Exports: listPayrollService, getEmployeePayrollService, getMySalaryService, finalizeMonthService,
 * reopenMonthService, listPayrollMonthsService, setExtraApprovalService
 * Used by: controllers/payroll/payroll.controller.js
 */
import mongoose from "mongoose";
import Employee from "../../models/employee.model.js";
import AttendanceDay from "../../models/attendanceday.model.js";
import { PayrollMonth, PayrollSnapshot } from "../../models/payrollmonth.model.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";
import { istDateKey, monthBounds, nowUtc } from "../../helpers/istdate.helper.js";
import { isDuplicateKeyError, runInTransaction } from "../../helpers/transaction.helper.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { loadMonthData } from "../attendance/monthdata.service.js";
import { resolveMonth } from "../attendance/calendar.service.js";
import { employeeDisplayName, findActiveEmployeeByEmail, findActiveEmployeeById } from "../employee/employeelookup.service.js";
import { calculateMonthlyPayroll, paiseToRupees } from "./payrollcalculator.js";
import { loadSalaryProfiles, salaryForMonthPaise } from "./salaryprofile.service.js";
import { assertMonthsOpen } from "./payrolllock.service.js";

const MONTH_KEY_LENGTH = 7;
const monthKeyOf = (year, month) => `${year}-${String(month).padStart(2, "0")}`;

/** Row of the payroll table: the calculator result without the day list. */
const toRow = (employee, result, extras = {}) => {
  const { days, netPayablePaise, ...totals } = result;
  return {
    employeeId: employee._id,
    employeeCode: extras.employeeCode || null,
    name: employeeDisplayName(employee),
    email: employee.email,
    role: employee.role,
    hasSalaryProfile: extras.hasSalaryProfile ?? true,
    ...totals,
  };
};

/**
 * Computes the live payroll of a set of employees for a month.
 *
 * @param {Array<object>} employees lean Employee documents
 * @param {number} year
 * @param {number} month
 * @returns {Promise<Array<{ employee: object, result: object, hasSalaryProfile: boolean, revision: object | null }>>}
 */
const computeLive = async (employees, year, month) => {
  if (!employees.length) return [];
  const ids = employees.map((employee) => employee._id);
  const [monthData, salaryProfiles] = await Promise.all([loadMonthData({ year, month, employeeIds: ids }), loadSalaryProfiles(ids)]);
  const todayKey = istDateKey(nowUtc());
  return employees.map((employee) => {
    const data = monthData.byEmployee.get(String(employee._id));
    const profile = salaryProfiles.get(String(employee._id)) || null;
    const { baseSalaryPaise, revision } = salaryForMonthPaise(profile, year, month);
    const result = calculateMonthlyPayroll({
      year,
      month,
      todayKey,
      settings: monthData.settings,
      holidays: monthData.holidays,
      baseSalaryPaise,
      employeeShiftMinutes: data.employeeShiftMinutes || null,
      joiningDate: data.joiningDate || null,
      attendanceDays: data.attendanceDays,
      leaveDays: data.leaveDays,
      pendingLeaveDays: data.pendingLeaveDays,
    });
    return { employee, result, hasSalaryProfile: Boolean(revision), revision };
  });
};

/** Active employees matching an optional search, sorted by name. */
const findPayrollEmployees = async (search) => {
  const filter = { isDeleted: false };
  if (search) {
    const pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }];
  }
  return Employee.find(filter).select("_id firstName lastName email role").sort({ firstName: 1, lastName: 1 }).lean();
};

const monthState = async (year, month) => {
  const record = await PayrollMonth.findOne({ monthKey: monthKeyOf(year, month) })
    .populate("finalizedBy", "firstName lastName email")
    .lean();
  return {
    monthKey: monthKeyOf(year, month),
    status: record?.status || "OPEN",
    version: record?.version || 0,
    finalizedAt: record?.finalizedAt || null,
    finalizedBy: record?.finalizedBy || null,
    isLive: (record?.status || "OPEN") !== "FINALIZED",
    events: record?.events || [],
  };
};

const sumRupees = (rows, key) => Math.round(rows.reduce((sum, row) => sum + Math.round((row[key] || 0) * 100), 0)) / 100;

/**
 * Payroll table for a month: one row per employee, paginated, with totals over all rows.
 * Live for an OPEN month, from the snapshot for a FINALIZED one.
 *
 * @param {{ month?: number, year?: number, search?: string, page: number, limit: number, skip: number }} query
 * @returns {Promise<{ month: object, summary: object, items: object[], total: number }>}
 */
export const listPayrollService = async ({ month, year, search, skip, limit }) => {
  const resolved = resolveMonth(month, year);
  const state = await monthState(resolved.year, resolved.month);
  let rows;
  if (state.isLive) {
    const employees = await findPayrollEmployees(search);
    rows = (await computeLive(employees, resolved.year, resolved.month)).map(({ employee, result, hasSalaryProfile }) =>
      toRow(employee, result, { hasSalaryProfile })
    );
  } else {
    const filter = { monthKey: state.monthKey, version: state.version };
    if (search) {
      const pattern = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ employeeName: pattern }, { employeeEmail: pattern }];
    }
    const snapshots = await PayrollSnapshot.find(filter).sort({ employeeName: 1 }).lean();
    rows = snapshots.map((snapshot) => snapshot.data.row);
  }
  const summary = {
    employees: rows.length,
    totalBase: sumRupees(rows, "baseSalary"),
    totalDeductions: sumRupees(rows, "totalDeductions"),
    totalExtraPay: sumRupees(rows, "extraPay"),
    totalNetPayable: sumRupees(rows, "netPayable"),
    pendingDays: rows.reduce((sum, row) => sum + (row.pendingDays || 0), 0),
    withoutSalaryProfile: rows.filter((row) => !row.hasSalaryProfile).length,
  };
  return { month: { ...resolved, ...state }, summary, items: rows.slice(skip, skip + limit), total: rows.length };
};

/**
 * One employee's payroll for a month with the day-by-day breakdown. `period` holds the month's
 * finalize state ({ monthKey, status, version, isLive }); `month` / `year` are the numbers.
 *
 * @param {{ employeeId: string, month?: number, year?: number }} input
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 */
export const getEmployeePayrollService = async ({ employeeId, month, year }) => {
  const resolved = resolveMonth(month, year);
  const state = await monthState(resolved.year, resolved.month);
  if (!state.isLive) {
    const snapshot = await PayrollSnapshot.findOne({
      monthKey: state.monthKey,
      version: state.version,
      employee: new mongoose.Types.ObjectId(String(employeeId)),
    }).lean();
    if (snapshot) return { ...snapshot.data.detail, period: { ...resolved, ...state } };
  }
  const employee = await findActiveEmployeeById(employeeId);
  const [{ result, hasSalaryProfile, revision }] = await computeLive([employee], resolved.year, resolved.month);
  return {
    period: { ...resolved, ...state, isLive: true },
    employee: { _id: employee._id, name: employeeDisplayName(employee), email: employee.email, role: employee.role },
    hasSalaryProfile,
    salaryRevision: revision
      ? { baseSalary: paiseToRupees(revision.baseSalaryPaise), effectiveFrom: revision.effectiveFrom }
      : null,
    ...result,
  };
};

/**
 * The logged-in employee's own payroll (never anyone else's). Future months are refused.
 *
 * @param {{ email: string }} user
 * @param {*} [month]
 * @param {*} [year]
 * @returns {Promise<object>}
 * @throws {BadRequestError} 400 INVALID_MONTH for a future month
 */
export const getMySalaryService = async (user, month, year) => {
  const resolved = resolveMonth(month, year);
  if (monthKeyOf(resolved.year, resolved.month) > istDateKey(nowUtc()).slice(0, MONTH_KEY_LENGTH)) {
    throw new BadRequestError("Salary is not available for a future month", { code: ERROR_CODES.INVALID_MONTH });
  }
  const employee = await findActiveEmployeeByEmail(user.email);
  return getEmployeePayrollService({ employeeId: employee._id, ...resolved });
};

/**
 * Finalizes a month: computes every employee's payroll and stores immutable snapshots (version + 1),
 * then locks the month. Refused while the month has not ended, and while there are pending days
 * (missing punch-outs, pending corrections or leave) unless force is true.
 *
 * @param {{ _id: *, email: string }} actor
 * @param {{ month: number, year: number, force?: boolean }} input
 * @returns {Promise<object>} month state and summary
 * @throws {BadRequestError} 400 INVALID_MONTH (month not over)
 * @throws {ConflictError} 409 MONTH_FINALIZED / PAYROLL_PENDING_ITEMS
 */
export const finalizeMonthService = async (actor, { month, year, force = false }) => {
  const resolved = resolveMonth(month, year);
  const monthKey = monthKeyOf(resolved.year, resolved.month);
  const { to } = monthBounds(resolved.year, resolved.month);
  if (istDateKey(nowUtc()) <= to) {
    throw new BadRequestError("A month can be finalized only after its last day", { code: ERROR_CODES.INVALID_MONTH });
  }
  const state = await monthState(resolved.year, resolved.month);
  if (!state.isLive) throw new ConflictError(`${monthKey} is already finalized`, { code: ERROR_CODES.MONTH_FINALIZED });

  const { from } = monthBounds(resolved.year, resolved.month);
  const activeEmployees = await findPayrollEmployees();
  const attendedIds = await AttendanceDay.distinct("employee", { date: { $gte: from, $lte: to } });
  const knownIds = new Set(activeEmployees.map((employee) => String(employee._id)));
  const formerEmployees = await Employee.find({ _id: { $in: attendedIds.filter((id) => !knownIds.has(String(id))) } })
    .select("_id firstName lastName email role")
    .lean();
  const computed = await computeLive([...activeEmployees, ...formerEmployees], resolved.year, resolved.month);

  const pending = computed.filter(({ result }) => result.pendingDays > 0);
  if (pending.length && !force) {
    throw new ConflictError(`${pending.length} employee(s) have pending days (missing punch-out or pending leave)`, {
      code: ERROR_CODES.PAYROLL_PENDING_ITEMS,
      details: pending.map(({ employee, result }) => ({ field: employeeDisplayName(employee), message: `${result.pendingDays} pending day(s)` })),
    });
  }

  const version = state.version + 1;
  const finalizedAt = nowUtc();
  await runInTransaction(async (session) => {
    const locked = await PayrollMonth.findOneAndUpdate(
      { monthKey, status: { $ne: "FINALIZED" }, version: state.version },
      {
        $set: { status: "FINALIZED", version, finalizedAt, finalizedBy: actor._id },
        $push: { events: { action: "FINALIZE", version, by: actor._id, at: finalizedAt, reason: force ? "forced with pending days" : "" } },
      },
      { upsert: true, new: true, session }
    );
    if (!locked) throw new ConflictError(`${monthKey} was finalized by someone else`, { code: ERROR_CODES.MONTH_FINALIZED });
    await PayrollSnapshot.insertMany(
      computed.map(({ employee, result, hasSalaryProfile, revision }) => ({
        monthKey,
        version,
        employee: employee._id,
        employeeName: employeeDisplayName(employee),
        employeeEmail: employee.email,
        netPayablePaise: result.netPayablePaise,
        data: {
          row: toRow(employee, result, { hasSalaryProfile }),
          detail: {
            employee: { _id: employee._id, name: employeeDisplayName(employee), email: employee.email, role: employee.role },
            hasSalaryProfile,
            salaryRevision: revision ? { baseSalary: paiseToRupees(revision.baseSalaryPaise), effectiveFrom: revision.effectiveFrom } : null,
            ...result,
          },
        },
      })),
      { session }
    );
  }).catch((error) => {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError(`${monthKey} was finalized by someone else`, { code: ERROR_CODES.MONTH_FINALIZED });
    }
    throw error;
  });

  await writeHrAudit({
    actor,
    action: "payroll.finalize",
    permission: PERMISSIONS.PAYROLL_FINALIZE,
    details: { monthKey, version, employees: computed.length, forced: Boolean(force && pending.length) },
  });
  return { monthKey, status: "FINALIZED", version, finalizedAt, employees: computed.length };
};

/**
 * Re-opens a finalized month (reason required). Snapshots stay; the month becomes live again.
 *
 * @param {{ _id: *, email: string }} actor
 * @param {{ month: number, year: number, reason: string }} input
 * @returns {Promise<object>}
 * @throws {ConflictError} 409 MONTH_NOT_FINALIZED
 */
export const reopenMonthService = async (actor, { month, year, reason }) => {
  const resolved = resolveMonth(month, year);
  const monthKey = monthKeyOf(resolved.year, resolved.month);
  const current = await PayrollMonth.findOne({ monthKey, status: "FINALIZED" }).select("version").lean();
  if (!current) throw new ConflictError(`${monthKey} is not finalized`, { code: ERROR_CODES.MONTH_NOT_FINALIZED });
  const reopened = await PayrollMonth.findOneAndUpdate(
    { monthKey, status: "FINALIZED", version: current.version },
    { $set: { status: "OPEN" }, $push: { events: { action: "REOPEN", version: current.version, by: actor._id, at: nowUtc(), reason } } },
    { new: true }
  ).lean();
  if (!reopened) throw new ConflictError(`${monthKey} is not finalized`, { code: ERROR_CODES.MONTH_NOT_FINALIZED });
  await writeHrAudit({
    actor,
    action: "payroll.reopen",
    permission: PERMISSIONS.PAYROLL_FINALIZE,
    details: { monthKey, version: reopened.version, reason },
  });
  return { monthKey, status: "OPEN", version: reopened.version };
};

/**
 * Finalize state of every month of a year (for the month picker).
 *
 * @param {number} year
 * @returns {Promise<Array<{ monthKey, status, version, finalizedAt }>>}
 */
export const listPayrollMonthsService = async (year) => {
  const records = await PayrollMonth.find({ monthKey: { $regex: `^${Number(year)}-` } })
    .select("monthKey status version finalizedAt")
    .sort({ monthKey: 1 })
    .lean();
  return records;
};

/**
 * Approves (or withdraws approval of) extra time on one attendance day. Only matters when
 * settings.extraRequiresApproval is on.
 *
 * @param {{ _id: *, email: string }} actor
 * @param {string} attendanceId
 * @param {boolean} approved
 * @returns {Promise<{ attendanceId, date, extraApproved }>}
 * @throws {NotFoundError} 404 RECORD_NOT_FOUND
 * @throws {ConflictError} 409 MONTH_FINALIZED
 */
export const setExtraApprovalService = async (actor, attendanceId, approved) => {
  const day = await AttendanceDay.findById(attendanceId).select("date employee").lean();
  if (!day) throw new NotFoundError("Attendance day not found", { code: ERROR_CODES.RECORD_NOT_FOUND });
  await assertMonthsOpen([day.date]);
  await AttendanceDay.updateOne({ _id: attendanceId }, { $set: { extraApproved: approved, extraApprovedBy: approved ? actor._id : null } });
  await writeHrAudit({
    actor,
    targetEmployeeId: day.employee,
    action: approved ? "payroll.extra.approve" : "payroll.extra.unapprove",
    permission: PERMISSIONS.PAYROLL_UPDATE,
    details: { date: day.date },
  });
  return { attendanceId, date: day.date, extraApproved: approved };
};
