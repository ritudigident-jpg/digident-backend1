/**
 * HTTP handlers for permission definitions and assigning them to employees: read the request, call
 * the service, send the response. No business logic here.
 *
 * Exports: createPermission, getAllPermissions, deletePermission, assignPermissionToEmployee,
 * removePermissionFromEmployee, getPermissionAuditLogs, deleteAllPermissions
 * Used by: routes/permissions.routes.js
 */

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import {
  assignPermissionToEmployeeService,
  createPermissionService,
  deleteAllPermissionsService,
  deletePermissionService,
  getAllPermissionsService,
  getPermissionAuditLogsService,
  removePermissionFromEmployeeService,
} from "../../services/permission/permission.service.js";
import { validateAssignPermissionBody, validatePermissionBody } from "./permission.validator.js";
import { ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createPermission
 *
 * @params
 * body: {
 *   name: string
 * }
 *
 * @process
 * 1. Validate required field `name`
 * 2. Authenticate admin using `req.user.email`
 * 3. Check if permission already exists
 * 4. Create new permission with unique `permissionId`
 * 5. Auto-assign permission to all Super Admins (role: "0")
 * 6. Create audit log entry for permission creation
 * 7. Return success response with created permission
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Permission created",
 *   data: {
 *     _id: string,
 *     name: string,
 *     permissionId: string,
 *     createdBy: ObjectId,
 *     createdAt: Date,
 *     updatedAt: Date
 *   }
 * }
 */
export const createPermission = asyncHandler(async (req, res) => {
  const { value, error } = validatePermissionBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const result = await createPermissionService(value, req.user);
  return sendCreated(res, { data: result, message: "Permission created successfully" });
});

/**
 * @function getAllPermissions
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * 1. Parse pagination parameters (`page`, `limit`) from query
 * 2. Fetch all permissions from database
 * 3. Apply `.lean()` for performance optimization
 * 4. (Optional) Apply pagination if implemented
 * 5. Return list of permissions
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All permissions fetched",
 *   data: [
 *     {
 *       _id: string,
 *       name: string,
 *       permissionId: string,
 *       createdBy: ObjectId,
 *       createdAt: Date,
 *       updatedAt: Date
 *     }
 *   ]
 * }
 */
export const getAllPermissions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10 } = req.query;

  const result = await getAllPermissionsService({
    page,
    limit,
  });

  return sendSuccess(res, { data: result, message: "Permissions fetched successfully" });
});

/**
 * @function deletePermission
 *
 * @params
 * params: {
 *   permissionId: string
 * }
 *
 * @process
 * 1. Extract `permissionId` from request params
 * 2. Find permission by `permissionId`
 * 3. If permission not found → return error
 * 4. Authenticate admin using `req.user.email`
 * 5. Delete permission from Permission collection
 * 6. Remove this permission from all employees
 * 7. Create audit log entry for deletion
 * 8. Return success response with deleted permission
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Permission deleted",
 *   data: {
 *     _id: string,
 *     name: string,
 *     permissionId: string,
 *     createdBy: ObjectId,
 *     createdAt: Date,
 *     updatedAt: Date
 *   }
 * }
 */
export const deletePermission = asyncHandler(async (req, res) => {
  const { permissionId } = req.params;

  if (!permissionId) {
    throw new ValidationError("permissionId is required");
  }

  // AFTER
  const result = await deletePermissionService(permissionId, req.user, req.permissionAction);
  return sendSuccess(res, { data: result, message: "Permission deleted successfully" });
});

/**
 * @function assignPermissionToEmployee
 *
 * @params
 * body: {
 *   email: string,
 *   permission: string
 * }
 *
 * @process
 * 1. Extract `email` and `permission` from request body
 * 2. Authenticate admin using `req.user.email`
 * 3. Find target employee using `email`
 * 4. Validate if permission exists in Permission collection
 * 5. Check if permission is already assigned to employee
 * 6. Add permission to employee using `$addToSet`
 * 7. Create audit log entry for permission assignment
 * 8. Return success response with assigned permission details
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Permission assigned",
 *   data: {
 *     email: string,
 *     permission: string
 *   }
 * }
 */
export const assignPermissionToEmployee = asyncHandler(async (req, res) => {
  const { value, error } = validateAssignPermissionBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const result = await assignPermissionToEmployeeService(value, req.user);

  return sendCreated(res, { data: result, message: "Permission assigned successfully" });
});

/**
 * @function removePermissionFromEmployee
 *
 * @params
 * body: {
 *   email: string,
 *   permission: string
 * }
 *
 * @process
 * 1. Extract `email` and `permission` from request body
 * 2. Authenticate admin using `req.user.email`
 * 3. Find target employee using `email`
 * 4. Check if permission is assigned to the employee
 * 5. Remove permission using `$pull`
 * 6. Create audit log entry for permission removal (revoke)
 * 7. Return success response with removed permission details
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Permission removed",
 *   data: {
 *     email: string,
 *     permission: string
 *   }
 * }
 */
export const removePermissionFromEmployee = asyncHandler(async (req, res) => {
  const { value, error } = validateAssignPermissionBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const result = await removePermissionFromEmployeeService(value, req.user);

  return sendSuccess(res, { data: result, message: "Permission removed successfully" });
});

/**
 * @function getPermissionAuditLogs
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * 1. Parse optional pagination parameters (`page`, `limit`) from query
 * 2. Fetch permission audit logs from database
 * 3. Populate `actionBy` with employee `email` and `name`
 * 4. Populate `actionFor` with employee `email` and `name`
 * 5. Sort logs in descending order (latest first)
 * 6. (Optional) Apply pagination if implemented
 * 7. Return audit logs list
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Permission audit logs fetched",
 *   data: [
 *     {
 *       _id: string,
 *       permissionAuditId: string,
 *       actionBy: {
 *         _id: ObjectId,
 *         email: string,
 *         name: string
 *       },
 *       actionFor: {
 *         _id: ObjectId,
 *         email: string,
 *         name: string
 *       },
 *       permission: string,
 *       action: string,
 *       createdAt: Date
 *     }
 *   ]
 * }
 */
export const getPermissionAuditLogs = asyncHandler(async (req, res) => {
  /* ---------- QUERY PARAMS ---------- */
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);

  /* ---------- SERVICE ---------- */
  const result = await getPermissionAuditLogsService({ page, limit });

  return sendSuccess(res, {
    data: {
      pagination: result.pagination,
      logs: result.logs,
    },
    message: "Permission audit logs fetched successfully",
  });
});
/**
 * @function deleteAllPermissions
 *
 * @params
 * body: {}
 *
 * @process
 * 1. Authenticate admin using `req.user.email`
 * 2. Delete all permissions from Permission collection
 * 3. Remove all permissions from every employee
 * 4. Create audit log entry for bulk deletion
 * 5. Return success response
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All permissions deleted",
 *   data: null
 * }
 */
export const deleteAllPermissions = asyncHandler(async (req, res) => {
  const result = await deleteAllPermissionsService(req.user);

  return sendSuccess(res, { data: result, message: "All permissions deleted successfully" });
});
