/**
 * HTTP handlers for blog view counts: read the request, call the service, send the response. No
 * business logic here.
 *
 * Exports: addBlogComment, deleteBlogComment, increaseBlogView
 * Used by: routes/blogs.routes.js
 */

// controllers/blog.controller.js
import {
  addBlogCommentService,
  deleteBlogCommentService,
  increaseBlogViewService,
} from "../../services/blog/blog.service.js";

import Employee from "../../models/employee.model.js";

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function addBlogComment
 *
 * @params
 * params: {
 *   blogId: string
 * }
 * body: {
 *   name: string,
 *   company?: string,
 *   city?: string,
 *   review: string
 * }
 *
 * @process
 * Validate comment data
 * Add comment to blog
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Comment added",
 *   data: blog
 * }
 */
export const addBlogComment = asyncHandler(async (req, res) => {
  const result = await addBlogCommentService({
    blogId: req.params.blogId,
    data: req.body,
  });

  return sendCreated(res, { data: result, message: "Comment added" });
});

/**
 * @function deleteBlogComment
 *
 * @params
 * params: {
 *   blogId: string,
 *   commentId: string
 * }
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * Fetch authenticated employee
 * Verify delete permission
 * Remove comment from blog
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Comment deleted"
 * }
 */
export const deleteBlogComment = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ email: req.user.email });
  if (!employee) {
    throw new NotFoundError("Employee not found");
  }
  const result = await deleteBlogCommentService({
    blogId: req.params.blogId,
    commentId: req.params.commentId,
    employee,
    permission: req.body.permission,
  });
  return sendSuccess(res, { data: result, message: "Comment deleted" });
});

/**
 * @function increaseBlogView
 *
 * @params
 * params: {
 *   blogId: string
 * }
 *
 * @process
 * Record blog view using request metadata
 * Prevent duplicate view counting (service logic)
 * Increase blog view count
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "View updated",
 *   data: blog
 * }
 */
export const increaseBlogView = asyncHandler(async (req, res) => {
  const result = await increaseBlogViewService({
    blogId: req.params.blogId,
    req,
  });

  return sendSuccess(res, { data: result, message: "View updated" });
});
