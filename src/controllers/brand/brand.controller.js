/**
 * HTTP handlers for implant brands (logo and downloadable files per category): read the request,
 * call the service, send the response. No business logic here.
 *
 * Exports: createBrand, updateBrand, getAllBrands, getBrandById, deleteBrandByBrandId,
 * deleteAllBrands
 * Used by: routes/brands.routes.js
 */

import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import Employee from "../../models/employee.model.js";
import {
  createBrandService,
  deleteAllBrandsService,
  deleteBrandService,
  getAllBrandsService,
  getBrandByIdService,
  updateBrandService,
} from "../../services/brand/brand.service.js";
import { createBrandValidator, updateBrandValidator } from "./brand.validator.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createBrand
 *
 * @route POST /api/brand
 *
 * @description
 * Create a new brand with logo and optional categorized files.
 *
 * @process
 * 1. Validate request body using Joi.
 * 2. Extract files from req.files.
 * 3. Fetch employee from req.user.
 * 4. Call createBrandService.
 * 5. Return created brand.
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Brand created successfully",
 *   data: BrandObject
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - EMPLOYEE_NOT_FOUND
 * 409 - BRAND_ALREADY_EXISTS
 * 500 - INTERNAL_SERVER_ERROR
 */
export const createBrand = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = createBrandValidator.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { brandName, categories, permission } = value;
  const logoFile = req.files?.logoUrl?.[0];
  const files = req.files?.file || [];

  if (!logoFile) {
    throw new ValidationError("Logo is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const result = await createBrandService({
    brandName,
    categories,
    files,
    logoFile,
    employee,
    permission,
  });
  return sendCreated(res, { data: result, message: "Brand created successfully" });
});

/**
 * @function updateBrand
 *
 * @route PUT /api/brand/:brandId
 *
 * @description
 * Update brand details including:
 * - brand brandName
 * - logo
 * - add/remove files
 *
 * @process
 * 1. Validate request body
 * 2. Extract params + files
 * 3. Fetch employee
 * 4. Call service
 * 5. Return updated brand
 *
 * @response
 * 200 - Brand updated successfully
 *
 * @errors
 * 400 - Validation error
 * 404 - Brand/Employee not found
 * 409 - Duplicate brand brandName
 * 500 - Internal server error
 */
export const updateBrand = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = updateBrandValidator.validate(req.body, {
    abortEarly: false,
  });

  if (error) {
    throw ValidationError.fromJoi(error);
  }

  const { brandName, categories, removeFileIds, permission } = value;

  const brandId = req.params.brandId;

  if (!brandId) {
    throw new ValidationError("BrandId is required");
  }

  const logoFile = req.files?.logoUrl?.[0];
  const files = req.files?.file || [];

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const result = await updateBrandService({
    brandId,
    brandName,
    categories,
    removeFileIds,
    files,
    logoFile,
    employee,
    permission,
  });

  return sendSuccess(res, { data: result, message: "Brand updated successfully" });
});

/**
 * @function getAllBrands
 * @route GET /api/brands
 *
 * @description
 * Fetch all brands with pagination
 */
export const getAllBrands = asyncHandler(async (req, res) => {
  const result = await getAllBrandsService();
  return sendSuccess(res, { data: result, message: "Brands fetched successfully" });
});

/**
 * @function getBrandById
 * @route GET /api/brand/:brandId
 *
 * @description
 * Fetch a single brand by its ID
 */
export const getBrandById = asyncHandler(async (req, res) => {
  const { brandId } = req.params;

  const result = await getBrandByIdService(brandId);

  return sendSuccess(res, { data: result, message: "Brand fetched successfully" });
});

/**
 * @function deleteBrandByBrandId
 *
 * @params
 * params: {
 *   brandId: string
 * }
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * Validate brandId from request params
 * Fetch employee using req.user.email
 * Check permission (only "delete_brand" allowed if provided)
 * Find brand by brandId
 * Delete logo from S3 if exists
 * Delete all associated files from S3
 * Delete brand from database
 * Create audit log entry
 *
 * @response
 * 200 { success: true, message: "Brand deleted successfully", data: null }
 */
export const deleteBrandByBrandId = asyncHandler(async (req, res) => {
  const { brandId } = req.params;
  const { permission } = req.body;
  if (!brandId) {
    throw new ValidationError("BrandId is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  await deleteBrandService({
    brandId,
    employee,
    permission,
  });

  return sendSuccess(res, { data: null, message: "Brand deleted successfully" });
});

/**
 * @function deleteAllBrands
 *
 * @params
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * Fetch employee using req.user.email
 * Check permission (only "delete_brand" allowed if provided)
 * Fetch all brands from database
 * Loop through each brand:
 *   Delete logo from S3 if exists
 *   Delete all associated files from S3
 * Delete all brands using deleteMany()
 * Create single audit log entry for bulk delete
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All brands deleted successfully",
 *   data: { deletedCount }
 * }
 */
export const deleteAllBrands = asyncHandler(async (req, res) => {
  const { permission } = req.body;

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const result = await deleteAllBrandsService({
    employee,
    permission,
  });

  return sendSuccess(res, { data: result, message: "All brands deleted successfully" });
});
