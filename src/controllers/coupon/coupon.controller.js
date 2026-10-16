/**
 * HTTP handlers for discount coupons: read the request, call the service, send the response. No
 * business logic here.
 *
 * Exports: createCoupon, updateCoupon, filterCouponsByStatus, getSingleCoupon, deleteCoupon
 * Used by: routes/coupons.routes.js
 */

import { createCouponValidation, updateCouponValidation } from "./coupon.validator.js";

import {
  createCouponService,
  deleteCouponService,
  filterCouponsService,
  getSingleCouponService,
  updateCouponService,
} from "../../services/coupon/coupon.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { getPagination } from "../../helpers/pagination.helper.js";
import Employee from "../../models/employee.model.js";
import { NotFoundError, ValidationError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createCoupon
 *
 * @body
 * {
 *   code: string,
 *   title: string,
 *   couponType: string,
 *   discountValue?: number,
 *   startDate: date,
 *   endDate: date
 * }
 *
 * @process
 * Validate request body using Joi
 * Generate couponId
 * Save coupon in database
 *
 * @response
 * 201 Coupon created successfully
 */
export const createCoupon = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = createCouponValidation.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  /* ---------- SERVICE ---------- */
  const coupon = await createCouponService({
    data: value,
    employee, // optional
    permission: req.permission, // optional
  });
  return sendCreated(res, { data: coupon, message: "Coupon created successfully" });
});

/**
 * @function updateCoupon
 *
 * @params
 * couponId: string
 *
 * @body
 * same as create
 *
 * @process
 * Validate request
 * Update coupon by couponId
 *
 * @response
 * 200 Coupon updated successfully
 */
export const updateCoupon = asyncHandler(async (req, res) => {
  const { value, error } = updateCouponValidation.validate(req.body, {
    abortEarly: false,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }
  const { id: couponId } = req.params;
  if (!couponId) {
    throw new ValidationError("CouponId is required");
  }

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }
  /* ---------- SERVICE ---------- */
  const coupon = await updateCouponService({
    couponId,
    data: value,
    employee,
  });
  return sendSuccess(res, { data: coupon, message: "Coupon updated successfully" });
});

/**
 * @function filterCouponsByStatus
 *
 * @query
 * {
 *   status?: "active" | "draft",
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * Extract pagination params (page, limit, skip)
 * Build filter based on status
 * Fetch coupons with pagination
 * Count total coupons
 * Format coupon response
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Coupons fetched successfully",
 *   data: {
 *     coupons: [],
 *     pagination: {
 *       currentPage,
 *       totalPages,
 *       totalCoupons,
 *       limit
 *     },
 *     status
 *   }
 * }
 */

export const filterCouponsByStatus = asyncHandler(async (req, res) => {
  /* ---------- PAGINATION ---------- */
  const { page, limit, skip } = getPagination(req.query);

  /* ---------- QUERY PARAM ---------- */
  const { isActive } = req.params;

  /* ---------- SERVICE ---------- */
  const { coupons, total } = await filterCouponsService({
    isActive,
    skip,
    limit,
  });

  /* ---------- RESPONSE ---------- */
  return sendSuccess(res, {
    data: {
      coupons, // ✅ no formatting
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalCoupons: total,
        limit,
      },
      status: isActive || "all",
    },
    message: "Coupons fetched successfully",
  });
});

/**
 * @function getSingleCoupon
 *
 * @params
 * couponId: string
 *
 * @process
 * Validate couponId
 * Fetch coupon from database
 * If expired → mark inactive
 * Format coupon response
 *
 * @response
 * 200 Coupon fetched successfully
 * 404 Coupon not found
 */
export const getSingleCoupon = asyncHandler(async (req, res) => {
  const { id: couponId } = req.params;

  if (!couponId) {
    throw new ValidationError("CouponId is required");
  }

  /* ---------- SERVICE ---------- */
  const coupon = await getSingleCouponService({ couponId });
  return sendSuccess(res, { data: coupon, message: "Coupon fetched successfully" });
});

/**
 * @function deleteCoupon
 *
 * @params
 * couponId: string
 *
 * @process
 * Validate couponId
 * Find and delete coupon from database
 * Throw error if not found
 *
 * @response
 * 200 Coupon deleted successfully
 * 404 Coupon not found
 */
export const deleteCoupon = asyncHandler(async (req, res) => {
  const { id: couponId } = req.params;

  if (!couponId) {
    throw new ValidationError("CouponId is required");
  }

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({
    email: req.user.email,
  });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- SERVICE ---------- */
  await deleteCouponService({ couponId, employee });
  return sendSuccess(res, { data: null, message: "Coupon deleted successfully" });
});
