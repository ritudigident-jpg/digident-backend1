/**
 * HTTP handlers for product categories: read the request, call the service, send the response. No
 * business logic here.
 *
 * Exports: createCategory, updateCategory, deleteCategory, getAllCategories
 * Used by: routes/categories.routes.js
 */

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import {
  createCategoryService,
  deleteCategoryService,
  getAllCategoriesService,
  updateCategoryService,
} from "../../services/category/category.service.js";
import { createCategoryValidator, updateCategoryValidator } from "./category.validator.js";
import Employee from "../../models/employee.model.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createCategory
 *
 * @params
 * body: {
 *   name: string,
 *   permission?: string
 * }
 * file: image (required)
 *
 * @process
 * Validate request body using Joi
 * Check if image file is provided
 * Fetch employee using req.user.email
 * Call createCategoryService
 * Return created category
 *
 * @response
 * 201 { success: true, message: "Category created successfully", data: category }
 */
export const createCategory = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = createCategoryValidator.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { name, permission } = value;
  if (!req.file) {
    throw new ValidationError("Image file is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const result = await createCategoryService({
    name,
    file: req.file,
    employee,
    permission,
  });
  return sendCreated(res, { data: result, message: "Category created successfully" });
});

/**
 * @function updateCategory
 *
 * @params
 * params: {
 *   categoryId: string
 * }
 * body: {
 *   name: string,
 *   permission?: string
 * }
 * file?: image
 *
 * @process
 * Validate request body using Joi
 * Extract categoryId from params
 * Fetch employee using req.user.email
 * Call updateCategoryService
 * Return updated category
 *
 * @response
 * 200 { success: true, message: "Category updated successfully", data: category }
 */
export const updateCategory = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = updateCategoryValidator.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { name, permission } = value;
  const { categoryId } = req.params;
  if (!categoryId) {
    throw new ValidationError("CategoryId is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const result = await updateCategoryService({
    categoryId,
    name,
    file: req.file,
    employee,
    permission,
  });

  return sendSuccess(res, { data: result, message: "Category updated successfully" });
});

/**
 * @function deleteCategory
 *
 * @params
 * params: {
 *   categoryId: string
 * }
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * Extract categoryId from params
 * Fetch employee using req.user.email
 * Call deleteCategoryService
 * Return success response
 *
 * @response
 * 200 { success: true, message: "Category deleted successfully" }
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { permission } = req.body;

  if (!categoryId) {
    throw new ValidationError("CategoryId is required");
  }

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  await deleteCategoryService({
    categoryId,
    employee,
    permission,
  });

  return sendSuccess(res, { data: null, message: "Category deleted successfully" });
});

/**
 * @function getAllCategories
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Retrieve pagination values using shared pagination utility
 * Fetch categories from database sorted by name
 * Apply pagination (skip & limit)
 * Count total categories
 * Return paginated categories with pagination metadata
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Categories fetched successfully",
 *   data: {
 *     categories,
 *     pagination: {
 *       currentPage,
 *       totalPages,
 *       totalCategories,
 *       limit
 *     }
 *   }
 * }
 */
export const getAllCategories = asyncHandler(async (req, res) => {
  const result = await getAllCategoriesService();
  return sendSuccess(res, { data: result, message: "Categories fetched successfully" });
});
