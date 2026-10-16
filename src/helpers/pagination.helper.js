/**
 * getPagination(query): page, limit (max 100, default 12) and skip from the query string.
 *
 * Exports: getPagination
 * Used by: 16 files, e.g. controllers/banner/banner.controller.js,
 * controllers/blog/blog.controller.js, controllers/contact/contact.controller.js,
 * controllers/coupon/coupon.controller.js
 */

/**
 * getPagination(query): page, limit (max 100, default 12) and skip from the query string.
 *
 * Exports: getPagination
 * Used by: 16 files, e.g. controllers/banner/banner.controller.js,
 * controllers/blog/blog.controller.js, controllers/contact/contact.controller.js,
 * controllers/coupon/coupon.controller.js
 */

/**
 * Get pagination.
 *
 * @param {*} [query]
 * @returns {*}
 */
export const getPagination = (query = {}) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 12, 1), 100);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
  };
};
