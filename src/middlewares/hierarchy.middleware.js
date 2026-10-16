/**
 * Stops an employee from acting on someone with an equal or higher role.
 *
 * Used by: routes/employees.routes.js
 */

import Employee from "../models/employee.model.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../helpers/apperror.helper.js";
import { asyncHandler } from "../helpers/asynchandler.helper.js";

/**
 * @function hierarchyMiddleware
 *
 * @description
 * Middleware to enforce employee role hierarchy rules.
 * Prevents users from performing actions on employees with equal or higher roles.
 *
 * @process
 * 1. Fetch logged-in employee from the database using `req.user.email`
 * 2. For POST requests:
 *    - Validate `role` is provided in body
 *    - Set `targetRole` to the requested role
 * 3. For PUT / PATCH / DELETE requests:
 *    - Validate `id` param exists
 *    - Fetch target employee using `id`
 *    - Prevent actions on self
 *    - Set `targetRole` to target employee's role
 * 4. Enforce role hierarchy rules:
 *    - Executives (role 3) cannot perform any action
 *    - SuperAdmin (role 0) can perform any action
 *    - Users can act only on employees with higher role number (lower authority)
 * 5. Call `next()` if action is allowed
 *
 * @response
 * 400 { success: false, message: "Role is required" } - for missing role or ID
 * 403 { success: false, message: "<hierarchy violation message>" } - for insufficient permissions
 * 404 { success: false, message: "Employee not found" } - if logged-in or target employee does not exist
 * 500 { success: false, message: "Internal Server Error", error: "<error_message>" } - for any server error
 */

const hierarchyMiddleware = asyncHandler(async (req, res, next) => {
  const loggedInEmployee = await Employee.findOne({
    email: req.user.email,
  }).select("role _id");

  if (!loggedInEmployee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  let targetRole;

  /* ================= CREATE ================= */
  if (req.method === "POST") {
    targetRole = req.body?.role;

    if (targetRole === undefined) {
      throw new BadRequestError("Role is required", { code: ERROR_CODES.ROLE_REQUIRED });
    }
  }

  /* ================= DELETE / UPDATE ================= */
  if (req.method === "DELETE" || req.method === "PUT") {
    const targetEmployee = await Employee.findOne({ email: req.body.email }).select("role _id");

    if (!targetEmployee) {
      throw new NotFoundError("Target employee not found", { code: ERROR_CODES.TARGET_EMPLOYEE_NOT_FOUND });
    }

    // ❌ cannot act on yourself
    if (loggedInEmployee._id.equals(targetEmployee._id)) {
      throw new ForbiddenError("You cannot perform this action on yourself", {
        code: ERROR_CODES.SELF_ACTION_FORBIDDEN,
      });
    }
    targetRole = targetEmployee.role;
  }

  const creatorRole = loggedInEmployee.role;

  // ❌ Executives can do nothing
  if (creatorRole === 3) {
    throw new ForbiddenError("Executives are not allowed to perform this action", {
      code: ERROR_CODES.EXECUTIVE_FORBIDDEN,
    });
  }

  // ✅ SuperAdmin can do anything
  if (creatorRole === 0) {
    return next();
  }

  // lower number = higher authority
  if (creatorRole < targetRole) {
    return next();
  }

  throw new ForbiddenError("You cannot perform this action on same or higher role", {
    code: ERROR_CODES.HIERARCHY_VIOLATION,
  });
});
export default hierarchyMiddleware;
