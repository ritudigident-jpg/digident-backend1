/**
 * Joi schemas for contact-form messages from the website: request bodies are checked against these
 * before the service runs.
 *
 * Exports: contactValidationSchema
 * Used by: controllers/contact/contact.controller.js
 */

import Joi from "joi";

export const contactValidationSchema = Joi.object({
  firstName: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "First name is required",
  }),

  lastName: Joi.string().trim().min(2).max(50).required().messages({
    "string.empty": "Last name is required",
  }),

  email: Joi.string().trim().email().required().messages({
    "string.empty": "Email is required",
    "string.email": "Invalid email format",
  }),

  phone: Joi.string()
    .trim()
    .pattern(/^[0-9]{10,15}$/)
    .required()
    .messages({
      "string.empty": "Phone is required",
      "string.pattern.base": "Phone must be 10-15 digits",
    }),

  message: Joi.string().trim().min(10).max(1000).required().messages({
    "string.empty": "Message is required",
  }),
});
