/**
 * Joi schemas for homepage banners of the shop and website: request bodies are checked against
 * these before the service runs.
 *
 * Exports: createBannerValidator
 * Used by: controllers/banner/banner.controller.js
 */

import Joi from "joi";

export const createBannerValidator = Joi.object({
  filterBy: Joi.string().optional(),

  filterId: Joi.string().optional(),

  isActive: Joi.boolean().optional(),

  displayOrder: Joi.number().min(1).required().messages({
    "number.base": "displayOrder must be a number",
    "number.min": "displayOrder must be >= 1",
    "any.required": "displayOrder is required",
  }),

  permission: Joi.string().optional(),
});
