// services/coupon.service.js
import Coupon from "../models/manage/coupon.model.js";
import { v6 as uuidv6 } from "uuid";

export const createCouponService = async (data) => {
  const coupon = await Coupon.create({
    ...data,
    couponId: uuidv6(),
    code: data.code.toUpperCase()
  });

  return coupon;
};

export const updateCouponService = async ({ couponId, data }) => {
  if (data.code) data.code = data.code.toUpperCase();

  const coupon = await Coupon.findOneAndUpdate(
    { couponId },
    data,
    { new: true }
  );

  if (!coupon) {
    const error = new Error("Coupon not found");
    error.statusCode = 404;
    throw error;
  }
  return coupon;
};

export const filterCouponsService = async ({ status, skip, limit }) => {
  let filter = {};

  if (status === "active") filter.isActive = true;
  if (status === "draft") filter.isActive = false;

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),

    Coupon.countDocuments(filter)
  ]);

  return { coupons, total, filter };
};

export const getSingleCouponService = async ({ couponId }) => {
  const coupon = await Coupon.findOne({ couponId });

  if (!coupon) {
    const error = new Error("Coupon not found");
    error.statusCode = 404;
    error.errorCode = "COUPON_NOT_FOUND";
    throw error;
  }

  // Auto deactivate expired coupon
  if (coupon.endDate < new Date() && coupon.isActive) {
    coupon.isActive = false;
    await coupon.save();
  }
  return coupon;
};

export const deleteCouponService = async ({ couponId }) => {
  const coupon = await Coupon.findOneAndDelete({ couponId });

  if (!coupon) {
    const error = new Error("Coupon not found");
    error.statusCode = 404;
    error.errorCode = "COUPON_NOT_FOUND";
    throw error;
  }

  return coupon;
};