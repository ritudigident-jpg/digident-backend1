/**
 * Business logic for customer testimonials shown on the website. Throws AppError subclasses on
 * failure.
 *
 * Exports: createTestimonialService, getAllTestimonialsService, getTestimonialByIdService,
 * updateTestimonialService, deleteTestimonialService
 * Used by: controllers/testimonial/testimonial.controller.js
 */

import { v6 as uuidv6 } from "uuid";
import Testimonial from "../../models/testimonial.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";

/* =========================================================
   CREATE
========================================================= */
/**
 * Create testimonial.
 *
 * @param {object} params
 * @param {*} params.data
 * @returns {Promise<*>}
 */
export const createTestimonialService = async ({ data }) => {
  const testimonial = await Testimonial.create({
    ...data,
    testimonialId: uuidv6(),
  });

  return testimonial.toObject();
};

/* =========================================================
   GET ALL (paginated + optional filters)
========================================================= */
/**
 * Get all testimonials.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @param {*} params.skip
 * @param {*} params.isActive
 * @param {*} params.search
 * @returns {Promise<*>}
 */
export const getAllTestimonialsService = async ({ page, limit, skip, isActive, search }) => {
  const filter = {};

  if (typeof isActive === "boolean") {
    filter.isActive = isActive;
  }

  if (search) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [
      { name: regex },
      { email: regex },
      { organizationName: regex },
      { purchasedProduct: regex },
      { feedback: regex },
    ];
  }

  const [testimonials, totalItems] = await Promise.all([
    Testimonial.find(filter).sort({ displayOrder: 1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Testimonial.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(totalItems / limit) || 0;

  return {
    testimonials,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };
};

/* =========================================================
   GET BY ID
========================================================= */
/**
 * Get testimonial by id.
 *
 * @param {object} params
 * @param {*} params.testimonialId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getTestimonialByIdService = async ({ testimonialId }) => {
  const testimonial = await Testimonial.findOne({ testimonialId }).lean();

  if (!testimonial) {
    throw new NotFoundError("Testimonial not found", { code: ERROR_CODES.TESTIMONIAL_NOT_FOUND });
  }

  return testimonial;
};

/* =========================================================
   UPDATE
========================================================= */
/**
 * Update testimonial.
 *
 * @param {object} params
 * @param {*} params.testimonialId
 * @param {*} params.data
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateTestimonialService = async ({ testimonialId, data }) => {
  const testimonial = await Testimonial.findOneAndUpdate(
    { testimonialId },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();

  if (!testimonial) {
    throw new NotFoundError("Testimonial not found", { code: ERROR_CODES.TESTIMONIAL_NOT_FOUND });
  }

  return testimonial;
};

/* =========================================================
   DELETE
========================================================= */
/**
 * Delete testimonial.
 *
 * @param {object} params
 * @param {*} params.testimonialId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteTestimonialService = async ({ testimonialId }) => {
  const deleted = await Testimonial.findOneAndDelete({ testimonialId }).lean();

  if (!deleted) {
    throw new NotFoundError("Testimonial not found", { code: ERROR_CODES.TESTIMONIAL_NOT_FOUND });
  }

  return deleted;
};
