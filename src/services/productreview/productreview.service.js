/**
 * Business logic for product-type feedback forms (Scan Body, Lab Analog, Screws, Abutment ...).
 * Throws AppError subclasses on failure.
 *
 * Exports: createProductReviewService, getAllProductReviewsService, getProductReviewByIdService,
 * updateProductReviewService, deleteProductReviewService
 * Used by: controllers/productreview/productreview.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import ProductReview from "../../models/productreview.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, NotFoundError } from "../../helpers/apperror.helper.js";
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

const clearProductReviewCache = async () => {
  try {
    const keys = await redisClient.keys("PRODUCTID:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("PRODUCT REVIEW CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS CLEAR CACHE ERROR", { error: err.message });
  }
};

/**
 * Create product review.
 *
 * @param {object} params
 * @param {*} params.data
 * @returns {Promise<*>}
 */
export const createProductReviewService = async ({ data }) => {
  const review = await ProductReview.create({
    ...data,
    reviewId: uuidv6(),
  });
  /* ---------- CLEAR CACHE ---------- */
  await clearProductReviewCache();

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: null,
      permission: "product.review.create",
      title: "New Product Review Created",
      message: `A new product review was submitted by ${data.reviewerInfo?.name || "Unknown"}`,
      type: "PRODUCT_REVIEW_CREATED",
      entityId: review._id,
      entityModel: "ProductReview",
      metadata: {
        reviewId: review.reviewId,
        reviewerName: data.reviewerInfo?.name || null,
        reviewerEmail: data.reviewerInfo?.email || null,
        categoryCount: data.categoryReviews.length,
      },
    });
  } catch (err) {
    logger.error("Notification failed on review create", { error: err.message });
  }
  return review.toObject();
};

/**
 * Get all product reviews.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getAllProductReviewsService = async ({ page, limit }) => {
  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.max(Number(limit) || 10, 1);
  const skip = (pageNum - 1) * limitNum;
  /* ---------- CACHE KEY ---------- */
  const cacheKey = `PRODUCTID:ALL:${pageNum}:${limitNum}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("PRODUCT REVIEW CACHE HIT", { cacheKey });
    return cached;
  }
  const [reviews, totalItems] = await Promise.all([
    ProductReview.find()
      .select({
        _id: 1,
        reviewId: 1,
        reviewerInfo: 1,
        categoryReviews: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ProductReview.countDocuments(),
  ]);

  const totalPages = Math.ceil(totalItems / limit);
  /* ---------- EDGE CASE: page out of range ---------- */
  if (pageNum > totalPages) {
    throw new BadRequestError(`Page ${pageNum} does not exist. Total pages: ${totalPages}`, {
      code: ERROR_CODES.PAGE_OUT_OF_RANGE,
    });
  }
  const result = {
    reviews,
    pagination: {
      totalItems,
      totalPages,
      currentPage: pageNum,
      nextPage: pageNum < totalPages ? pageNum + 1 : null,
      prevPage: pageNum > 1 ? pageNum - 1 : null,
      limit: limitNum,
    },
  };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);
  return result;
};

/**
 * Get product review by id.
 *
 * @param {object} params
 * @param {*} params.reviewId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getProductReviewByIdService = async ({ reviewId }) => {
  /* ---------- CACHE CHECK ---------- */
  const cacheKey = `PRODUCT_REVIEW:ID:${reviewId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("PRODUCT REVIEW CACHE HIT", { cacheKey });
    return cached;
  }
  const review = await ProductReview.findOne({ reviewId })
    .select({
      _id: 1,
      reviewId: 1,
      reviewerInfo: 1,
      categoryReviews: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    .lean();
  /* ---------- EDGE CASE: not found ---------- */
  if (!review) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }
  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, review);

  return review;
};

/**
 * Update product review.
 *
 * @param {object} params
 * @param {*} params.reviewId
 * @param {*} params.data
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateProductReviewService = async ({ reviewId, data }) => {
  const review = await ProductReview.findOne({ reviewId });
  if (!review) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }

  // What actually changed, for the "no changes" check and the notification.
  const changes = {};

  /* ---------- PARTIAL UPDATE reviewerInfo ---------- */
  if (data.reviewerInfo) {
    Object.keys(data.reviewerInfo).forEach((key) => {
      if (review.reviewerInfo[key] !== data.reviewerInfo[key])
        changes[`reviewerInfo.${key}`] = data.reviewerInfo[key];
      review.reviewerInfo[key] = data.reviewerInfo[key];
    });
  }

  /* ---------- UPSERT categoryReviews BY productType ---------- */
  if (Array.isArray(data.categoryReviews) && data.categoryReviews.length > 0) {
    changes.categoryReviews = data.categoryReviews.map((category) => category.productType);
    data.categoryReviews.forEach((incomingCategory) => {
      const existingIndex = review.categoryReviews.findIndex(
        (item) => item.productType === incomingCategory.productType
      );

      if (existingIndex !== -1) {
        review.categoryReviews[existingIndex] = {
          ...review.categoryReviews[existingIndex].toObject(),
          ...incomingCategory,
        };
      } else {
        review.categoryReviews.push(incomingCategory);
      }
    });
  }

  /* ---------- EDGE CASE: no actual change ---------- */
  if (Object.keys(changes).length === 0) {
    throw new BadRequestError("No changes detected — values are the same as existing", {
      code: ERROR_CODES.NO_CHANGES_DETECTED,
    });
  }

  await review.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearProductReviewCache();
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: null,
      permission: "product.review.update",
      title: "Product Review Updated",
      message: `Product review for "${review.reviewerInfo?.name || "Unknown"}" was updated`,
      type: "PRODUCT_REVIEW_UPDATED",
      entityId: review._id,
      entityModel: "ProductReview",
      metadata: {
        reviewId: review.reviewId,
        reviewerName: review.reviewerInfo?.name || null,
        changes,
      },
    });
  } catch (err) {
    logger.error("Notification failed on review update", { error: err.message });
  }

  return review.toObject();
};

/**
 * Delete product review.
 *
 * @param {object} params
 * @param {*} params.reviewId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteProductReviewService = async ({ reviewId }) => {
  /* ---------- FETCH & DELETE ---------- */
  const deletedReview = await ProductReview.findOneAndDelete({ reviewId }).lean();
  /* ---------- EDGE CASE: not found ---------- */
  if (!deletedReview) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }
  /* ---------- CLEAR CACHE ---------- */
  await clearProductReviewCache();
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: null,
      permission: "product.review.delete",
      title: "Product Review Deleted",
      message: `Product review by "${deletedReview.reviewerInfo?.name || "Unknown"}" was deleted`,
      type: "PRODUCT_REVIEW_DELETED",
      entityId: deletedReview._id,
      entityModel: "ProductReview",
      metadata: {
        reviewId: deletedReview.reviewId,
        reviewerName: deletedReview.reviewerInfo?.name || null,
        reviewerEmail: deletedReview.reviewerInfo?.email || null,
        categoryCount: deletedReview.categoryReviews?.length || 0,
      },
    });
  } catch (err) {
    logger.error("Notification failed on review delete", { error: err.message });
  }
  return deletedReview;
};
