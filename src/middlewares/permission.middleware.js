/**
 * Checks that the logged-in employee has the permission named in the request.
 *
 * Exports: checkPermission
 * Used by: 14 files, e.g. routes/banners.routes.js, routes/blogs.routes.js,
 * routes/brands.routes.js, routes/careers.routes.js
 */

import Employee from "../models/employee.model.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";
import { AppError, ForbiddenError, UnauthorizedError, NotFoundError } from "../helpers/apperror.helper.js";
import { HTTP_STATUS } from "../constants/httpstatus.constant.js";
import { asyncHandler } from "../helpers/asynchandler.helper.js";
import { logger } from "../helpers/logger.helper.js";

/**
 * @function checkPermission
 *
 * @description
 * Middleware factory to validate if the logged-in employee has the required permission.
 * SuperAdmin (role 0) bypasses all permission checks.
 *
 * @process
 * 1. Extract user email from `req.user.email`
 * 2. Validate email exists in token
 * 3. Fetch employee from DB with role and permissions
 * 4. Validate `permission` field exists in request body
 * 5. SuperAdmin bypass: role 0 automatically passes
 * 6. Check if employee's permissions include the required permission
 * 7. Call `next()` if permission check passes
 *
 * @response
 * 400 { success: false, message: "Permission is required" } - if missing in request
 * 401 { success: false, message: "Unauthorized - User not found in token" } - if no token info
 * 403 { success: false, message: "Permission denied" } - if missing permission
 * 404 { success: false, message: "Employee not found" } - if employee record missing
 * 500 { success: false, message: "<error_message>" } - for unexpected errors
 *
 * @example
 * router.post("/some-route", authToken, checkPermission, controllerFunction);
 */

export const checkPermission = asyncHandler(async (req, res, next) => {
  /* =========================
         VALIDATE TOKEN USE
      ========================= */
  logger.debug("Checking permissions for user", { user: req.user });
  const userEmail = req.user?.email;
  if (!userEmail) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  /* =========================
         RESOLVE REQUIRED PERMISSION
      ========================= */
  const requiredPermission =
    req.method === "GET"
      ? req.params?.permission || req.query?.permission
      : req.body?.permission || req.query?.permission;

  /* =========================
         FETCH EMPLOYEE
      ========================= */
  const employee = await Employee.findOne({
    email: userEmail,
    isDeleted: false,
  })
    .select("_id email role permissions")
    .lean();

  if (!employee) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  /* =========================
         SUPER ADMIN BYPASS
         (runs before the "permission required" guard so an admin is never
         blocked just because a request forgot to name a permission)
      ========================= */
  if (employee.role === 0) {
    req.currentUser = employee;
    return next();
  }

  /* =========================
         VALIDATE INPUT
      ========================= */
  if (!requiredPermission) {
    throw new AppError("Permission is required", {
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.PERMISSION_CONFIG_MISSING,
    });
  }

  /* =========================
         PERMISSION CHECK
      ========================= */
  const hasPermission =
    Array.isArray(employee.permissions) && employee.permissions.includes(requiredPermission);

  if (!hasPermission) {
    throw new ForbiddenError(`Permission denied: ${requiredPermission}`, {
      code: ERROR_CODES.PERMISSION_DENIED,
    });
  }

  /* =========================
         ATTACH FOR DOWNSTREAM
      ========================= */
  req.currentUser = employee;

  next();
});

/**
 * True when the employee may use the permission: Super Admin always, others when it is in their list.
 *
 * @param {{ role: number, permissions?: string[] }} employee
 * @param {string} permission
 * @returns {boolean}
 */
export const employeeHasPermission = (employee, permission) =>
  Boolean(employee) &&
  (employee.role === 0 || (Array.isArray(employee.permissions) && employee.permissions.includes(permission)));

/**
 * Middleware factory with the permission FIXED ON THE SERVER (the client cannot choose what is
 * checked, unlike checkPermission above). Passes when the employee has ANY of the listed
 * permissions. Puts { _id, email, role, permissions, firstName, lastName } on req.currentUser.
 *
 * Example: router.get("/", auth, requirePermission("payroll.salary.read"), listPayroll);
 *
 * @param {...string} permissions
 * @returns {import("express").RequestHandler}
 * @throws {UnauthorizedError} 401 without a logged-in user.
 * @throws {NotFoundError} 404 when the employee no longer exists.
 * @throws {ForbiddenError} 403 PERMISSION_DENIED when none of the permissions is held.
 */
export const requirePermission = (...permissions) =>
  asyncHandler(async (req, res, next) => {
    const userEmail = req.user?.email;
    if (!userEmail) {
      throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
    }
    const employee = await Employee.findOne({ email: userEmail, isDeleted: false })
      .select("_id email role permissions firstName lastName")
      .lean();
    if (!employee) {
      throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
    }
    if (!permissions.some((permission) => employeeHasPermission(employee, permission))) {
      throw new ForbiddenError(`Permission denied: ${permissions.join(" or ")}`, {
        code: ERROR_CODES.PERMISSION_DENIED,
      });
    }
    req.currentUser = employee;
    next();
  });

/**
 * Loads the logged-in employee onto req.currentUser without requiring a permission (for "my ..."
 * endpoints and owner-or-permission checks inside services).
 *
 * @throws {UnauthorizedError} 401 without a logged-in user.
 * @throws {NotFoundError} 404 when the employee no longer exists.
 */
export const attachCurrentEmployee = asyncHandler(async (req, res, next) => {
  const userEmail = req.user?.email;
  if (!userEmail) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }
  const employee = await Employee.findOne({ email: userEmail, isDeleted: false })
    .select("_id email role permissions firstName lastName employeeId")
    .lean();
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  req.currentUser = employee;
  next();
});
