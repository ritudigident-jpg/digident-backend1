/**
 * Salary profiles: monthly base salary with an effective-from date and full revision history.
 * Only reachable through routes guarded by payroll.salary.read / payroll.salary.update.
 * Changes are audited (who, when, effective date - the amount itself is not copied into the
 * audit feed because that feed is visible to admins without salary access).
 *
 * Exports: salaryForMonthPaise, getSalaryProfileService, updateSalaryProfileService, loadSalaryProfiles
 * Used by: services/payroll/payroll.service.js, controllers/payroll/payroll.controller.js
 */
import mongoose from "mongoose";
import SalaryProfile from "../../models/salaryprofile.model.js";
import { monthBounds } from "../../helpers/istdate.helper.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";
import { findActiveEmployeeById, employeeDisplayName } from "../employee/employeelookup.service.js";
import { paiseToRupees, rupeesToPaise } from "./payrollcalculator.js";

/** Sort order: latest effective date first, then latest change first. */
const newestRevisionFirst = (left, right) =>
  right.effectiveFrom.localeCompare(left.effectiveFrom) || new Date(right.changedAt) - new Date(left.changedAt);

/**
 * The revision in force for a month: the latest effectiveFrom on or before the month's last day.
 * Example: revisions from 2026-04-01 (25,000) and 2026-10-15 (28,000) -> October: 28,000; September: 25,000.
 *
 * @param {object | null} profile SalaryProfile (lean)
 * @param {number} year
 * @param {number} month
 * @returns {{ baseSalaryPaise: number, revision: object | null }}
 */
export const salaryForMonthPaise = (profile, year, month) => {
  const { to } = monthBounds(year, month);
  const applicable = (profile?.revisions || [])
    .filter((revision) => revision.effectiveFrom <= to)
    .sort(newestRevisionFirst)[0];
  return { baseSalaryPaise: applicable?.baseSalaryPaise || 0, revision: applicable || null };
};

/**
 * Salary profiles for many employees, keyed by employee id.
 *
 * @param {Array<*>} employeeIds
 * @returns {Promise<Map<string, object>>}
 */
export const loadSalaryProfiles = async (employeeIds) => {
  const profiles = await SalaryProfile.find({ employee: { $in: employeeIds } }).lean();
  return new Map(profiles.map((profile) => [profile.employee.toString(), profile]));
};

const toPublicRevision = (revision) => ({
  revisionId: revision._id,
  baseSalary: paiseToRupees(revision.baseSalaryPaise),
  effectiveFrom: revision.effectiveFrom,
  note: revision.note,
  changedBy: revision.changedBy,
  changedAt: revision.changedAt,
});

/**
 * An employee's salary profile with the current salary and history (newest first).
 *
 * @param {string} employeeId
 * @param {{ _id: *, email: string }} actor
 * @param {{ audit?: boolean }} [options] audit: false when called right after an update
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 */
export const getSalaryProfileService = async (employeeId, actor, { audit = true } = {}) => {
  const employee = await findActiveEmployeeById(employeeId);
  const profile = await SalaryProfile.findOne({ employee: employee._id })
    .populate("revisions.changedBy", "firstName lastName email")
    .lean();
  const revisions = [...(profile?.revisions || [])].sort(newestRevisionFirst);
  if (audit) {
    await writeHrAudit({
    actor,
    targetEmployeeId: employee._id,
    action: "salary.view",
    permission: PERMISSIONS.PAYROLL_READ,
    actionType: "view",
    });
  }
  return {
    employee: { _id: employee._id, name: employeeDisplayName(employee), email: employee.email },
    currentBaseSalary: revisions.length ? paiseToRupees(revisions[0].baseSalaryPaise) : null,
    revisions: revisions.map(toPublicRevision),
  };
};

/**
 * Adds a salary revision. Example: { baseSalary: 28000, effectiveFrom: "2026-10-01", note: "Appraisal" }.
 * A revision effective inside a finalized month does not change that month's snapshot; re-open the
 * month to apply it.
 *
 * @param {string} employeeId
 * @param {{ baseSalary: number, effectiveFrom: string, note?: string }} input
 * @param {{ _id: *, email: string }} actor
 * @returns {Promise<object>} the updated profile
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 */
export const updateSalaryProfileService = async (employeeId, { baseSalary, effectiveFrom, note = "" }, actor) => {
  const employee = await findActiveEmployeeById(employeeId);
  const revision = {
    _id: new mongoose.Types.ObjectId(),
    baseSalaryPaise: rupeesToPaise(baseSalary),
    effectiveFrom,
    note,
    changedBy: actor._id,
    changedAt: new Date(),
  };
  await SalaryProfile.updateOne(
    { employee: employee._id },
    { $push: { revisions: revision }, $setOnInsert: { employee: employee._id } },
    { upsert: true, runValidators: true }
  );
  await writeHrAudit({
    actor,
    targetEmployeeId: employee._id,
    action: "salary.update",
    permission: PERMISSIONS.PAYROLL_UPDATE,
    details: { effectiveFrom, revisionId: String(revision._id), note },
  });
  return getSalaryProfileService(employeeId, actor, { audit: false });
};
