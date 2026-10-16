/**
 * HTTP handlers for blog posts, comments and SEO data: read the request, call the service, send
 * the response. No business logic here.
 *
 * Exports: createBlog, getBlogs, getBlogById, getBlogBySlug, updateBlog, deleteBlog
 * Used by: routes/blogs.routes.js
 */

import {
  createBlogService,
  getBlogsService,
  getBlogByIdService,
  getBlogBySlugService,
  updateBlogService,
  deleteBlogService,
} from "../../services/blog/blog.service.js";

import { createBlogValidator, updateBlogValidator } from "./blog.validator.js";

import Employee from "../../models/employee.model.js";

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createBlog
 *
 * @params
 * body: {
 *   title: string,
 *   contentMarkdown: string,
 *   category?: string,
 *   tags?: string[],
 *   status?: "draft" | "published"
 * }
 * file: featuredImage (optional)
 *
 * @process
 * Validate request body using Joi
 * Fetch authenticated employee using req.user.email
 * Upload featured image (if provided)
 * Create blog
 *
 * @response
 * 201 { success: true, message: "Blog created successfully", data: blog }
 */
export const createBlog = asyncHandler(async (req, res) => {
  const featuredImage = req.files?.featuredImage?.[0];
  const { value, error } = createBlogValidator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const blog = await createBlogService({
    data: value,
    featuredImage,
    employee,
  });
  return sendCreated(res, { data: blog, message: "Blog created successfully" });
});

/**
 * @function getBlogs
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number,
 *   status?: "draft" | "published",
 *   category?: string,
 *   search?: string
 * }
 *
 * @process
 * Read pagination values
 * Apply optional filters
 * Fetch paginated blogs
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Blogs fetched successfully",
 *   data: {
 *     blogs,
 *     pagination
 *   }
 * }
 */
export const getBlogs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);

  const result = await getBlogsService({
    page,
    limit,
    skip,
    status: req.query.status,
    search: req.query.search,
    category: req.query.category,
  });

  return sendSuccess(res, { data: result, message: "Blogs fetched successfully" });
});

/**
 * @function getBlogById
 *
 * @params
 * params: {
 *   blogId: string
 * }
 *
 * @process
 * Fetch blog using blogId
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Blog fetched successfully",
 *   data: blog
 * }
 */
export const getBlogById = asyncHandler(async (req, res) => {
  const blog = await getBlogByIdService({
    blogId: req.params.blogId,
  });

  return sendSuccess(res, { data: blog, message: "Blog fetched successfully" });
});

/**
 * @function getBlogBySlug
 *
 * @params
 * params: {
 *   slug: string
 * }
 *
 * @process
 * Fetch published blog using slug
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Blog fetched successfully",
 *   data: blog
 * }
 */
export const getBlogBySlug = asyncHandler(async (req, res) => {
  const blog = await getBlogBySlugService({
    slug: req.params.slug,
  });

  return sendSuccess(res, { data: blog, message: "Blog fetched successfully" });
});

/**
 * @function updateBlog
 *
 * @params
 * params: {
 *   blogId: string
 * }
 * body: {
 *   title?: string,
 *   contentMarkdown?: string,
 *   category?: string,
 *   tags?: string[],
 *   status?: "draft" | "published"
 * }
 * file?: featuredImage
 *
 * @process
 * Validate request body
 * Fetch authenticated employee
 * Replace featured image (if provided)
 * Update blog details
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Blog updated successfully",
 *   data: blog
 * }
 */
export const updateBlog = asyncHandler(async (req, res) => {
  const featuredImage = req.files?.featuredImage?.[0];
  const { value, error } = updateBlogValidator.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const blog = await updateBlogService({
    blogId: req.params.blogId,
    data: value,
    featuredImage,
    employee,
  });
  return sendSuccess(res, { data: blog, message: "Blog updated successfully" });
});

/**
 * @function deleteBlog
 *
 * @params
 * params: {
 *   blogId: string
 * }
 *
 * @process
 * Fetch authenticated employee
 * Soft delete blog
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Blog deleted successfully"
 * }
 */
export const deleteBlog = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ email: req.user.email });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const result = await deleteBlogService({
    blogId: req.params.blogId,
    employee,
  });

  return sendSuccess(res, { data: result, message: "Blog deleted successfully" });
});
