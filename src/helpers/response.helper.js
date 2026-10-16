/**
 * The ONLY place that sends success responses. Every endpoint answers with:
 *   { success: true, message, statusCode, data, meta? }
 * meta only for paginated lists: { page, limit, total, totalPages, hasNext, hasPrev }.
 * Errors are sent by middlewares/error.middleware.js, never from here.
 *
 * Example:
 *   sendSuccess(res, { data: brand, message: "Brand fetched" })
 *   -> 200 { success: true, message: "Brand fetched", statusCode: 200, data: { ...brand } }
 *
 * Used by: every controller
 */
import { HTTP_STATUS } from "../constants/httpstatus.constant.js";

/**
 * Sends the standard success response.
 *
 * `legacyTopLevel` is temporary (see docs/API_RESPONSE_MIGRATION.md): endpoints that used to put
 * their fields at the top level ({ success, leads, total }) keep sending those keys next to
 * `data`, so existing frontends keep working. Remove once the frontends read `data`.
 *
 * @param {import("express").Response} res
 * @param {object} [options]
 * @param {*} [options.data] Response payload. Defaults to legacyTopLevel (or its `data` key) or null.
 * @param {string} [options.message="Success"] Human-readable text.
 * @param {number} [options.statusCode=200] 200 for reads and updates, 201 for creates.
 * @param {object} [options.meta] Pagination info for lists (see buildPaginationMeta).
 * @param {object} [options.legacyTopLevel] Old top-level keys, kept for backward compatibility.
 * @returns {import("express").Response}
 */
export const sendSuccess = (
  res,
  { data, message, statusCode = HTTP_STATUS.OK, meta, legacyTopLevel } = {}
) => {
  let payload = data;
  if (payload === undefined && legacyTopLevel && typeof legacyTopLevel === "object") {
    payload = Object.prototype.hasOwnProperty.call(legacyTopLevel, "data")
      ? legacyTopLevel.data
      : legacyTopLevel;
  }
  const body = {
    ...(legacyTopLevel && typeof legacyTopLevel === "object" ? legacyTopLevel : {}),
    success: true,
    message: message ?? legacyTopLevel?.message ?? "Success",
    statusCode,
    data: payload === undefined ? null : payload,
  };
  if (meta) body.meta = meta;
  return res.status(statusCode).json(body);
};

/**
 * Same as sendSuccess with status 201 (a record was created).
 *
 * @param {import("express").Response} res
 * @param {object} [options] See sendSuccess.
 * @returns {import("express").Response}
 */
export const sendCreated = (res, options = {}) =>
  sendSuccess(res, { ...options, statusCode: HTTP_STATUS.CREATED });

/**
 * Builds the standard pagination meta block.
 * Example: page 2, limit 10, total 35 -> { page: 2, limit: 10, total: 35, totalPages: 4, hasNext: true, hasPrev: true }.
 *
 * @param {{ page: number, limit: number, total: number }} pagination
 * @returns {{ page: number, limit: number, total: number, totalPages: number, hasNext: boolean, hasPrev: boolean }}
 */
export const buildPaginationMeta = ({ page, limit, total }) => {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
};

/**
 * Sends a list with the standard meta block.
 *
 * @param {import("express").Response} res
 * @param {object} options
 * @param {Array} options.data The items of this page.
 * @param {{ page: number, limit: number, total: number }} options.pagination
 * @param {string} [options.message]
 * @param {object} [options.legacyTopLevel] See sendSuccess.
 * @returns {import("express").Response}
 */
export const sendPaginated = (res, { data, pagination, message, legacyTopLevel }) =>
  sendSuccess(res, { data, message, meta: buildPaginationMeta(pagination), legacyTopLevel });
