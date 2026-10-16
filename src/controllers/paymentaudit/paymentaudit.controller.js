/**
 * HTTP handlers for payment audit records: read the request, call the service, send the response.
 * No business logic here.
 *
 * Exports: getAllPayments
 */

/**
 * Payment audit list (admin).
 * NOTE: no route uses this controller yet.
 */
import Payment from "../../models/paymentaudit.model.js";
import { sendSuccess, buildPaginationMeta } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function getAllPayments
 *
 * @params
 * query: {
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * 1. Parse pagination parameters (`page`, `limit`) from query
 * 2. Fetch payments from database
 * 3. Populate `user` with `firstName`, `lastName`, and `email`
 * 4. Sort payments by latest (`createdAt: -1`)
 * 5. Apply pagination using `skip` and `limit`
 * 6. Get total count of payments
 * 7. Generate pagination metadata using central utility
 * 8. Return paginated payment data
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Payments fetched successfully",
 *   data: {
 *     payments: [
 *       {
 *         _id: string,
 *         amount: number,
 *         status: string,
 *         user: {
 *           firstName: string,
 *           lastName: string,
 *           email: string
 *         },
 *         createdAt: Date
 *       }
 *     ],
 *     pagination: {
 *       totalItems: number,
 *       totalPages: number,
 *       currentPage: number,
 *       nextPage: number | null,
 *       prevPage: number | null
 *     }
 *   }
 * }
 */

export const getAllPayments = asyncHandler(async (req, res) => {
  /* ---------- PAGINATION PARAMS ---------- */
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  /* ---------- TOTAL COUNT ---------- */
  const total = await Payment.countDocuments();

  /* ---------- FETCH PAYMENTS ---------- */
  const payments = await Payment.find()
    .populate("user", "firstName lastName email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  /* ---------- PAGINATION ---------- */
  const pagination = buildPaginationMeta({ total, page, limit });

  /* ---------- RESPONSE ---------- */
  return sendSuccess(res, {
    data: {
      payments,
      pagination,
    },
    message: "Payments fetched successfully",
  });
});
