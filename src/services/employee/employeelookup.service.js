/**
 * Small shared lookups of Employee documents used by the HR services.
 *
 * Exports: findActiveEmployeeByEmail, findActiveEmployeeById, employeeDisplayName, searchEmployeeIds
 * Used by: services/attendance/*, services/payroll/*, services/employeeprofile/*
 */
import Employee from "../../models/employee.model.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";

const PUBLIC_FIELDS = "_id employeeId firstName lastName email role permissions personalEmail";

/**
 * @param {string} email
 * @returns {Promise<object>} lean employee (no password)
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 */
export const findActiveEmployeeByEmail = async (email) => {
  const employee = await Employee.findOne({ email: String(email).toLowerCase().trim(), isDeleted: false })
    .select(PUBLIC_FIELDS)
    .lean();
  if (!employee) throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  return employee;
};

/**
 * @param {*} id Mongo _id
 * @returns {Promise<object>} lean employee (no password)
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 */
export const findActiveEmployeeById = async (id) => {
  const employee = await Employee.findOne({ _id: id, isDeleted: false }).select(PUBLIC_FIELDS).lean();
  if (!employee) throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  return employee;
};

/** "First Last" */
export const employeeDisplayName = (employee) => `${employee?.firstName || ""} ${employee?.lastName || ""}`.trim();

/**
 * Ids of active employees whose name or email contains the text (case-insensitive).
 *
 * @param {string} text
 * @returns {Promise<Array<*>>}
 */
export const searchEmployeeIds = async (text) => {
  const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "i");
  const employees = await Employee.find({
    isDeleted: false,
    $or: [{ firstName: pattern }, { lastName: pattern }, { email: pattern }],
  })
    .select("_id")
    .lean();
  return employees.map((employee) => employee._id);
};
