/**
 * Business logic for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals. Throws AppError subclasses on failure.
 *
 * Exports: punchInService, punchOutService, sendPunchOutRequestService, getMyAttendancesService,
 * getAllAttendancesService, requestLeaveService, getAllLeaveRequestsForAdminService,
 * getAllPunchOutRequestsForAdminService and 10 more
 * Used by: controllers/attendance/attendance.controller.js
 */

import Employee from "../../models/employee.model.js";
import { EmployeeRecord } from "../../models/attendance.model.js";
import { getISTDateString, getISTNow } from "../../helpers/date.helper.js";
import { v6 as uuidv6 } from "uuid";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";

/**
 * Punch in.
 *
 * @param {*} user
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const punchInService = async (user) => {
  const normalizedEmail = user.email.toLowerCase().trim();

  /* ===== FIND EMPLOYEE ===== */
  const employee = await Employee.findOne({
    email: normalizedEmail,
    isDeleted: false,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const nowIST = getISTNow();
  const today = getISTDateString(nowIST);

  /* ===== FIND OR CREATE RECORD DOC ===== */
  let recordDoc = await EmployeeRecord.findOne({ employee: employee._id });

  if (!recordDoc) {
    recordDoc = await EmployeeRecord.create({
      employee: employee._id,
      records: [],
    });
  }
  /* ===== FIND TODAY RECORD ===== */
  let todayRecord = recordDoc.records.find((r) => r.date === today);

  if (todayRecord) {
    /* ===== 1. HOLIDAY BLOCK ===== */
    if (todayRecord.dayType?.includes("HOLIDAY")) {
      throw new ForbiddenError("Today is a Holiday. Punch-in disabled.", { code: ERROR_CODES.HOLIDAY_BLOCK });
    }
    /* ===== 2. FULL DAY LEAVE BLOCK ===== */
    if (todayRecord.dayType?.includes("LEAVE") && todayRecord.leaveDuration === "FULL_DAY") {
      throw new ForbiddenError("You are on Full-Day Leave", { code: ERROR_CODES.FULL_DAY_LEAVE });
    }

    /* ===== 3. ALREADY PUNCHED IN ===== */
    if (todayRecord.punchIn) {
      throw new BadRequestError("Already punched in for today", { code: ERROR_CODES.ALREADY_PUNCHED_IN });
    }

    /* ===== 4. HALF DAY LEAVE → ALLOW PUNCH IN ===== */
    todayRecord.dayType = [...new Set([...(todayRecord.dayType || []), "WORKING"])];
    todayRecord.punchIn = nowIST;
  } else {
    /* ===== CREATE NEW RECORD ===== */
    recordDoc.records.push({
      recordId: uuidv6(),
      date: today,
      dayType: ["WORKING"],
      punchIn: nowIST,
      punchOut: null,
      status: [],
      totalWorkedTime: { hours: 0, minutes: 0 },
    });
    todayRecord = recordDoc.records[recordDoc.records.length - 1];
  }

  /* ===== LATE MARK (After 9:30 AM IST) ===== */
  const isLate = nowIST.getHours() > 9 || (nowIST.getHours() === 9 && nowIST.getMinutes() > 30);

  if (isLate) {
    todayRecord.status = [...new Set([...(todayRecord.status || []), "LATE"])];
  }

  /* ===== SAVE ===== */
  await recordDoc.save();

  /* ===== RESPONSE ===== */
  return {
    date: today,
    time: nowIST,
    dayType: todayRecord.dayType,
    status: todayRecord.status,
  };
};

/**
 * Punch out.
 *
 * @param {*} user
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const punchOutService = async (user) => {
  const normalizedEmail = user.email.toLowerCase().trim();

  /* ===== FETCH EMPLOYEE ===== */
  const employee = await Employee.findOne({
    email: normalizedEmail,
    isDeleted: false,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const nowIST = getISTNow();
  const today = getISTDateString(nowIST);
  const dayOfWeek = nowIST.getDay(); // 0 = Sunday, 6 = Saturday
  /* ===== SUNDAY BLOCK ===== */
  if (dayOfWeek === 0) {
    throw new ForbiddenError("Today is Sunday. Punch-out disabled.", { code: ERROR_CODES.SUNDAY_BLOCK });
  }
  /* ===== FETCH RECORD ===== */
  const recordDoc = await EmployeeRecord.findOne({ employee: employee._id });
  if (!recordDoc) {
    throw new BadRequestError("Attendance record not found", { code: ERROR_CODES.RECORD_NOT_FOUND });
  }

  /* ===== FIND TODAY RECORD ===== */
  const todayRecord = recordDoc.records.find((r) => r.date === today);

  if (!todayRecord || !todayRecord.punchIn) {
    throw new BadRequestError("You have not punched in today", { code: ERROR_CODES.NOT_PUNCHED_IN });
  }
  if (todayRecord.punchOut) {
    throw new BadRequestError("Already punched out today", { code: ERROR_CODES.ALREADY_PUNCHED_OUT });
  }
  if (nowIST <= new Date(todayRecord.punchIn)) {
    throw new BadRequestError("Invalid punch-out time", { code: ERROR_CODES.INVALID_PUNCH_OUT });
  }

  /* ===== CALCULATE WORK TIME ===== */
  const diffMs = nowIST - new Date(todayRecord.punchIn);
  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = totalMinutes / 60;

  /* ===== DECIDE STATUS ===== */
  let workStatus = "PRESENT";

  if (dayOfWeek === 6) {
    // Saturday rule
    if (totalMinutes < 330) workStatus = "ABSENT";
  } else {
    // Weekday rule
    if (totalHours < 4) workStatus = "ABSENT";
    else if (totalHours < 6) workStatus = "HALF_DAY";
    else if (totalHours < 8) workStatus = "EARLY_GOING";
  }

  /* ===== UPDATE RECORD ===== */
  todayRecord.punchOut = nowIST;
  todayRecord.totalWorkedTime = {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };

  // Remove old attendance statuses
  todayRecord.status = todayRecord.status.filter(
    (s) => !["PRESENT", "ABSENT", "HALF_DAY", "EARLY_GOING"].includes(s)
  );

  // Add new status
  todayRecord.status.push(workStatus);

  await recordDoc.save();

  return {
    time: nowIST,
    worked: todayRecord.totalWorkedTime,
    status: todayRecord.status,
  };
};

/**
 * Get my attendances.
 *
 * @param {*} user
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getMyAttendancesService = async (user) => {
  const normalizedEmail = user.email.toLowerCase().trim();
  /* ---------- FIND EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: normalizedEmail,
    isDeleted: false,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  /* ---------- FETCH EMPLOYEE RECORD ---------- */
  const recordDoc = await EmployeeRecord.findOne({
    employee: employee._id,
  });

  if (!recordDoc || !recordDoc.records.length) {
    return [];
  }

  /* ---------- RETURN RECORDS ---------- */
  return recordDoc.records;
};

/**
 * Get all attendances.
 * @returns {Promise<*>}
 */
export const getAllAttendancesService = async () => {
  const records = await EmployeeRecord.find()
    .populate("employee", "firstName lastName email role")
    .sort({ createdAt: -1 });

  if (!records.length) return [];

  // Flatten each record into per-day entries with employee info
  const allDays = records.flatMap((r) =>
    r.records.map((day) => ({
      employee: r.employee,
      ...day,
    }))
  );

  return allDays;
};

/**
 * Get my attendance stats.
 *
 * @param {*} user
 * @param {*} month
 * @param {*} year
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getMyAttendanceStatsService = async (user, month, year) => {
  const normalizedEmail = user.email.toLowerCase().trim();

  // ===== Find Employee =====
  const employee = await Employee.findOne({ email: normalizedEmail, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  // ===== Fetch Attendance Records =====
  const recordDoc = await EmployeeRecord.findOne({ employee: employee._id });

  const now = getISTNow();
  const selectedMonth = month ? Number(month) - 1 : now.getMonth();
  const selectedYear = year ? Number(year) : now.getFullYear();

  const stats = {
    presentDays: 0,
    absentDays: 0,
    halfDays: 0,
    lateDays: 0,
    leaveDays: 0,
    leaveSummary: { FULL_DAY: 0, HALF_DAY: 0 },
    leaveTypeCount: { SICK: 0, CASUAL: 0, EMERGENCY: 0 },
    totalHoursWorked: 0,
  };

  if (!recordDoc?.records?.length) {
    return {
      month: new Date(selectedYear, selectedMonth).toLocaleString("default", { month: "long" }),
      year: selectedYear,
      stats,
    };
  }

  const monthlyRecords = recordDoc.records.filter((r) => {
    const d = new Date(r.date + "T00:00:00");
    return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
  });

  monthlyRecords.forEach((r) => {
    const status = r.status || [];
    const dayType = r.dayType || [];

    if (status.includes("PRESENT")) stats.presentDays++;
    if (status.includes("ABSENT")) stats.absentDays++;
    if (status.includes("HALF_DAY")) stats.halfDays++;
    if (status.includes("LATE")) stats.lateDays++;

    if (dayType.includes("LEAVE") || status.includes("LEAVE")) {
      const leaveValue = r.leaveDuration === "HALF_DAY" ? 0.5 : 1;
      stats.leaveDays += leaveValue;
      if (r.leaveDuration === "HALF_DAY") stats.leaveSummary.HALF_DAY += 0.5;
      else stats.leaveSummary.FULL_DAY += 1;

      if (r.leaveType && stats.leaveTypeCount[r.leaveType] !== undefined) {
        stats.leaveTypeCount[r.leaveType] += leaveValue;
      }
    }

    if (r.totalWorkedTime) {
      stats.totalHoursWorked += (r.totalWorkedTime.hours || 0) + (r.totalWorkedTime.minutes || 0) / 60;
    }
  });

  return {
    month: new Date(selectedYear, selectedMonth).toLocaleString("default", { month: "long" }),
    year: selectedYear,
    stats,
  };
};

export {
  requestLeaveService,
  getAllLeaveRequestsForAdminService,
  updateLeaveRequestStatusService,
  getMyLeaveRequestsService,
  getLeaveRequestsByStatusService,
  cancelLeaveRequestService,
} from "./leave.service.js";

export {
  sendPunchOutRequestService,
  getAllPunchOutRequestsForAdminService,
  updatePunchOutRequestStatusService,
  getMyPunchOutRequestsService,
  getAttendanceApprovalsByStatusService,
} from "./punchoutrequest.service.js";

export { createHolidayService, getHolidaysService } from "./holiday.service.js";
