/**
 * Mongoose model "AttendanceDay": ONE document per employee per IST date (collection
 * "attendance_days"). The unique index on (employee, date) is what makes a second punch-in for the
 * same day impossible, even when two requests arrive at the same time.
 *
 * Times (punchIn / punchOut) are real UTC instants set from the SERVER clock; `date` is the IST
 * calendar date of the punch-in ("YYYY-MM-DD"). workedMinutes / expectedMinutes / extraMinutes /
 * status are a cache written at punch-out (and by corrections); the payroll recomputes them.
 *
 * Replaces the per-employee "records" array of models/attendance.model.js (kept read-only for the
 * migration in scripts/migrateattendancedays.js).
 *
 * Used by: services/attendance/*.service.js, services/payroll/payroll.service.js, jobs/endofday.job.js
 */
import mongoose from "mongoose";
import { ATTENDANCE_STATUS } from "../constants/payrollsettings.constant.js";

const attendanceDaySchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    /** IST date "YYYY-MM-DD". */
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    /** Kept so old screens that read recordId keep working. */
    recordId: { type: String, required: true },
    punchIn: { type: Date, required: true },
    punchOut: { type: Date, default: null },
    status: { type: String, enum: Object.values(ATTENDANCE_STATUS), default: ATTENDANCE_STATUS.OPEN },
    isLate: { type: Boolean, default: false },
    workedMinutes: { type: Number, default: 0, min: 0 },
    expectedMinutes: { type: Number, default: 0, min: 0 },
    extraMinutes: { type: Number, default: 0, min: 0 },
    /** Set by an admin when settings.extraRequiresApproval is on. */
    extraApproved: { type: Boolean, default: false },
    extraApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    /** SELF = employee punched out; CORRECTION = approved correction request; MIGRATION = old data. */
    punchOutSource: { type: String, enum: ["SELF", "CORRECTION", "MIGRATION", null], default: null },
    /** True while a punch-out correction request is pending. */
    requiresAdminApproval: { type: Boolean, default: false },
    adminAdjusted: { type: Boolean, default: false },
    correctionApprovalId: { type: String, default: null },
    migratedFromRecordId: { type: String, default: null },
  },
  { timestamps: true, collection: "attendance_days" }
);

attendanceDaySchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceDaySchema.index({ date: 1, status: 1 });

export const AttendanceDay =
  mongoose.models.AttendanceDay || mongoose.model("AttendanceDay", attendanceDaySchema);
export default AttendanceDay;
