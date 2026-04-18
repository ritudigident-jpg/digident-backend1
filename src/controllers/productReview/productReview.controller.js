import ProductReview from "../../models/manage/productReview.model.js";
import { v6 as uuidv6 } from "uuid";
import {
  validateCreateProductReviewBody,
  validateUpdateProductReviewBody,
} from "./productReview.validation.js";
import { sendError,handleError } from "../../helpers/error.helper.js";
import {sendSuccess } from "../../helpers/response.helper.js";
import { getPagination} from "../../helpers/pagination.helper.js";


/**
 * @function createProductReview
 *
 * @description
 * Create a new product review.
 *
 * @process
 * 1. Validate request body
 * 2. Generate unique reviewId
 * 3. Create review in database
 * 4. Return created review
 *
 * @response
 * 201 { success: true, message: "Product review created successfully", data: review }
 * 400 { success: false, message: "Validation failed", details: [...] }
 */
export const createProductReview = async (req, res) => {
  try {
    const { value, error } = validateCreateProductReviewBody(req.body);

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((err) => err.message),
      });
    }
    const review = await ProductReview.create({
      ...value,
      reviewId: uuidv6(),
    });

    return sendSuccess(
      res,
      review,
      201,
      "Product review created successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getAllProductReviews
 *
 * @description
 * Fetch all product reviews with pagination.
 *
 * @process
 * 1. Read pagination params
 * 2. Fetch reviews from database
 * 3. Sort by latest first
 * 4. Return paginated response
 *
 * @response
 * 200 { success: true, message: "Product reviews fetched successfully", data: { reviews, pagination } }
 */
export const getAllProductReviews = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const [reviews, totalItems] = await Promise.all([
      ProductReview.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ProductReview.countDocuments(),
    ]);

    const pagination = {
      totalItems,
      currentPage: page,
      limit,
    };

    return sendSuccess(
      res,
      {
        reviews,
        pagination,
      },
      200,
      "Product reviews fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getProductReviewById
 *
 * @description
 * Fetch a single product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Find review by reviewId
 * 3. Return review if found
 *
 * @response
 * 200 { success: true, message: "Product review fetched successfully", data: review }
 * 404 { success: false, message: "Review not found" }
 */
export const getProductReviewById = async (req, res) => {
  try {
    const { reviewId } = req.params;

    const review = await ProductReview.findOne({ reviewId }).lean();

    if (!review) {
      return sendError(res, {
        message: "Review not found",
        statusCode: 404,
        errorCode: "REVIEW_NOT_FOUND",
      });
    }

    return sendSuccess(
      res,
      review,
      200,
      "Product review fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function updateProductReview
 *
 * @description
 * Update a product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Validate update body
 * 3. Update review in database
 * 4. Return updated review
 *
 * @response
 * 200 { success: true, message: "Review updated successfully", data: review }
 * 400 { success: false, message: "Validation failed", details: [...] }
 * 404 { success: false, message: "Review not found" }
 */
export const updateProductReview = async (req, res) => {
  try {
    const { reviewId } = req.params;

    const { value, error } = validateUpdateProductReviewBody(req.body);

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((err) => err.message),
      });
    }

    const updatedReview = await ProductReview.findOneAndUpdate(
      { reviewId },
      { $set: value },
      {
        new: true,
        runValidators: true,
      }
    ).lean();

    if (!updatedReview) {
      return sendError(res, {
        message: "Review not found",
        statusCode: 404,
        errorCode: "REVIEW_NOT_FOUND",
      });
    }

    return sendSuccess(
      res,
      updatedReview,
      200,
      "Review updated successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function deleteProductReview
 *
 * @description
 * Delete a product review by reviewId.
 *
 * @process
 * 1. Read reviewId from params
 * 2. Delete review from database
 * 3. Return success response
 *
 * @response
 * 200 { success: true, message: "Review deleted successfully" }
 * 404 { success: false, message: "Review not found" }
 */
export const deleteProductReview = async (req, res) => {
  try {
    const { reviewId } = req.params;

    const deletedReview = await ProductReview.findOneAndDelete({ reviewId });

    if (!deletedReview) {
      return sendError(res, {
        message: "Review not found",
        statusCode: 404,
        errorCode: "REVIEW_NOT_FOUND",
      });
    }

    return sendSuccess(res, null, 200, "Review deleted successfully");
  } catch (error) {
    return handleError(res, error);
  }
};