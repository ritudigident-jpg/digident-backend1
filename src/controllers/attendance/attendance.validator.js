/**
 * Joi schemas for the attendance, leave, punch-out correction and holiday endpoints. Applied in
 * routes/attendance.routes.js with validate(schema, source) before the controller runs.
 * Unknown keys are removed (so a client-sent totalDays or punchOutTime is simply dropped).
 *
 * Used by: routes/attendance.routes.js
 */
import Joi from "joi";
import { HALF_DAY_SESSIONS, HOLIDAY_TYPES, LEAVE_DURATIONS, LEAVE_TYPES } from "../../constants/payrollsettings.constant.js";
import { objectId } from "../../middlewares/validate.middleware.js";

const dateKey = () =>
  Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
    .messages({ "string.pattern.name": "{{#label}} must be a date like 2026-10-16" });
const time = () =>
  Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm")
    .messages({ "string.pattern.name": "{{#label}} must be a 24-hour time like 18:30" });

const paging = {
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(400),
};

export const listQuerySchema = Joi.object({
  ...paging,
  status: Joi.string().valid("PENDING", "APPROVED", "REJECTED", "CANCELLED", "OPEN", "PRESENT", "HALF_DAY", "ABSENT", "MISSING_PUNCH_OUT"),
  search: Joi.string().trim().max(100).allow(""),
  from: dateKey(),
  to: dateKey(),
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2000).max(2100),
  employeeId: objectId(),
  type: Joi.string().valid("all", "past", "upcoming"),
  includePending: Joi.boolean(),
});

export const monthQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2000).max(2100),
});

export const punchOutRequestSchema = Joi.object({
  date: dateKey(),
  time: time(),
  requestedPunchOut: Joi.string().trim().max(40),
  reason: Joi.string().trim().min(3).max(500).required(),
})
  .and("date", "time")
  .or("date", "requestedPunchOut")
  .messages({ "object.missing": "Send date and time (or requestedPunchOut)" });

export const leaveRequestSchema = Joi.object({
  leaveType: Joi.string().valid(...LEAVE_TYPES).required(),
  leaveDuration: Joi.string().valid(...LEAVE_DURATIONS).default("FULL_DAY"),
  halfDaySession: Joi.when("leaveDuration", {
    is: "HALF_DAY",
    then: Joi.string().valid(...HALF_DAY_SESSIONS).required(),
    otherwise: Joi.any().strip(),
  }),
  fromDate: dateKey().required(),
  toDate: dateKey().required(),
  leaveReason: Joi.string().trim().min(3).max(1000).required(),
});

export const decisionSchema = Joi.object({
  action: Joi.string().valid("APPROVED", "REJECTED").required(),
  note: Joi.string().trim().max(500).allow(""),
  rejectionReason: Joi.string().trim().max(500).allow(""),
});

export const leaveOverrideSchema = Joi.object({
  isPaid: Joi.boolean(),
  days: Joi.array().items(Joi.object({ date: dateKey().required(), paidFraction: Joi.number().valid(0, 0.5, 1).required() })).min(1),
  note: Joi.string().trim().min(3).max(500).required(),
}).or("isPaid", "days");

export const createHolidaySchema = Joi.object({
  date: Joi.string().trim().required(),
  title: Joi.string().trim().min(2).max(120).required(),
  type: Joi.string().valid(...HOLIDAY_TYPES).default("PUBLIC"),
});

export const updateHolidaySchema = Joi.object({
  date: dateKey(),
  title: Joi.string().trim().min(2).max(120),
  type: Joi.string().valid(...HOLIDAY_TYPES),
}).min(1);

export const approvalIdParamsSchema = Joi.object({ approvalId: Joi.string().trim().max(64).required() });
