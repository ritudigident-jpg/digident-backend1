/**
 * Joi schemas for a shop customer's cart: request bodies are checked against these before the
 * service runs.
 *
 * Exports: addToCartSchema, updateCartQuantitySchema, removeCartItemSchema
 * Used by: controllers/cart/cart.controller.js
 */

import Joi from "joi";

export const addToCartSchema = Joi.object({
  productId: Joi.string().required(),
  variantId: Joi.string().required(),
  brandId: Joi.string().required(),
  categoryId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
});

export const updateCartQuantitySchema = Joi.object({
  variantId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
});

export const removeCartItemSchema = Joi.object({
  variantId: Joi.string().required(),
});
