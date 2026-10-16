/**
 * Leave requests (AdminApproval requestType LEAVE): apply, list, approve / reject (idempotent),
 * cancel, paid / unpaid override, balance and the team leave calendar. Re-exported by
 * attendance.service.js.
 *
 * Rules (values from PayrollSettings):
 *   - types SICK, CASUAL, UNPAID; FULL_DAY or HALF_DAY; HALF_DAY needs halfDaySession
 *     (MORNING / AFTERNOON) and a single date;
 *   - the server counts the days (Sundays and holidays skipped; half = 0.5); the client never sends it;
 *   - no overlap with another pending / approved leave (two half days with different sessions on one
 *     date are allowed); a range of only Sundays / holidays is refused; toDate >= fromDate;
 *     start no earlier than leaveBackdateDays ago; reason required (validator);
 *   - on approval the server decides which days are paid with the monthly paid quota
 *     (attendancerules.allocatePaidLeave); an admin may override it (audited).
 *
 * Exports: requestLeaveService, getMyLeaveRequestsService, getLeaveRequestByIdService,
 * getAllLeaveRequestsForAdminService, getLeaveRequestsByStatusService, updateLeaveRequestStatusService,
 * cancelLeaveRequestService, overrideLeavePaidService, getLeaveBalanceService, getTeamLeaveCalendarService
 * Used by: services/attendance/attendance.service.js
 */
import { v6 as uuidv6 } from "uuid";
import mongoose from "mongoose";
import { AdminApproval } from "../../models/attendanceapproval.model.js";
import AttendanceDay from "../../models/attendanceday.model.js";
import Holiday from "../../models/holiday.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { addDays, istDateKey, monthBounds, nowUtc } from "../../helpers/istdate.helper.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { logger } from "../../helpers/logger.helper.js";
import { allocatePaidLeave, countLeaveDays } from "./attendancerules.js";
import { leaveDaysFromApprovals, loadHolidays } from "./monthdata.service.js";
import { getPayrollSettings } from "../payroll/payrollsettings.service.js";
import { assertMonthsOpen } from "../payroll/payrolllock.service.js";
import { sendNotification } from "../notification/notification.service.js";
import { employeeHasPermission } from "../../middlewares/permission.middleware.js";
import {
  employeeDisplayName,
  findActiveEmployeeByEmail,
  searchEmployeeIds,
} from "../employee/employeelookup.service.js";
import { resolveMonth } from "./calendar.service.js";

const ACTIVE_STATUSES = ["PENDING", "APPROVED"];
const MONTH_KEY_LENGTH = 7;

const notify = async (payload) => {
  try {
    await sendNotification(payload);
  } catch (error) {
    logger.error("Leave notification failed", { type: payload.type, error });
  }
};

/** A leave approval in the response shape (old keys kept, new ones added). */
const toPublic = (approval) => {
  const data = approval.requestData || {};
  return {
    approvalId: approval.approvalId,
    employee: approval.employee,
    leaveType: data.leaveType,
    leaveDuration: data.leaveDuration,
    halfDaySession: data.halfDaySession || null,
    fromDate: data.fromDate,
    toDate: data.toDate,
    leaveReason: data.leaveReason,
    totalDays: approval.totalDays ?? data.totalDays ?? null,
    days: approval.days || [],
    paidDays: approval.paidDays ?? null,
    unpaidDays: approval.unpaidDays ?? null,
    isPaid: approval.isPaid ?? null,
    paidOverridden: Boolean(approval.paidOverrides?.length),
    status: approval.status,
    note: approval.note || null,
    rejectionReason: approval.rejectionReason || null,
    actionBy: approval.actionBy || null,
    actionAt: approval.actionAt || null,
    cancelledAt: approval.cancelledAt || null,
    createdAt: approval.createdAt,
  };
};

/** Pending / approved leaves of an employee that touch [from, to]. */
const activeLeavesInRange = (employeeId, from, to, extraFilter = {}) =>
  AdminApproval.find({
    employee: employeeId,
    requestType: "LEAVE",
    status: { $in: ACTIVE_STATUSES },
    "requestData.fromDate": { $lte: to },
    "requestData.toDate": { $gte: from },
    ...extraFilter,
  }).lean();

/** True when two leaves may share a date: both half days with different sessions. */
const canShareDate = (existing, leaveDuration, halfDaySession) =>
  existing.requestData?.leaveDuration === "HALF_DAY" &&
  leaveDuration === "HALF_DAY" &&
  existing.requestData?.halfDaySession &&
  existing.requestData.halfDaySession !== halfDaySession;

/**
 * Applies for leave.
 * Example: { leaveType: "CASUAL", leaveDuration: "HALF_DAY", halfDaySession: "MORNING",
 *   fromDate: "2026-10-20", toDate: "2026-10-20", leaveReason: "Bank work" } -> totalDays 0.5.
 *
 * @param {{ email: string }} user
 * @param {object} data validated by leave.validator.js
 * @returns {Promise<object>}
 * @throws {BadRequestError} 400 INVALID_DATE_RANGE / HALF_DAY_SINGLE_DATE / HALF_DAY_SESSION_REQUIRED /
 *   LEAVE_BACKDATE_LIMIT / LEAVE_TOO_FAR_AHEAD / LEAVE_NO_WORKING_DAYS / ATTENDANCE_EXISTS
 * @throws {ConflictError} 409 LEAVE_OVERLAP
 */
export const requestLeaveService = async (user, data) => {
  const { leaveType, leaveDuration = "FULL_DAY", fromDate, toDate, leaveReason } = data;
  const halfDaySession = leaveDuration === "HALF_DAY" ? data.halfDaySession : null;
  if (toDate < fromDate) {
    throw new BadRequestError("toDate cannot be before fromDate", { code: ERROR_CODES.INVALID_DATE_RANGE });
  }
  if (leaveDuration === "HALF_DAY" && fromDate !== toDate) {
    throw new BadRequestError("A half-day leave must be for a single date", { code: ERROR_CODES.HALF_DAY_SINGLE_DATE });
  }
  if (leaveDuration === "HALF_DAY" && !halfDaySession) {
    throw new BadRequestError("Choose MORNING or AFTERNOON for a half-day leave", {
      code: ERROR_CODES.HALF_DAY_SESSION_REQUIRED,
    });
  }

  const settings = await getPayrollSettings();
  const today = istDateKey(nowUtc());
  if (fromDate < addDays(today, -settings.leaveBackdateDays)) {
    throw new BadRequestError(`Leave can start at most ${settings.leaveBackdateDays} days in the past`, {
      code: ERROR_CODES.LEAVE_BACKDATE_LIMIT,
    });
  }
  if (toDate > addDays(today, settings.leaveMaxFutureDays)) {
    throw new BadRequestError(`Leave can end at most ${settings.leaveMaxFutureDays} days ahead`, {
      code: ERROR_CODES.LEAVE_TOO_FAR_AHEAD,
    });
  }

  const employee = await findActiveEmployeeByEmail(user.email);
  const holidays = await loadHolidays(fromDate, toDate);
  const { days, totalDays } = countLeaveDays({
    fromDate,
    toDate,
    leaveDuration,
    holidayDates: new Set(holidays.map((holiday) => holiday.date)),
    settings,
  });
  if (!days.length) {
    throw new BadRequestError("The selected dates are only Sundays or holidays", {
      code: ERROR_CODES.LEAVE_NO_WORKING_DAYS,
    });
  }

  const overlapping = (await activeLeavesInRange(employee._id, fromDate, toDate)).filter(
    (existing) => !canShareDate(existing, leaveDuration, halfDaySession)
  );
  if (overlapping.length) {
    const first = toPublic(overlapping[0]);
    throw new ConflictError(`You already have a ${first.status.toLowerCase()} leave from ${first.fromDate} to ${first.toDate}`, {
      code: ERROR_CODES.LEAVE_OVERLAP,
    });
  }

  if (leaveDuration === "FULL_DAY") {
    const worked = await AttendanceDay.findOne({ employee: employee._id, date: { $in: days.map((day) => day.date) } })
      .select("date")
      .lean();
    if (worked) {
      throw new BadRequestError(`You already punched in on ${worked.date}. Apply for a half day instead.`, {
        code: ERROR_CODES.ATTENDANCE_EXISTS,
      });
    }
  }

  const approval = await AdminApproval.create({
    approvalId: uuidv6(),
    employee: employee._id,
    requestType: "LEAVE",
    recordDate: fromDate,
    requestData: { leaveType, leaveDuration, halfDaySession, fromDate, toDate, leaveReason, totalDays },
    days: days.map((day) => ({ ...day, paidFraction: 0 })),
    totalDays,
    status: "PENDING",
  });

  await notify({
    sender: employee._id,
    permission: "attendance.log.update",
    title: "New Leave Request",
    message: `${employeeDisplayName(employee)} requested ${totalDays} day(s) ${leaveType} leave from ${fromDate} to ${toDate}`,
    type: "LEAVE_REQUESTED",
    entityId: approval.approvalId,
    entityModel: "AdminApproval",
    metadata: { approvalId: approval.approvalId, employeeEmail: employee.email, leaveType, leaveDuration, halfDaySession, fromDate, toDate, totalDays },
  });

  return toPublic(approval.toObject());
};

/**
 * The logged-in employee's leave requests, newest first, paginated; optional status filter.
 *
 * @param {string} email
 * @param {{ status?: string, skip: number, limit: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getMyLeaveRequestsService = async (email, { status, skip, limit }) => {
  const employee = await findActiveEmployeeByEmail(email);
  const filter = { employee: employee._id, requestType: "LEAVE", ...(status ? { status } : {}) };
  const [requests, total] = await Promise.all([
    AdminApproval.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminApproval.countDocuments(filter),
  ]);
  return { items: requests.map(toPublic), total };
};

/**
 * One leave request: the owner, or anyone with attendance.team.read / an admin role.
 *
 * @param {{ _id: *, role: number, permissions: string[] }} currentUser
 * @param {string} approvalId
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 LEAVE_REQUEST_NOT_FOUND
 */
export const getLeaveRequestByIdService = async (currentUser, approvalId) => {
  const approval = await AdminApproval.findOne({ approvalId, requestType: "LEAVE" })
    .populate("employee", "firstName lastName email role")
    .lean();
  const isOwner = approval && String(approval.employee?._id) === String(currentUser._id);
  const isAdmin = [0, 1].includes(currentUser.role) || employeeHasPermission(currentUser, PERMISSIONS.TEAM_ATTENDANCE_READ);
  if (!approval || (!isOwner && !isAdmin)) {
    throw new NotFoundError("Leave request not found", { code: ERROR_CODES.LEAVE_REQUEST_NOT_FOUND });
  }
  return toPublic(approval);
};

/**
 * Admin list of leave requests, newest first, paginated. Filters: status, search, from, to.
 *
 * @param {{ status?: string, search?: string, from?: string, to?: string, skip: number, limit: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const getAllLeaveRequestsForAdminService = async ({ status, search, from, to, skip = 0, limit = 50 }) => {
  const filter = { requestType: "LEAVE" };
  if (status) filter.status = status;
  if (from) filter["requestData.toDate"] = { $gte: from };
  if (to) filter["requestData.fromDate"] = { $lte: to };
  if (search) filter.employee = { $in: await searchEmployeeIds(search) };
  const [requests, total] = await Promise.all([
    AdminApproval.find(filter)
      .populate("employee", "firstName lastName email role")
      .populate("actionBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AdminApproval.countDocuments(filter),
  ]);
  return { items: requests.map(toPublic), total };
};

/** Kept for older imports: same as the admin list filtered by status. */
export const getLeaveRequestsByStatusService = async (email, status) =>
  (await getAllLeaveRequestsForAdminService({ status, skip: 0, limit: 100 })).items;

/**
 * Paid days already used per month by the employee's APPROVED leaves (excluding one approval).
 *
 * @returns {Promise<Record<string, number>>} { "2026-10": 1 }
 */
const paidUsedByMonth = async (employeeId, monthKeys, settings, excludeApprovalId = null) => {
  const usedByMonth = {};
  for (const monthKey of monthKeys) {
    const [year, month] = monthKey.split("-").map(Number);
    const { from, to } = monthBounds(year, month);
    const [approvals, holidays] = await Promise.all([
      AdminApproval.find({
        employee: employeeId,
        requestType: "LEAVE",
        status: "APPROVED",
        "requestData.fromDate": { $lte: to },
        "requestData.toDate": { $gte: from },
        ...(excludeApprovalId ? { approvalId: { $ne: excludeApprovalId } } : {}),
      }).lean(),
      loadHolidays(from, to),
    ]);
    const days = leaveDaysFromApprovals(approvals, new Set(holidays.map((holiday) => holiday.date)), settings);
    usedByMonth[monthKey] = days
      .filter((day) => day.date.startsWith(monthKey))
      .reduce((sum, day) => sum + day.paidFraction, 0);
  }
  return usedByMonth;
};

/**
 * Approves or rejects a leave request. Only a PENDING request can be decided; the status change is
 * conditional, so approving twice is impossible. On approval the days are re-counted with the
 * current holidays and the paid quota is applied.
 *
 * @param {{ email: string }} adminUser
 * @param {string} approvalId
 * @param {"APPROVED" | "REJECTED"} action
 * @param {{ note?: string, rejectionReason?: string }} [extra]
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 LEAVE_REQUEST_NOT_FOUND
 * @throws {ConflictError} 409 ALREADY_PROCESSED / LEAVE_OVERLAP / MONTH_FINALIZED
 */
export const updateLeaveRequestStatusService = async (adminUser, approvalId, action, extra = {}) => {
  const admin = await findActiveEmployeeByEmail(adminUser.email);
  const approval = await AdminApproval.findOne({ approvalId, requestType: "LEAVE" }).lean();
  if (!approval) throw new NotFoundError("Leave request not found", { code: ERROR_CODES.LEAVE_REQUEST_NOT_FOUND });
  if (approval.status !== "PENDING") {
    throw new ConflictError(`Request already ${approval.status.toLowerCase()}`, { code: ERROR_CODES.ALREADY_PROCESSED });
  }
  const data = approval.requestData;
  const now = nowUtc();
  const update = { status: action, actionBy: admin._id, actionAt: now, note: extra.note || null };

  if (action === "REJECTED") {
    update.rejectionReason = extra.rejectionReason || extra.note || "Not specified";
  } else {
    const settings = await getPayrollSettings();
    const holidays = await loadHolidays(data.fromDate, data.toDate);
    const counted = countLeaveDays({
      fromDate: data.fromDate,
      toDate: data.toDate,
      leaveDuration: data.leaveDuration,
      holidayDates: new Set(holidays.map((holiday) => holiday.date)),
      settings,
    });
    await assertMonthsOpen(counted.days.map((day) => day.date));
    const clash = (
      await activeLeavesInRange(approval.employee, data.fromDate, data.toDate, {
        status: "APPROVED",
        approvalId: { $ne: approvalId },
      })
    ).filter((existing) => !canShareDate(existing, data.leaveDuration, data.halfDaySession));
    if (clash.length) {
      throw new ConflictError("Another approved leave overlaps these dates", { code: ERROR_CODES.LEAVE_OVERLAP });
    }
    const monthKeys = [...new Set(counted.days.map((day) => day.date.slice(0, MONTH_KEY_LENGTH)))];
    const usedByMonth = await paidUsedByMonth(approval.employee, monthKeys, settings, approvalId);
    const allocation = allocatePaidLeave({ days: counted.days, leaveType: data.leaveType, settings, usedByMonth });
    Object.assign(update, {
      days: allocation.days,
      totalDays: counted.totalDays,
      paidDays: allocation.paidDays,
      unpaidDays: allocation.unpaidDays,
      isPaid: allocation.unpaidDays === 0 && allocation.paidDays > 0,
      "requestData.totalDays": counted.totalDays,
    });
  }

  const decided = await AdminApproval.findOneAndUpdate(
    { approvalId, status: "PENDING" },
    { $set: update },
    { new: true }
  ).lean();
  if (!decided) throw new ConflictError("Request already processed", { code: ERROR_CODES.ALREADY_PROCESSED });

  const result = toPublic(decided);
  await notify({
    receivers: [approval.employee],
    sender: admin._id,
    title: action === "APPROVED" ? "Leave Approved" : "Leave Rejected",
    message:
      action === "APPROVED"
        ? `Your leave ${data.fromDate} to ${data.toDate} was approved (${result.paidDays} paid, ${result.unpaidDays} unpaid)`
        : `Your leave ${data.fromDate} to ${data.toDate} was rejected${update.rejectionReason ? `: ${update.rejectionReason}` : ""}`,
    type: action === "APPROVED" ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
    entityId: approvalId,
    entityModel: "AdminApproval",
    metadata: { approvalId, status: action },
  });
  return { ...result, actionBy: admin.email };
};

/**
 * Cancels the employee's own PENDING leave request (kept with status CANCELLED, not deleted).
 *
 * @param {string} email
 * @param {string} approvalId
 * @returns {Promise<{ approvalId: string, status: "CANCELLED", cancelledAt: Date }>}
 * @throws {NotFoundError} 404 APPROVAL_NOT_FOUND when not found, not own, or not pending
 */
export const cancelLeaveRequestService = async (email, approvalId) => {
  const employee = await findActiveEmployeeByEmail(email);
  const cancelledAt = nowUtc();
  const cancelled = await AdminApproval.findOneAndUpdate(
    { approvalId, employee: employee._id, requestType: "LEAVE", status: "PENDING" },
    { $set: { status: "CANCELLED", cancelledAt } },
    { new: true }
  ).lean();
  if (!cancelled) {
    throw new NotFoundError("Pending leave request not found or already processed", {
      code: ERROR_CODES.APPROVAL_NOT_FOUND,
    });
  }
  return { approvalId, status: "CANCELLED", cancelledAt };
};

/**
 * Admin override of which days of an APPROVED leave are paid. Recorded on the request
 * (paidOverrides) and in the audit log.
 * Example: { isPaid: true, note: "Medical certificate" } -> every day paid.
 *
 * @param {{ _id: *, email: string }} admin req.currentUser
 * @param {string} approvalId
 * @param {{ isPaid?: boolean, days?: Array<{ date: string, paidFraction: number }>, note: string }} input
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 LEAVE_REQUEST_NOT_FOUND
 * @throws {BadRequestError} 400 INVALID_STATUS (not approved) / INVALID_REQUEST_DATA
 * @throws {ConflictError} 409 MONTH_FINALIZED
 */
export const overrideLeavePaidService = async (admin, approvalId, { isPaid, days: requestedDays, note }) => {
  const approval = await AdminApproval.findOne({ approvalId, requestType: "LEAVE" }).lean();
  if (!approval) throw new NotFoundError("Leave request not found", { code: ERROR_CODES.LEAVE_REQUEST_NOT_FOUND });
  if (approval.status !== "APPROVED") {
    throw new BadRequestError("Only approved leave can be overridden", { code: ERROR_CODES.INVALID_STATUS });
  }
  const settings = await getPayrollSettings();
  let before = approval.days;
  if (!before?.length) {
    const holidays = await loadHolidays(approval.requestData.fromDate, approval.requestData.toDate);
    before = leaveDaysFromApprovals([approval], new Set(holidays.map((holiday) => holiday.date)), settings).map((day) => ({
      date: day.date,
      fraction: day.fraction,
      paidFraction: day.paidFraction,
    }));
  }
  await assertMonthsOpen(before.map((day) => day.date));

  const requestedByDate = new Map((requestedDays || []).map((day) => [day.date, day.paidFraction]));
  const after = before.map((day) => {
    let paidFraction = day.paidFraction;
    if (typeof isPaid === "boolean") paidFraction = isPaid ? day.fraction : 0;
    if (requestedByDate.has(day.date)) paidFraction = requestedByDate.get(day.date);
    if (paidFraction > day.fraction || ![0, 0.5, 1].includes(paidFraction)) {
      throw new BadRequestError(`Paid fraction for ${day.date} must be 0, 0.5 or up to the leave day`, {
        code: ERROR_CODES.INVALID_REQUEST_DATA,
      });
    }
    return { date: day.date, fraction: day.fraction, paidFraction };
  });
  const paidDays = after.reduce((sum, day) => sum + day.paidFraction, 0);
  const totalDays = after.reduce((sum, day) => sum + day.fraction, 0);

  const updated = await AdminApproval.findOneAndUpdate(
    { approvalId, status: "APPROVED" },
    {
      $set: { days: after, paidDays, unpaidDays: totalDays - paidDays, isPaid: paidDays === totalDays && totalDays > 0 },
      $push: { paidOverrides: { by: admin._id, at: nowUtc(), note, before, after } },
    },
    { new: true }
  ).lean();
  await writeHrAudit({
    actor: admin,
    targetEmployeeId: approval.employee,
    action: "leave.paid.override",
    permission: PERMISSIONS.PAYROLL_UPDATE,
    details: { approvalId, note, paidDaysBefore: before.reduce((sum, day) => sum + day.paidFraction, 0), paidDaysAfter: paidDays },
  });
  return toPublic(updated);
};

/**
 * Paid-leave balance of the logged-in employee for a month: quota, used, remaining, plus pending
 * and unpaid days.
 *
 * @param {{ email: string }} user
 * @param {*} [month]
 * @param {*} [year]
 * @returns {Promise<object>}
 */
export const getLeaveBalanceService = async (user, month, year) => {
  const resolved = resolveMonth(month, year);
  const employee = await findActiveEmployeeByEmail(user.email);
  const settings = await getPayrollSettings();
  const { from, to } = monthBounds(resolved.year, resolved.month);
  const [approvals, holidays] = await Promise.all([activeLeavesInRange(employee._id, from, to), loadHolidays(from, to)]);
  const days = leaveDaysFromApprovals(approvals, new Set(holidays.map((holiday) => holiday.date)), settings).filter(
    (day) => day.date >= from && day.date <= to
  );
  const approved = days.filter((day) => day.status === "APPROVED");
  const used = approved.reduce((sum, day) => sum + day.paidFraction, 0);
  const byType = {};
  for (const day of approved) byType[day.leaveType] = (byType[day.leaveType] || 0) + day.fraction;
  return {
    ...resolved,
    quota: settings.paidLeaveQuotaPerMonth,
    used,
    remaining: Math.max(0, settings.paidLeaveQuotaPerMonth - used),
    unpaidTaken: approved.reduce((sum, day) => sum + (day.fraction - day.paidFraction), 0),
    pendingDays: days.filter((day) => day.status === "PENDING").reduce((sum, day) => sum + day.fraction, 0),
    byType,
    paidLeaveTypes: settings.paidLeaveTypes,
  };
};

/**
 * Approved (and optionally pending) leaves of all employees in a month, with each leave's days,
 * plus the month's holidays. Used by the admin Team Leave Calendar.
 *
 * @param {{ month?: number, year?: number, includePending?: boolean, employeeId?: string }} query
 * @returns {Promise<{ year, month, holidays: object[], leaves: object[] }>}
 */
export const getTeamLeaveCalendarService = async ({ month, year, includePending = false, employeeId }) => {
  const resolved = resolveMonth(month, year);
  const { from, to } = monthBounds(resolved.year, resolved.month);
  const filter = {
    requestType: "LEAVE",
    status: { $in: includePending ? ACTIVE_STATUSES : ["APPROVED"] },
    "requestData.fromDate": { $lte: to },
    "requestData.toDate": { $gte: from },
  };
  if (employeeId) filter.employee = new mongoose.Types.ObjectId(String(employeeId));
  const [approvals, holidays] = await Promise.all([
    AdminApproval.find(filter).populate("employee", "firstName lastName email role isDeleted").sort({ "requestData.fromDate": 1 }).lean(),
    Holiday.find({ date: { $gte: from, $lte: to } }).sort({ date: 1 }).lean(),
  ]);
  const settings = await getPayrollSettings();
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));
  const leaves = approvals
    .filter((approval) => approval.employee && !approval.employee.isDeleted)
    .map((approval) => {
      const days = leaveDaysFromApprovals([approval], holidayDates, settings).filter((day) => day.date >= from && day.date <= to);
      return { ...toPublic(approval), days: days.map(({ date, fraction, paidFraction }) => ({ date, fraction, paidFraction })) };
    });
  return {
    ...resolved,
    holidays: holidays.map((holiday) => ({ date: holiday.date, title: holiday.title, type: holiday.type })),
    leaves,
  };
};
