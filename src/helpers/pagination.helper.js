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

/**
 * Pagination for the attendance / leave / payroll lists, with a per-list default and maximum.
 * Example: listPagination({ page: "2", limit: "500" }, { defaultLimit: 20, maxLimit: 100 })
 *   -> { page: 2, limit: 100, skip: 100 }
 *
 * @param {object} [query]
 * @param {{ defaultLimit?: number, maxLimit?: number }} [options]
 * @returns {{ page: number, limit: number, skip: number }}
 */
export const listPagination = (query = {}, { defaultLimit = 20, maxLimit = 100 } = {}) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};
