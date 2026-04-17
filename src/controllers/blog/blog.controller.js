import Employee from "../../models/manage/employee.model.js";
import { createBlogValidator, updateBlogValidator } from "./blog.validator.js";
import { createBlogService, deleteBlogService, getBlogByIdService, getBlogsService, updateBlogService} from "../../services/blog.service.js";
import {
  sendError,
  handleError,
} from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";

/* ---------- SAFE JSON PARSER ---------- */
const parseJsonField = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};


export const createBlog = async (req, res) => {
  try {
    const body = {
      ...req.body,
      content: parseJsonField(req.body.content, []),
      tags: parseJsonField(req.body.tags, []),
      featured:
        req.body.featured === undefined
          ? undefined
          : req.body.featured === "true" || req.body.featured === true,
    };
    const { value, error } = createBlogValidator.validate(body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error){
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
    const result = await createBlogService({
      data: value,
      files: req.files || {},
      employee,
    });

    return sendSuccess(res, result, 201, "Blog created successfully");
  } catch (error) {
    console.error("Create Blog Error:", error);
    return handleError(res, error);
  }
};

/**
 * @function updateBlog
 *
 * @description
 * Update blog with optional banner replacement + optional content image replacement
 */
export const updateBlog = async (req, res) => {
  try {
    const body = {
      ...req.body,
      content: parseJsonField(req.body.content, undefined),
      tags: parseJsonField(req.body.tags, undefined),
      featured:
        req.body.featured === undefined
          ? undefined
          : req.body.featured === "true" || req.body.featured === true,
      removeBannerImage:
        req.body.removeBannerImage === undefined
          ? undefined
          : req.body.removeBannerImage === "true" ||
            req.body.removeBannerImage === true,
    };
    const { value, error } = updateBlogValidator.validate(body, {
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
    
    const result = await updateBlogService({
      blogId: req.params.blogId,
      data: value,
      files: req.files || {},
      employee,
    });
    return sendSuccess(res, result, 200, "Blog updated successfully");
  } catch (error) {
    console.error("Update Blog Error:", error);
    return handleError(res, error);
  }
};


/**
 * @function getBlogs
 *
 * @description
 * Get all blogs with pagination, search and filters
 *
 * @query
 * page, limit, search, status, featured, sortBy, sortOrder
 *
 * @response
 * 200 { success: true, message: "Blogs fetched successfully", data: { blogs, pagination } }
 */
export const getBlogs = async (req, res) => {
  try {
    const result = await getBlogsService(req.query);
    return sendSuccess(res, result, 200, "Blogs fetched successfully");
  } catch (error) {
    console.error("Get Blogs Error:", error);
    return handleError(res, error);
  }
};

/**
 * @function getBlogById
 *
 * @description
 * Get single blog by blogId
 *
 * @params
 * blogId
 *
 * @response
 * 200 { success: true, message: "Blog fetched successfully", data: blog }
 * 404 { success: false, message: "Blog not found" }
 */
export const getBlogById = async (req, res) => {
  try {
    const { blogId } = req.params;
    const result = await getBlogByIdService(blogId);
    return sendSuccess(res, result, 200, "Blog fetched successfully");
  } catch (error) {
    console.error("Get Blog By Id Error:", error);
    return handleError(res, error);
  }
};


/**
 * @function deleteBlog
 *
 * @description
 * Permanently delete blog and related S3 images
 *
 * @params
 * blogId
 *
 * @response
 * 200 { success: true, message: "Blog deleted successfully" }
 * 404 { success: false, message: "Blog not found" }
 */
export const deleteBlog = async (req, res) => {
  try {
    const { blogId } = req.params;
    const { permission } = req.body;

    if (!permission) {
      return sendError(res, {
        message: "Permission is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
      });
    }

    const employee = await Employee.findOne({
      email: req.user.email,
    });

    if (!employee) {
      return sendError(res, {
        message: "Employee not found",
        statusCode: 404,
        errorCode: "EMPLOYEE_NOT_FOUND",
      });
    }
    const result = await deleteBlogService({
      blogId,
      employee,
      permission,
    });
    return sendSuccess(res, result, 200, "Blog deleted successfully");
  }catch (error) {
    console.error("Delete Blog Error:", error);
    return handleError(res, error);
  }
};