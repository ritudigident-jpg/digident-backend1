/**
 * Business logic for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals. Throws AppError subclasses on failure.
 *
 * Exports: createHolidayService, getHolidaysService
 * Used by: services/attendance/attendance.service.js
 */

/**
 * Holidays: create (marks every employee's day as a holiday) and list. Re-exported by attendance.service.js.
 */
import Employee from "../../models/employee.model.js";
import { EmployeeRecord } from "../../models/attendance.model.js";
import { getISTDateString, getISTNow } from "../../helpers/date.helper.js";
import { sendNotification } from "../notification/notification.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Create holiday.
 *
 * @param {*} date
 * @param {*} title
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createHolidayService = async (date, title) => {
  const holidayDate = new Date(date);
  if (isNaN(holidayDate)) {
    throw new BadRequestError("Invalid date format", { code: ERROR_CODES.INVALID_DATE });
  }

  const dateStr = holidayDate.toISOString().split("T")[0];

  const employees = await Employee.find({ isDeleted: false });

  let updated = 0;
  let skipped = 0;

  for (const emp of employees) {
    const record = await EmployeeRecord.findOne({ employee: emp._id });

    // If employee has no record document → skip
    if (!record) {
      skipped++;
      continue;
    }

    const day = record.records.find((r) => r.date === dateStr);

    if (!day) {
      // Create new holiday entry
      record.records.push({
        recordId: `HOLIDAY-${dateStr}`,
        date: dateStr,
        dayType: ["HOLIDAY"],
        status: ["HOLIDAY"],
        leaveType: null,
        leaveDuration: "FULL_DAY",
        leaveStatus: null,
        fromDate: null,
        toDate: null,
        leaveReason: title,
        punchIn: null,
        punchOut: null,
        totalWorkedTime: { hours: 0, minutes: 0 },
        requiresAdminApproval: false,
        adminAdjusted: true,
      });
      updated++;
    } else {
      // Update existing record to holiday
      day.dayType = ["HOLIDAY"];
      day.status = ["HOLIDAY"];
      day.leaveType = null;
      day.leaveDuration = "FULL_DAY";
      day.leaveStatus = null;
      day.fromDate = null;
      day.toDate = null;
      day.leaveReason = title;
      day.punchIn = null;
      day.punchOut = null;
      day.totalWorkedTime = { hours: 0, minutes: 0 };
      day.requiresAdminApproval = false;
      day.adminAdjusted = true;
      updated++;
    }
    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: null,
        permission: "attendance.log.update",
        title: "Create Holiday",
        message: `Create holiday on ${dateStr}`,
        type: "ATTENDANCE_LOG_UPDATED",
        entityId: null,
        entityModel: "Employee",
      });
    } catch (err) {
      logger.error("Notification failed on create holiday", { error: err.message });
    }

    await record.save();
  }

  return {
    date: dateStr,
    title,
    totalEmployees: employees.length,
    updated,
    skipped,
  };
};

/**
 * Get holidays.
 *
 * @param {*} email
 * @param {*} [type]
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getHolidaysService = async (email, type = "all") => {
  const todayStr = getISTDateString(getISTNow());

  // Find employee
  const employee = await Employee.findOne({ email, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found");
  }

  // Fetch employee record
  const record = await EmployeeRecord.findOne({ employee: employee._id });
  if (!record || !Array.isArray(record.records)) {
    return [];
  }

  // Extract holiday records
  const holidays = record.records
    .filter((day) => day.dayType.includes("HOLIDAY"))
    .filter((day) => {
      if (type === "past") return day.date <= todayStr;
      if (type === "upcoming") return day.date >= todayStr;
      return true; // all
    })
    .map((day) => ({
      date: day.date,
      reason: day.leaveReason || "Holiday",
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  return holidays;
};
