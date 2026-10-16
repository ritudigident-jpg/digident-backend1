/**
 * Business logic for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals. Throws AppError subclasses on failure.
 *
 * Exports: requestLeaveService, getAllLeaveRequestsForAdminService,
 * updateLeaveRequestStatusService, getMyLeaveRequestsService, getLeaveRequestsByStatusService,
 * cancelLeaveRequestService
 * Used by: services/attendance/attendance.service.js
 */

/**
 * Leave requests: apply, list (own / by status / all for admins), approve or reject, cancel. Re-exported by attendance.service.js.
 */
import Employee from "../../models/employee.model.js";
import { EmployeeRecord } from "../../models/attendance.model.js";
import { getISTDateString, getISTNow } from "../../helpers/date.helper.js";
import { v6 as uuidv6 } from "uuid";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Request leave.
 *
 * @param {*} user
 * @param {*} data
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const requestLeaveService = async (user, data) => {
  const { leaveType, leaveDuration = "FULL_DAY", fromDate, toDate, leaveReason } = data;

  const normalizedEmail = user.email.toLowerCase().trim();
  const today = getISTDateString(getISTNow());

  const start = new Date(fromDate);
  const end = new Date(toDate);

  if (isNaN(start) || isNaN(end)) {
    throw new BadRequestError("Invalid date format", { code: ERROR_CODES.INVALID_DATE });
  }

  if (start < new Date(today) || end < new Date(today)) {
    throw new BadRequestError("Past dates are not allowed", { code: ERROR_CODES.PAST_DATE });
  }

  if (end < start) {
    throw new BadRequestError("toDate cannot be before fromDate", { code: ERROR_CODES.INVALID_DATE_RANGE });
  }

  /* ---------- FIND EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: normalizedEmail,
    isDeleted: false,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- FETCH EMPLOYEE RECORD ---------- */
  const record = await EmployeeRecord.findOne({ employee: employee._id });

  /* ---------- GENERATE ALL DATES ---------- */
  const leaveDates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    leaveDates.push(d.toISOString().split("T")[0]);
  }

  /* ---------- CHECK EXISTING DAY RECORDS ---------- */
  if (record && Array.isArray(record.records)) {
    for (const date of leaveDates) {
      const existing = record.records.find((r) => r.date === date);
      if (existing) {
        throw new BadRequestError(`Record already exists for ${date}. Cannot request leave.`, {
          code: ERROR_CODES.RECORD_EXISTS,
        });
      }
    }
  }

  /* ---------- CHECK DUPLICATE LEAVE REQUEST ---------- */
  const existingReq = await AdminApproval.findOne({
    employee: employee._id,
    requestType: "LEAVE",
    status: "PENDING",
    $expr: {
      $and: [{ $lte: ["$requestData.fromDate", toDate] }, { $gte: ["$requestData.toDate", fromDate] }],
    },
  });

  if (existingReq) {
    throw new BadRequestError("A leave request for this date range is already pending", {
      code: ERROR_CODES.DUPLICATE_REQUEST,
    });
  }

  /* ---------- CREATE ADMIN APPROVAL ---------- */
  const approval = await AdminApproval.create({
    approvalId: uuidv6(),
    employee: employee._id,
    requestType: "LEAVE",
    recordDate: fromDate,
    requestData: {
      leaveType,
      leaveDuration,
      fromDate,
      toDate,
      leaveReason: leaveReason || null,
    },
    status: "PENDING",
  });
  /* ---------- SEND NOTIFICATION ---------- */
  await sendNotification({
    sender: employee._id,

    permission: "attendance.log.update",

    title: "New Leave Request",

    message: `${employee.firstName} ${employee.lastName} requested ${leaveType} leave from ${fromDate} to ${toDate}`,

    type: "LEAVE_REQUESTED",

    entityId: approval._id,
    entityModel: "AdminApproval",

    metadata: {
      approvalId: approval.approvalId,
      employeeId: employee.employeeId,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      employeeEmail: employee.email,
      leaveType,
      leaveDuration,
      fromDate,
      toDate,
      leaveReason: leaveReason || null,
      status: "PENDING",
    },
  });

  return {
    approvalId: approval.approvalId,
    leaveType,
    leaveDuration,
    fromDate,
    toDate,
    status: "PENDING",
  };
};

/**
 * Get all leave requests for admin.
 * @returns {Promise<*>}
 */
export const getAllLeaveRequestsForAdminService = async () => {
  const requests = await AdminApproval.find({ requestType: "LEAVE" })
    .populate("employee", "firstName lastName email role")
    .sort({ createdAt: -1 });

  if (!requests.length) return [];

  const data = requests.map((r) => ({
    approvalId: r.approvalId,
    employee: r.employee,
    leaveType: r.requestData.leaveType,
    leaveDuration: r.requestData.leaveDuration,
    fromDate: r.requestData.fromDate,
    toDate: r.requestData.toDate,
    leaveReason: r.requestData.leaveReason,
    status: r.status,
    actionBy: r.actionBy || null,
    actionAt: r.actionAt || null,
    createdAt: r.createdAt,
  }));

  return data;
};

/**
 * Update leave request status.
 *
 * @param {*} adminUser
 * @param {*} approvalId
 * @param {*} action
 * @param {*} rejectionReason
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateLeaveRequestStatusService = async (adminUser, approvalId, action, rejectionReason) => {
  // ===== FIND ADMIN =====
  const admin = await Employee.findOne({ email: adminUser.email });
  if (!admin) {
    throw new ForbiddenError("Admin not found", { code: ERROR_CODES.ADMIN_NOT_FOUND });
  }

  // ===== FIND LEAVE APPROVAL =====
  const approval = await AdminApproval.findOne({ approvalId, requestType: "LEAVE" });
  if (!approval) {
    throw new NotFoundError("Leave request not found", { code: ERROR_CODES.LEAVE_REQUEST_NOT_FOUND });
  }

  if (approval.status !== "PENDING") {
    throw new BadRequestError("Request already processed", { code: ERROR_CODES.ALREADY_PROCESSED });
  }

  // ===== HANDLE REJECTION =====
  if (action === "REJECTED") {
    approval.status = "REJECTED";
    approval.actionBy = admin._id;
    approval.actionAt = new Date();
    approval.rejectionReason = rejectionReason || "Not specified";
    await approval.save();

    return {
      approvalId: approval.approvalId,
      employee: approval.employee,
      status: "REJECTED",
      actionBy: admin.email,
      actionAt: approval.actionAt,
      rejectionReason: approval.rejectionReason,
    };
  }

  // ===== APPROVAL FLOW =====
  const { employee, requestData } = approval;
  const { leaveType, leaveDuration, fromDate, toDate, leaveReason } = requestData;

  const record = await EmployeeRecord.findOne({ employee });
  if (!record) {
    throw new NotFoundError("Employee record not found", { code: ERROR_CODES.EMPLOYEE_RECORD_NOT_FOUND });
  }
  const start = new Date(fromDate);
  const end = new Date(toDate);

  // Generate all leave dates
  const leaveDates = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    leaveDates.push(d.toISOString().split("T")[0]);
  }

  // Check for conflicts
  for (const dateStr of leaveDates) {
    const existing = record.records.find((r) => r.date === dateStr);
    if (existing) {
      throw new BadRequestError(`Attendance already exists for ${dateStr}`, {
        code: ERROR_CODES.ATTENDANCE_EXISTS,
      });
    }

    // Push leave record
    record.records.push({
      recordId: approval.approvalId,
      date: dateStr,
      dayType: ["LEAVE"],
      status: ["LEAVE"],
      leaveType,
      leaveDuration,
      fromDate: start,
      toDate: end,
      leaveStatus: "APPROVED",
      leaveReason: leaveReason || null,
      requiresAdminApproval: false,
      adminAdjusted: true,
    });
  }

  approval.status = "APPROVED";
  approval.actionBy = admin._id;
  approval.actionAt = new Date();

  await record.save();
  await approval.save();
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "attendance.log.update",
      title: "Attendance Log Updated",
      message: `Attendance log updated for ${employee?.name || "Employee"}`,
      type: "ATTENDANCE_LOG_UPDATED",
      entityId: employee?._id,
      entityModel: "Employee",
    });
  } catch (err) {
    logger.error("Notification failed on attendance log update", { error: err.message });
  }

  return {
    approvalId: approval.approvalId,
    employee,
    fromDate,
    toDate,
    leaveType,
    leaveDuration,
    status: "APPROVED",
    actionBy: admin.email,
    actionAt: approval.actionAt,
  };
};

/**
 * Get my leave requests.
 *
 * @param {*} email
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getMyLeaveRequestsService = async (email) => {
  // Find employee
  const employee = await Employee.findOne({ email, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found");
  }

  // Fetch leave requests
  const requests = await AdminApproval.find({
    employee: employee._id,
    requestType: "LEAVE",
  }).sort({ createdAt: -1 });

  // Format response
  return requests.map((r) => ({
    approvalId: r.approvalId,
    leaveType: r.requestData.leaveType,
    leaveDuration: r.requestData.leaveDuration,
    fromDate: r.requestData.fromDate,
    toDate: r.requestData.toDate,
    leaveReason: r.requestData.leaveReason,
    status: r.status,
    actionBy: r.actionBy,
    actionAt: r.actionAt,
    createdAt: r.createdAt,
  }));
};

/**
 * Get leave requests by status.
 *
 * @param {*} email
 * @param {*} status
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const getLeaveRequestsByStatusService = async (email, status) => {
  // ===== VERIFY ADMIN =====
  const admin = await Employee.findOne({ email, role: "ADMIN" });
  if (!admin) {
    throw new ForbiddenError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  // ===== BUILD FILTER =====
  const filter = { requestType: "LEAVE" };
  if (status) {
    filter.status = status;
  }

  // ===== FETCH DATA =====
  const approvals = await AdminApproval.find(filter)
    .populate("employee", "firstName lastName email role")
    .populate("actionBy", "firstName lastName email")
    .sort({ createdAt: -1 });

  if (!approvals.length) return [];

  // ===== FORMAT RESPONSE =====
  return approvals.map((doc) => ({
    approvalId: doc.approvalId,
    employee: doc.employee,
    leaveType: doc.requestData.leaveType,
    leaveDuration: doc.requestData.leaveDuration,
    fromDate: doc.requestData.fromDate,
    toDate: doc.requestData.toDate,
    leaveReason: doc.requestData.leaveReason,
    status: doc.status,
    actionBy: doc.actionBy,
    actionAt: doc.actionAt,
    rejectionReason: doc.rejectionReason,
    createdAt: doc.createdAt,
  }));
};

/**
 * Cancel leave request.
 *
 * @param {*} email
 * @param {*} approvalId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const cancelLeaveRequestService = async (email, approvalId) => {
  // ===== FIND EMPLOYEE =====
  const employee = await Employee.findOne({ email, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMP_NOT_FOUND });
  }

  // ===== FIND PENDING LEAVE REQUEST =====
  const approval = await AdminApproval.findOne({
    approvalId,
    employee: employee._id,
    requestType: "LEAVE",
    status: "PENDING",
  });

  if (!approval) {
    throw new NotFoundError("Pending leave request not found or already processed", {
      code: ERROR_CODES.APPROVAL_NOT_FOUND,
    });
  }

  // ===== DELETE REQUEST =====
  await approval.deleteOne();

  return { approvalId };
};
