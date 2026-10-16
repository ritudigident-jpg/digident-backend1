/**
 * Mongoose model "DeletedEmployee": archive of employees deleted more than 30 days ago.
 *
 * Used by: controllers/employee/employee.controller.js, jobs/employeecleanup.job.js
 */

// models/DeletedEmployee.js
import mongoose from "mongoose";

const deletedEmployeeSchema = new mongoose.Schema(
  {
    originalEmployeeId: { type: String, required: true },
    firstName: String,
    lastName: String,
    email: String,
    personalEmail: String,
    role: Number,
    permissions: [String],
    createdBy: String,
    isNewEmployee: Boolean,
    deletedAt: Date,
    permanentlyDeletedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: "deleted_employees",
  }
);
const DeletedEmployee =
  mongoose.models.DeletedEmployee || mongoose.model("DeletedEmployee", deletedEmployeeSchema);
export default DeletedEmployee;
