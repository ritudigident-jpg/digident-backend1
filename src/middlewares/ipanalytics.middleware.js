/**
 * Client IP and IP analytics.
 * - clientIpMiddleware: puts the caller's IP on req.userIP (used by punch-in IP checks).
 * - ipAnalyticsMiddleware: after the response is sent, records the hit (services/ipanalytics/
 *   iptracking.service.js). A failure is logged and never affects the request.
 *
 * Used by: app.js
 */
import { recordIpHit } from "../services/ipanalytics/iptracking.service.js";
import { logger } from "../helpers/logger.helper.js";

const LOCALHOST_IPS = new Set(["::1", "127.0.0.1"]);
// Local development has no public IP; use the office IP so punch-in IP checks behave like production.
const DEVELOPMENT_FALLBACK_IP = "163.53.179.27";

/**
 * The caller's IP: first x-forwarded-for entry, else the socket address.
 *
 * @param {import("express").Request} req
 * @returns {string|undefined}
 */
export const resolveClientIp = (req) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || req.ip;
  return LOCALHOST_IPS.has(ip) ? DEVELOPMENT_FALLBACK_IP : ip;
};

/** @type {import("express").RequestHandler} */
export const clientIpMiddleware = (req, res, next) => {
  req.userIP = resolveClientIp(req);
  next();
};

/** @type {import("express").RequestHandler} */
export const ipAnalyticsMiddleware = (req, res, next) => {
  const ip = req.userIP;
  if (!ip) return next();
  const endpoint = `${req.method} ${req.baseUrl}${req.path}`;
  res.on("finish", () => {
    recordIpHit(ip, endpoint).catch((error) =>
      logger.warn("IP analytics update failed", { requestId: req.id, ip, error })
    );
  });
  return next();
};
