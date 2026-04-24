// import Employee from "../../models/manage/employee.model.js";
// import { createBlogValidator, updateBlogValidator } from "./blog.validator.js";
// import { createBlogService, deleteBlogService, getBlogByIdService, getBlogsService, updateBlogService} from "../../services/blog.service.js";
// import {
//   sendError,
//   handleError,
// } from "../../helpers/error.helper.js";
// import { sendSuccess } from "../../helpers/response.helper.js";

// /* ---------- SAFE JSON PARSER ---------- */
// const parseJsonField = (value, fallback) => {
//   if (value === undefined || value === null || value === "") return fallback;
//   if (typeof value !== "string") return value;
//   try {
//     return JSON.parse(value);
//   } catch {
//     return fallback;
//   }
// };

// export const createBlog = async (req, res) => {
//   try {
//     const body = {
//       ...req.body,
//       content: parseJsonField(req.body.content, []),
//       tags: parseJsonField(req.body.tags, []),
//       featured:
//         req.body.featured === undefined
//           ? undefined
//           : req.body.featured === "true" || req.body.featured === true,
//     };

//     const { value, error } = createBlogValidator.validate(body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });

//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }

//     const employee = await Employee.findOne({ email: req.user.email });

//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }

//     const result = await createBlogService({
//       data: value,
//       files: req.files || {},
//       employee,
//     });

//     return sendSuccess(res, result, 201, "Blog created successfully");
//   } catch (error) {
//     console.error("Create Blog Error:", error);
//     return handleError(res, error);
//   }
// };

// /**
//  * @function updateBlog
//  *
//  * @description
//  * Update blog with optional banner replacement + optional content image replacement
//  */

// export const updateBlog = async (req, res) => {
//   try {
//     const body = {
//       ...req.body,
//       content: parseJsonField(req.body.content, undefined),
//       tags: parseJsonField(req.body.tags, undefined),
//       featured:
//         req.body.featured === undefined
//           ? undefined
//           : req.body.featured === "true" || req.body.featured === true,
//       removeBannerImage:
//         req.body.removeBannerImage === undefined
//           ? undefined
//           : req.body.removeBannerImage === "true" ||
//             req.body.removeBannerImage === true,
//     };
//     const { value, error } = updateBlogValidator.validate(body, {
//       abortEarly: false,
//       stripUnknown: true,
//     });
//     if (error) {
//       return sendError(res, {
//         message: "Validation failed",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//         details: error.details.map((e) => e.message),
//       });
//     }
//     const employee = await Employee.findOne({ email: req.user.email });
//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }
//     const result = await updateBlogService({
//       blogId: req.params.blogId,
//       data: value,
//       files: req.files || {},
//       employee,
//     });
//     return sendSuccess(res, result, 200, "Blog updated successfully");
//   } catch (error) {
//     console.error("Update Blog Error:", error);
//     return handleError(res, error);
//   }
// };

// /**
//  * @function getBlogs
//  *
//  * @description
//  * Get all blogs with pagination, search and filters
//  *
//  * @query
//  * page, limit, search, status, featured, sortBy, sortOrder
//  *
//  * @response
//  * 200 { success: true, message: "Blogs fetched successfully", data: { blogs, pagination } }
//  */
// export const getBlogs = async (req, res) => {
//   try {
//     const result = await getBlogsService(req.query);
//     return sendSuccess(res, result, 200, "Blogs fetched successfully");
//   } catch (error) {
//     console.error("Get Blogs Error:", error);
//     return handleError(res, error);
//   }
// };

// /**
//  * @function getBlogById
//  *
//  * @description
//  * Get single blog by blogId
//  *
//  * @params
//  * blogId
//  *
//  * @response
//  * 200 { success: true, message: "Blog fetched successfully", data: blog }
//  * 404 { success: false, message: "Blog not found" }
//  */
// export const getBlogById = async (req, res) => {
//   try {
//     const { blogId } = req.params;
//     const result = await getBlogByIdService(blogId);
//     return sendSuccess(res, result, 200, "Blog fetched successfully");
//   } catch (error) {
//     console.error("Get Blog By Id Error:", error);
//     return handleError(res, error);
//   }
// };


// /**
//  * @function deleteBlog
//  *
//  * @description
//  * Permanently delete blog and related S3 images
//  *
//  * @params
//  * blogId
//  *
//  * @response
//  * 200 { success: true, message: "Blog deleted successfully" }
//  * 404 { success: false, message: "Blog not found" }
//  */
// export const deleteBlog = async (req, res) => {
//   try {
//     const { blogId } = req.params;
//     const { permission } = req.body;

//     if (!permission) {
//       return sendError(res, {
//         message: "Permission is required",
//         statusCode: 400,
//         errorCode: "VALIDATION_ERROR",
//       });
//     }
//     const employee = await Employee.findOne({
//       email: req.user.email,
//     });
//     if (!employee) {
//       return sendError(res, {
//         message: "Employee not found",
//         statusCode: 404,
//         errorCode: "EMPLOYEE_NOT_FOUND",
//       });
//     }
//     const result = await deleteBlogService({
//       blogId,
//       employee,
//       permission,
//     });
//     return sendSuccess(res, result, 200, "Blog deleted successfully");
//   }catch (error) {
//     console.error("Delete Blog Error:", error);
//     return handleError(res, error);
//   }
// };


import {
  createBlogService,
  updateBlogService,
  getBlogsService,
  getBlogByIdService,
  deleteBlogService,
} from "../../services/blog.service.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";

/**
 * @function createBlog
 *
 * @description
 * Create blog with markdown content.
 * If markdown contains image urls, service uploads those images to S3
 * and replaces the urls before saving.
 *
 * @params
 * req.body.content -> full markdown string
 *
 * @response
 * 201 { success: true, message: "Blog created successfully", data: blog }
 * 400 { success: false, message: "Content is required" }
 */
export const createBlog = async (req, res) => {
  try {
    const { content } = req.body;

    if (!content || typeof content !== "string" || !content.trim()) {
      return sendError(res, {
        message: "Content is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: ["content is required and must be a non-empty markdown string"],
      });
    }

    const blog = await createBlogService({
      data: { content: content.trim() },
    });

    return sendSuccess(res, blog, 201, "Blog created successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function updateBlog
 *
 * @description
 * Update blog markdown content by blogId.
 * If markdown contains external image urls, service uploads them to S3
 * and replaces the urls before saving.
 *
 * @params
 * req.params.blogId
 * req.body.content
 *
 * @response
 * 200 { success: true, message: "Blog updated successfully", data: blog }
 * 404 { success: false, message: "Blog not found" }
 */
export const updateBlog = async (req, res) => {
  try {
    const { content } = req.body;
    const { blogId } = req.params;

    if (!blogId || !blogId.trim()) {
      return sendError(res, {
        message: "Blog id is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: ["blogId is required in params"],
      });
    }

    if (!content || typeof content !== "string" || !content.trim()) {
      return sendError(res, {
        message: "Content is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: ["content is required and must be a non-empty markdown string"],
      });
    }

    const blog = await updateBlogService({
      blogId: blogId.trim(),
      data: { content: content.trim() },
    });

    return sendSuccess(res, blog, 200, "Blog updated successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function getBlogs
 *
 * @description
 * Get all blogs
 *
 * @response
 * 200 { success: true, message: "Blogs fetched successfully", data: blogs }
 */
export const getBlogs = async (req, res) => {
  try {
    const blogs = await getBlogsService();
    return sendSuccess(res, blogs, 200, "Blogs fetched successfully");
  } catch (error) {
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
 * req.params.blogId
 *
 * @response
 * 200 { success: true, message: "Blog fetched successfully", data: blog }
 * 404 { success: false, message: "Blog not found" }
 */
export const getBlogById = async (req, res) => {
  try {
    const { blogId } = req.params;

    if (!blogId || !blogId.trim()) {
      return sendError(res, {
        message: "Blog id is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: ["blogId is required in params"],
      });
    }
    const blog = await getBlogByIdService({
      blogId: blogId.trim(),
    });

    return sendSuccess(res, blog, 200, "Blog fetched successfully");
  } catch (error) {
    return handleError(res, error);
  }
};

/**
 * @function deleteBlog
 *
 * @description
 * Delete single blog by blogId
 *
 * @params
 * req.params.blogId
 *
 * @response
 * 200 { success: true, message: "Blog deleted successfully", data: null }
 * 404 { success: false, message: "Blog not found" }
 */
export const deleteBlog = async (req, res) => {
  try {
    const { blogId } = req.params;
    if (!blogId || !blogId.trim()) {
      return sendError(res, {
        message: "Blog id is required",
        statusCode: 400,
        errorCode: "VALIDATION_ERROR",
        details: ["blogId is required in params"],
      });
    }
    await deleteBlogService({
      blogId: blogId.trim(),
    });
    return sendSuccess(res, null, 200, "Blog deleted successfully");
  } catch (error) {
    return handleError(res, error);
  }
};