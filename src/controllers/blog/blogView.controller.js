// controllers/blog.controller.js
import {
  addBlogCommentService,
  deleteBlogCommentService,
  increaseBlogViewService,
} from "../../services/blog.service.js";

import Employee from "../../models/manage/employee.model.js";
import { sendError, handleError } from "../../helpers/error.helper.js";
import {sendSuccess} from "../../helpers/response.helper.js"


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
export const addBlogComment = async (req, res) => {
  try {
    
    const result = await addBlogCommentService({
      blogId: req.params.blogId,
      data: req.body,
    });

    return sendSuccess(res, result, 201, "Comment added");
  } catch (err) {
    return handleError(res, err);
  }
};


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
export const deleteBlogComment = async (req, res) => {
  try {
    const employee = await Employee.findOne({ email: req.user.email });
    if (!employee) {
      return sendError(res, { message: "Employee not found", statusCode: 404 });
    }
    const result = await deleteBlogCommentService({
      blogId: req.params.blogId,
      commentId: req.params.commentId,
      employee,
      permission: req.body.permission,
    });
    return sendSuccess(res, result, 200, "Comment deleted");
  } catch (err) {
    return handleError(res, err);
  }
};


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
export const increaseBlogView = async (req, res) => {
  try {
    const result = await increaseBlogViewService({
      blogId: req.params.blogId,
      req,
    });

    return sendSuccess(res, result, 200, "View updated");
  } catch (err) {
    return handleError(res, err);
  }
};