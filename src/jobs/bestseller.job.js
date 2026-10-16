/**
 * Daily at 08:00: products in the top sellers (paid, not cancelled orders) get the "best_selling" label; others lose it.
 *
 * Started by: app.js (bestSellerCronJob)
 */
import { scheduleJob } from "../helpers/cronjob.helper.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { logger } from "../helpers/logger.helper.js";

export const bestSellerCronJob = () => {
  // Every day at 08:00: label the top-selling products "best_selling".
  scheduleJob("best-seller-labels", "0 0 8 * * *", async () => {
    logger.debug("Running Best Selling Cron Job");

    // Check if any orders exist
    const orderCount = await Order.countDocuments();

    if (orderCount === 0) {
      logger.debug("No orders found. Skipping Best Seller Cron Job.");
      return;
    }
    // 1️⃣ Aggregate top-selling products
    const bestSellers = await Order.aggregate([
      {
        $match: {
          paymentStatus: { $in: ["paid", "success"] },
          orderStatus: { $in: ["placed", "confirmed", "shipped", "delivered"] },
        },
      },
      { $unwind: "$items" },
      {
        $match: { "items.productId": { $exists: true, $ne: null } },
      },
      {
        $group: {
          _id: "$items.productId", // UUID productId
          totalSoldQuantity: { $sum: "$items.quantity" },
        },
      },
      { $sort: { totalSoldQuantity: -1 } },
      { $limit: 6 },
    ]);

    if (!bestSellers.length) {
      logger.debug("No best selling found");
      return;
    }

    const bestSellingProductIds = bestSellers.map((item) => item._id);

    logger.debug("🏆 Best selling productIds", { bestSellingProductIds });

    // 2️⃣ Remove "Best seller" label from products NOT in best sellers
    await Product.updateMany(
      {
        labels: { $in: ["best_selling"] }, // array check
        productId: { $nin: bestSellingProductIds },
      },
      { $pull: { labels: "best_selling" } }
    );

    // 3️⃣ Add "Best seller" label to top products
    const result = await Product.updateMany(
      {
        productId: { $in: bestSellingProductIds },
        status: "active",
      },
      { $addToSet: { labels: "best_selling" } } // ✅ add to array
    );

    logger.debug("Modified products", { modifiedCount: result.modifiedCount });
  });
};
