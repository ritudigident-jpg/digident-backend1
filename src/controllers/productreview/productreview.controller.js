/**
 * HTTP handlers for product-type feedback forms (Scan Body, Lab Analog, Screws, Abutment ...):
 * read the request, call the service, send the response. No business logic here.
 *
 * Exports: createProductReview, getAllProductReviews, getProductReviewById, updateProductReview,
 * deleteProductReview
 * Used by: routes/productreviews.routes.js
 */

import {
  validateCreateProductReviewBody,
  validateUpdateProductReviewBody,
} from "./productreview.validator.js";

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import {
  createProductReviewService,
  getAllProductReviewsService,
  getProductReviewByIdService,
  updateProductReviewService,
  deleteProductReviewService,
} from "../../services/productreview/productreview.service.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createProductReview
 *
 * @description
 * Create a new product review with one reviewer and multiple category reviews.
 *
 * @process
 * 1. Validate request body
 * 2. Create product review using service layer
 * 3. Return created review
 *
 * @response
 * 201 { success: true, message: "Product review created successfully", data: review }
 * 400 { success: false, message: "Validation failed", details: [...] }
 */
export const createProductReview = asyncHandler(async (req, res) => {
  const { value, error } = validateCreateProductReviewBody(req.body);

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const review = await createProductReviewService({
    data: value,
  });

  return sendCreated(res, { data: review, message: "Product review created successfully" });
});

/**
 * @function getAllProductReviews
 *
 * @description
 * Fetch all product reviews with pagination.
 *
 * @process
 * 1. Read pagination params
 * 2. Fetch reviews from service layer
 * 3. Return paginated response
 *
 * @response
 * 200 { success: true, message: "Product reviews fetched successfully", data: { reviews, pagination } }
 */
export const getAllProductReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const result = await getAllProductReviewsService({
    page,
    limit,
    skip,
  });

  return sendSuccess(res, { data: result, message: "Product reviews fetched successfully" });
});

/**
 * @function getProductReviewById
 *
 * @description
 * Fetch a single product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Fetch review from service layer
 * 3. Return review if found
 *
 * @response
 * 200 { success: true, message: "Product review fetched successfully", data: review }
 * 404 { success: false, message: "Review not found" }
 */
export const getProductReviewById = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  const review = await getProductReviewByIdService({ reviewId });

  if (!review) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }

  return sendSuccess(res, { data: review, message: "Product review fetched successfully" });
});

/**
 * @function updateProductReview
 *
 * @description
 * Update a product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Validate update body
 * 3. Update review using service layer
 * 4. Return updated review
 *
 * @response
 * 200 { success: true, message: "Review updated successfully", data: review }
 * 400 { success: false, message: "Validation failed", details: [...] }
 * 404 { success: false, message: "Review not found" }
 */
export const updateProductReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;
  const { value, error } = validateUpdateProductReviewBody(req.body);

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const updatedReview = await updateProductReviewService({
    reviewId,
    data: value,
  });

  if (!updatedReview) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }

  return sendSuccess(res, { data: updatedReview, message: "Review updated successfully" });
});

/**
 * @function deleteProductReview
 *
 * @description
 * Delete a product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Delete review using service layer
 * 3. Return success response
 *
 * @response
 * 200 { success: true, message: "Review deleted successfully" }
 * 404 { success: false, message: "Review not found" }
 */
export const deleteProductReview = asyncHandler(async (req, res) => {
  const { reviewId } = req.params;

  const deletedReview = await deleteProductReviewService({ reviewId });

  if (!deletedReview) {
    throw new NotFoundError("Review not found", { code: ERROR_CODES.REVIEW_NOT_FOUND });
  }

  return sendSuccess(res, { data: null, message: "Review deleted successfully" });
});
