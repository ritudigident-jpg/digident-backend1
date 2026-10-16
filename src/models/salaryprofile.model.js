/**
 * Mongoose model "SalaryProfile": an employee's monthly base salary with its revision history.
 * Amounts are integer paise. The salary used for a month is the revision with the latest
 * effectiveFrom on or before the last day of that month.
 * Example: revisions 25,000 from 2026-04-01 and 28,000 from 2026-10-15 -> October uses 28,000.
 *
 * Only users with payroll.salary.read / payroll.salary.update can see or change it.
 * Used by: services/payroll/salaryprofile.service.js, services/payroll/payroll.service.js
 */
import mongoose from "mongoose";

const revisionSchema = new mongoose.Schema(
  {
    baseSalaryPaise: { type: Number, required: true, min: 0 },
    effectiveFrom: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const salaryProfileSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, unique: true },
    revisions: { type: [revisionSchema], default: [] },
  },
  { timestamps: true, collection: "salary_profiles" }
);

export const SalaryProfile = mongoose.models.SalaryProfile || mongoose.model("SalaryProfile", salaryProfileSchema);
export default SalaryProfile;
