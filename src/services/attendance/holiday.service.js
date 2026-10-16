/**
 * Holidays (Holiday collection, one per IST date): list for everyone, and create / edit / delete
 * for admins. A holiday is no longer written into each employee's attendance, and adding one never
 * erases punches already made that day (that time simply becomes extra). Changes that touch a
 * finalized payroll month are refused. Re-exported by attendance.service.js.
 *
 * Exports: createHolidayService, getHolidaysService, listHolidaysForAdminService,
 * updateHolidayService, deleteHolidayService
 * Used by: services/attendance/attendance.service.js
 */
import Holiday from "../../models/holiday.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { istDateKey, isValidDateKey, nowUtc } from "../../helpers/istdate.helper.js";
import { isDuplicateKeyError } from "../../helpers/transaction.helper.js";
import { assertMonthsOpen } from "../payroll/payrolllock.service.js";
import { sendNotification } from "../notification/notification.service.js";
import { logger } from "../../helpers/logger.helper.js";
import { findActiveEmployeeByEmail } from "../employee/employeelookup.service.js";

const toPublic = (holiday) => ({
  _id: holiday._id,
  date: holiday.date,
  title: holiday.title,
  reason: holiday.title,
  type: holiday.type,
  createdAt: holiday.createdAt,
  updatedAt: holiday.updatedAt,
});

const notifyEveryone = async (title, message) => {
  try {
    await sendNotification({ permission: "attendance.log.update", title, message, type: "HOLIDAY_UPDATED", entityModel: "Holiday" });
  } catch (error) {
    logger.error("Holiday notification failed", { error });
  }
};

/**
 * Creates a holiday.
 * Example: { date: "2026-11-08", title: "Diwali", type: "PUBLIC" }.
 *
 * @param {{ date: string, title: string, type?: string }} data
 * @param {{ email: string }} adminUser
 * @returns {Promise<object>} the holiday (also returns { date, title } like before)
 * @throws {BadRequestError} 400 INVALID_DATE
 * @throws {ConflictError} 409 HOLIDAY_EXISTS / MONTH_FINALIZED
 */
export const createHolidayService = async ({ date, title, type = "PUBLIC" }, adminUser) => {
  const dateKey = String(date).slice(0, 10);
  if (!isValidDateKey(dateKey)) throw new BadRequestError("Invalid date format", { code: ERROR_CODES.INVALID_DATE });
  await assertMonthsOpen([dateKey]);
  const admin = await findActiveEmployeeByEmail(adminUser.email);
  try {
    const holiday = await Holiday.create({ date: dateKey, title, type, createdBy: admin._id });
    await notifyEveryone("Holiday Added", `${title} on ${dateKey}`);
    return toPublic(holiday.toObject());
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError(`A holiday already exists on ${dateKey}`, { code: ERROR_CODES.HOLIDAY_EXISTS });
    }
    throw error;
  }
};

/**
 * Holidays for the employee screens (same response shape as before: { date, reason } plus title / type).
 *
 * @param {"all" | "past" | "upcoming"} [type]
 * @param {number} [year]
 * @returns {Promise<object[]>}
 */
export const getHolidaysService = async (type = "all", year = null) => {
  const today = istDateKey(nowUtc());
  const filter = {};
  if (type === "past") filter.date = { $lt: today };
  if (type === "upcoming") filter.date = { $gte: today };
  if (year) filter.date = { ...(filter.date || {}), $gte: `${year}-01-01`, $lte: `${year}-12-31` };
  const holidays = await Holiday.find(filter).sort({ date: 1 }).lean();
  return holidays.map(toPublic);
};

/**
 * Paginated holiday list for the Holiday Manager.
 *
 * @param {{ year?: number, skip: number, limit: number }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const listHolidaysForAdminService = async ({ year, skip, limit }) => {
  const filter = year ? { date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } } : {};
  const [holidays, total] = await Promise.all([
    Holiday.find(filter).sort({ date: 1 }).skip(skip).limit(limit).populate("createdBy", "firstName lastName email").lean(),
    Holiday.countDocuments(filter),
  ]);
  return { items: holidays.map((holiday) => ({ ...toPublic(holiday), createdBy: holiday.createdBy })), total };
};

/**
 * Edits a holiday's date, title or type.
 *
 * @param {string} holidayId
 * @param {{ date?: string, title?: string, type?: string }} changes
 * @param {{ _id: * }} admin
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 HOLIDAY_NOT_FOUND
 * @throws {ConflictError} 409 HOLIDAY_EXISTS / MONTH_FINALIZED
 */
export const updateHolidayService = async (holidayId, changes, admin) => {
  const holiday = await Holiday.findById(holidayId);
  if (!holiday) throw new NotFoundError("Holiday not found", { code: ERROR_CODES.HOLIDAY_NOT_FOUND });
  await assertMonthsOpen([holiday.date, changes.date]);
  Object.assign(holiday, changes, { updatedBy: admin._id });
  try {
    await holiday.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError(`A holiday already exists on ${changes.date}`, { code: ERROR_CODES.HOLIDAY_EXISTS });
    }
    throw error;
  }
  await notifyEveryone("Holiday Updated", `${holiday.title} on ${holiday.date}`);
  return toPublic(holiday.toObject());
};

/**
 * Deletes a holiday.
 *
 * @param {string} holidayId
 * @returns {Promise<{ holidayId: string, date: string }>}
 * @throws {NotFoundError} 404 HOLIDAY_NOT_FOUND
 * @throws {ConflictError} 409 MONTH_FINALIZED
 */
export const deleteHolidayService = async (holidayId) => {
  const holiday = await Holiday.findById(holidayId).lean();
  if (!holiday) throw new NotFoundError("Holiday not found", { code: ERROR_CODES.HOLIDAY_NOT_FOUND });
  await assertMonthsOpen([holiday.date]);
  await Holiday.deleteOne({ _id: holidayId });
  await notifyEveryone("Holiday Removed", `${holiday.title} on ${holiday.date} is no longer a holiday`);
  return { holidayId, date: holiday.date };
};
