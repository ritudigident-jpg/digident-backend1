import Joi from "joi";

const ratingEnum = ["Excellent", "Good", "Average", "Dissatisfied"];

const ratingItemSchema = Joi.object({
  question: Joi.string().trim().min(3).required().messages({
    "string.empty": "Question is required",
    "string.min": "Question must be at least 3 characters long",
    "any.required": "Question is required",
  }),

  score: Joi.string()
    .valid(...ratingEnum)
    .required()
    .messages({
      "any.only": "Invalid rating score",
      "any.required": "Score is required",
    }),
});

const reviewerInfoSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    "string.empty": "Reviewer name is required",
    "string.min": "Reviewer name must be at least 2 characters long",
    "string.max": "Reviewer name must not exceed 100 characters",
    "any.required": "Reviewer name is required",
  }),

  age: Joi.number().integer().min(0).max(120).optional().messages({
    "number.base": "Age must be a number",
    "number.min": "Age cannot be negative",
    "number.max": "Age cannot be greater than 120",
  }),

  email: Joi.string().trim().email().required().messages({
    "string.email": "Invalid email format",
    "any.required": "Reviewer email is required",
  }),

  date: Joi.date().optional().messages({
    "date.base": "Date must be a valid date",
  }),
});

export const createProductReviewValidator = Joi.object({
  productType: Joi.string()
    .valid(
      "Scan Body",
      "Horizontal Scan Body",
      "Lab Analog",
      "Screws",
      "Abutment"
    )
    .required()
    .messages({
      "any.required": "Product type is required",
      "any.only": "Invalid product type",
    }),

  reviewerInfo: reviewerInfoSchema.required().messages({
    "any.required": "Reviewer info is required",
  }),

  ratings: Joi.array().items(ratingItemSchema).min(1).required().messages({
    "array.base": "Ratings must be an array",
    "array.min": "At least one rating is required",
    "any.required": "Ratings are required",
  }),

  overallSatisfaction: Joi.string()
    .valid(...ratingEnum)
    .required()
    .messages({
      "any.only": "Invalid overall satisfaction value",
      "any.required": "Overall satisfaction is required",
    }),

  comments: Joi.string().trim().max(1000).allow("").optional().messages({
    "string.max": "Comments must not exceed 1000 characters",
  }),
});

export const updateProductReviewValidator = Joi.object({
  productType: Joi.string()
    .valid(
      "Scan Body",
      "Horizontal Scan Body",
      "Lab Analog",
      "Screws",
      "Abutment"
    )
    .optional()
    .messages({
      "any.only": "Invalid product type",
    }),

  reviewerInfo: Joi.object({
    name: Joi.string().trim().min(2).max(100).optional().messages({
      "string.min": "Reviewer name must be at least 2 characters long",
      "string.max": "Reviewer name must not exceed 100 characters",
    }),

    age: Joi.number().integer().min(0).max(120).optional().messages({
      "number.base": "Age must be a number",
      "number.min": "Age cannot be negative",
      "number.max": "Age cannot be greater than 120",
    }),

    email: Joi.string().trim().email().optional().messages({
      "string.email": "Invalid email format",
    }),

    date: Joi.date().optional().messages({
      "date.base": "Date must be a valid date",
    }),
  })
    .min(1)
    .optional(),

  ratings: Joi.array().items(ratingItemSchema).min(1).optional().messages({
    "array.base": "Ratings must be an array",
    "array.min": "At least one rating is required",
  }),

  overallSatisfaction: Joi.string()
    .valid(...ratingEnum)
    .optional()
    .messages({
      "any.only": "Invalid overall satisfaction value",
    }),

  comments: Joi.string().trim().max(1000).allow("").optional().messages({
    "string.max": "Comments must not exceed 1000 characters",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field is required for update",
  });

export const validateCreateProductReviewBody = (body) =>
  createProductReviewValidator.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });

export const validateUpdateProductReviewBody = (body) =>
  updateProductReviewValidator.validate(body, {
    abortEarly: false,
    stripUnknown: true,
  });