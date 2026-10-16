/**
 * The error classes the whole backend throws. A service throws one of these for every business
 * failure ("not found", "out of stock", "already exists"); the global error middleware turns it
 * into the standard error response. Never throw a plain string or object.
 *
 * Example:
 *   if (!order) throw new NotFoundError("Order not found", { code: ERROR_CODES.ORDER_NOT_FOUND });
 *   -> 404 { success: false, message: "Order not found", error: { code: "ORDER_NOT_FOUND" }, ... }
 *
 * Used by: services, controllers, middlewares/error.middleware.js
 */
import { HTTP_STATUS } from "../constants/httpstatus.constant.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";

/**
 * Base class: an expected failure with a status code and a stable error code.
 * `isOperational` = true means the message is safe to show to the client.
 */
export class AppError extends Error {
  /**
   * @param {string} message Human-readable text shown to the client.
   * @param {object} [options]
   * @param {number} [options.statusCode=500] HTTP status (use HTTP_STATUS).
   * @param {string} [options.code="INTERNAL_ERROR"] Stable code from ERROR_CODES.
   * @param {Array<{ field?: string, message: string }>} [options.details] Extra detail (validation).
   * @param {unknown} [options.cause] The original error, kept for the logs.
   * @param {boolean} [options.isOperational=true] False for programming errors (message hidden).
   */
  constructor(
    message,
    {
      statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code = ERROR_CODES.INTERNAL_ERROR,
      details,
      cause,
      isOperational = true,
    } = {}
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;
  }
}

const subclass = (name, statusCode, defaultCode, defaultMessage) =>
  ({
    [name]: class extends AppError {
      constructor(message = defaultMessage, options = {}) {
        super(message, { code: defaultCode, ...options, statusCode });
      }
    },
  })[name];

/** 400: the request is wrong (bad value, missing field, rule broken). */
export const BadRequestError = subclass(
  "BadRequestError",
  HTTP_STATUS.BAD_REQUEST,
  ERROR_CODES.BAD_REQUEST,
  "Bad request"
);
/** 401: not logged in, or the token is missing / expired / invalid. */
export const UnauthorizedError = subclass(
  "UnauthorizedError",
  HTTP_STATUS.UNAUTHORIZED,
  ERROR_CODES.UNAUTHORIZED,
  "Unauthorized"
);
/** 403: logged in but not allowed to do this. */
export const ForbiddenError = subclass(
  "ForbiddenError",
  HTTP_STATUS.FORBIDDEN,
  ERROR_CODES.FORBIDDEN,
  "Forbidden"
);
/** 404: the record (or route) does not exist. */
export const NotFoundError = subclass(
  "NotFoundError",
  HTTP_STATUS.NOT_FOUND,
  ERROR_CODES.NOT_FOUND,
  "Not found"
);
/** 409: duplicate or conflicting state ("already exists", "already processed"). */
export const ConflictError = subclass(
  "ConflictError",
  HTTP_STATUS.CONFLICT,
  ERROR_CODES.CONFLICT,
  "Conflict"
);
/** 429: too many requests. */
export const TooManyRequestsError = subclass(
  "TooManyRequestsError",
  HTTP_STATUS.TOO_MANY_REQUESTS,
  ERROR_CODES.TOO_MANY_REQUESTS,
  "Too many requests, please try again later"
);
/** 502: Razorpay, Zoho, S3, mail ... failed. Always pass the original error as `cause`. */
export const ExternalServiceError = subclass(
  "ExternalServiceError",
  HTTP_STATUS.BAD_GATEWAY,
  ERROR_CODES.EXTERNAL_SERVICE_ERROR,
  "External service failed"
);

/** 400 with field details. Build it from a Joi error with ValidationError.fromJoi(error). */
export class ValidationError extends AppError {
  constructor(message = "Validation failed", options = {}) {
    super(message, { code: ERROR_CODES.VALIDATION_ERROR, ...options, statusCode: HTTP_STATUS.BAD_REQUEST });
  }

  /**
   * Converts a Joi validation error into a ValidationError.
   * Example: missing email -> details [{ field: "email", message: "\"email\" is required" }].
   *
   * @param {import("joi").ValidationError} joiError
   * @param {string} [message="Validation failed"]
   * @returns {ValidationError}
   */
  static fromJoi(joiError, message = "Validation failed") {
    const details = (joiError?.details || []).map((detail) => ({
      field: (detail.path || []).join("."),
      message: detail.message,
    }));
    return new ValidationError(message, { details, cause: joiError });
  }
}

/**
 * Codes that older code throws as `new Error("CODE")`. The global error handler maps them to the
 * status and message clients have always received, so existing frontends see no change.
 * New code must throw an AppError subclass instead.
 */
export const LEGACY_MESSAGE_CODES = Object.freeze({
  EMAIL_EXISTS: { statusCode: HTTP_STATUS.CONFLICT, message: "Email already exists" },
  INVALID_CREDENTIALS: { statusCode: HTTP_STATUS.UNAUTHORIZED, message: "Invalid email or password" },
  USER_NOT_FOUND: { statusCode: HTTP_STATUS.NOT_FOUND, message: "User not found" },
  INVALID_OLD_PASSWORD: { statusCode: HTTP_STATUS.UNAUTHORIZED, message: "Old password is incorrect" },
  TOKEN_EXPIRED: { statusCode: HTTP_STATUS.UNAUTHORIZED, message: "Token expired" },
  INVALID_TOKEN: { statusCode: HTTP_STATUS.UNAUTHORIZED, message: "Invalid token" },
});
