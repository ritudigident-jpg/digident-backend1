/**
 * Mongoose model "PermissionAudit": who changed what, with which permission.
 *
 * Used by: 15 files, e.g. controllers/creditnote/creditnote.controller.js,
 * controllers/invoice/invoice.controller.js,
 * controllers/jobapplication/jobapplication.controller.js, services/banner/banner.service.js
 */

import mongoose from "mongoose";

const permissionAuditSchema = new mongoose.Schema({
  permissionAuditId: {
    type: String,
    required: true,
  },
  actionBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee", //Who gave/removed
    required: true,
  },
  actionByEmail: {
    type: String,
    lowercase: true,
    trim: true,
  },

  actionFor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee", //Who received the permission
    default: null,
  },
  action: {
    type: String,
    lowercase: true,
    trim: true,
  },
  permission: {
    type: String,
    lowercase: true,
  },
  actionType: {
    type: String,
    lowercase: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export const PermissionAudit = mongoose.model("PermissionAudit", permissionAuditSchema);
