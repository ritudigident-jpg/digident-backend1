/**
 * writeHrAudit(): one line in the existing audit log feed (PermissionAudit collection, shown on the
 * frontend's Security Audit Logs) for HR events: salary changes, bank detail changes, sensitive
 * field reveals, document views / downloads / verifications, payroll finalize / re-open, leave
 * paid overrides. Best-effort: a failed audit write is logged and never fails the request.
 * Never put secrets or full sensitive values in `details`.
 *
 * Example:
 *   await writeHrAudit({ actor: req.currentUser, targetEmployeeId, action: "salary.update",
 *     permission: "payroll.salary.update", details: { effectiveFrom: "2026-10-01" } });
 *
 * Used by: services/payroll/*, services/employeeprofile/*, services/attendance/leave.service.js
 */
import { v6 as uuidv6 } from "uuid";
import { PermissionAudit } from "../models/permissionaudit.model.js";
import { logger } from "./logger.helper.js";

/**
 * @param {object} entry
 * @param {{ _id: *, email: string }} entry.actor
 * @param {*} [entry.targetEmployeeId]
 * @param {string} entry.action short dotted name, e.g. "document.download"
 * @param {string} entry.permission permission used
 * @param {string} [entry.actionType] "view" | "update" | "create" | "delete"
 * @param {object} [entry.details]
 * @returns {Promise<void>}
 */
export const writeHrAudit = async ({ actor, targetEmployeeId = null, action, permission, actionType = "update", details = null }) => {
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: actor._id,
      actionByEmail: actor.email,
      actionFor: targetEmployeeId,
      action,
      permission,
      actionType,
      details,
    });
  } catch (error) {
    logger.error("HR audit write failed", { action, error });
  }
};
