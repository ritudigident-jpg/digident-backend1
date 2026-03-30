import Employee from "../models/manage/employee.model.js";
import { sendError, handleError } from "../helpers/error.helper.js";

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


const hierarchyMiddleware = async (req, res, next) => {
  try {
    /* =========================
       FETCH LOGGED-IN EMPLOYEE
    ========================= */
    const loggedInEmployee = await Employee.findOne({
      email: req.user?.email,
      isDeleted: false,
    })
      .select("role _id")
      .lean();

    if (!loggedInEmployee) {
      throw new Error("USER_NOT_FOUND");
    }

    let targetRole;

    /* =========================
       CREATE (POST)
    ========================= */
    if (req.method === "POST") {
      targetRole = req.body?.role;

      if (targetRole === undefined) {
        return sendError(res, {
          message: "Role is required",
          statusCode: 400,
          errorCode: "ROLE_REQUIRED",
        });
      }
    }

    /* =========================
       UPDATE / DELETE
    ========================= */
    if (["PUT", "PATCH", "DELETE"].includes(req.method)) {
      const { id } = req.params;

      if (!id) {
        return sendError(res, {
          message: "Employee ID is required",
          statusCode: 400,
          errorCode: "EMPLOYEE_ID_REQUIRED",
        });
      }

      const targetEmployee = await Employee.findById(id)
        .select("role _id")
        .lean();

      if (!targetEmployee) {
        throw new Error("USER_NOT_FOUND");
      }

      /* ---------- SELF ACTION BLOCK ---------- */
      if (String(loggedInEmployee._id) === String(targetEmployee._id)) {
        return sendError(res, {
          message: "You cannot perform this action on yourself",
          statusCode: 403,
          errorCode: "SELF_ACTION_FORBIDDEN",
        });
      }

      targetRole = targetEmployee.role;
    }

    const creatorRole = loggedInEmployee.role;

    /* =========================
       ROLE RULES
    ========================= */

    // ❌ Executives cannot perform actions
    if (creatorRole === 3) {
      return sendError(res, {
        message: "Executives are not allowed to perform this action",
        statusCode: 403,
        errorCode: "INSUFFICIENT_ROLE",
      });
    }

    // ✅ Super Admin (0) → full access
    if (creatorRole === 0) {
      return next();
    }

    // ✅ Lower number = higher authority
    if (creatorRole < targetRole) {
      return next();
    }

    return sendError(res, {
      message: "You cannot perform this action on same or higher role",
      statusCode: 403,
      errorCode: "HIERARCHY_VIOLATION",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export default hierarchyMiddleware;