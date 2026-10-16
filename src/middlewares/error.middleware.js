/**
 * The ONE place that turns errors into responses, plus the 404 handler for unknown routes.
 * Both are mounted LAST in app.js. Every error leaves the API in this shape:
 *   { success: false, message, statusCode, error: { code, details? }, requestId }
 * In production a 500 always says "Something went wrong"; the real error is only logged.
 *
 * Mapping (see docs/API_CONVENTIONS.md):
 *   AppError -> its own status / code        Joi error -> 400 VALIDATION_ERROR
 *   Mongoose ValidationError -> 400          Mongoose CastError (bad id) -> 400 INVALID_ID
 *   Mongo duplicate key 11000 -> 409         JWT expired / invalid -> 401
 *   Multer error -> 400                      invalid JSON body -> 400 INVALID_JSON
 *   CORS rejection -> 403 CORS_BLOCKED       Razorpay SDK error -> 400 with its description
 *   older thrown { statusCode, message } -> kept as is
 *   new Error("EMAIL_EXISTS") etc. -> same status / message as before (LEGACY_MESSAGE_CODES)
 *   anything else -> 500 INTERNAL_ERROR
 *
 * Used by: app.js
 */
import { HTTP_STATUS } from "../constants/httpstatus.constant.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";
import { AppError, LEGACY_MESSAGE_CODES } from "../helpers/apperror.helper.js";
import { logger } from "../helpers/logger.helper.js";

const GENERIC_MESSAGE = "Something went wrong";
const MONGO_DUPLICATE_KEY = 11000;

const CODE_FOR_STATUS = {
  [HTTP_STATUS.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HTTP_STATUS.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HTTP_STATUS.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HTTP_STATUS.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HTTP_STATUS.CONFLICT]: ERROR_CODES.CONFLICT,
  [HTTP_STATUS.TOO_MANY_REQUESTS]: ERROR_CODES.TOO_MANY_REQUESTS,
  [HTTP_STATUS.BAD_GATEWAY]: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
  [HTTP_STATUS.GATEWAY_TIMEOUT]: ERROR_CODES.EXTERNAL_SERVICE_TIMEOUT,
};

const isValidStatus = (value) => Number.isInteger(value) && value >= 400 && value <= 599;

/** Older code passes details as plain strings; the contract wants { field?, message }. */
const normaliseDetails = (details) => {
  if (details === undefined || details === null) return undefined;
  const list = Array.isArray(details) ? details : [details];
  return list.map((item) => (typeof item === "string" ? { message: item } : item));
};

/**
 * Turns any thrown value into { statusCode, code, message, details, expose }.
 * `expose` = false means the message must not reach the client.
 *
 * @param {*} error
 * @returns {{ statusCode: number, code: string, message: string, details?: Array, expose: boolean }}
 */
export const classifyError = (error) => {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      details: normaliseDetails(error.details),
      expose: error.isOperational && error.statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR,
    };
  }
  if (!error || typeof error !== "object") {
    return {
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: String(error),
      expose: false,
    };
  }
  if (error.isJoi || (error.name === "ValidationError" && Array.isArray(error.details))) {
    const details = error.details.map((detail) => ({
      field: (detail.path || []).join("."),
      message: detail.message,
    }));
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Validation failed",
      details,
      expose: true,
    };
  }
  if (error.name === "ValidationError" && error.errors && typeof error.errors === "object") {
    const details = Object.values(error.errors).map((item) => ({ field: item.path, message: item.message }));
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
      message: "Validation failed",
      details,
      expose: true,
    };
  }
  if (error.name === "CastError") {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.INVALID_ID,
      message: `Invalid value for ${error.path}`,
      details: [{ field: error.path, message: `"${error.value}" is not a valid ${error.kind}` }],
      expose: true,
    };
  }
  if (error.code === MONGO_DUPLICATE_KEY) {
    const fields = Object.keys(error.keyValue || error.keyPattern || {});
    return {
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.DUPLICATE_KEY,
      message: fields.length ? `${fields.join(", ")} already exists` : "Record already exists",
      details: fields.map((field) => ({ field, message: `${field} already exists` })),
      expose: true,
    };
  }
  if (error.name === "TokenExpiredError") {
    return {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.TOKEN_EXPIRED,
      message: "Token expired",
      expose: true,
    };
  }
  if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
    return {
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      code: ERROR_CODES.INVALID_TOKEN,
      message: "Invalid token",
      expose: true,
    };
  }
  if (error.name === "MulterError") {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.FILE_UPLOAD_ERROR,
      message: error.message,
      details: error.field ? [{ field: error.field, message: error.message }] : undefined,
      expose: true,
    };
  }
  if (error.type === "entity.parse.failed") {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.INVALID_JSON,
      message: "Request body is not valid JSON",
      expose: true,
    };
  }
  if (error.message === "CORS Blocked") {
    return {
      statusCode: HTTP_STATUS.FORBIDDEN,
      code: ERROR_CODES.CORS_BLOCKED,
      message: "Origin not allowed",
      expose: true,
    };
  }
  if (LEGACY_MESSAGE_CODES[error.message]) {
    const legacy = LEGACY_MESSAGE_CODES[error.message];
    return { statusCode: legacy.statusCode, code: error.message, message: legacy.message, expose: true };
  }
  // Razorpay SDK errors: { statusCode, error: { code, description } } -> the description is safe to show.
  if (error.error?.description) {
    const razorpayStatus =
      isValidStatus(error.statusCode) && error.statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR
        ? error.statusCode
        : HTTP_STATUS.BAD_REQUEST;
    return {
      statusCode: razorpayStatus,
      code: error.error.code || ERROR_CODES.BAD_REQUEST,
      message: error.error.description,
      expose: true,
    };
  }
  // Older code: throw { message, statusCode, errorCode, details } or an Error with .statusCode set.
  const legacyStatus = isValidStatus(error.statusCode)
    ? error.statusCode
    : isValidStatus(error.status)
      ? error.status
      : undefined;
  if (legacyStatus) {
    return {
      statusCode: legacyStatus,
      code:
        error.errorCode ||
        (typeof error.code === "string" ? error.code : undefined) ||
        CODE_FOR_STATUS[legacyStatus] ||
        ERROR_CODES.INTERNAL_ERROR,
      message: error.message || GENERIC_MESSAGE,
      details: normaliseDetails(error.details),
      expose: legacyStatus < HTTP_STATUS.INTERNAL_SERVER_ERROR,
    };
  }
  return {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error.message || GENERIC_MESSAGE,
    expose: false,
  };
};

/**
 * Global Express error handler. Must be registered after every route.
 *
 * @type {import("express").ErrorRequestHandler}
 */

/**
 * Error handler.
 *
 * @param {*} error
 * @param {*} req
 * @param {*} res
 * @param {*} next
 * @returns {*}
 */
export const errorHandler = (error, req, res, next) => {
  const classified = classifyError(error);
  const isProduction = process.env.NODE_ENV === "production";
  const isServerError = classified.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR;

  const logContext = {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode: classified.statusCode,
    code: classified.code,
    error,
  };
  if (isServerError) logger.error("Request failed", logContext);
  else
    logger.warn("Request rejected", { ...logContext, error: { name: error?.name, message: error?.message } });

  if (res.headersSent) return undefined;

  const showMessage = classified.expose || !isProduction;
  const body = {
    success: false,
    message: showMessage ? classified.message : GENERIC_MESSAGE,
    statusCode: classified.statusCode,
    error: { code: classified.code },
    requestId: req.id,
  };
  if (showMessage && classified.details?.length) body.error.details = classified.details;
  if (!isProduction && isServerError && error?.stack) body.error.stack = error.stack;
  return res.status(classified.statusCode).json(body);
};

/**
 * 404 for any route that no router handled.
 *
 * @type {import("express").RequestHandler}
 */
export const notFoundHandler = (req, res, next) =>
  next(
    new AppError(`Route not found: ${req.method} ${req.originalUrl}`, {
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.ROUTE_NOT_FOUND,
    })
  );
