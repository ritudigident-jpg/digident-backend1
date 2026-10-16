/**
 * Field-level encryption for sensitive employee data (bank account, PAN, Aadhaar, UAN):
 * AES-256-GCM with a random 12-byte IV per value; the auth tag detects tampering.
 * Stored format: "v1:<iv base64>:<tag base64>:<ciphertext base64>".
 * Key: FIELD_ENCRYPTION_KEY = 32 random bytes, base64 (generate with
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))").
 * Never log the key or decrypted values. Rotating the key needs a re-encryption script.
 *
 * Also: maskValue() for display ("XXXXXXXX1234").
 *
 * Exports: encryptField, decryptField, maskValue, lastFour, isEncryptionConfigured
 * Used by: services/employeeprofile/employeeprofile.service.js, tests/fieldcrypto.test.js
 */
import crypto from "node:crypto";
import { AppError } from "./apperror.helper.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

const readKey = () => {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  const key = raw ? Buffer.from(raw, "base64") : null;
  if (!key || key.length !== KEY_BYTES) {
    throw new AppError("Sensitive-field encryption is not configured", { code: ERROR_CODES.ENCRYPTION_NOT_CONFIGURED });
  }
  return key;
};

/** True when FIELD_ENCRYPTION_KEY is a valid 32-byte base64 key. */
export const isEncryptionConfigured = () => {
  try {
    readKey();
    return true;
  } catch {
    return false; // a missing / bad key is reported by readKey() when encryption is actually needed
  }
};

/**
 * @param {string} plainText
 * @returns {string} "v1:iv:tag:cipher"
 * @throws {AppError} 500 ENCRYPTION_NOT_CONFIGURED
 */
export const encryptField = (plainText) => {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, readKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
};

/**
 * @param {string | null} stored
 * @returns {string | null}
 * @throws {AppError} 500 ENCRYPTION_NOT_CONFIGURED; Error when the value was tampered with
 */
export const decryptField = (stored) => {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION) throw new AppError("Unknown encrypted value format");
  const decipher = crypto.createDecipheriv(ALGORITHM, readKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
};

/** Last 4 characters (kept in clear for masking). */
export const lastFour = (value) => (value ? String(value).slice(-4) : null);

/**
 * Masked display value. Example: maskValue("1234", 12) -> "XXXXXXXX1234".
 *
 * @param {string | null} last4
 * @param {number} [length=10]
 * @returns {string | null}
 */
export const maskValue = (last4, length = 10) => (last4 ? `${"X".repeat(Math.max(0, length - last4.length))}${last4}` : null);
