import Joi from "joi";

export const sendEmailOtpValidator = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Valid email is required",
    "string.empty": "Email is required",
    "any.required": "Email is required"
  })
});

export const verifyOtpAndCreateCustomerValidator = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Valid email is required",
    "string.empty": "Email is required",
    "any.required": "Email is required"
  }),

  otp: Joi.string().optional().allow("").messages({
    "string.base": "OTP must be a string"
  }),

  libraryObjectId: Joi.string().optional().messages({
    "string.empty": "libraryObjectId is required",
    "any.required": "libraryObjectId is required"
  }),

  libraryId: Joi.string().optional().messages({
    "string.empty": "libraryId is required",
    "any.required": "libraryId is required"
  }),

  brand: Joi.string().required().messages({
    "string.empty": "brand is required",
    "any.required": "brand is required"
  }),

  category: Joi.string().required().messages({
    "string.empty": "category is required",
    "any.required": "category is required"
  }),

  firstName: Joi.string().optional().allow(""),
  lastName: Joi.string().optional().allow(""),
  mobileNumber: Joi.string().optional().allow(""),
  companyName: Joi.string().optional().allow(""),

  address: Joi.object({
    line1: Joi.string().optional().allow(""),
    city: Joi.string().optional().allow(""),
    state: Joi.string().optional().allow(""),
    postalCode: Joi.string().optional().allow(""),
    country: Joi.string().optional().allow("")
  }).optional()
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