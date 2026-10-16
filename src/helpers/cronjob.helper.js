/**
 * scheduleJob(): the safe way to start a cron job. The job body is wrapped in try/catch and
 * logged, a run that is still busy is never started twice, and a failing job can never crash the
 * process. stopAllJobs() is called on shutdown.
 *
 * Example:
 *   scheduleJob("coupon-expiry", "0 0 * * *", async () => { ... });
 *
 * Used by: src/jobs/*
 */
import cron from "node-cron";
import { logger } from "./logger.helper.js";

const scheduledTasks = [];

/**
 * Schedules a job with overlap protection and error logging.
 *
 * @param {string} name Short job name used in the logs.
 * @param {string} expression Cron expression, e.g. "0 0 * * *" (midnight).
 * @param {() => Promise<unknown>} task The job body.
 * @param {object} [options] Extra node-cron options (for example { timezone: "Asia/Kolkata" }).
 * @returns {import("node-cron").ScheduledTask}
 */
export const scheduleJob = (name, expression, task, options = {}) => {
  let isRunning = false;
  const run = async () => {
    if (isRunning) {
      logger.warn("Cron job skipped: previous run still busy", { job: name });
      return;
    }
    isRunning = true;
    const startedAt = Date.now();
    try {
      await task();
      logger.info("Cron job finished", { job: name, durationMs: Date.now() - startedAt });
    } catch (error) {
      logger.error("Cron job failed", { job: name, error });
    } finally {
      isRunning = false;
    }
  };
  const scheduled = cron.schedule(expression, run, options);
  scheduledTasks.push(scheduled);
  return scheduled;
};

/** Stops every job started with scheduleJob (graceful shutdown). */
export const stopAllJobs = () => {
  scheduledTasks.forEach((scheduled) => scheduled.stop());
};
