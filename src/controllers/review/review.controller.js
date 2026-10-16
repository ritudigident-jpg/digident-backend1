/**
 * HTTP handlers for customer star ratings and reviews of products: read the request, call the
 * service, send the response. No business logic here.
 *
 * Exports: addReview, updateReview, getAllReviews, deleteReview, getHomePageReviews
 * Used by: routes/reviews.routes.js
 */

import {
  addReviewService,
  deleteReviewService,
  getAllReviewsService,
  getHomePageReviewsService,
  updateReviewService,
} from "../../services/review/review.service.js";
import { validateAddReview, validateUpdateReview } from "./review.validator.js";

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function addReview
 *
 * @params
 * params: {
 *   productId: string
 * }
 * body: {
 *   rating: number (1-5),
 *   comment: string
 * }
 * user: {
 *   email: string
 * }
 *
 * @process
 * 1. Validate rating (must be between 1 and 5)
 * 2. Fetch product using productId
 * 3. Validate authenticated user (email must exist)
 * 4. Fetch user from DB using email
 * 5. Check if user already reviewed the product
 * 6. Create new review object with unique reviewId
 * 7. Push review into product.reviews array
 * 8. Recalculate product ratingAvg and ratingCount
 * 9. Save product
 * 10. Populate reviews.user for response
 * 11. Return updated reviews and rating data
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Review added",
 *   data: {
 *     reviews: [],
 *     ratingAvg: number,
 *     ratingCount: number
 *   }
 * }
 */
export const addReview = asyncHandler(async (req, res) => {
  /* ---------------- MERGE DATA ---------------- */
  const payload = {
    productId: req.params.productId,
    rating: req.body.rating,
    comment: req.body.comment,
  };
  /* ---------------- VALIDATION ---------------- */
  const { error, value } = validateAddReview(payload);
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  /* ---------------- AUTH ---------------- */
  if (!req.user?.email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }
  /* ---------------- SERVICE ---------------- */
  const result = await addReviewService({
    ...value,
    userEmail: req.user.email,
  });
  return sendCreated(res, { data: result, message: "Review added successfully" });
});

/**
 * @function updateReview
 *
 * @params
 * params: {
 *   productId: string,
 *   reviewId: string
 * }
 * body: {
 *   rating?: number,
 *   comment?: string
 * }
 * user: {
 *   email: string
 * }
 *
 * @process
 * 1. Fetch product using productId
 * 2. Validate authenticated user (email must exist)
 * 3. Fetch user from DB
 * 4. Find review using reviewId
 * 5. Check if review exists
 * 6. Ensure review is not anonymous
 * 7. Verify ownership (review.user === logged-in user)
 * 8. Update rating and/or comment
 * 9. Set updatedAt timestamp
 * 10. Recalculate ratingAvg and ratingCount
 * 11. Save product
 * 12. Populate reviews.user for response
 * 13. Return updated reviews and rating data
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Review updated",
 *   data: {
 *     reviews: [],
 *     ratingAvg: number,
 *     ratingCount: number
 *   }
 * }
 */
export const updateReview = asyncHandler(async (req, res) => {
  const payload = {
    productId: req.params.productId,
    reviewId: req.params.reviewId,
    rating: req.body.rating,
    comment: req.body.comment,
  };

  /* ---------------- VALIDATION ---------------- */
  const { error, value } = validateUpdateReview(payload);
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  /* ---------------- AUTH ---------------- */
  if (!req.user?.email) {
    throw new UnauthorizedError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  /* ---------------- SERVICE ---------------- */
  const result = await updateReviewService({
    ...value,
    userEmail: req.user.email,
  });

  /* ---------------- SUCCESS ---------------- */
  return sendSuccess(res, { data: result, message: "Review updated successfully" });
});

/**
 * @function getAllReviews
 *
 * @params
 * params: {
 *   productId: string
 * }
 *
 * @process
 * 1. Fetch product using productId
 * 2. Populate reviews.user (firstName)
 * 3. Check if product exists
 * 4. Sort reviews by createdAt (latest first)
 * 5. Return ratingAvg, ratingCount, and sorted reviews
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Reviews fetched",
 *   data: {
 *     ratingAvg: number,
 *     ratingCount: number,
 *     reviews: []
 *   }
 * }
 */
export const getAllReviews = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  /* ---------- BASIC CHECK ---------- */
  if (!productId) {
    throw new BadRequestError("ProductId is required", { code: ERROR_CODES.PRODUCT_ID_REQUIRED });
  }
  /* ---------- PAGINATION INPUT ---------- */
  let page = parseInt(req.query.page, 10) || 1;
  let limit = parseInt(req.query.limit, 10) || 12;

  page = page < 1 ? 1 : page;
  limit = limit < 1 ? 12 : limit;

  const MAX_LIMIT = 50;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  /* ---------- SERVICE ---------- */
  const result = await getAllReviewsService({
    productId,
    page,
    limit,
  });

  /* ---------- SUCCESS ---------- */
  return sendSuccess(res, { data: result, message: "Reviews fetched successfully" });
});

/**
 * @function deleteReview
 *
 * @params
 * params: {
 *   productId: string,
 *   reviewId: string
 * }
 * user: {
 *   email: string
 * }
 *
 * @process
 * 1. Fetch product using productId
 * 2. Find review using reviewId
 * 3. Check if review exists
 * 4. Ensure review is not anonymous
 * 5. Validate authenticated user (email must exist)
 * 6. Fetch user from DB
 * 7. Verify ownership (review.user === logged-in user)
 * 8. Remove review from product.reviews array
 * 9. Recalculate ratingAvg and ratingCount
 * 10. Save product
 * 11. Return updated rating and reviews
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Review deleted",
 *   data: {
 *     ratingAvg: number,
 *     ratingCount: number,
 *     reviews: []
 *   }
 * }
 */
export const deleteReview = asyncHandler(async (req, res) => {
  const { productId, reviewId } = req.params;
  const userEmail = req.user?.email;

  /* ---------- BASIC CHECK ---------- */
  if (!productId || !reviewId) {
    throw new BadRequestError("ProductId and ReviewId are required", {
      code: ERROR_CODES.MISSING_REQUIRED_FIELDS,
    });
  }

  if (!userEmail) {
    throw new BadRequestError("User email missing", { code: ERROR_CODES.USER_EMAIL_MISSING });
  }

  /* ---------- SERVICE ---------- */
  const result = await deleteReviewService({
    productId,
    reviewId,
    userEmail,
  });

  /* ---------- SUCCESS ---------- */
  return sendSuccess(res, { data: result, message: "Review deleted successfully" });
});

/**
 * @function getHomePageReviews
 *
 * @params
 * none
 *
 * @process
 * 1. Fetch products where reviews.isHomePage = true
 * 2. Select required fields (name, reviews)
 * 3. Populate reviews.user (firstName, lastName)
 * 4. Iterate through products and extract only homepage reviews
 * 5. Map reviews into custom response format
 * 6. Sort reviews by createdAt (latest first)
 * 7. Limit result to top 6 reviews
 * 8. Return homepage reviews list
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Homepage reviews fetched",
 *   data: [
 *     {
 *       productId: string,
 *       productName: string,
 *       reviewId: string,
 *       user: object,
 *       rating: number,
 *       comment: string,
 *       createdAt: date,
 *       isHomePage: true
 *     }
 *   ]
 * }
 */
export const getHomePageReviews = asyncHandler(async (req, res) => {
  /* ---------- SERVICE ---------- */
  const result = await getHomePageReviewsService();

  if (!result || result.length === 0) {
    throw new NotFoundError("No homepage reviews found", { code: ERROR_CODES.NO_HOMEPAGE_REVIEWS });
  }

  /* ---------- SUCCESS ---------- */
  return sendSuccess(res, { data: result, message: "Homepage reviews fetched successfully" });
});
