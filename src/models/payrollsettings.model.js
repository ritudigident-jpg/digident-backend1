/**
 * Mongoose model "PayrollSettings": the ONE document (key "default") holding every configurable
 * attendance / leave / payroll rule. Missing keys fall back to constants/payrollsettings.constant.js.
 *
 * Used by: services/payroll/payrollsettings.service.js
 */
import mongoose from "mongoose";
import { PAYROLL_SETTINGS_KEY } from "../constants/payrollsettings.constant.js";

const payrollSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: PAYROLL_SETTINGS_KEY },
    weeklyOffDays: { type: [Number] },
    standardShiftMinutes: { type: Number, min: 60, max: 960 },
    saturdayShiftMinutes: { type: Number, min: 60, max: 960 },
    lateAfterTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    fullDayGraceMinutes: { type: Number, min: 0, max: 120 },
    halfDayThresholdPercent: { type: Number, min: 1, max: 100 },
    extraMinimumMinutes: { type: Number, min: 0, max: 600 },
    extraPayMultiplier: { type: Number, min: 0, max: 5 },
    extraRequiresApproval: { type: Boolean },
    paidLeaveQuotaPerMonth: { type: Number, min: 0, max: 31 },
    paidLeaveTypes: { type: [String] },
    leaveBackdateDays: { type: Number, min: 0, max: 90 },
    leaveMaxFutureDays: { type: Number, min: 1, max: 730 },
    punchOutCorrectionWindowDays: { type: Number, min: 0, max: 90 },
    allowPunchOnOffDays: { type: Boolean },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true, collection: "payroll_settings" }
);

export const PayrollSettings =
  mongoose.models.PayrollSettings || mongoose.model("PayrollSettings", payrollSettingsSchema);
export default PayrollSettings;
