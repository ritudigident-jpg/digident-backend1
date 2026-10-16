/**
 * Read and update the ONE PayrollSettings document. Reads are cached for a short time because
 * every punch and calendar request needs them.
 *
 * Exports: getPayrollSettings, getPayrollSettingsService, updatePayrollSettingsService, clearSettingsCache
 * Used by: services/attendance/*, services/payroll/*, controllers/payroll/payroll.controller.js
 */
import PayrollSettings from "../../models/payrollsettings.model.js";
import { PAYROLL_SETTINGS_KEY } from "../../constants/payrollsettings.constant.js";
import { mergeSettings } from "../attendance/attendancerules.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";

const SETTINGS_CACHE_MS = 30_000;
let cached = null;
let cachedAt = 0;

/** Forgets the cached settings (after an update, and in tests). */
export const clearSettingsCache = () => {
  cached = null;
  cachedAt = 0;
};

/**
 * Current settings: the stored document merged over the defaults.
 *
 * @returns {Promise<object>}
 */
export const getPayrollSettings = async () => {
  if (cached && Date.now() - cachedAt < SETTINGS_CACHE_MS) return cached;
  const stored = await PayrollSettings.findOne({ key: PAYROLL_SETTINGS_KEY }).lean();
  cached = mergeSettings(stored || {});
  cachedAt = Date.now();
  return cached;
};

/**
 * Settings for the settings screen.
 *
 * @returns {Promise<{ settings: object, updatedAt: Date | null }>}
 */
export const getPayrollSettingsService = async () => {
  const stored = await PayrollSettings.findOne({ key: PAYROLL_SETTINGS_KEY }).lean();
  return { settings: mergeSettings(stored || {}), updatedAt: stored?.updatedAt || null };
};

/**
 * Saves new settings (only the keys given) and writes an audit entry with old and new values.
 *
 * @param {object} changes validated by payroll.validator.js
 * @param {{ _id: *, email: string }} actor
 * @returns {Promise<object>} merged settings after the change
 */
export const updatePayrollSettingsService = async (changes, actor) => {
  const before = await getPayrollSettingsService();
  const stored = await PayrollSettings.findOneAndUpdate(
    { key: PAYROLL_SETTINGS_KEY },
    { $set: { ...changes, updatedBy: actor._id }, $setOnInsert: { key: PAYROLL_SETTINGS_KEY } },
    { upsert: true, new: true, runValidators: true }
  ).lean();
  clearSettingsCache();
  const changed = Object.keys(changes).filter((key) => JSON.stringify(before.settings[key]) !== JSON.stringify(changes[key]));
  await writeHrAudit({
    actor,
    action: "payroll.settings.update",
    permission: PERMISSIONS.PAYROLL_SETTINGS_UPDATE,
    details: Object.fromEntries(changed.map((key) => [key, { from: before.settings[key], to: changes[key] }])),
  });
  return mergeSettings(stored);
};
