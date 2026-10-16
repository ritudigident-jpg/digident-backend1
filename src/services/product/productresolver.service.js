/**
 * Business logic for products, variants, stock and images. Throws AppError subclasses on failure.
 *
 * Exports: getStock, resolvePrice, resolveImages
 * Used by: services/cart/cart.service.js, services/order/order.service.js
 */

import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError } from "../../helpers/apperror.helper.js";
/**
 * Get stock.
 *
 * @param {*} product
 * @param {*} [variantId]
 * @returns {*}
 */
export const getStock = (product, variantId = null) => {
  if (product.stockType === "PRODUCT") {
    return product.productStock;
  }

  if (!variantId) return 0;

  const variant = product.variants.find((v) => v.variantId === variantId);
  return variant ? variant.variantStock : 0;
};

/**
 * Resolve price.
 *
 * @param {*} product
 * @param {*} variant
 * @returns {*}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const resolvePrice = (product, variant) => {
  if (!variant || variant.priceType === "PRODUCT") {
    return product.price ?? 0;
  }
  if (variant.priceType === "VARIANT" && variant.variantPrice == null) {
    throw new BadRequestError("Variant price required", { code: ERROR_CODES.VARIANT_PRICE_REQUIRED });
  }
  return variant.variantPrice;
};

/**
 * Resolve images.
 *
 * @param {*} product
 * @param {*} variant
 * @returns {*}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const resolveImages = (product, variant) => {
  if (!variant || variant.imageType === "PRODUCT") {
    return product.images ?? [];
  }
  if (variant.imageType === "VARIANT" && (!variant.variantImages || variant.variantImages.length === 0)) {
    throw new BadRequestError("Variant images required");
  }
  return variant.variantImages;
};
