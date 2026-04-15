import { addBlogCommentValidator } from "./blog.validator.js";
import { addBlogCommentService, deleteBlogCommentService, increaseBlogViewService } from "../../services/blog.service.js";
import {
  sendError,
  handleError,
} from "../../helpers/error.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import Employee from "../../models/manage/employee.model.js";

/**
 * @function addBlogComment
 *
 * @description
 * Public API to add comment on published blog
 *
 * @params
 * slug
 *
 * @body
 * name, company, city, review
 *
 * @response
 * 201 { success: true, message: "Comment added successfully", data: comment }
 * 404 { success: false, message: "Blog not found" }
 */
export const addBlogComment = async (req, res) => {
  try {
    const { value, error } = addBlogCommentValidator.validate(req.body, {
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

    const result = await addBlogCommentService({
       blogId:req.params.blogId,
      data: value,
    });

    return sendSuccess(res, result, 201, "Comment added successfully");
  } catch (error) {
    console.error("Add Blog Comment Error:", error);
    return handleError(res, error);
  }
};


/**
 * @function increaseBlogView
 *
 * @description
 * Increase blog view when blog stays open for 2 minutes on frontend
 *
 * @params
 * blogId
 *
 * @response
 * 200 { success: true, message: "Blog view updated successfully", data: { blogId, slug, views } }
 * 404 { success: false, message: "Blog not found" }
 */
export const increaseBlogView = async (req, res) => {
  try {
    const result = await increaseBlogViewService({
      blogId: req.params.blogId,
    });

    return sendSuccess(res, result, 200, "Blog view updated successfully");
  } catch (error) {
    console.error("Increase Blog View Error:", error);
    return handleError(res, error);
  }
};


/**
 * @function deleteBlogComment
 *
 * @description
 * Permanently delete a blog comment from manage website
 *
 * @params
 * blogId, commentId
 *
 * @body
 * permission
 *
 * @response
 * 200 { success: true, message: "Blog comment deleted successfully", data: result }
 * 404 { success: false, message: "Blog or comment not found" }
 */
export const deleteBlogComment = async (req, res) => {
  try {
    const { blogId, commentId } = req.params;
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

    const result = await deleteBlogCommentService({
      blogId,
      commentId,
      employee,
      permission,
    });

    return sendSuccess(
      res,
      result,
      200,
      "Blog comment deleted successfully"
    );
  } catch (error) {
    console.error("Delete Blog Comment Error:", error);
    return handleError(res, error);
  }
};