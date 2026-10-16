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
