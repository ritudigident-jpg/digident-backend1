/**
 * Allows attendance punch-in only from office IP addresses.
 *
 * Exports: punchAccessMiddleware
 */

import ipRangeCheck from "ip-range-check";
import { ForbiddenError } from "../helpers/apperror.helper.js";
import { asyncHandler } from "../helpers/asynchandler.helper.js";
import { logger } from "../helpers/logger.helper.js";

/**
 * @function punchAccessMiddleware
 *
 * @description
 * Middleware to restrict punch-in/out access to office IP addresses only.
 *
 * @process
 * 1. Extract client IP from `req.userIP`
 * 2. Compare against allowed office IP ranges using `ip-range-check`
 * 3. If IP is allowed, call `next()`
 * 4. If IP is not allowed, return 403 Forbidden with descriptive message
 *
 * @response
 * 403 { success: false, message: "Punch-in/out allowed only from office network" } - if IP not allowed
 * 500 { success: false, message: "<error_message>" } - for unexpected errors
 *
 * @example
 * router.post("/punch-in", authToken, punchAccessMiddleware, punchController);
 */
export const punchAccessMiddleware = asyncHandler((req, res, next) => {
  const userIp = req.userIP;
  logger.debug("Punch Access Middleware - User IP", { userIp });

  // Skip if IP not provided
  if (!userIp) return next();

  const OFFICE_IPS = ["150.107.241.0/24"];
  const isAllowed = ipRangeCheck(userIp, OFFICE_IPS);

  if (!isAllowed) {
    throw new ForbiddenError("Punch-in/out allowed only from office network");
  }

  next();
});
