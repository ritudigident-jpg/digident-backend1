/**
 * Joi schemas for the payroll endpoints (settings, list, finalize / re-open, salary profile,
 * extra approval). Applied in routes/payroll.routes.js.
 *
 * Used by: routes/payroll.routes.js
 */
import Joi from "joi";

const time = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");
const month = Joi.number().integer().min(1).max(12);
const year = Joi.number().integer().min(2000).max(2100);

export const payrollListQuerySchema = Joi.object({
  month,
  year,
  search: Joi.string().trim().max(100).allow(""),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(200),
});

export const monthOnlyQuerySchema = Joi.object({ month, year });
export const yearQuerySchema = Joi.object({ year: year.required() });

export const finalizeSchema = Joi.object({
  month: month.required(),
  year: year.required(),
  force: Joi.boolean().default(false),
});

export const reopenSchema = Joi.object({
  month: month.required(),
  year: year.required(),
  reason: Joi.string().trim().min(5).max(500).required(),
});

export const salaryProfileSchema = Joi.object({
  baseSalary: Joi.number().min(0).max(100_000_000).precision(2).required(),
  effectiveFrom: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD").required(),
  note: Joi.string().trim().max(500).allow(""),
});

export const extraApprovalSchema = Joi.object({ approved: Joi.boolean().required() });

export const payrollSettingsSchema = Joi.object({
 weeklyOffDays: Joi.array().items(Joi.number().integer().min(0).max(6)).unique().min(1).max(3),
  standardShiftMinutes: Joi.number().integer().min(60).max(960),
  saturdayShiftMinutes: Joi.number().integer().min(60).max(960),
  lateAfterTime: time,
  fullDayGraceMinutes: Joi.number().integer().min(0).max(120),
  halfDayThresholdPercent: Joi.number().integer().min(1).max(100),
  extraMinimumMinutes: Joi.number().integer().min(0).max(600),
  extraPayMultiplier: Joi.number().min(0).max(5).precision(2),
  extraRequiresApproval: Joi.boolean(),
  paidLeaveQuotaPerMonth: Joi.number().min(0).max(31).multiple(0.5),
  paidLeaveTypes: Joi.array().items(Joi.string().valid("SICK", "CASUAL")).unique(),
  leaveBackdateDays: Joi.number().integer().min(0).max(90),
  leaveMaxFutureDays: Joi.number().integer().min(1).max(730),
  punchOutCorrectionWindowDays: Joi.number().integer().min(0).max(90),
  allowPunchOnOffDays: Joi.boolean(),
}).min(1);
