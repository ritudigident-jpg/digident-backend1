import Joi from "joi";

/* ---------- Create Validator ---------- */
export const createTestimonialValidator = Joi.object({
  feedback: Joi.string().trim().min(3).max(5000).required().messages({
    "string.empty": "Feedback is required",
    "string.min": "Feedback must be at least 3 characters long",
    "string.max": "Feedback must not exceed 5000 characters",
    "any.required": "Feedback is required",
  }),

  suggestions: Joi.string().trim().max(5000).allow("").optional().messages({
    "string.max": "Suggestions must not exceed 5000 characters",
  }),

  name: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Name is required",
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name must not exceed 100 characters",
    "any.required": "Name is required",
  }),

  email: Joi.string().trim().email().required().messages({
    "string.email": "Invalid email format",
    "any.required": "Email is required",
  }),

  contactNumber: Joi.string()
    .trim()
    .pattern(/^[0-9+\-()\s]{6,20}$/)
    .allow("")
    .optional()
    .messages({
      "string.pattern.base": "Invalid contact number",
    }),

  organizationName: Joi.string().trim().max(150).allow("").optional().messages({
    "string.max": "Organization name must not exceed 150 characters",
  }),

  purchasedProduct: Joi.string().trim().max(200).allow("").optional().messages({
    "string.max": "Purchased product must not exceed 200 characters",
  }),

  submittedAt: Joi.date().optional().messages({
    "date.base": "submittedAt must be a valid date",
  }),

  isActive: Joi.boolean().optional(),

  displayOrder: Joi.number().integer().min(0).optional().messages({
    "number.base": "displayOrder must be a number",
    "number.min": "displayOrder cannot be negative",
  }),
});

/* ---------- Update Validator ---------- */
export const updateTestimonialValidator = Joi.object({
  feedback: Joi.string().trim().min(3).max(5000).optional().messages({
    "string.min": "Feedback must be at least 3 characters long",
    "string.max": "Feedback must not exceed 5000 characters",
  }),

  suggestions: Joi.string().trim().max(5000).allow("").optional().messages({
    "string.max": "Suggestions must not exceed 5000 characters",
  }),

  name: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Name must be at least 2 characters long",
    "string.max": "Name must not exceed 100 characters",
  }),

  email: Joi.string().trim().email().optional().messages({
    "string.email": "Invalid email format",
  }),

  contactNumber: Joi.string()
    .trim()
    .pattern(/^[0-9+\-()\s]{6,20}$/)
    .allow("")
    .optional()
    .messages({
      "string.pattern.base": "Invalid contact number",
    }),

  organizationName: Joi.string().trim().max(150).allow("").optional().messages({
    "string.max": "Organization name must not exceed 150 characters",
  }),

  purchasedProduct: Joi.string().trim().max(200).allow("").optional().messages({
    "string.max": "Purchased product must not exceed 200 characters",
  }),

  submittedAt: Joi.date().optional().messages({
    "date.base": "submittedAt must be a valid date",
  }),

  isActive: Joi.boolean().optional(),

  displayOrder: Joi.number().integer().min(0).optional().messages({
    "number.base": "displayOrder must be a number",
    "number.min": "displayOrder cannot be negative",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });

export const validateCreateTestimonialBody = (body) =>
  createTestimonialValidator.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

export const validateUpdateTestimonialBody = (body) =>
  updateTestimonialValidator.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });
