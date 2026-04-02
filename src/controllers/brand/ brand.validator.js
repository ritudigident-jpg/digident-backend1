import Joi from "joi";

export const createBrandValidator = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .required()
    .messages({
      "string.empty": "Brand name is required"
    }),
  categories: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.array().items(Joi.string())
    ).optional(),
  permission: Joi.string().optional()
});

export const updateBrandValidator = Joi.object({
  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .optional(),

  categories: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.array().items(Joi.string())
    )
    .optional(),

  removeFileIds: Joi.alternatives()
    .try(
      Joi.string(),
      Joi.array().items(Joi.string())
    )
    .optional(),

  permission: Joi.string().required()
});