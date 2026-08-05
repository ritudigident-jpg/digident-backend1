import {
  createBlogService,
  getBlogsService,
  getBlogByIdService,
  getBlogBySlugService,
  updateBlogService,
  deleteBlogService,
} from "../../services/blog.service.js";

import {
  createBlogValidator,
  updateBlogValidator,
} from "./blog.validator.js";

import Employee from "../../models/manage/employee.model.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";

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
export const createBlog = async (req, res) => {
  try {
    const featuredImage =  req.files?.featuredImage?.[0]
    const { value, error } = createBlogValidator.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
   
    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }
    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }
    const blog = await createBlogService({
      data: value,featuredImage,
      employee,
    });
    return sendSuccess(res, blog, 201, "Blog created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getBlogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const result = await getBlogsService({
      page,
      limit,
      skip,
      status: req.query.status,
      search: req.query.search,
      category: req.query.category,
    });

    return sendSuccess(res, result, 200, "Blogs fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getBlogById = async (req, res) => {
  try {
    const blog = await getBlogByIdService({
      blogId: req.params.blogId,
    });

    return sendSuccess(res, blog, 200, "Blog fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getBlogBySlug = async (req, res) => {
  try {
    const blog = await getBlogBySlugService({
      slug: req.params.slug,
    });

    return sendSuccess(res, blog, 200, "Blog fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const updateBlog = async (req, res) => {
  try {
    const featuredImage = req.files?.featuredImage?.[0];
    const { value, error } = updateBlogValidator.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return sendError(res, {
        message: "Validation failed",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: error.details.map((e) => e.message),
      });
    }
    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }
    const blog = await updateBlogService({
      blogId: req.params.blogId,
      data: value,featuredImage,
      employee,
    });
    return sendSuccess(res, blog, 200, "Blog updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const deleteBlog = async (req, res) => {
  try {
    const employee = await Employee.findOne({ email: req.user.email });

    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }

    const result = await deleteBlogService({
      blogId: req.params.blogId,
      employee,
    });

    return sendSuccess(res, result, 200, "Blog deleted successfully");
  } catch (error) {
    return handleError(res, error);
  }
};