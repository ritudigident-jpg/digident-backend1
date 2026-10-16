/**
 * Mongoose model "AdminApproval": leave requests and forgot-punch-out correction requests that
 * need an admin decision (this is the LeaveRequest / PunchOutRequest store).
 *
 * The original fields (approvalId, requestType, recordDate, requestData, status, actionBy,
 * actionAt, rejectionReason) are unchanged so existing screens keep working. Added:
 *   - leave: halfDaySession and totalDays (server computed) inside requestData; days[] with the
 *     paid fraction of each day, paidDays / unpaidDays / isPaid; note; cancelledAt; status CANCELLED;
 *     paidOverride history for admin overrides.
 *   - punch-out: requestedPunchOutAt (UTC instant), reason.
 * A partial unique index allows only ONE pending punch-out request per employee per date.
 *
 * Used by: services/attendance/leave.service.js, services/attendance/punchoutrequest.service.js,
 * services/payroll/payroll.service.js
 */
import mongoose from "mongoose";

const leaveDaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true },
    fraction: { type: Number, enum: [0.5, 1], required: true },
    paidFraction: { type: Number, min: 0, max: 1, default: 0 },
  },
  { _id: false }
);

const paidOverrideSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    at: { type: Date, default: Date.now },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    before: { type: [leaveDaySchema], default: [] },
    after: { type: [leaveDaySchema], default: [] },
  },
  { _id: false }
);

const adminApprovalSchema = new mongoose.Schema(
  {
    approvalId: { type: String, unique: true, required: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    requestType: { type: String, enum: ["FORGOT_PUNCH_OUT", "LEAVE"], required: true, index: true },
    recordDate: { type: String, required: true },
    // LEAVE: { leaveType, leaveDuration, halfDaySession, fromDate, toDate, leaveReason, totalDays }
    // FORGOT_PUNCH_OUT: { requestedPunchOut (as sent), requestedPunchOutAt (UTC ISO), reason }
    requestData: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING" },
    actionBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    actionAt: { type: Date, default: null },
    rejectionReason: { type: String, default: null },
    /** Admin note given on approve / reject. */
    note: { type: String, trim: true, maxlength: 500, default: null },
    cancelledAt: { type: Date, default: null },

    /* ---------- LEAVE only ---------- */
    days: { type: [leaveDaySchema], default: undefined },
    totalDays: { type: Number, default: null },
    paidDays: { type: Number, default: null },
    unpaidDays: { type: Number, default: null },
    isPaid: { type: Boolean, default: null },
    paidOverrides: { type: [paidOverrideSchema], default: undefined },

    /* ---------- FORGOT_PUNCH_OUT only ---------- */
    requestedPunchOutAt: { type: Date, default: null },
    reason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true }
);

adminApprovalSchema.index({ employee: 1, requestType: 1, status: 1 });
adminApprovalSchema.index({ requestType: 1, status: 1, "requestData.fromDate": 1 });
adminApprovalSchema.index(
  { employee: 1, requestType: 1, recordDate: 1 },
  {
    unique: true,
    name: "one_pending_punchout_request_per_day",
    partialFilterExpression: { requestType: "FORGOT_PUNCH_OUT", status: "PENDING" },
  }
);

export const AdminApproval = mongoose.models.AdminApproval || mongoose.model("AdminApproval", adminApprovalSchema);
