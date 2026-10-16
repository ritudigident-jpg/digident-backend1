/**
 * Business logic for a shop customer's cart. Throws AppError subclasses on failure.
 *
 * Exports: addToCartService, getCartService, updateCartQuantityService, removeCartItemService,
 * clearCartService
 * Used by: controllers/cart/cart.controller.js
 */

import Product from "../../models/product.model.js";
import Cart from "../../models/cart.model.js";
import { v6 as uuidv6 } from "uuid";
import { getStock, resolvePrice, resolveImages } from "../product/productresolver.service.js";
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  AppError,
} from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

/**
 * Add to cart.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.user
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const addToCartService = async ({ data, user }) => {
  try {
    /* ---------- AUTH ---------- */
    if (!user) {
      throw new UnauthorizedError("Unauthorized user");
    }

    const { productId, variantId, brandId, categoryId, quantity } = data;

    const qty = Number(quantity);

    /* ---------- FETCH PRODUCT ---------- */
    const product = await Product.findOne({
      productId,
      status: "active",
    })
      .populate("brand", "brandName logoUrl")
      .populate("category", "name");

    if (!product) {
      throw new NotFoundError("Product not found or inactive", { code: ERROR_CODES.PRODUCT_NOT_FOUND });
    }

    /* ---------- VALIDATIONS ---------- */
    if (product.category?._id.toString() !== categoryId.toString()) {
      throw new BadRequestError("Invalid category", { code: ERROR_CODES.INVALID_CATEGORY });
    }

    const brand = product.brand.find((b) => b._id.toString() === brandId.toString());

    if (!brand) {
      throw new BadRequestError("Invalid brand", { code: ERROR_CODES.INVALID_BRAND });
    }

    const variant = product.variants.find((v) => v.variantId.toString() === variantId.toString());

    if (!variant) {
      throw new NotFoundError("Variant not found", { code: ERROR_CODES.VARIANT_NOT_FOUND });
    }

    const availableStock = getStock(product, variantId);

    if (availableStock < qty) {
      throw new BadRequestError("Insufficient stock", { code: ERROR_CODES.INSUFFICIENT_STOCK });
    }

    const price = resolvePrice(product, variant);
    const images = resolveImages(product, variant);

    const attributesMap = {};
    variant.attributes?.forEach((attr) => {
      attributesMap[attr.key] = attr.value;
    });

    /* ---------- ENSURE CART ---------- */
    let cart;

    if (user.cart) {
      cart = await Cart.findById(user.cart);
    }

    if (!cart) {
      cart = await Cart.create({
        cartId: uuidv6(),
        items: [],
      });

      user.cart = cart._id;
      await user.save();
    }

    /* ---------- ATOMIC UPDATE ---------- */
    const incrementResult = await Cart.updateOne(
      {
        _id: cart._id,
        "items.variantId": variantId,
      },
      {
        $inc: { "items.$.quantity": qty },
        $set: {
          "items.$.price": price,
          "items.$.image": images?.[0] || "",
          "items.$.updatedAt": new Date(),
        },
      }
    );

    if (incrementResult.modifiedCount === 0) {
      await Cart.updateOne(
        { _id: cart._id },
        {
          $push: {
            items: {
              productId,
              variantId,
              brandId,
              categoryId,
              productName: product.name,
              variantName: variant.name,
              brandName: brand.brandName,
              categoryName: product.category?.name,
              sku: product.sku || "",
              price,
              quantity: qty,
              attributes: attributesMap,
              image: images?.[0] || "",
              updatedAt: new Date(),
            },
          },
        }
      );
    }

    /* ---------- FETCH UPDATED CART ---------- */
    cart = await Cart.findById(cart._id);

    return {
      cartId: cart.cartId,
      totalItems: cart.items.length,
      items: cart.items,
    };
  } catch (error) {
    logger.error("Add To Cart Service Error", { error });

    throw error instanceof AppError
      ? error
      : new AppError("Failed to add item to cart", { code: ERROR_CODES.ADD_TO_CART_FAILED, cause: error });
  }
};

/**
 * Get cart.
 *
 * @param {object} params
 * @param {*} params.user
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const getCartService = async ({ user }) => {
  try {
    /* ---------- AUTH ---------- */
    if (!user) {
      throw new UnauthorizedError("Unauthorized");
    }

    /* ---------- EMPTY CART ---------- */
    if (!user.cart) {
      return {
        cartId: null,
        items: [],
      };
    }

    const cart = await Cart.findById(user.cart).lean();

    if (!cart || cart.items.length === 0) {
      return {
        cartId: cart?.cartId || null,
        items: [],
      };
    }

    /* ---------- FETCH PRODUCTS ---------- */
    const productIds = [...new Set(cart.items.map((i) => i.productId))];

    const products = await Product.find({
      productId: { $in: productIds },
      status: "active",
    })
      .populate("brand", "brandName logoUrl")
      .populate("category", "name")
      .lean();

    const productMap = new Map(products.map((p) => [p.productId, p]));

    /* ---------- BUILD RESPONSE ---------- */
    const cartItems = cart.items
      .map((item) => {
        const product = productMap.get(item.productId);
        if (!product) return null;

        const variant = product.variants.find((v) => v.variantId === item.variantId);
        if (!variant) return null;

        const brand = product.brand.find((b) => b._id.toString() === item.brandId.toString());

        return {
          product: {
            id: product.productId,
            name: product.name,
          },

          category: product.category
            ? {
                id: product.category._id,
                name: product.category.name,
              }
            : {
                id: item.categoryId,
                name: item.categoryName || "",
              },

          brand: brand
            ? {
                id: brand._id,
                name: brand.brandName,
              }
            : null,

          variant: {
            id: variant.variantId,
            name: variant.name,
            attributes: item.attributes,
          },

          sku: item.sku,
          price: item.price,
          quantity: item.quantity,
          image: item.image,
          addedAt: item.createdAt,
        };
      })
      .filter(Boolean);

    return {
      cartId: cart.cartId,
      items: cartItems,
    };
  } catch (error) {
    logger.error("Get Cart Service Error", { error });

    throw error instanceof AppError
      ? error
      : new AppError("Failed to fetch cart", { code: ERROR_CODES.GET_CART_FAILED, cause: error });
  }
};

/**
 * Update cart quantity.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.user
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const updateCartQuantityService = async ({ data, user }) => {
  try {
    /* ---------- AUTH ---------- */
    if (!user) {
      throw new UnauthorizedError("Unauthorized user");
    }

    const { variantId, quantity } = data;
    const qty = Number(quantity);

    /* ---------- CART CHECK ---------- */
    if (!user.cart) {
      throw new NotFoundError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
    }

    const cart = await Cart.findById(user.cart);

    if (!cart || cart.items.length === 0) {
      throw new NotFoundError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
    }

    /* ---------- FIND ITEM ---------- */
    const cartItem = cart.items.find((item) => item.variantId === variantId);

    if (!cartItem) {
      throw new NotFoundError("Cart item not found", { code: ERROR_CODES.ITEM_NOT_FOUND });
    }

    /* ---------- FETCH PRODUCT ---------- */
    const product = await Product.findOne({
      productId: cartItem.productId,
      status: "active",
    });

    if (!product) {
      throw new NotFoundError("Product not available", { code: ERROR_CODES.PRODUCT_NOT_AVAILABLE });
    }

    /* ---------- FIND VARIANT ---------- */
    const variant = product.variants.find((v) => v.variantId === cartItem.variantId);

    if (!variant) {
      throw new NotFoundError("Variant not available", { code: ERROR_CODES.VARIANT_NOT_AVAILABLE });
    }

    /* ---------- STOCK CHECK ---------- */
    const availableStock = getStock(product, cartItem.variantId);

    if (availableStock < qty) {
      throw new BadRequestError(`Only ${availableStock} item(s) available`, {
        code: ERROR_CODES.INSUFFICIENT_STOCK,
      });
    }

    /* ---------- UPDATE ---------- */
    cartItem.quantity = qty;
    cartItem.updatedAt = new Date();

    await cart.save();

    return {
      cartId: cart.cartId,
      item: {
        product: {
          id: cartItem.productId,
          name: cartItem.productName,
        },
        brand: {
          id: cartItem.brandId,
          name: cartItem.brandName,
        },
        variant: {
          id: cartItem.variantId,
          name: cartItem.variantName,
          attributes: cartItem.attributes,
        },
        price: cartItem.price,
        quantity: cartItem.quantity,
        image: cartItem.image,
      },
    };
  } catch (error) {
    logger.error("Update Cart Quantity Service Error", { error });

    throw error instanceof AppError
      ? error
      : new AppError("Failed to update cart quantity", {
          code: ERROR_CODES.UPDATE_CART_FAILED,
          cause: error,
        });
  }
};

/**
 * Remove cart item.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.user
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const removeCartItemService = async ({ data, user }) => {
  try {
    /* ---------- AUTH ---------- */
    if (!user) {
      throw new UnauthorizedError("Unauthorized user");
    }

    const { variantId } = data;

    /* ---------- CART CHECK ---------- */
    if (!user.cart) {
      throw new NotFoundError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
    }

    const cart = await Cart.findById(user.cart);

    if (!cart || cart.items.length === 0) {
      throw new NotFoundError("Cart is empty", { code: ERROR_CODES.CART_EMPTY });
    }

    const initialLength = cart.items.length;

    /* ---------- REMOVE ITEM ---------- */
    cart.items = cart.items.filter((item) => item.variantId !== variantId);

    if (cart.items.length === initialLength) {
      throw new NotFoundError("Cart item not found", { code: ERROR_CODES.ITEM_NOT_FOUND });
    }

    await cart.save();

    return {
      cartId: cart.cartId,
      items: cart.items,
    };
  } catch (error) {
    logger.error("Remove Cart Item Service Error", { error });

    throw error instanceof AppError
      ? error
      : new AppError("Failed to remove cart item", { code: ERROR_CODES.REMOVE_CART_FAILED, cause: error });
  }
};

/**
 * Clear cart.
 *
 * @param {object} params
 * @param {*} params.user
 * @returns {Promise<*>}
 * @throws {UnauthorizedError} 401 when the caller is not logged in or the credentials are wrong.
 */
export const clearCartService = async ({ user }) => {
  try {
    /* ---------- AUTH ---------- */
    if (!user) {
      throw new UnauthorizedError("Unauthorized user");
    }

    /* ---------- NO CART ---------- */
    if (!user.cart) {
      return {
        cartId: null,
        items: [],
        totalItems: 0,
      };
    }

    /* ---------- FETCH CART ---------- */
    const cart = await Cart.findById(user.cart);

    if (!cart || cart.items.length === 0) {
      return {
        cartId: cart?.cartId || null,
        items: [],
        totalItems: 0,
      };
    }

    /* ---------- CLEAR CART ---------- */
    cart.items = [];
    cart.updatedAt = new Date();

    await cart.save();

    return {
      cartId: cart.cartId,
      items: [],
      totalItems: 0,
    };
  } catch (error) {
    logger.error("Clear Cart Service Error", { error });

    throw error instanceof AppError
      ? error
      : new AppError("Failed to clear cart", { code: ERROR_CODES.CLEAR_CART_FAILED, cause: error });
  }
};
