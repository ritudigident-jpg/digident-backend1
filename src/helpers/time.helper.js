/**
 * India-time (IST) helpers for logs and attendance.
 *
 * Exports: getISTTime, getISTDateTime
 * Used by: middlewares/logger.middleware.js
 */

/**
 * Get ist time.
 * @returns {*}
 */
export const getISTTime = () => {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
};

/**
 * Get ist date time.
 * @returns {*}
 */
export const getISTDateTime = () => {
  const date = new Date().toLocaleString("en-IN", {
    timezone: "Asia/Kolkata",
    hour12: true,
  });
  return date.replace(",", "");
};
