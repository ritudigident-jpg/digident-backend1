/**
 * Mongoose model "EmployeeProfile": personal, employment and bank / statutory details of an
 * employee (one per Employee). Bank account, PAN, Aadhaar and UAN are stored ENCRYPTED
 * (helpers/fieldcrypto.helper.js, AES-256-GCM) with only the last 4 characters in clear for
 * masking. They are decrypted only for users with employee.sensitive.read, and every reveal is audited.
 *
 * Used by: services/employeeprofile/employeeprofile.service.js, services/payroll/payroll.service.js
 */
import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 200, default: "" },
    line2: { type: String, trim: true, maxlength: 200, default: "" },
    city: { type: String, trim: true, maxlength: 100, default: "" },
    state: { type: String, trim: true, maxlength: 100, default: "" },
    pincode: { type: String, trim: true, maxlength: 6, default: "" },
    country: { type: String, trim: true, maxlength: 100, default: "India" },
  },
  { _id: false }
);

const encryptedFieldSchema = new mongoose.Schema(
  {
    cipher: { type: String, default: null },
    last4: { type: String, default: null },
  },
  { _id: false }
);

const employeeProfileSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, unique: true },
    personal: {
      dateOfBirth: { type: String, default: null },
      gender: { type: String, enum: ["MALE", "FEMALE", "OTHER", null], default: null },
      maritalStatus: { type: String, enum: ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", null], default: null },
      bloodGroup: { type: String, enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", null], default: null },
      phone: { type: String, default: null },
      currentAddress: { type: addressSchema, default: () => ({}) },
      permanentAddress: { type: addressSchema, default: () => ({}) },
      emergencyContact: {
        name: { type: String, trim: true, maxlength: 100, default: "" },
        relation: { type: String, trim: true, maxlength: 50, default: "" },
        phone: { type: String, default: "" },
      },
    },
    employment: {
      employeeCode: { type: String, trim: true, uppercase: true, default: null },
      designation: { type: String, trim: true, maxlength: 100, default: "" },
      department: { type: String, trim: true, maxlength: 100, default: "" },
      joiningDate: { type: String, default: null },
      employmentType: {
        type: String,
        enum: ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "PROBATION", null],
        default: null,
      },
      reportingManager: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
      workLocation: { type: String, trim: true, maxlength: 100, default: "" },
      /** Weekday shift override in hours (Saturday always uses the Saturday shift). */
      shiftHours: { type: Number, min: 1, max: 16, default: null },
    },
    bank: {
      bankName: { type: String, trim: true, maxlength: 100, default: "" },
      ifsc: { type: String, trim: true, uppercase: true, default: "" },
      accountNumber: { type: encryptedFieldSchema, default: () => ({}) },
      pan: { type: encryptedFieldSchema, default: () => ({}) },
      aadhaar: { type: encryptedFieldSchema, default: () => ({}) },
      uan: { type: encryptedFieldSchema, default: () => ({}) },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  },
  { timestamps: true, collection: "employee_profiles" }
);

employeeProfileSchema.index(
  { "employment.employeeCode": 1 },
  { unique: true, partialFilterExpression: { "employment.employeeCode": { $type: "string" } } }
);

export const EmployeeProfile =
  mongoose.models.EmployeeProfile || mongoose.model("EmployeeProfile", employeeProfileSchema);
export default EmployeeProfile;
