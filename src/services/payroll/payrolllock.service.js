/**
 * Guards finalized payroll months: any change that would alter a FINALIZED month (approving a
 * leave or punch-out correction, changing a holiday, overriding paid leave, approving extra time)
 * is refused with 409 MONTH_FINALIZED until an admin re-opens the month.
 *
 * Exports: assertMonthsOpen, isMonthFinalized
 * Used by: services/attendance/*, services/payroll/payroll.service.js
 */
import { PayrollMonth } from "../../models/payrollmonth.model.js";
import { ConflictError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";

const MONTH_KEY_LENGTH = 7;

/**
 * @param {string} monthKey "YYYY-MM"
 * @returns {Promise<boolean>}
 */
export const isMonthFinalized = async (monthKey) =>
  Boolean(await PayrollMonth.exists({ monthKey, status: "FINALIZED" }));

/**
 * Throws when any of the dates falls in a finalized month.
 * Example: assertMonthsOpen(["2026-09-30", "2026-10-01"]) with September finalized -> 409.
 *
 * @param {string[]} dateKeys "YYYY-MM-DD"
 * @returns {Promise<void>}
 * @throws {ConflictError} 409 MONTH_FINALIZED
 */
export const assertMonthsOpen = async (dateKeys) => {
  const monthKeys = [...new Set(dateKeys.filter(Boolean).map((date) => String(date).slice(0, MONTH_KEY_LENGTH)))];
  if (!monthKeys.length) return;
  const finalized = await PayrollMonth.findOne({ monthKey: { $in: monthKeys }, status: "FINALIZED" })
    .select("monthKey")
    .lean();
  if (finalized) {
    throw new ConflictError(`Payroll for ${finalized.monthKey} is finalized. Re-open the month first.`, {
      code: ERROR_CODES.MONTH_FINALIZED,
    });
  }
};
