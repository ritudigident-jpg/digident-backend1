/**
 * Business logic for customer star ratings and reviews of products. Throws AppError subclasses on
 * failure.
 *
 * Exports: addReviewService, updateReviewService, getAllReviewsService, deleteReviewService,
 * getHomePageReviewsService
 * Used by: controllers/review/review.controller.js
 */

import Product from "../../models/product.model.js";
import User from "../../models/user.model.js";
import { v6 as uuidv6 } from "uuid";
import { getPagination } from "../../helpers/pagination.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  AppError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../helpers/apperror.helper.js";

/**
 * Add review.
 *
 * @param {object} params
 * @param {*} params.productId
 * @param {*} params.rating
 * @param {*} params.comment
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const addReviewService = async ({ productId, rating, comment, userEmail }) => {
  try {
    /* ---------------- GET PRODUCT ---------------- */
    const product = await Product.findOne({ productId });
    if (!product) {
      throw new NotFoundError("Product not found", { code: ERROR_CODES.PRODUCT_NOT_FOUND });
    }

    /* ---------------- GET USER ---------------- */
    const user = await User.findOne({ email: userEmail }).select("_id firstName");
    if (!user) {
      throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
    }

    const userId = user._id;

    /* ---------------- DUPLICATE CHECK ---------------- */
    const alreadyReviewed = product.reviews.find((r) => r.user?.toString() === userId.toString());

    if (alreadyReviewed) {
      throw new ConflictError("You already reviewed this product");
    }

    /* ---------------- CREATE REVIEW ---------------- */
    const newReview = {
      reviewId: uuidv6(),
      user: userId,
      rating,
      comment,
      createdAt: new Date(),
    };

    product.reviews.push(newReview);

    /* ---------------- RE-CALCULATE RATING ---------------- */
    const total = product.reviews.length;
    const sum = product.reviews.reduce((acc, r) => acc + (r.rating || 0), 0);

    product.ratingCount = total;
    product.ratingAvg = total ? sum / total : 0;

    await product.save();

    /* ---------------- POPULATE (OPTIMIZED) ---------------- */
    await product.populate({
      path: "reviews.user",
      select: "name email avatar",
    });

    return {
      reviews: product.reviews,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
    };
  } catch (error) {
    throw error instanceof AppError ? error : new AppError("Failed to add review", { cause: error });
  }
};

/**
 * Update review.
 *
 * @param {object} params
 * @param {*} params.productId
 * @param {*} params.reviewId
 * @param {*} params.rating
 * @param {*} params.comment
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const updateReviewService = async ({ productId, reviewId, rating, comment, userEmail }) => {
  try {
    /* ---------------- GET PRODUCT ---------------- */
    const product = await Product.findOne({ productId });
    if (!product) {
      throw new NotFoundError("Product not found", { code: ERROR_CODES.PRODUCT_NOT_FOUND });
    }

    /* ---------------- GET USER ---------------- */
    const user = await User.findOne({ email: userEmail }).select("_id");
    if (!user) {
      throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
    }

    /* ---------------- FIND REVIEW ---------------- */
    const review = product.reviews.find((r) => r.reviewId === reviewId);

    if (!review) {
      throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
    }

    if (!review.user) {
      throw new BadRequestError("Cannot update anonymous review");
    }

    if (review.user.toString() !== user._id.toString()) {
      throw new ForbiddenError("You cannot update someone else's review");
    }

    /* ---------------- UPDATE FIELDS ---------------- */
    if (rating !== undefined) review.rating = rating;
    if (comment !== undefined) review.comment = comment;

    review.updatedAt = new Date();

    /* ---------------- RE-CALCULATE RATING ---------------- */
    const total = product.reviews.length;
    const sum = product.reviews.reduce((acc, r) => acc + (r.rating || 0), 0);

    product.ratingCount = total;
    product.ratingAvg = total ? sum / total : 0;

    await product.save();

    /* ---------------- POPULATE ---------------- */
    await product.populate({
      path: "reviews.user",
      select: "name email avatar",
    });

    return {
      reviews: product.reviews,
      ratingAvg: product.ratingAvg,
      ratingCount: product.ratingCount,
    };
  } catch (error) {
    throw error instanceof AppError ? error : new AppError("Failed to update review", { cause: error });
  }
};

/**
 * Get all reviews.
 *
 * @param {object} params
 * @param {*} params.productId
 * @param {*} params.page
 * @param {*} params.limit
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getAllReviewsService = async ({ productId, page, limit }) => {
  const skip = (page - 1) * limit;

  /* ---------- FETCH PRODUCT ---------- */
  const product = await Product.findOne({ productId }).populate({
    path: "reviews.user",
    select: "firstName",
  });

  if (!product) {
    throw new NotFoundError("Product not found", { code: ERROR_CODES.PRODUCT_NOT_FOUND });
  }

  /* ---------- SORT REVIEWS ---------- */
  const reviews = [...(product.reviews || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  /* ---------- PAGINATE ---------- */
  const paginatedReviews = reviews.slice(skip, skip + limit);

  const pagination = getPagination({
    total: reviews.length,
    page,
    limit,
  });

  /* ---------- RETURN ---------- */
  return {
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    ...pagination,
    reviews: paginatedReviews,
  };
};

/**
 * Delete review.
 *
 * @param {object} params
 * @param {*} params.productId
 * @param {*} params.reviewId
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ForbiddenError} 403 when the caller may not do this.
 */
export const deleteReviewService = async ({ productId, reviewId, userEmail }) => {
  /* ---------- FETCH PRODUCT ---------- */
  const product = await Product.findOne({ productId });

  if (!product) {
    throw new NotFoundError("Product not found", { code: ERROR_CODES.PRODUCT_NOT_FOUND });
  }

  /* ---------- FIND REVIEW ---------- */
  const review = product.reviews.find((r) => r.reviewId === reviewId);

  if (!review) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }

  if (!review.user) {
    throw new ForbiddenError("Anonymous review cannot be deleted", { code: ERROR_CODES.ANONYMOUS_REVIEW });
  }

  /* ---------- FETCH USER ---------- */
  const user = await User.findOne({ email: userEmail }).select("_id");

  if (!user) {
    throw new NotFoundError("User not found", { code: ERROR_CODES.USER_NOT_FOUND });
  }

  /* ---------- OWNERSHIP CHECK ---------- */
  if (review.user.toString() !== user._id.toString()) {
    throw new ForbiddenError("You cannot delete someone else's review", {
      code: ERROR_CODES.UNAUTHORIZED_ACTION,
    });
  }

  /* ---------- DELETE REVIEW ---------- */
  product.reviews = product.reviews.filter((r) => r.reviewId !== reviewId);

  /* ---------- RECALCULATE RATINGS ---------- */
  const total = product.reviews.length;

  const sum = product.reviews.reduce((acc, r) => acc + (r.rating || 0), 0);

  product.ratingCount = total;
  product.ratingAvg = total ? sum / total : 0;

  await product.save();

  /* ---------- RETURN ---------- */
  return {
    ratingAvg: product.ratingAvg,
    ratingCount: product.ratingCount,
    reviews: product.reviews,
  };
};

/**
 * Get home page reviews.
 *
 * @returns {Promise<*>}
 * @throws {AppError} 500 for unexpected failures.
 */
export const getHomePageReviewsService = async () => {
  try {
    /* ---------- FETCH PRODUCTS ---------- */
    const products = await Product.find({
      "reviews.isHomePage": true,
    })
      .select("name reviews")
      .populate({
        path: "reviews.user",
        select: "firstName lastName",
      });

    if (!products || products.length === 0) {
      return [];
    }

    /* ---------- EXTRACT REVIEWS ---------- */
    const homePageReviews = [];

    for (const product of products) {
      const filteredReviews = (product.reviews || []).filter((rev) => rev.isHomePage === true);

      const mapped = filteredReviews.map((rev) => ({
        productId: product.productId || product._id,
        productName: product.name,
        reviewId: rev.reviewId,
        user: rev.user || null,
        rating: rev.rating,
        comment: rev.comment,
        createdAt: rev.createdAt,
        isHomePage: true,
      }));

      homePageReviews.push(...mapped);
    }

    /* ---------- SORT ---------- */
    homePageReviews.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    /* ---------- LIMIT (TOP 6) ---------- */
    return homePageReviews.slice(0, 6);
  } catch (error) {
    throw new AppError(error.message || "Failed to fetch homepage reviews", {
      code: ERROR_CODES.FETCH_HOMEPAGE_REVIEWS_FAILED,
    });
  }
};
