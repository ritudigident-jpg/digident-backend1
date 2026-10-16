/**
 * Business logic for permission definitions and assigning them to employees. Throws AppError
 * subclasses on failure.
 *
 * Exports: createPermissionService, getAllPermissionsService, deletePermissionService,
 * assignPermissionToEmployeeService, removePermissionFromEmployeeService,
 * getPermissionAuditLogsService, deleteAllPermissionsService
 * Used by: controllers/permission/permission.controller.js
 */

import Permission from "../../models/permission.model.js";
import Employee from "../../models/employee.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";
import { sendNotification } from "../notification/notification.service.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js"; // ← ADD THIS

/* =========================================================
   CREATE PERMISSION
========================================================= */
/**
 * Create permission.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const createPermissionService = async (data, currentUser) => {
  const { name } = data;

  /* ---------- AUTH CHECK ---------- */
  const admin = await Employee.findOne({ email: currentUser.email });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized");
  }

  /* ---------- DUPLICATE CHECK ---------- */
  const exists = await Permission.findOne({ name });
  if (exists) {
    throw new ConflictError("Permission already exists");
  }

  /* ---------- CREATE PERMISSION ---------- */
  const permission = await Permission.create({
    name,
    permissionId: uuidv6(),
    createdBy: admin._id,
  });

  /* ---------- AUTO ASSIGN TO SUPER ADMIN & ADMIN ---------- */
  await Employee.updateMany({ role: { $in: [0, 1] } }, { $addToSet: { permissions: name } });

  /* ---------- AUDIT LOG ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: admin._id,
    actionByEmail: admin.email,
    permission: permission.name,
    action: "create",
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "system.permission.create",
      title: "Permission Created",
      message: `Permission "${permission.name}" was created by ${admin.email}`,
      type: "PERMISSION_CREATED",
      entityId: permission._id,
      entityModel: "Permission",
      metadata: {
        permissionId: permission.permissionId,
        permissionName: permission.name,
        createdBy: admin.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on permission create", { error: err.message });
  }

  return permission;
};

/* =========================================================
   GET ALL PERMISSIONS
========================================================= */
/**
 * Get all permissions.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getAllPermissionsService = async ({ page, limit }) => {
  const [permissions, totalItems] = await Promise.all([
    Permission.find().sort({ createdAt: -1 }).limit(limit).lean(),
    Permission.countDocuments(),
  ]);

  if (!permissions.length) {
    throw new NotFoundError("No permissions found");
  }

  const totalPages = Math.ceil(totalItems / limit);

  return {
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
    count: permissions.length,
    permissions,
  };
};

/* =========================================================
   DELETE PERMISSION
========================================================= */
/**
 * Delete permission.
 *
 * @param {*} permissionId
 * @param {*} currentUser
 * @param {*} action
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deletePermissionService = async (permissionId, currentUser, action) => {
  /* ---------- AUTH CHECK ---------- */
  const admin = await Employee.findOne({ email: currentUser.email });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized");
  }

  /* ---------- FIND PERMISSION ---------- */
  const permission = await Permission.findOne({ permissionId });
  if (!permission) {
    throw new NotFoundError("Permission not found");
  }

  /* ---------- DELETE PERMISSION ---------- */
  await Permission.deleteOne({ permissionId });

  /* ---------- REMOVE FROM ALL EMPLOYEES ---------- */
  await Employee.updateMany({ permissions: permission.name }, { $pull: { permissions: permission.name } });

  /* ---------- AUDIT LOG ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: admin._id,
    actionByEmail: admin.email,
    permission: permission.name,
    action: action || "delete",
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "system.permission.delete",
      title: "Permission Deleted",
      message: `Permission "${permission.name}" was deleted by ${admin.email}`,
      type: "PERMISSION_DELETED",
      entityId: permission._id,
      entityModel: "Permission",
      metadata: {
        permissionId: permission.permissionId,
        permissionName: permission.name,
        deletedBy: admin.email,
        action: action || "delete",
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on permission delete", { error: err.message });
  }

  return permission;
};

/* =========================================================
   ASSIGN PERMISSION TO EMPLOYEE
========================================================= */
/**
 * Assign permission to employee.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const assignPermissionToEmployeeService = async (data, currentUser) => {
  const { email, permission } = data;

  /* ---------- AUTH CHECK ---------- */
  const admin = await Employee.findOne({ email: currentUser.email });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized");
  }

  /* ---------- TARGET EMPLOYEE ---------- */
  const target = await Employee.findOne({ email });
  if (!target) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- PERMISSION CHECK ---------- */
  const permExists = await Permission.findOne({ name: permission });
  if (!permExists) {
    throw new BadRequestError("Permission not found");
  }

  /* ---------- DUPLICATE CHECK ---------- */
  if (target.permissions.includes(permission)) {
    throw new ConflictError("Permission already assigned");
  }

  /* ---------- ASSIGN PERMISSION ---------- */
  await Employee.updateOne({ email }, { $addToSet: { permissions: permission } });

  /* ---------- AUDIT LOG ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: admin._id,
    actionByEmail: admin.email,
    actionFor: target._id,
    actionForEmail: target.email,
    permission,
    action: "assign",
  });
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "system.permission.assign",
      title: "Permission Assigned",
      message: `Permission "${permission.name}" was assigned to ${target.email} by ${admin.email}`,
      type: "PERMISSION_ASSIGNED",
      entityId: target._id,
      entityModel: "Employee",
      metadata: {
        permissionId: permission.permissionId,
        permissionName: permission.name,
        createdBy: admin.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on permission assign", { error: err.message });
  }

  return { email, permission };
};

/* =========================================================
   REMOVE PERMISSION FROM EMPLOYEE
========================================================= */
/**
 * Remove permission from employee.
 *
 * @param {*} data
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const removePermissionFromEmployeeService = async (data, currentUser) => {
  const { email, permission } = data;

  /* ---------- AUTH CHECK ---------- */
  const admin = await Employee.findOne({ email: currentUser.email });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized");
  }

  /* ---------- TARGET EMPLOYEE ---------- */
  const target = await Employee.findOne({ email });
  if (!target) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- CHECK PERMISSION EXISTS ON USER ---------- */
  if (!target.permissions.includes(permission)) {
    throw new BadRequestError("Permission not assigned");
  }

  /* ---------- REMOVE PERMISSION ---------- */
  await Employee.updateOne({ email }, { $pull: { permissions: permission } });

  /* ---------- AUDIT LOG ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: admin._id,
    actionByEmail: admin.email,
    actionFor: target._id,
    actionForEmail: target.email,
    permission,
    action: "revoke",
  });
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "system.permission.revoke",
      title: "Permission Revoked",
      message: `Permission "${permission.name}" was revoked from ${target.email} by ${admin.email}`,
      type: "PERMISSION_REVOKED",
      entityId: target._id,
      entityModel: "Employee",
      metadata: {
        permissionId: permission.permissionId,
        permissionName: permission.name,
        createdBy: admin.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on permission revoke", { error: err.message });
  }

  return { email, permission };
};

/* =========================================================
   GET PERMISSION AUDIT LOGS
========================================================= */
/**
 * Get permission audit logs.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 */
export const getPermissionAuditLogsService = async ({ page, limit }) => {
  const skip = (page - 1) * limit;
  const totalItems = await PermissionAudit.countDocuments();

  const logs = await PermissionAudit.find()
    .populate("actionBy", "email firstName lastName name")
    .populate("actionFor", "email firstName lastName name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const totalPages = Math.ceil(totalItems / limit);

  const pagination = {
    totalItems,
    totalPages,
    currentPage: page,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    limit,
  };

  return { logs, pagination };
};

/* =========================================================
   DELETE ALL PERMISSIONS
========================================================= */
/**
 * Delete all permissions.
 *
 * @param {*} currentUser
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const deleteAllPermissionsService = async (currentUser) => {
  /* ---------- AUTH CHECK ---------- */
  const admin = await Employee.findOne({ email: currentUser.email });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized");
  }

  /* ---------- COUNT BEFORE DELETE ---------- */
  const totalPermissions = await Permission.countDocuments();

  /* ---------- DELETE ALL PERMISSIONS ---------- */
  await Permission.deleteMany({});

  /* ---------- REMOVE FROM ALL EMPLOYEES ---------- */
  await Employee.updateMany({}, { $set: { permissions: [] } });

  /* ---------- AUDIT LOG ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: admin._id,
    actionByEmail: admin.email,
    permission: "ALL",
    action: "delete_all",
  });

  return { deletedPermissions: totalPermissions };
};
