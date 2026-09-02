import {
  validateCreateTestimonialBody,
  validateUpdateTestimonialBody,
} from "./testimonial.validation.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import {
  createTestimonialService,
  getAllTestimonialsService,
  getTestimonialByIdService,
  updateTestimonialService,
  deleteTestimonialService,
} from "../../services/testimonial.service.js";

/* ---------- Route known service errors (statusCode set) to sendError ---------- */
const respondError = (res, error) => {
  if (error?.statusCode) {
    return sendError(res, {
      message: error.message,
      statusCode: error.statusCode,
      errorCode: error.errorCode || "ERROR",
    });
  }
  return handleError(res, error);
};

/**
 * @function createTestimonial
 * @description Create a new testimonial.
 * @response
 * 201 { success: true, message: "Testimonial created successfully", data: testimonial }
 * 400 { success: false, message: "Validation failed", details: [...] }
 */
export const createTestimonial = async (req, res) => {
  try {
    const { value, error } = validateCreateTestimonialBody(req.body);

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((err) => err.message),
      });
    }

    const testimonial = await createTestimonialService({ data: value });

    return sendSuccess(res, testimonial, 201, "Testimonial created successfully");
  } catch (error) {
    return respondError(res, error);
  }
};

/**
 * @function getAllTestimonials
 * @description Fetch all testimonials with pagination.
 * @query page, limit, isActive ("true" | "false"), search
 * @response
 * 200 { success: true, message: "Testimonials fetched successfully", data: { testimonials, pagination } }
 */
export const getAllTestimonials = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    let isActive;
    if (req.query.isActive === "true") isActive = true;
    else if (req.query.isActive === "false") isActive = false;

    const result = await getAllTestimonialsService({
      page,
      limit,
      skip,
      isActive,
      search: req.query.search,
    });

    return sendSuccess(res, result, 200, "Testimonials fetched successfully");
  } catch (error) {
    return respondError(res, error);
  }
};

/**
 * @function getTestimonialById
 * @description Fetch a single testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial fetched successfully", data: testimonial }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const getTestimonialById = async (req, res) => {
  try {
    const { testimonialId } = req.params;

    const testimonial = await getTestimonialByIdService({ testimonialId });

    return sendSuccess(res, testimonial, 200, "Testimonial fetched successfully");
  } catch (error) {
    return respondError(res, error);
  }
};

/**
 * @function updateTestimonial
 * @description Update a testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial updated successfully", data: testimonial }
 * 400 { success: false, message: "Validation failed", details: [...] }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const updateTestimonial = async (req, res) => {
  try {
    const { testimonialId } = req.params;
    const { value, error } = validateUpdateTestimonialBody(req.body);

    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((err) => err.message),
      });
    }

    const testimonial = await updateTestimonialService({
      testimonialId,
      data: value,
    });

    return sendSuccess(res, testimonial, 200, "Testimonial updated successfully");
  } catch (error) {
    return respondError(res, error);
  }
};

/**
 * @function deleteTestimonial
 * @description Delete a testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial deleted successfully" }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const deleteTestimonial = async (req, res) => {
  try {
    const { testimonialId } = req.params;

    await deleteTestimonialService({ testimonialId });

    return sendSuccess(res, null, 200, "Testimonial deleted successfully");
  } catch (error) {
    return respondError(res, error);
  }
};
