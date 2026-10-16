/**
 * Creates URL slugs.
 *
 * Exports: generateSlug
 * Used by: services/job/job.service.js
 */

/**
 * Generate slug.
 *
 * @param {*} [text]
 * @returns {*}
 */
export const generateSlug = (text = "") => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
};
