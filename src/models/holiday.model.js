/**
 * Mongoose model "Holiday": public / company holidays, one per IST date (unique). Holidays are no
 * longer copied into every employee's attendance; calendars and payroll read this collection.
 *
 * Used by: services/attendance/holiday.service.js, services/attendance/leave.service.js,
 * services/payroll/payroll.service.js
 */
import mongoose from "mongoose";
import { HOLIDAY_TYPES } from "../constants/payrollsettings.constant.js";

const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: HOLIDAY_TYPES, default: "PUBLIC" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true, collection: "holidays" }
);

export const Holiday = mongoose.models.Holiday || mongoose.model("Holiday", holidaySchema);
export default Holiday;
