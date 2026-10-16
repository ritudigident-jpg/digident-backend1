/**
 * Mongoose model "EmployeeDocument": METADATA of an employee document. The file itself is in a
 * private S3 location under a random key (never a public URL); it is downloaded through
 * GET /api/v1/employee-profile/documents/:documentId/download, which checks permission, writes an
 * audit entry and returns a short-lived signed URL.
 *
 * Used by: services/employeeprofile/employeedocument.service.js
 */
import mongoose from "mongoose";

export const DOCUMENT_TYPES = Object.freeze([
  "AADHAAR",
  "PAN",
  "PHOTO",
  "RESUME",
  "OFFER_LETTER",
  "EDUCATION_CERTIFICATE",
  "EXPERIENCE_LETTER",
  "BANK_PROOF",
  "OTHER",
]);
export const DOCUMENT_STATUSES = Object.freeze(["UPLOADED", "VERIFIED", "REJECTED"]);

const employeeDocumentSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    documentType: { type: String, enum: DOCUMENT_TYPES, required: true },
    title: { type: String, trim: true, maxlength: 120, default: "" },
    /** Private storage key, random; never sent to clients. */
    storageKey: { type: String, required: true, select: false },
    originalName: { type: String, trim: true, maxlength: 200, required: true },
    mimeType: { type: String, enum: ["application/pdf", "image/jpeg", "image/png"], required: true },
    sizeBytes: { type: Number, required: true, min: 1 },
    expiryDate: { type: String, default: null },
    status: { type: String, enum: DOCUMENT_STATUSES, default: "UPLOADED" },
    rejectionReason: { type: String, trim: true, maxlength: 500, default: null },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    verifiedAt: { type: Date, default: null },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "employee_documents" }
);

employeeDocumentSchema.index({ employee: 1, isDeleted: 1, createdAt: -1 });

export const EmployeeDocument =
  mongoose.models.EmployeeDocument || mongoose.model("EmployeeDocument", employeeDocumentSchema);
export default EmployeeDocument;
