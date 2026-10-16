/**
 * Sales dashboard numbers for shop orders. Re-exported by order.service.js.
 */
import Order from "../../models/order.model.js";

/**
 * Sales dashboard.
 *
 * @param {*} data
 * @returns {Promise<*>}
 */
export const salesDashboardService = async (data) => {
  const { startDate, endDate, country, state, top } = data;

  const safeTop = Math.min(parseInt(top) || 10, 50);

  const baseMatch = {
    orderStatus: { $nin: ["cancelled", "returned"] },
  };

  if (startDate || endDate) {
    baseMatch.createdAt = {};

    if (startDate) {
      baseMatch.createdAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
    }

    if (endDate) {
      baseMatch.createdAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
  }

  if (country) {
    baseMatch["shippingAddress.country"] = country;
  }

  if (state) {
    baseMatch["shippingAddress.state"] = state;
  }

  let groupField;
  let level;

  if (!country && !state) {
    groupField = "$shippingAddress.country";
    level = "country";
  } else if (country && !state) {
    groupField = "$shippingAddress.state";
    level = "state";
  } else {
    groupField = "$shippingAddress.city";
    level = "city";
  }

  const result = await Order.aggregate([
    { $match: baseMatch },
    {
      $addFields: {
        netRevenue: {
          $subtract: ["$grandTotal", { $ifNull: ["$partialRefundAmount", 0] }],
        },
      },
    },
    {
      $group: {
        _id: groupField,
        totalRevenue: { $sum: "$netRevenue" },
        totalOrders: { $sum: 1 },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: safeTop },
  ]);

  const analytics = result.map((item) => ({
    name: item._id || "Unknown",
    totalRevenue: item.totalRevenue,
    totalOrders: item.totalOrders,
    averageOrderValue: item.totalOrders ? +(item.totalRevenue / item.totalOrders).toFixed(2) : 0,
  }));

  return {
    level,
    filters: {
      startDate,
      endDate,
      country,
      state,
    },
    analytics,
  };
};
