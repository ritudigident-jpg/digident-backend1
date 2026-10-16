/**
 * Business logic for discount coupons. Throws AppError subclasses on failure.
 *
 * Exports: createCouponService, updateCouponService, filterCouponsService, getSingleCouponService,
 * deleteCouponService
 * Used by: controllers/coupon/coupon.controller.js
 */

import Coupon from "../../models/coupon.model.js";
import { v6 as uuidv6 } from "uuid";
import { sendNotification } from "../notification/notification.service.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { redis as redisClient } from "../../config/redis.config.js";
import Employee from "../../models/employee.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/* =========================================================
   CACHE CONFIG
========================================================= */
const CACHE_TTL = 60 * 60;

/* =========================================================
   CACHE HELPERS
========================================================= */
const getCache = async (key) => {
  try {
    const cached = await redisClient.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (err) {
    logger.error("REDIS GET CACHE ERROR", { error: err.message });
    return null;
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), { ex: CACHE_TTL });
  } catch (err) {
    logger.error("REDIS SET CACHE ERROR", { error: err.message });
  }
};

const clearCouponCache = async () => {
  try {
    const keys = await redisClient.keys("COUPON:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("COUPON CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS COUPON CACHE CLEAR ERROR", { error: err.message });
  }
};

/* =========================================================
   CREATE COUPON
========================================================= */
/**
 * Create coupon.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.employee
 * @returns {Promise<*>}
 */
export const createCouponService = async ({ data, employee }) => {
  const coupon = await Coupon.create({
    ...data,
    couponId: uuidv6(),
  });
  /* ---------- CLEAR CACHE ---------- */
  await clearCouponCache();
  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: Employee?._id,
      actionByEmail: employee?.email,
      actionFor: coupon._id,
      action: coupon.code,
      permission: data.permission || "create_coupon",
      actionType: "Create",
    });
  } catch (err) {
    logger.error("Audit log failed on create coupon", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "marketing.coupon.create",
      title: "New Coupon Created",
      message: `${coupon.code} coupon has been created successfully`,
      type: "COUPON_CREATED",
      entityId: coupon._id,
      entityModel: "Coupon",
      metadata: {
        couponId: coupon.couponId,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        createdBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on create coupon", { error: err.message });
  }

  return coupon;
};

/* =========================================================
   UPDATE COUPON
========================================================= */
/**
 * Update coupon.
 *
 * @param {object} params
 * @param {*} params.couponId
 * @param {*} params.data
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateCouponService = async ({ couponId, data, employee }) => {
  if (data.code) data.code = data.code.toUpperCase();

  const coupon = await Coupon.findOneAndUpdate({ couponId }, data, { new: true });

  if (!coupon) {
    throw new NotFoundError("Coupon not found", { code: ERROR_CODES.COUPON_NOT_FOUND });
  }

  /* ---------- CLEAR CACHE ---------- */
  await clearCouponCache();
  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: coupon._id,
      action: coupon.code,
      permission: data.permission || "update_coupon",
      actionType: "Update",
    });
  } catch (err) {
    logger.error("Audit log failed on update coupon", { error: err.message });
  }
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "marketing.coupon.update",
      title: "Coupon Updated",
      message: `${coupon.code} coupon has been updated successfully`,
      type: "COUPON_UPDATED",
      entityId: coupon._id,
      entityModel: "Coupon",
      metadata: {
        couponId: coupon.couponId,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        createdBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on update coupon", { error: err.message });
  }

  return coupon;
};

/* =========================================================
   FILTER COUPONS
========================================================= */
/**
 * Filter coupons.
 *
 * @param {object} params
 * @param {*} params.isActive
 * @param {*} params.skip
 * @param {*} params.limit
 * @returns {Promise<*>}
 */
export const filterCouponsService = async ({ isActive, skip, limit }) => {
  const filter = {};
  if (isActive === "true") filter.isActive = true;
  if (isActive === "false") filter.isActive = false;

  /* ---------- CACHE KEY ---------- */
  const cacheKey = `COUPON:LIST:${isActive ?? "all"}:${skip}:${limit}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("COUPON CACHE HIT", { cacheKey });
    return cached;
  }

  const [coupons, total] = await Promise.all([
    Coupon.find(filter)
      .populate("applicableCategories", "name categoryId")
      .populate("applicableBrands", "brandName brandId")
      .populate("buyXGetY.buyCategory", "name categoryId")
      .populate("buyXGetY.getCategory", "name categoryId")
      .populate("buyXGetY.buyBrand", "brandName brandId")
      .populate("buyXGetY.getBrand", "brandName brandId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Coupon.countDocuments(filter),
  ]);

  const result = { coupons, total, filter };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET SINGLE COUPON
========================================================= */
/**
 * Get single coupon.
 *
 * @param {object} params
 * @param {*} params.couponId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getSingleCouponService = async ({ couponId }) => {
  /* ---------- CACHE KEY ---------- */
  const cacheKey = `COUPON:ID:${couponId}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("COUPON CACHE HIT", { cacheKey });
    return cached;
  }

  const coupon = await Coupon.findOne({ couponId })
    .populate("applicableCategories", "name categoryId")
    .populate("applicableBrands", "brandName brandId")
    .populate("buyXGetY.buyCategory", "name categoryId")
    .populate("buyXGetY.getCategory", "name categoryId")
    .populate("buyXGetY.buyBrand", "brandName brandId")
    .populate("buyXGetY.getBrand", "brandName brandId");

  if (!coupon) {
    throw new NotFoundError("Coupon not found", { code: ERROR_CODES.COUPON_NOT_FOUND });
  }

  /* ---------- AUTO DEACTIVATE IF EXPIRED ---------- */
  if (coupon.endDate < new Date() && coupon.isActive) {
    coupon.isActive = false;
    await coupon.save();
    await clearCouponCache();
  }

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, coupon);

  return coupon;
};

/* =========================================================
   DELETE COUPON
========================================================= */
/**
 * Delete coupon.
 *
 * @param {object} params
 * @param {*} params.couponId
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteCouponService = async ({ couponId, employee }) => {
  const coupon = await Coupon.findOneAndDelete({ couponId });

  if (!coupon) {
    throw new NotFoundError("Coupon not found", { code: ERROR_CODES.COUPON_NOT_FOUND });
  }

  /* ---------- CLEAR CACHE ---------- */
  await clearCouponCache();
  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: coupon._id,
      action: coupon.code,
      permission: "delete_coupon",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete coupon", { error: err.message });
  }
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "marketing.coupon.delete",
      title: "Coupon Deleted",
      message: `${coupon.code} coupon has been deleted successfully`,
      type: "COUPON_DELETED",
      entityId: coupon._id,
      entityModel: "Coupon",
      metadata: {
        couponId: coupon.couponId,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        createdBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete coupon", { error: err.message });
  }

  return coupon;
};
