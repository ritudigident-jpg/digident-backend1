/**
 * Employee information: personal, employment and bank / statutory sections (EmployeeProfile) plus
 * the name / personal e-mail on the Employee account.
 *
 * Access
 *   - an employee reads their own profile and may change ONLY phone, addresses and emergency
 *     contact (updateMyProfileService) - never salary, role or employment fields;
 *   - employee.profile.read: read anyone's profile; employee.profile.update: edit every section;
 *   - bank account / PAN / Aadhaar / UAN are encrypted at rest and always returned MASKED; the
 *     real values are returned only with ?reveal=true AND employee.sensitive.read, and every reveal
 *     and every bank change is written to the audit log.
 *
 * Exports: getProfileService, updateProfileService, updateMyProfileService, getMyProfileService
 * Used by: controllers/employeeprofile/employeeprofile.controller.js
 */
import Employee from "../../models/employee.model.js";
import EmployeeProfile from "../../models/employeeprofile.model.js";
import EmployeeDocument from "../../models/employeedocument.model.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";
import { decryptField, encryptField, lastFour, maskValue } from "../../helpers/fieldcrypto.helper.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { isDuplicateKeyError } from "../../helpers/transaction.helper.js";
import { employeeHasPermission } from "../../middlewares/permission.middleware.js";
import { employeeDisplayName, findActiveEmployeeById } from "../employee/employeelookup.service.js";

const SENSITIVE_FIELDS = Object.freeze({
  accountNumber: { maskLength: 12 },
  pan: { maskLength: 10 },
  aadhaar: { maskLength: 12 },
  uan: { maskLength: 12 },
});

const isSelf = (actor, employeeId) => String(actor._id) === String(employeeId);

/** Sends a 404 (not 403) to people who may not see the profile, so ids cannot be probed. */
const assertCanRead = (actor, employeeId) => {
  if (!isSelf(actor, employeeId) && !employeeHasPermission(actor, PERMISSIONS.PROFILE_READ)) {
    throw new NotFoundError("Profile not found", { code: ERROR_CODES.PROFILE_NOT_FOUND });
  }
};

const toPublic = (employee, profile, { reveal, documentCount }) => {
  const bank = profile?.bank || {};
  const sensitive = Object.fromEntries(
    Object.entries(SENSITIVE_FIELDS).map(([field, { maskLength }]) => {
      const stored = bank[field] || {};
      return [field, reveal ? decryptField(stored.cipher) : maskValue(stored.last4, maskLength)];
    })
  );
  const personal = profile?.personal || {};
  const employment = profile?.employment || {};
  return {
    employee: {
      _id: employee._id,
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      personalEmail: employee.personalEmail,
      role: employee.role,
    },
    personal: {
      dateOfBirth: personal.dateOfBirth || null,
      gender: personal.gender || null,
      maritalStatus: personal.maritalStatus || null,
      bloodGroup: personal.bloodGroup || null,
      phone: personal.phone || null,
      currentAddress: personal.currentAddress || {},
      permanentAddress: personal.permanentAddress || {},
      emergencyContact: personal.emergencyContact || {},
    },
    employment: {
      employeeCode: employment.employeeCode || null,
      designation: employment.designation || "",
      department: employment.department || "",
      joiningDate: employment.joiningDate || null,
      employmentType: employment.employmentType || null,
      reportingManager: employment.reportingManager
        ? {
            _id: employment.reportingManager._id || employment.reportingManager,
            name: employeeDisplayName(employment.reportingManager),
            email: employment.reportingManager.email || null,
          }
        : null,
      workLocation: employment.workLocation || "",
      shiftHours: employment.shiftHours || null,
    },
    bank: { bankName: bank.bankName || "", ifsc: bank.ifsc || "", ...sensitive, isRevealed: Boolean(reveal) },
    completion: {
      personal: Boolean(personal.phone && personal.dateOfBirth && personal.emergencyContact?.phone),
      employment: Boolean(employment.employeeCode && employment.joiningDate && employment.designation),
      bank: Boolean(bank.bankName && bank.accountNumber?.last4 && bank.ifsc),
      documents: documentCount,
    },
    updatedAt: profile?.updatedAt || null,
  };
};

const loadProfile = (employeeId) =>
  EmployeeProfile.findOne({ employee: employeeId }).populate("employment.reportingManager", "firstName lastName email").lean();

/**
 * One employee's profile. Bank / statutory values are masked unless reveal is asked for by someone
 * with employee.sensitive.read (audited).
 *
 * @param {object} actor req.currentUser
 * @param {string} employeeId
 * @param {{ reveal?: boolean }} [options]
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 PROFILE_NOT_FOUND / EMPLOYEE_NOT_FOUND
 */
export const getProfileService = async (actor, employeeId, { reveal = false } = {}) => {
  assertCanRead(actor, employeeId);
  const employee = await findActiveEmployeeById(employeeId);
  const canReveal = reveal && employeeHasPermission(actor, PERMISSIONS.SENSITIVE_READ);
  const [profile, documentCount] = await Promise.all([
    loadProfile(employee._id),
    EmployeeDocument.countDocuments({ employee: employee._id, isDeleted: false }),
  ]);
  if (canReveal) {
    await writeHrAudit({
      actor,
      targetEmployeeId: employee._id,
      action: "employee.sensitive.reveal",
      permission: PERMISSIONS.SENSITIVE_READ,
      actionType: "view",
    });
  }
  return toPublic(employee, profile, { reveal: canReveal, documentCount });
};

/** The logged-in employee's own profile (masked). */
export const getMyProfileService = async (actor) => getProfileService(actor, actor._id);

/**
 * Builds the $set for the sections that were sent. Sensitive values are encrypted here; an empty
 * string clears a sensitive value.
 *
 * @returns {{ set: object, bankFieldsChanged: string[] }}
 */
const buildProfileSet = ({ personal, employment, bank }) => {
  const set = {};
  const bankFieldsChanged = [];
  for (const [section, values] of Object.entries({ personal, employment })) {
    if (!values) continue;
    for (const [key, value] of Object.entries(values)) set[`${section}.${key}`] = value;
  }
  if (bank) {
    for (const key of ["bankName", "ifsc"]) {
      if (bank[key] !== undefined) {
        set[`bank.${key}`] = bank[key];
        bankFieldsChanged.push(key);
      }
    }
    for (const field of Object.keys(SENSITIVE_FIELDS)) {
      if (bank[field] === undefined) continue;
      set[`bank.${field}`] = bank[field] ? { cipher: encryptField(bank[field]), last4: lastFour(bank[field]) } : { cipher: null, last4: null };
      bankFieldsChanged.push(field);
    }
  }
  return { set, bankFieldsChanged };
};

/**
 * Admin edit of any section (employee.profile.update). Account name / personal e-mail are written
 * to the Employee document. Bank changes are audited (field names only, never values).
 * Example body: { personal: { phone: "9876543210" }, employment: { employeeCode: "DG-014" },
 *   bank: { ifsc: "HDFC0001234", accountNumber: "50100123456789" } }
 *
 * @param {object} actor req.currentUser
 * @param {string} employeeId
 * @param {{ account?: object, personal?: object, employment?: object, bank?: object }} changes
 * @returns {Promise<object>} the updated profile (masked)
 * @throws {NotFoundError} 404 EMPLOYEE_NOT_FOUND
 * @throws {ConflictError} 409 EMPLOYEE_CODE_EXISTS
 * @throws {AppError} 500 ENCRYPTION_NOT_CONFIGURED when bank values are sent without a key
 */
export const updateProfileService = async (actor, employeeId, { account, personal, employment, bank }) => {
  const employee = await findActiveEmployeeById(employeeId);
  if (employment?.reportingManager) {
    if (String(employment.reportingManager) === String(employee._id)) {
      throw new BadRequestError("An employee cannot report to themselves", { code: ERROR_CODES.INVALID_REQUEST_DATA });
    }
    await findActiveEmployeeById(employment.reportingManager);
  }
  const { set, bankFieldsChanged } = buildProfileSet({ personal, employment, bank });
  try {
    await EmployeeProfile.updateOne(
      { employee: employee._id },
      { $set: { ...set, updatedBy: actor._id }, $setOnInsert: { employee: employee._id } },
      { upsert: true, runValidators: true }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("This employee code is already used", { code: ERROR_CODES.EMPLOYEE_CODE_EXISTS });
    }
    throw error;
  }
  if (account && Object.keys(account).length) {
    await Employee.updateOne({ _id: employee._id }, { $set: account });
  }
  if (bankFieldsChanged.length) {
    await writeHrAudit({
      actor,
      targetEmployeeId: employee._id,
      action: "employee.bank.update",
      permission: PERMISSIONS.PROFILE_UPDATE,
      details: { fields: bankFieldsChanged },
    });
  }
  if (employment) {
    await writeHrAudit({
      actor,
      targetEmployeeId: employee._id,
      action: "employee.employment.update",
      permission: PERMISSIONS.PROFILE_UPDATE,
      details: { fields: Object.keys(employment) },
    });
  }
  return getProfileService(actor, employee._id);
};

/**
 * The employee's own edit: only phone, current / permanent address and emergency contact.
 * Anything else in the body was already removed by the validator.
 *
 * @param {object} actor req.currentUser
 * @param {{ phone?: string, currentAddress?: object, permanentAddress?: object, emergencyContact?: object }} changes
 * @returns {Promise<object>}
 */
export const updateMyProfileService = async (actor, changes) => {
  const set = {};
  for (const key of ["phone", "currentAddress", "permanentAddress", "emergencyContact"]) {
    if (changes[key] !== undefined) set[`personal.${key}`] = changes[key];
  }
  await EmployeeProfile.updateOne(
    { employee: actor._id },
    { $set: { ...set, updatedBy: actor._id }, $setOnInsert: { employee: actor._id } },
    { upsert: true, runValidators: true }
  );
  return getProfileService(actor, actor._id);
};
