import { v6 as uuidv6 } from "uuid";
import Testimonial from "../models/manage/testimonial.model.js";

/* =========================================================
   CREATE
========================================================= */
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
export const getAllTestimonialsService = async ({
  page,
  limit,
  skip,
  isActive,
  search,
}) => {
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
    Testimonial.find(filter)
      .sort({ displayOrder: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
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
export const getTestimonialByIdService = async ({ testimonialId }) => {
  const testimonial = await Testimonial.findOne({ testimonialId }).lean();

  if (!testimonial) {
    const err = new Error("Testimonial not found");
    err.statusCode = 404;
    err.errorCode = "TESTIMONIAL_NOT_FOUND";
    throw err;
  }

  return testimonial;
};

/* =========================================================
   UPDATE
========================================================= */
export const updateTestimonialService = async ({ testimonialId, data }) => {
  const testimonial = await Testimonial.findOneAndUpdate(
    { testimonialId },
    { $set: data },
    { new: true, runValidators: true }
  ).lean();

  if (!testimonial) {
    const err = new Error("Testimonial not found");
    err.statusCode = 404;
    err.errorCode = "TESTIMONIAL_NOT_FOUND";
    throw err;
  }

  return testimonial;
};

/* =========================================================
   DELETE
========================================================= */
export const deleteTestimonialService = async ({ testimonialId }) => {
  const deleted = await Testimonial.findOneAndDelete({ testimonialId }).lean();

  if (!deleted) {
    const err = new Error("Testimonial not found");
    err.statusCode = 404;
    err.errorCode = "TESTIMONIAL_NOT_FOUND";
    throw err;
  }

  return deleted;
};
