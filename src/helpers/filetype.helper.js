/**
 * Detects the REAL type of an uploaded file from its first bytes ("magic numbers"), so a renamed
 * .exe cannot pass as a .pdf. Only PDF, JPEG and PNG are recognised (the allowed document types).
 *
 *   PDF  25 50 44 46 2D        "%PDF-"
 *   PNG  89 50 4E 47 0D 0A 1A 0A
 *   JPEG FF D8 FF
 *
 * Exports: detectFileType, ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES
 * Used by: services/employeeprofile/employeedocument.service.js, tests/filetype.test.js
 */

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
});

const startsWith = (buffer, bytes) => buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);

/**
 * @param {Buffer} buffer file contents (at least the first 8 bytes)
 * @returns {"application/pdf" | "image/png" | "image/jpeg" | null}
 */
export const detectFileType = (buffer) => {
  if (!Buffer.isBuffer(buffer)) return null;
  if (startsWith(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  return null;
};
