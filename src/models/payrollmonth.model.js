/**
 * Mongoose models for finalized payroll:
 *   - "PayrollMonth": the state of a month (OPEN / FINALIZED), its current snapshot version and an
 *     audit trail of finalize / re-open actions.
 *   - "PayrollSnapshot": the immutable computed payroll of one employee for one finalized version.
 *     Never updated; a re-open + finalize writes a new version.
 *
 * While a month is FINALIZED, payroll screens read the snapshot and attendance / leave / holiday
 * changes that touch the month are refused (services/payroll/payrolllock.service.js).
 *
 * Used by: services/payroll/payroll.service.js, services/payroll/payrolllock.service.js
 */
import mongoose from "mongoose";

const monthEventSchema = new mongoose.Schema(
  {
    action: { type: String, enum: ["FINALIZE", "REOPEN"], required: true },
    version: { type: Number, required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    at: { type: Date, default: Date.now },
    reason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false }
);

const payrollMonthSchema = new mongoose.Schema(
  {
    /** "YYYY-MM" */
    monthKey: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}$/ },
    status: { type: String, enum: ["OPEN", "FINALIZED"], default: "OPEN" },
    version: { type: Number, default: 0 },
    finalizedAt: { type: Date, default: null },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    events: { type: [monthEventSchema], default: [] },
  },
  { timestamps: true, collection: "payroll_months" }
);

const payrollSnapshotSchema = new mongoose.Schema(
  {
    monthKey: { type: String, required: true, match: /^\d{4}-\d{2}$/ },
    version: { type: Number, required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    employeeName: { type: String, default: "" },
    employeeEmail: { type: String, default: "" },
    netPayablePaise: { type: Number, required: true },
    /** Full calculator output, including the day-by-day breakdown. */
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: "payroll_snapshots" }
);

payrollSnapshotSchema.index({ monthKey: 1, version: 1, employee: 1 }, { unique: true });
payrollSnapshotSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  throw new Error("Payroll snapshots are immutable");
});

export const PayrollMonth = mongoose.models.PayrollMonth || mongoose.model("PayrollMonth", payrollMonthSchema);
export const PayrollSnapshot =
  mongoose.models.PayrollSnapshot || mongoose.model("PayrollSnapshot", payrollSnapshotSchema);
