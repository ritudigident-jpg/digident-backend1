/**
 * Business logic for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals. Throws AppError subclasses on failure.
 *
 * Exports: sendPunchOutRequestService, getAllPunchOutRequestsForAdminService,
 * updatePunchOutRequestStatusService, getMyPunchOutRequestsService,
 * getAttendanceApprovalsByStatusService
 * Used by: services/attendance/attendance.service.js
 */

/**
 * Forgot-to-punch-out requests: send, list (own / by status / all for admins), approve or reject. Re-exported by attendance.service.js.
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
 * Send punch out request.
 *
 * @param {*} user
 * @param {*} requestedPunchOut
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const sendPunchOutRequestService = async (user, requestedPunchOut) => {
  const normalizedEmail = user.email.toLowerCase().trim();

  // ===== Validate format =====
  const hasTime = /T\d{2}:\d{2}/.test(requestedPunchOut) || /\d{2}:\d{2}/.test(requestedPunchOut);

  if (!hasTime) {
    throw new BadRequestError("Punch-out must include time (format: YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm)", {
      code: ERROR_CODES.INVALID_PUNCH_OUT_FORMAT,
    });
  }

  const punchOutTime = new Date(requestedPunchOut);
  if (isNaN(punchOutTime)) {
    throw new BadRequestError("Invalid punch-out time format", { code: ERROR_CODES.INVALID_PUNCH_OUT });
  }

  const now = getISTNow();
  if (punchOutTime > now) {
    throw new BadRequestError("Punch-out time cannot be in the future", {
      code: ERROR_CODES.FUTURE_PUNCH_OUT,
    });
  }

  const date = punchOutTime.toISOString().split("T")[0];
  const today = getISTDateString(now);
  if (date > today) {
    throw new BadRequestError("Cannot request punch-out for a future date", {
      code: ERROR_CODES.FUTURE_DATE,
    });
  }

  // ===== Find employee =====
  const employee = await Employee.findOne({
    email: normalizedEmail,
    isDeleted: false,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  // ===== Fetch attendance record =====
  const empRecord = await EmployeeRecord.findOne({ employee: employee._id });
  if (!empRecord) {
    throw new NotFoundError("Attendance not found", { code: ERROR_CODES.RECORD_NOT_FOUND });
  }

  // ===== Find specific day record =====
  const record = empRecord.records.find((r) => r.date === date);
  if (!record) {
    throw new BadRequestError("No record found for this date", {
      code: ERROR_CODES.RECORD_NOT_FOUND_FOR_DATE,
    });
  }

  if (!record.punchIn) {
    throw new BadRequestError("No punch-in found for this date", { code: ERROR_CODES.NO_PUNCH_IN });
  }

  if (record.punchOut) {
    throw new BadRequestError("Punch-out already exists", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  }

  if (record.dayType.includes("HOLIDAY")) {
    throw new BadRequestError("This date is a holiday", { code: ERROR_CODES.HOLIDAY_BLOCK });
  }

  if (record.dayType.includes("LEAVE") && record.leaveDuration === "FULL_DAY") {
    throw new BadRequestError("You were on full-day leave", { code: ERROR_CODES.FULL_DAY_LEAVE });
  }

  if (record.requiresAdminApproval) {
    throw new BadRequestError("Already sent for admin approval", {
      code: ERROR_CODES.ALREADY_PENDING_APPROVAL,
    });
  }

  // ===== Check for duplicate admin request =====
  const exists = await AdminApproval.findOne({
    employee: employee._id,
    requestType: "FORGOT_PUNCH_OUT",
    recordDate: date,
    status: "PENDING",
  });

  if (exists) {
    throw new BadRequestError("Request already pending", { code: ERROR_CODES.DUPLICATE_REQUEST });
  }

  // ===== Mark record for admin approval =====
  record.requiresAdminApproval = true;

  // ===== Create admin approval request =====
  await AdminApproval.create({
    approvalId: uuidv6(),
    employee: employee._id,
    requestType: "FORGOT_PUNCH_OUT",
    recordDate: date,
    requestData: { requestedPunchOut },
    status: "PENDING",
  });

  await empRecord.save();
  /* ===== SEND NOTIFICATION ===== */

  /* ===== SEND NOTIFICATION (with error guard) ===== */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "attendance.log.update",
      title: "Punch-Out Approval Request",
      message: `${employee.firstName} ${employee.lastName} requested punch-out approval for ${date}`,
      type: "FORGOT_PUNCH_OUT_REQUEST",
      entityId: employee._id,
      entityModel: "Employee",
      metadata: {
        employeeId: employee.employeeId,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        employeeEmail: employee.email,
        requestDate: date,
        requestedPunchOut: punchOutTime,
        requestType: "FORGOT_PUNCH_OUT",
      },
    });
  } catch (notifError) {
    // Non-fatal: log but don't fail the request
    logger.error("Notification failed for punch-out request", { error: notifError });
  }

  return {
    date,
    requestedPunchOut,
    status: "PENDING",
  };
};

/**
 * Get all punch out requests for admin.
 * @returns {Promise<*>}
 */
export const getAllPunchOutRequestsForAdminService = async () => {
  const approvals = await AdminApproval.find({
    requestType: "FORGOT_PUNCH_OUT",
  })
    .populate("employee", "firstName lastName email role")
    .sort({ createdAt: -1 });

  if (!approvals.length) return [];

  return approvals.map((a) => ({
    approvalId: a.approvalId,
    employee: a.employee,
    date: a.recordDate,
    requestedPunchOut: a.requestData.requestedPunchOut,
    status: a.status,
    createdAt: a.createdAt,
  }));
};

/**
 * Update punch out request status.
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
export const updatePunchOutRequestStatusService = async (adminUser, approvalId, action, rejectionReason) => {
  // ===== FIND ADMIN =====
  const admin = await Employee.findOne({ email: adminUser.email });
  if (!admin) {
    throw new ForbiddenError("Admin not found", { code: ERROR_CODES.ADMIN_NOT_FOUND });
  }
  // ===== FIND APPROVAL =====
  const approval = await AdminApproval.findOne({ approvalId });
  if (!approval) {
    throw new NotFoundError("Approval request not found", { code: ERROR_CODES.APPROVAL_NOT_FOUND });
  }

  if (approval.status !== "PENDING") {
    throw new BadRequestError("Request already processed", { code: ERROR_CODES.ALREADY_PROCESSED });
  }

  const { employee, recordDate, requestData } = approval;

  // ===== FIND EMPLOYEE RECORD =====
  const record = await EmployeeRecord.findOne({ employee });
  if (!record) {
    throw new NotFoundError("Employee record not found", { code: ERROR_CODES.RECORD_NOT_FOUND });
  }

  const day = record.records.find((r) => r.date === recordDate);
  if (!day) {
    throw new NotFoundError("Day record not found", { code: ERROR_CODES.DAY_RECORD_NOT_FOUND });
  }

  // ===== HANDLE REJECTION =====
  if (action === "REJECTED") {
    day.requiresAdminApproval = false;
    day.adminAdjusted = true;
    day.punchOut = null;
    day.totalWorkedTime = {
      hours: 0,
      minutes: 0,
    };

    day.status = day.status.filter((s) => !["PRESENT", "ABSENT", "HALF_DAY", "EARLY_GOING"].includes(s));
    day.status.push("ABSENT");

    await record.save();

    approval.status = "REJECTED";
    approval.actionBy = admin._id;
    approval.actionAt = new Date();
    approval.rejectionReason = rejectionReason || "Not specified";
    await approval.save();

    return {
      approvalId: approval.approvalId,
      employee: approval.employee,
      date: recordDate,
      status: day.status,
      actionBy: admin.email,
      actionAt: approval.actionAt,
      rejectionReason: approval.rejectionReason,
    };
  }

  // ===== APPROVAL FLOW =====
  const requestedPunchOut = requestData?.requestedPunchOut;
  if (!requestedPunchOut) {
    throw new BadRequestError("Invalid punch-out request data", { code: ERROR_CODES.INVALID_REQUEST_DATA });
  }

  if (!day.punchIn) {
    throw new BadRequestError("Cannot punch-out without punch-in", { code: ERROR_CODES.NO_PUNCH_IN });
  }

  if (day.punchOut) {
    throw new BadRequestError("Punch-out already exists", { code: ERROR_CODES.PUNCH_OUT_EXISTS });
  }

  // ===== APPLY PUNCH-OUT =====
  const punchOutTime = new Date(requestedPunchOut);
  if (isNaN(punchOutTime.getTime())) {
    throw new BadRequestError("Invalid punch-out time", { code: ERROR_CODES.INVALID_TIME });
  }

  if (punchOutTime < new Date(day.punchIn)) {
    throw new BadRequestError("Punch-out cannot be before punch-in", { code: ERROR_CODES.INVALID_PUNCH_OUT });
  }

  day.punchOut = punchOutTime;
  day.requiresAdminApproval = false;
  day.adminAdjusted = true;

  // ===== RECOMPUTE STATUS =====
  const diffMs = punchOutTime - new Date(day.punchIn);
  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = totalMinutes / 60;

  let newStatus = "PRESENT";
  const weekday = new Date(day.date).getDay();

  if (weekday === 6) {
    if (totalMinutes < 330) newStatus = "ABSENT";
  } else {
    if (totalHours < 4) newStatus = "ABSENT";
    else if (totalHours < 6) newStatus = "HALF_DAY";
    else if (totalHours < 8) newStatus = "EARLY_GOING";
  }

  day.totalWorkedTime = {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };

  day.status = day.status.filter((s) => !["PRESENT", "ABSENT", "HALF_DAY", "EARLY_GOING"].includes(s));
  day.status.push(newStatus);

  // ===== SAVE =====
  await record.save();

  approval.status = "APPROVED";
  approval.actionBy = admin._id;
  approval.actionAt = new Date();
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
    logger.error("Notification failed on Attendance log update", { error: err.message });
  }

  return {
    approvalId: approval.approvalId,
    employee,
    date: recordDate,
    punchOut: punchOutTime,
    worked: day.totalWorkedTime,
    status: day.status,
    actionBy: admin.email,
    actionAt: approval.actionAt,
  };
};

/**
 * Get my punch out requests.
 *
 * @param {*} email
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getMyPunchOutRequestsService = async (email) => {
  // Find employee
  const employee = await Employee.findOne({ email, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found");
  }

  // Fetch punch-out requests
  const requests = await AdminApproval.find({
    employee: employee._id,
    requestType: "FORGOT_PUNCH_OUT",
  }).sort({ createdAt: -1 });
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "attendance.log.update",
      title: "Forget to Punch-Out Request",
      message: `Forget to Punch-Out requested for ${employee?.name || "Employee"}`,
      type: "FORGOT_PUNCH_OUT_REQUESTED",
      entityId: employee?._id,
      entityModel: "Employee",
      metadata: {
        createdBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed for forgot punch-out request", { error: err.message });
  }

  // Format response
  return requests.map((r) => ({
    approvalId: r.approvalId,
    date: r.recordDate,
    requestedPunchOut: r.requestData.requestedPunchOut,
    status: r.status,
    actionBy: r.actionBy,
    actionAt: r.actionAt,
    createdAt: r.createdAt,
  }));
};

/**
 * Get attendance approvals by status.
 *
 * @param {*} email
 * @param {*} status
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const getAttendanceApprovalsByStatusService = async (email, status) => {
  // ===== VERIFY ADMIN =====
  const admin = await Employee.findOne({ email });
  if (!admin) {
    throw new ForbiddenError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  // ===== BUILD FILTER =====
  const filter = {};
  if (status) {
    filter.status = status;
  }

  // ===== FETCH APPROVALS =====
  const approvals = await AdminApproval.find(filter)
    .populate("employee", "firstName lastName email role")
    .populate("actionBy", "firstName lastName email")
    .sort({ createdAt: -1 });

  if (!approvals.length) return [];

  // ===== FORMAT RESPONSE =====
  return approvals.map((doc) => ({
    approvalId: doc.approvalId,
    employee: doc.employee,
    requestType: doc.requestType,
    recordDate: doc.recordDate,
    requestData: doc.requestData,
    status: doc.status,
    actionBy: doc.actionBy,
    actionAt: doc.actionAt,
    rejectionReason: doc.rejectionReason,
    createdAt: doc.createdAt,
  }));
};
