/**
 * Joi schemas for employee information and documents. Formats:
 *   phone 10 digits; PAN AAAAA9999A; IFSC AAAA0XXXXXX; Aadhaar 12 digits; UAN 12 digits;
 *   bank account 9-18 digits; pincode 6 digits; dates YYYY-MM-DD.
 * The frontend repeats the same rules in src/validators/EmployeeValidator.js.
 *
 * Used by: routes/employeeprofile.routes.js
 */
import Joi from "joi";
import { objectId } from "../../middlewares/validate.middleware.js";
import { DOCUMENT_STATUSES, DOCUMENT_TYPES } from "../../models/employeedocument.model.js";

export const PATTERNS = Object.freeze({
  phone: /^\d{10}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  aadhaar: /^\d{12}$/,
  uan: /^\d{12}$/,
  accountNumber: /^\d{9,18}$/,
  pincode: /^\d{6}$/,
  employeeCode: /^[A-Z0-9-]{2,20}$/,
});

const dateKey = () => Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const phone = () => Joi.string().trim().pattern(PATTERNS.phone, "10-digit phone").messages({ "string.pattern.name": "{{#label}} must be 10 digits" });

const address = Joi.object({
  line1: Joi.string().trim().max(200).allow(""),
  line2: Joi.string().trim().max(200).allow(""),
  city: Joi.string().trim().max(100).allow(""),
  state: Joi.string().trim().max(100).allow(""),
  pincode: Joi.string().trim().pattern(PATTERNS.pincode, "6-digit pincode").allow(""),
  country: Joi.string().trim().max(100).allow(""),
});

const emergencyContact = Joi.object({
  name: Joi.string().trim().max(100).allow(""),
  relation: Joi.string().trim().max(50).allow(""),
  phone: phone().allow(""),
});

/** What an employee may change on their own profile. */
export const myProfileSchema = Joi.object({
  phone: phone().allow(null, ""),
  currentAddress: address,
  permanentAddress: address,
  emergencyContact,
}).min(1);

/** Admin edit: every section optional; only the sections sent are changed. */
export const profileSchema = Joi.object({
  account: Joi.object({
    firstName: Joi.string().trim().min(2).max(50),
    lastName: Joi.string().trim().min(2).max(50),
    personalEmail: Joi.string().trim().lowercase().email(),
  }),
  personal: Joi.object({
    dateOfBirth: dateKey().allow(null),
    gender: Joi.string().valid("MALE", "FEMALE", "OTHER").allow(null),
    maritalStatus: Joi.string().valid("SINGLE", "MARRIED", "DIVORCED", "WIDOWED").allow(null),
    bloodGroup: Joi.string().valid("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-").allow(null),
    phone: phone().allow(null, ""),
    currentAddress: address,
    permanentAddress: address,
    emergencyContact,
  }),
  employment: Joi.object({
    employeeCode: Joi.string().trim().uppercase().pattern(PATTERNS.employeeCode, "employee code").allow(null),
    designation: Joi.string().trim().max(100).allow(""),
    department: Joi.string().trim().max(100).allow(""),
    joiningDate: dateKey().allow(null),
    employmentType: Joi.string().valid("FULL_TIME", "PART_TIME", "CONTRACT", "INTERN", "PROBATION").allow(null),
    reportingManager: objectId().allow(null),
    workLocation: Joi.string().trim().max(100).allow(""),
    shiftHours: Joi.number().min(1).max(16).precision(2).allow(null),
  }),
  bank: Joi.object({
    bankName: Joi.string().trim().max(100).allow(""),
    ifsc: Joi.string().trim().uppercase().pattern(PATTERNS.ifsc, "IFSC").allow(""),
    accountNumber: Joi.string().trim().pattern(PATTERNS.accountNumber, "account number").allow(""),
    pan: Joi.string().trim().uppercase().pattern(PATTERNS.pan, "PAN").allow(""),
    aadhaar: Joi.string().trim().replace(/\s/g, "").pattern(PATTERNS.aadhaar, "12-digit Aadhaar").allow(""),
    uan: Joi.string().trim().pattern(PATTERNS.uan, "12-digit UAN").allow(""),
  }),
})
  .min(1)
  .messages({ "string.pattern.name": "{{#label}} is not a valid {{#name}}" });

export const revealQuerySchema = Joi.object({ reveal: Joi.boolean().default(false) });

export const documentMetaSchema = Joi.object({
  documentType: Joi.string().valid(...DOCUMENT_TYPES).required(),
  title: Joi.string().trim().max(120).allow(""),
  expiryDate: dateKey().allow(null, ""),
});

export const documentListQuerySchema = Joi.object({
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  status: Joi.string().valid(...DOCUMENT_STATUSES),
});

export const verifyDocumentSchema = Joi.object({
  status: Joi.string().valid("VERIFIED", "REJECTED").required(),
  rejectionReason: Joi.when("status", {
    is: "REJECTED",
    then: Joi.string().trim().min(3).max(500).required(),
    otherwise: Joi.any().strip(),
  }),
});
