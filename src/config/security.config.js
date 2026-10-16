/**
 * Security middleware settings: helmet headers and rate limits.
 * General limit: RATE_LIMIT.GENERAL_MAX requests per IP per window on all /api routes.
 * Strict limit: RATE_LIMIT.AUTH_MAX attempts per IP per window on login, register, OTP and
 * password-reset routes (STRICT_LIMIT_PATHS). Over the limit -> 429 TOO_MANY_REQUESTS.
 *
 * Used by: app.js
 */
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { TooManyRequestsError } from "../helpers/apperror.helper.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

export const RATE_LIMIT = Object.freeze({
  WINDOW_MS: FIFTEEN_MINUTES_MS,
  GENERAL_MAX: 3000,
  AUTH_MAX: 20,
});

/** Routes that get the strict limit (brute-force targets). */
export const STRICT_LIMIT_PATHS = [
  "/api/v1/user/register",
  "/api/v1/user/login",
  "/api/v1/user/forget-password",
  "/api/v1/user/reset-password",
  "/api/v1/employee/login",
  "/api/v1/employee/forget-password",
  "/api/v1/employee/reset-password",
  "/api/v1/librarylog/send-otp",
  "/api/v1/librarylog/verify-otp",
];

const rejectWithAppError = (message) => (req, res, next) => next(new TooManyRequestsError(message));

/** Helmet for a JSON API used from other origins: files and images may be loaded cross-origin. */
export const helmetMiddleware = helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false,
});

/** Limit for every /api request. */
export const generalRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  limit: RATE_LIMIT.GENERAL_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  // app.js sets "trust proxy" (the API runs behind a proxy), so do not warn about it.
  validate: { trustProxy: false, xForwardedForHeader: false },
  handler: rejectWithAppError("Too many requests, please try again later"),
});

/** Stricter limit for login / OTP / password routes. */
export const authRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  limit: RATE_LIMIT.AUTH_MAX,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  validate: { trustProxy: false, xForwardedForHeader: false },
  handler: rejectWithAppError("Too many attempts, please try again in 15 minutes"),
});
