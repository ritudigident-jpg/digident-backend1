/**
 * Business logic for staff accounts: create, login, tokens, password reset, roles and permissions.
 * Throws AppError subclasses on failure.
 *
 * Exports: createEmployeeService, loginEmployeeService, changeEmployeePasswordService,
 * verifyEmailService, resetEmployeePasswordService, forgotEmployeePasswordService,
 * getEmployeeService, deleteEmployeeService and 2 more
 * Used by: controllers/employee/employee.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import Employee from "../../models/employee.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { sendZohoMail } from "../zoho/zohomail.service.js";
import { employeeWelcomeEmail } from "../../templates/email/employeewelcome.template.js";
import bcrypt from "bcryptjs";
import { generateTokens } from "../../helpers/token.helper.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { resetPasswordTemplate } from "../../templates/email/resetpassword.template.js";
import { sendNotification } from "../notification/notification.service.js";
import Permission from "../../models/permission.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Create employee.
 *
 * @param {*} data
 * @param {*} adminEmail
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const createEmployeeService = async (data, adminEmail) => {
  const {
    firstName,
    lastName,
    email,
    password,
    personalEmail,
    role: rawRole, // ✅ destructure as rawRole to avoid const conflict
    permission,
  } = data;

  const role = Number(rawRole); // ✅ now safely convert to number

  /* Check existing employee */
  const existingEmployee = await Employee.findOne({ email });
  if (existingEmployee) {
    throw new BadRequestError("Employee already exists", { code: ERROR_CODES.EMPLOYEE_ALREADY_EXISTS });
  }

  /* Check admin */
  const admin = await Employee.findOne({ email: adminEmail, isDeleted: false });
  if (!admin) {
    throw new UnauthorizedError("Unauthorized admin", { code: ERROR_CODES.UNAUTHORIZED_ADMIN });
  }

  /* Assign permissions */
  let assignedPermissions = [];

  if (role === 0 || role === 1) {
    const allPermissions = await Permission.find({}, "name").lean();
    assignedPermissions = allPermissions.map((p) => p.name); // all 44
  }

  /* Create employee */
  const newEmployee = await Employee.create({
    employeeId: uuidv6(),
    firstName,
    lastName,
    email,
    password,
    personalEmail,
    role,
    permissions: assignedPermissions,
    createdBy: adminEmail,
    isNewEmployee: true,
  });

  /* Send welcome email */
  const htmlBody = employeeWelcomeEmail(firstName, email, password);
  await sendZohoMail(personalEmail, "Login to your Company Account", htmlBody);

  /* Permission audit */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: admin._id,
      actionByEmail: admin.email,
      actionFor: newEmployee._id,
      action: newEmployee.email,
      permission: permission || "create_employee",
      actionType: "Create",
    });
  } catch (error) {
    logger.error("Audit log failed on create employee", { error: error.message });
  }

  /* Send notification */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "auth.account.create",
      title: "New Employee Created",
      message: `${firstName} ${lastName} has been added as role ${role}`,
      type: "EMPLOYEE_CREATED",
      entityId: newEmployee._id,
      entityModel: "Employee",
      metadata: {
        employeeName: `${firstName} ${lastName}`,
        employeeEmail: email,
        role,
      },
    });
  } catch (error) {
    logger.error("Notification failed on create employee", { error: error.message });
  }

  return newEmployee;
};

/**
 * Login employee.
 *
 * @param {*} email
 * @param {*} password
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const loginEmployeeService = async (email, password) => {
  const employee = await Employee.findOne({ email, isDeleted: false }).select("+password");
  if (!employee) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }
  const isMatch = await bcrypt.compare(password, employee.password);
  if (!isMatch) {
    throw new UnauthorizedError("Invalid email or password", { code: ERROR_CODES.INVALID_CREDENTIALS });
  }
  const { accessToken, refreshToken } = generateTokens(employee);
  return {
    employee,
    accessToken,
    refreshToken,
  };
};

/**
 * Change employee password.
 *
 * @param {*} email
 * @param {*} password
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const changeEmployeePasswordService = async (email, password) => {
  const employee = await Employee.findOne({
    email,
    isDeleted: false,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  /* Update password */
  employee.password = password; // hashed in pre-save middleware
  employee.isNewEmployee = false;
  await employee.save();
  return employee;
};

/**
 * Verify email.
 *
 * @param {*} token
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const verifyEmailService = async (token) => {
  const employee = await Employee.findOne({
    "emailVerificationToken.token": token,
    "emailVerificationToken.expiresAt": { $gt: Date.now() },
    isDeleted: false,
  });
  if (!employee) {
    throw new UnauthorizedError("Invalid or expired token", { code: ERROR_CODES.INVALID_OR_EXPIRED_TOKEN });
  }
  employee.emailVerified = true;
  employee.emailVerificationToken = undefined;
  await employee.save();
  return employee;
};

/**
 * Reset employee password.
 *
 * @param {*} token
 * @param {*} newPassword
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const resetEmployeePasswordService = async (token, newPassword) => {
  const employee = await Employee.findOne({
    resetPasswordToken: token,
    resetPasswordExpiresAt: { $gt: Date.now() },
    isDeleted: false,
  });
  if (!employee) {
    throw new UnauthorizedError("Invalid or expired token", { code: ERROR_CODES.INVALID_OR_EXPIRED_TOKEN });
  }
  employee.password = newPassword;
  employee.resetPasswordToken = null;
  employee.resetPasswordExpiresAt = null;
  employee.isNewEmployee = false;
  await employee.save();
  return employee;
};

/**
 * Forgot employee password.
 *
 * @param {*} email
 * @returns {Promise<*>}
 */
export const forgotEmployeePasswordService = async (email) => {
  const employee = await Employee.findOne({
    email,
    isDeleted: false,
  });
  if (!employee) {
    return;
  }
  const resetToken = crypto.randomBytes(32).toString("hex");
  employee.resetPasswordToken = resetToken;
  employee.resetPasswordExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await employee.save();
  const resetURL = `https://adminfrontend00.netlify.app/reset-password/${resetToken}`;
  await sendZohoMail(
    employee.email,
    "Reset Your Password",
    resetPasswordTemplate(resetURL, employee.firstName)
  );
};

/**
 * Get employee.
 *
 * @param {*} email
 * @returns {Promise<*>}
 */
export const getEmployeeService = async (email) => {
  if (email) {
    const employee = await Employee.findOne({ email, isDeleted: false }).select("-password").lean();
    return employee;
  }
  const employees = await Employee.find({ isDeleted: false }).select("-password").lean();
  return employees;
};

/**
 * Delete employee.
 *
 * @param {*} employeeId
 * @param {*} adminEmail
 * @param {*} permission
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const deleteEmployeeService = async (employeeId, adminEmail, permission) => {
  const employee = await Employee.findOne({
    employeeId,
    isDeleted: false,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const admin = await Employee.findOne({
    email: adminEmail,
    isDeleted: false,
  });
  if (!admin) {
    throw new ForbiddenError("Unauthorized action", { code: ERROR_CODES.UNAUTHORIZED_ACTION });
  }
  employee.isDeleted = true;
  employee.deletedAt = new Date();
  await employee.save();
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: admin._id,
      actionByEmail: admin.email,
      actionFor: employee._id,
      action: employee.email,
      permission: permission?.toLowerCase() || "delete_employee",
      actionType: "Delete",
    });
  } catch (error) {
    logger.debug("error in delete of employee Audit log");
  }
  /* ---------- SEND NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "auth.account.delete",
      title: "Employee Deleted",
      message: `${employee.firstName} ${employee.lastName} account deleted by ${admin.firstName} ${admin.lastName}`,
      type: "EMPLOYEE_DELETED",
      entityId: employee._id,
      entityModel: "Employee",
      metadata: {
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeEmail: employee.email,
        deletedBy: `${admin.firstName} ${admin.lastName}`,
        deletedByEmail: admin.email,
      },
    });
  } catch (error) {
    logger.debug("error in delete employee notification send");
  }
  return {
    employeeId: employee.employeeId,
  };
};

/**
 * Update employee role.
 *
 * @param {*} employeeEmail
 * @param {*} role
 * @param {*} adminEmail
 * @param {*} permission
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateEmployeeRoleService = async (employeeEmail, role, adminEmail, permission) => {
  /* Find admin */
  const admin = await Employee.findOne({
    email: adminEmail,
    isDeleted: false,
  });
  if (!admin) {
    throw new ForbiddenError("Unauthorized action", { code: ERROR_CODES.UNAUTHORIZED_ACTION });
  }
  /* Find employee */
  const employee = await Employee.findOne({
    email: employeeEmail,
    isDeleted: false,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  /* Update role */
  const oldRole = employee.role;
  employee.role = role;
  await employee.save();
  /* Save permission audit */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: admin._id,
      actionByEmail: admin.email,
      actionFor: employee._id,
      action: employee.email,
      permission: permission?.toLowerCase(),
      actionType: "Update",
    });
  } catch (error) {
    logger.debug("error in update role of employee Audit log");
  }

  /* ---------- SEND NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: admin._id,
      permission: "auth.account.update",
      title: "Employee Role Updated",
      message: `${employee.firstName} ${employee.lastName} role updated from ${oldRole} to ${role}`,
      type: "EMPLOYEE_ROLE_UPDATED",
      entityId: employee._id,
      entityModel: "Employee",
      metadata: {
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeEmail: employee.email,
        oldRole,
        newRole: role,
        updatedBy: `${admin.firstName} ${admin.lastName}`,
        updatedByEmail: admin.email,
      },
    });
  } catch (error) {
    logger.debug("error in update role notification of employee");
  }

  return {
    email: employee.email,
    updatedRole: role,
    updatedBy: admin.email,
  };
};

/**
 * Refresh employee access token.
 *
 * @param {*} refreshToken
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const refreshEmployeeAccessTokenService = async (refreshToken) => {
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (error) {
    throw new UnauthorizedError("Invalid or expired refresh token", {
      code: ERROR_CODES.INVALID_OR_EXPIRED_REFRESH_TOKEN,
    });
  }
  const employee = await Employee.findOne({
    email: decoded.email,
    isDeleted: false,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const { accessToken } = generateTokens(employee);
  return accessToken;
};
