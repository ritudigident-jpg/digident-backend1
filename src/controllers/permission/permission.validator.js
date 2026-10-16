/**
 * Joi schemas for permission definitions and assigning them to employees: request bodies are
 * checked against these before the service runs.
 *
 * Exports: validatePermissionBody, validateAssignPermissionBody
 * Used by: controllers/permission/permission.controller.js
 */

import Joi from "joi";

export const validatePermissionBody = (data) => {
  const schema = Joi.object({
    name: Joi.string().trim().min(2).max(50).required(),
  });

  return schema.validate(data, { abortEarly: false });
};

export const validateAssignPermissionBody = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required(),
    permission: Joi.string().trim().required(),
  });

  return schema.validate(data, { abortEarly: false });
};
