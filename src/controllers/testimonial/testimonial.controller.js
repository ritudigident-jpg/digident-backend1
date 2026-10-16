/**
 * HTTP handlers for customer testimonials shown on the website: read the request, call the
 * service, send the response. No business logic here.
 *
 * Exports: createTestimonial, getAllTestimonials, getTestimonialById, updateTestimonial,
 * deleteTestimonial
 * Used by: routes/testimonials.routes.js
 */

import { validateCreateTestimonialBody, validateUpdateTestimonialBody } from "./testimonial.validator.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import {
  createTestimonialService,
  getAllTestimonialsService,
  getTestimonialByIdService,
  updateTestimonialService,
  deleteTestimonialService,
} from "../../services/testimonial/testimonial.service.js";
import { ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createTestimonial
 * @description Create a new testimonial.
 * @response
 * 201 { success: true, message: "Testimonial created successfully", data: testimonial }
 * 400 { success: false, message: "Validation failed", details: [...] }
 */
export const createTestimonial = asyncHandler(async (req, res) => {
  const { value, error } = validateCreateTestimonialBody(req.body);

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const testimonial = await createTestimonialService({ data: value });

  return sendCreated(res, { data: testimonial, message: "Testimonial created successfully" });
});

/**
 * @function getAllTestimonials
 * @description Fetch all testimonials with pagination.
 * @query page, limit, isActive ("true" | "false"), search
 * @response
 * 200 { success: true, message: "Testimonials fetched successfully", data: { testimonials, pagination } }
 */
export const getAllTestimonials = asyncHandler(async (req, res) => {
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

  return sendSuccess(res, { data: result, message: "Testimonials fetched successfully" });
});

/**
 * @function getTestimonialById
 * @description Fetch a single testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial fetched successfully", data: testimonial }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const getTestimonialById = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  const testimonial = await getTestimonialByIdService({ testimonialId });

  return sendSuccess(res, { data: testimonial, message: "Testimonial fetched successfully" });
});

/**
 * @function updateTestimonial
 * @description Update a testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial updated successfully", data: testimonial }
 * 400 { success: false, message: "Validation failed", details: [...] }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const updateTestimonial = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;
  const { value, error } = validateUpdateTestimonialBody(req.body);

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const testimonial = await updateTestimonialService({
    testimonialId,
    data: value,
  });

  return sendSuccess(res, { data: testimonial, message: "Testimonial updated successfully" });
});

/**
 * @function deleteTestimonial
 * @description Delete a testimonial by testimonialId.
 * @response
 * 200 { success: true, message: "Testimonial deleted successfully" }
 * 404 { success: false, message: "Testimonial not found" }
 */
export const deleteTestimonial = asyncHandler(async (req, res) => {
  const { testimonialId } = req.params;

  await deleteTestimonialService({ testimonialId });

  return sendSuccess(res, { data: null, message: "Testimonial deleted successfully" });
});
