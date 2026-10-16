/**
 * HTTP handlers for homepage banners of the shop and website: read the request, call the service,
 * send the response. No business logic here.
 *
 * Exports: createBanner, getProductsByBanner, getAllBanners, updateBanner,
 * updateBannerDisplayOrder, deleteBanner, getBannersByIsActive
 * Used by: routes/banners.routes.js
 */

import { getPagination } from "../../helpers/pagination.helper.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import Employee from "../../models/employee.model.js";
import {
  createBannerService,
  deleteBannerService,
  getAllBannersService,
  getBannersByIsActiveService,
  getProductsByBannerService,
  updateBannerDisplayOrderService,
  updateBannerService,
} from "../../services/banner/banner.service.js";
import { createBannerValidator } from "./banner.validator.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createBanner
 *
 * @params
 * body: {
 *   filterBy?: string,
 *   filterId?: string,
 *   isActive?: boolean,
 *   displayOrder: number,
 *   permission?: string
 * }
 * file: image (required)
 *
 * @process
 * Validate request body using Joi
 * Ensure image file is provided
 * Fetch employee using req.user.email
 * Check displayOrder uniqueness for active banners
 * Upload image to S3
 * Create banner in database
 * Create audit log entry
 *
 * @response
 * 201 { success: true, message: "Banner created successfully", data: banner }
 */
export const createBanner = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = createBannerValidator.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { filterBy, filterId, isActive, displayOrder, permission } = value;
  if (!req.file) {
    throw new ValidationError("Banner image is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  const result = await createBannerService({
    filterBy,
    filterId,
    isActive,
    displayOrder,
    file: req.file,
    employee,
    permission,
  });

  return sendCreated(res, { data: result, message: "Banner created successfully" });
});

/**
 * @function getProductsByBanner
 *
 * @params
 * params: {
 *   bannerId: string
 * }
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Extract bannerId from params
 * Get pagination values
 * Find active banner
 * Apply filter based on banner type (category/brand)
 * Fetch products with pagination
 * Populate category and brand details
 *
 * @response
 * 200 { success: true, message: "Products fetched by banner", data: { products, pagination } }
 */
export const getProductsByBanner = asyncHandler(async (req, res) => {
  const { bannerId } = req.params;
  if (!bannerId) {
    throw new ValidationError("BannerId is required");
  }
  const { page, limit } = getPagination(req.query);
  const result = await getProductsByBannerService({
    bannerId,
    page,
    limit,
  });
  return sendSuccess(res, { data: result, message: "Products fetched by banner" });
});

/**
 * @function getAllBanners
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Retrieve pagination values using shared pagination utility
 * Fetch active banners from database
 * Sort banners by displayOrder (ascending)
 * Apply pagination (skip & limit)
 * Count total banners
 * Return paginated banners with metadata
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Banners fetched successfully",
 *   data: {
 *     banners,
 *     pagination: {
 *       currentPage,
 *       totalPages,
 *       totalBanners,
 *       limit
 *     }
 *   }
 * }
 */
export const getAllBanners = asyncHandler(async (req, res) => {
  const { page, limit } = getPagination(req.query);
  const result = await getAllBannersService({
    page,
    limit,
  });
  return sendSuccess(res, { data: result, message: "Banners fetched successfully" });
});

/**
 * @function updateBanner
 *
 * @params
 * params: {
 *   bannerId: string
 * }
 * body: {
 *   filterBy?: string,
 *   filterId?: string,
 *   isActive?: boolean,
 *   displayOrder?: number,
 *   permission?: string
 * }
 * file?: image
 *
 * @process
 * Extract bannerId from params
 * Fetch employee using req.user.email
 * Check displayOrder conflict for active banners
 * If image provided:
 *   Delete old image from S3
 *   Upload new image
 * Update banner fields
 * Save banner
 * Create audit log entry
 *
 * @response
 * 200 { success: true, message: "Banner updated successfully", data: banner }
 */
export const updateBanner = asyncHandler(async (req, res) => {
  const { bannerId } = req.params;
  const { filterBy, filterId, isActive, displayOrder, permission } = req.body;

  if (!bannerId) {
    throw new ValidationError("BannerId is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const result = await updateBannerService({
    bannerId,
    filterBy,
    filterId,
    isActive,
    displayOrder,
    file: req.file,
    employee,
    permission,
  });

  return sendSuccess(res, { data: result, message: "Banner updated successfully" });
});

/**
 * @function updateBannerDisplayOrder
 *
 * @params
 * params: {
 *   bannerId: string
 * }
 * body: {
 *   displayOrder: number,
 *   permission?: string
 * }
 *
 * @process
 * Extract bannerId from params
 * Validate displayOrder (>=1)
 * Fetch employee using req.user.email
 * Check displayOrder conflict for active banners
 * Update banner displayOrder
 * Save banner
 * Create audit log entry
 *
 * @response
 * 200 { success: true, message: "Display order updated successfully", data: banner }
 */
export const updateBannerDisplayOrder = asyncHandler(async (req, res) => {
  const { bannerId } = req.params;
  const { displayOrder, permission } = req.body;
  if (!bannerId) {
    throw new ValidationError("BannerId is required");
  }
  if (!displayOrder || displayOrder < 1) {
    throw new ValidationError("displayOrder must be >= 1");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  const result = await updateBannerDisplayOrderService({
    bannerId,
    displayOrder,
    employee,
    permission,
  });
  return sendSuccess(res, { data: result, message: "Display order updated successfully" });
});

/**
 * @function deleteBanner
 *
 * @params
 * params: {
 *   bannerId: string
 * }
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * Extract bannerId from params
 * Fetch employee using req.user.email
 * Find banner by bannerId
 * Delete banner image from S3
 * Delete banner from database
 * Create audit log entry
 *
 * @response
 * 200 { success: true, message: "Banner deleted successfully" }
 */
export const deleteBanner = asyncHandler(async (req, res) => {
  const { bannerId } = req.params;
  const { permission } = req.body;
  if (!bannerId) {
    throw new ValidationError("BannerId is required");
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  await deleteBannerService({
    bannerId,
    employee,
    permission,
  });

  return sendSuccess(res, { data: null, message: "Banner deleted successfully" });
});

/**
 * @function getBannersByIsActive
 *
 * @params
 * query: {
 *   isActive: boolean (true | false),
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Extract isActive from query
 * Convert isActive string to boolean
 * Retrieve pagination values
 * Fetch banners filtered by isActive
 * Sort by displayOrder
 * Return paginated banners
 *
 * @response
 * 200 { success: true, message: "Banners fetched successfully", data: { banners, pagination } }
 */
export const getBannersByIsActive = asyncHandler(async (req, res) => {
  const { isActive } = req.query;
  if (isActive === undefined) {
    throw new ValidationError("isActive query param is required (true | false)");
  }
  /* ---------- CONVERT TO BOOLEAN ---------- */
  const isActiveBool = isActive === "true" ? true : isActive === "false" ? false : null;
  if (isActiveBool === null) {
    throw new ValidationError("isActive must be true or false");
  }
  const { page, limit, skip } = getPagination(req.query);
  const result = await getBannersByIsActiveService({
    isActive: isActiveBool,
    page,
    limit,
    skip,
  });
  return sendSuccess(res, { data: result, message: "Banners fetched successfully" });
});
