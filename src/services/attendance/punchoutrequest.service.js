/**
 * Forgot-to-punch-out correction requests (AdminApproval requestType FORGOT_PUNCH_OUT). This is
 * the ONLY place a client-supplied time is accepted. Rules for a request:
 *   - the day has a punch-in and no punch-out;
 *   - the requested time is on the SAME IST date as the punch-in, after it, and not in the future;
 *   - the day is within the last N days (settings.punchOutCorrectionWindowDays, default 7);
 *   - only one pending request per day (partial unique index);
 *   - the payroll month is not finalized.
 * Approval sets the punch-out and recomputes worked time in one transaction; rejection marks the
 * day ABSENT (as before). Both sides are notified. Re-exported by attendance.service.js.
 *
 * Exports: sendPunchOutRequestService, getAllPunchOutRequestsForAdminService,
 * updatePunchOutRequestStatusService, getMyPunchOutRequestsService, getAttendanceApprovalsByStatusService
 * Used by: services/attendance/attendance.service.js
 */
import { v6 as uuidv6 } from "uuid";
import AttendanceDay from "../../models/attendanceday.model.js";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import {
  addDays,
  formatIst,
  istDateKey,
  istDateTimeToUtc,
  nowUtc,
  parseClientDateTime,
} from "../../helpers/istdate.helper.js";
import { isDuplicateKeyError, runInTransaction } from "../../helpers/transaction.helper.js";
import { sendNotification } from "../notification/notification.service.js";
import { logger } from "../../helpers/logger.helper.js";
import { getPayrollSettings } from "../payroll/payrollsettings.service.js";
import { assertMonthsOpen } from "../payroll/payrolllock.service.js";
import { employeeDisplayName, findActiveEmployeeByEmail } from "../employee/employeelookup.service.js";
import { computeStoredFields } from "./attendancecommon.service.js";

const notify = async (payload) => {
  try {
    await sendNotification(payload);
  } catch (error) {
    logger.error("Punch-out request notification failed", { type: payload.type, error });
  }
};

/** Requested punch-out instant of a request (new field, or the legacy string). */
const requestedInstantOf = (approval) =>
  approval.requestedPunchOutAt ||
  (approval.requestData?.requestedPunchOutAt ? new Date(approval.requestData.requestedPunchOutAt) : null) ||
  parseClientDateTime(approval.requestData?.requestedPunchOut);

const toPublic = (approval, day = null) => ({
  approvalId: approval.approvalId,
  employee: approval.employee,
  date: approval.recordDate,
  requestedPunchOut: requestedInstantOf(approval),
  requestedPunchOutAt: requestedInstantOf(approval),
  reason: approval.reason || approval.requestData?.reason || null,
  punchIn: day?.punchIn || null,
  status: approval.status,
  note: approval.note || null,
  rejectionReason: approval.rejectionReason || null,
  actionBy: approval.actionBy || null,
  actionAt: approval.actionAt || null,
  createdAt: approval.createdAt,
});

/**
 * Creates a correction request. Accepts { date, time ("HH:mm" IST), reason } or the older
 * { requestedPunchOut } (no zone = IST wall time; "Z" / offset = exact instant).
 * Example: { date: "2026-10-15", time: "18:30", reason: "Forgot" } -> 2026-10-15T13:00:00Z.
 *
 * @param {{ email: string }} user
 * @param {{ date?: string, time?: string, requestedPunchOut?: string, reason: string }} input
 * @returns {Promise<object>}
 * @throws {BadRequestError} 400 INVALID_PUNCH_OUT / FUTURE_PUNCH_OUT / NO_PUNCH_IN /
 *   CORRECTION_NOT_SAME_DAY / INVALID_PUNCH_OUT_ORDER / CORRECTION_WINDOW_EXCEEDED
 * @throws {ConflictError} 409 ALREADY_PUNCHED_OUT / DUPLICATE_REQUEST / MONTH_FINALIZED
 */
export const sendPunchOutRequestService = async (user, { date, time, requestedPunchOut, reason }) => {
  const requested = date && time ? istDateTimeToUtc(date, time) : parseClientDateTime(requestedPunchOut);
  if (!requested) {
    throw new BadRequestError("Invalid punch-out time", { code: ERROR_CODES.INVALID_PUNCH_OUT });
  }
  const now = nowUtc();
  if (requested > now) {
    throw new BadRequestError("Punch-out time cannot be in the future", { code: ERROR_CODES.FUTURE_PUNCH_OUT });
  }
  const recordDate = date || istDateKey(requested);
  const employee = await findActiveEmployeeByEmail(user.email);
  const settings = await getPayrollSettings();

  const day = await AttendanceDay.findOne({ employee: employee._id, date: recordDate }).lean();
  if (!day?.punchIn) {
    throw new BadRequestError(`No punch-in found on ${recordDate}`, { code: ERROR_CODES.NO_PUNCH_IN });
  }
  if (day.punchOut) {
    throw new ConflictError("Punch-out already exists for this day", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  }
  if (istDateKey(requested) !== day.date) {
    throw new BadRequestError("Punch-out must be on the same day as the punch-in", {
      code: ERROR_CODES.CORRECTION_NOT_SAME_DAY,
    });
  }
  if (requested <= new Date(day.punchIn)) {
    throw new BadRequestError("Punch-out must be after the punch-in", { code: ERROR_CODES.INVALID_PUNCH_OUT_ORDER });
  }
  const today = istDateKey(now);
  if (day.date < addDays(today, -settings.punchOutCorrectionWindowDays)) {
    throw new BadRequestError(
      `Corrections are allowed only for the last ${settings.punchOutCorrectionWindowDays} days`,
      { code: ERROR_CODES.CORRECTION_WINDOW_EXCEEDED }
    );
  }
  await assertMonthsOpen([day.date]);

  let approval;
  try {
    approval = await runInTransaction(async (session) => {
      const [created] = await AdminApproval.create(
        [
          {
            approvalId: uuidv6(),
            employee: employee._id,
            requestType: "FORGOT_PUNCH_OUT",
            recordDate: day.date,
            requestData: { requestedPunchOut: requested.toISOString(), requestedPunchOutAt: requested.toISOString(), reason },
            requestedPunchOutAt: requested,
            reason,
            status: "PENDING",
          },
        ],
        { session }
      );
      await AttendanceDay.updateOne({ _id: day._id }, { $set: { requiresAdminApproval: true } }, { session });
      return created;
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("A correction request for this day is already pending", {
        code: ERROR_CODES.DUPLICATE_REQUEST,
      });
    }
    throw error;
  }

  await notify({
    sender: employee._id,
    permission: "attendance.log.update",
    title: "Punch-Out Correction Request",
    message: `${employeeDisplayName(employee)} requested punch-out at ${formatIst(requested)} for ${day.date}`,
    type: "FORGOT_PUNCH_OUT_REQUEST",
    entityId: approval.approvalId,
    entityModel: "AdminApproval",
    metadata: { approvalId: approval.approvalId, employeeEmail: employee.email, requestDate: day.date, requestedPunchOut: requested, reason },
  });

  return { ...toPublic(approval.toObject(), day), status: "PENDING" };
};

/**
 * Admin list of correction requests, newest first, paginated. Optional status filter.
 *
 * @param {{ status?: string, skip: number, limit: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getAllPunchOutRequestsForAdminService = async ({ status, skip, limit }) => {
  const filter = { requestType: "FORGOT_PUNCH_OUT", ...(status ? { status } : {}) };
  const [approvals, total] = await Promise.all([
    AdminApproval.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("employee", "firstName lastName email role")
      .populate("actionBy", "firstName lastName email")
      .lean(),
    AdminApproval.countDocuments(filter),
  ]);
  const days = await AttendanceDay.find({
    $or: approvals.map((approval) => ({ employee: approval.employee?._id, date: approval.recordDate })),
  })
    .select("employee date punchIn")
    .lean()
    .catch(() => []);
  const dayKey = (employeeId, date) => `${employeeId}:${date}`;
  const dayByKey = new Map(days.map((day) => [dayKey(day.employee, day.date), day]));
  return {
    items: approvals.map((approval) => toPublic(approval, dayByKey.get(dayKey(approval.employee?._id, approval.recordDate)))),
    total,
  };
};

/**
 * Approves or rejects a correction. Idempotent: only a PENDING request can be decided, and the
 * status change is conditional, so a double click cannot apply it twice.
 *
 * @param {{ email: string }} adminUser
 * @param {string} approvalId
 * @param {"APPROVED" | "REJECTED"} action
 * @param {{ note?: string, rejectionReason?: string }} [extra]
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 APPROVAL_NOT_FOUND / DAY_RECORD_NOT_FOUND
 * @throws {ConflictError} 409 ALREADY_PROCESSED / ALREADY_PUNCHED_OUT / MONTH_FINALIZED
 * @throws {BadRequestError} 400 INVALID_REQUEST_DATA / INVALID_PUNCH_OUT_ORDER
 */
export const updatePunchOutRequestStatusService = async (adminUser, approvalId, action, extra = {}) => {
  const admin = await findActiveEmployeeByEmail(adminUser.email);
  const approval = await AdminApproval.findOne({ approvalId, requestType: "FORGOT_PUNCH_OUT" }).lean();
  if (!approval) throw new NotFoundError("Approval request not found", { code: ERROR_CODES.APPROVAL_NOT_FOUND });
  if (approval.status !== "PENDING") {
    throw new ConflictError("Request already processed", { code: ERROR_CODES.ALREADY_PROCESSED });
  }
  const day = await AttendanceDay.findOne({ employee: approval.employee, date: approval.recordDate }).lean();
  if (!day) throw new NotFoundError("Day record not found", { code: ERROR_CODES.DAY_RECORD_NOT_FOUND });
  if (day.punchOut) throw new ConflictError("Punch-out already exists", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  await assertMonthsOpen([day.date]);

  const decidedAt = nowUtc();
  const decision = {
    status: action,
    actionBy: admin._id,
    actionAt: decidedAt,
    note: extra.note || null,
    rejectionReason: action === "REJECTED" ? extra.rejectionReason || extra.note || "Not specified" : null,
  };

  let dayUpdate;
  if (action === "APPROVED") {
    const requested = requestedInstantOf(approval);
    if (!requested || Number.isNaN(requested.getTime())) {
      throw new BadRequestError("Invalid punch-out request data", { code: ERROR_CODES.INVALID_REQUEST_DATA });
    }
    if (requested <= new Date(day.punchIn)) {
      throw new BadRequestError("Punch-out cannot be before punch-in", { code: ERROR_CODES.INVALID_PUNCH_OUT_ORDER });
    }
    const settings = await getPayrollSettings();
    const fields = await computeStoredFields({ employeeId: day.employee, date: day.date, punchIn: day.punchIn, punchOut: requested, settings });
    dayUpdate = {
      punchOut: requested,
      punchOutSource: "CORRECTION",
      correctionApprovalId: approvalId,
      requiresAdminApproval: false,
      adminAdjusted: true,
      ...fields,
    };
  } else {
    dayUpdate = { status: "ABSENT", requiresAdminApproval: false, adminAdjusted: true, correctionApprovalId: approvalId };
  }

  const updatedDay = await runInTransaction(async (session) => {
    const claimed = await AdminApproval.updateOne({ approvalId, status: "PENDING" }, { $set: decision }, { session });
    if (claimed.modifiedCount !== 1) {
      throw new ConflictError("Request already processed", { code: ERROR_CODES.ALREADY_PROCESSED });
    }
    return AttendanceDay.findOneAndUpdate({ _id: day._id, punchOut: null }, { $set: dayUpdate }, { new: true, session }).lean();
  });

  await notify({
    receivers: [approval.employee],
    sender: admin._id,
    title: action === "APPROVED" ? "Punch-Out Correction Approved" : "Punch-Out Correction Rejected",
    message:
      action === "APPROVED"
        ? `Your punch-out for ${day.date} was set to ${formatIst(dayUpdate.punchOut)}`
        : `Your punch-out correction for ${day.date} was rejected${decision.rejectionReason ? `: ${decision.rejectionReason}` : ""}`,
    type: "ATTENDANCE_LOG_UPDATED",
    entityId: approvalId,
    entityModel: "AdminApproval",
    metadata: { approvalId, date: day.date, status: action },
  });

  return {
    approvalId,
    employee: approval.employee,
    date: day.date,
    punchOut: updatedDay?.punchOut || null,
    worked: { hours: Math.floor((updatedDay?.workedMinutes || 0) / 60), minutes: (updatedDay?.workedMinutes || 0) % 60 },
    workedMinutes: updatedDay?.workedMinutes || 0,
    attendanceStatus: updatedDay?.status,
    status: action,
    note: decision.note,
    rejectionReason: decision.rejectionReason,
    actionBy: admin.email,
    actionAt: decidedAt,
  };
};

/**
 * The logged-in employee's correction requests, newest first.
 *
 * @param {string} email
 * @returns {Promise<object[]>}
 */
export const getMyPunchOutRequestsService = async (email) => {
  const employee = await findActiveEmployeeByEmail(email);
  const requests = await AdminApproval.find({ employee: employee._id, requestType: "FORGOT_PUNCH_OUT" })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  return requests.map((request) => toPublic(request));
};

/**
 * All approval requests (leave and punch-out) filtered by status, for admins. Paginated.
 *
 * @param {{ status?: string, skip?: number, limit?: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getAttendanceApprovalsByStatusService = async ({ status, skip = 0, limit = 50 }) => {
  const filter = status ? { status } : {};
  const [approvals, total] = await Promise.all([
    AdminApproval.find(filter)
      .populate("employee", "firstName lastName email role")
      .populate("actionBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AdminApproval.countDocuments(filter),
  ]);
  return {
    items: approvals.map((doc) => ({
      approvalId: doc.approvalId,
      employee: doc.employee,
      requestType: doc.requestType,
      recordDate: doc.recordDate,
      requestData: doc.requestData,
      status: doc.status,
      actionBy: doc.actionBy,
      actionAt: doc.actionAt,
      note: doc.note || null,
      rejectionReason: doc.rejectionReason,
      createdAt: doc.createdAt,
    })),
    total,
  };
};
