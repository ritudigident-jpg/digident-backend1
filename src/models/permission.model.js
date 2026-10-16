/**
 * Mongoose model "Permission": permission definitions and assigning them to employees.
 *
 * Used by: services/employee/employee.service.js, services/permission/permission.service.js
 */

import mongoose from "mongoose";

const permissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    permissionId: {
      type: String,
      required: true,
      unique: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Permission", permissionSchema);
