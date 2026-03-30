import Joi from "joi";

export const sendEmailOtpValidator = Joi.object({
  email: Joi.string()
    .email()
    .required()
    .messages({
      "string.email": "Invalid email format",
      "any.required": "Email is required"
    }),

  libraryObjectId: Joi.string()
    .required()
    .messages({
      "any.required": "libraryObjectId is required"
    }),

  libraryId: Joi.string()
    .trim()
    .required()
    .messages({
      "any.required": "libraryId is required"
    }),

  brandName: Joi.string()
    .trim()
    .required()
    .messages({
      "any.required": "brandName is required"
    }),

  category: Joi.string()
    .trim()
    .required()
    .messages({
      "any.required": "category is required"
    })
});


export const verifyOtpValidator = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Invalid email format",
    "any.required": "Email is required"
  }),

  otp: Joi.string().length(6).required().messages({
    "string.length": "OTP must be 6 digits",
    "any.required": "OTP is required"
  }),

  firstName: Joi.string().required(),
  lastName: Joi.string().required(),
  mobileNumber: Joi.string().required(),
  companyName: Joi.string().required(),

  address: Joi.object({
    line1: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().required(),
    postalCode: Joi.string().required(),
    country: Joi.string().required()
  }).required()
});