/**
 * Daily at midnight: coupons whose end date has passed are switched off (isActive = false).
 *
 * Started by: app.js (startCouponExpiryCron)
 */
import { scheduleJob } from "../helpers/cronjob.helper.js";
import Coupon from "../models/coupon.model.js";
import { logger } from "../helpers/logger.helper.js";

export const startCouponExpiryCron = () => {
  scheduleJob("coupon-expiry", "0 0 * * *", async () => {
    logger.debug("Running Coupon Expiry Cron...");
    const now = new Date();
    const result = await Coupon.updateMany(
      {
        endDate: { $lt: now },
        isActive: true,
      },
      {
        $set: { isActive: false },
      }
    );
    logger.debug(`Expired coupons updated: ${result.modifiedCount}`);
  });
};
