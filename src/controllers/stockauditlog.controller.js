import {sendError, handleError } from "../helpers/error.helper.js";
import { sendSuccess } from "../helpers/response.helper.js";
import { getPagination } from "../helpers/pagination.helper.js";
import StockAuditLogs from "../models/ecommarace/stockauditlog.model.js";

/**
 * @function getStockAuditLogs
 *
 * @route GET /api/stock-audit-logs
 *
 * @description
 * Fetch stock audit logs with pagination and optional filtering by
 * order ID, action type, and date range.
 *
 * @query
 * {
 *   orderId?: string,
 *   action?: "add" | "deduct",
 *   startDate?: string,
 *   endDate?: string,
 *   page?: number,
 *   limit?: number
 * }
 *
 * @process
 * 1. Read query parameters.
 * 2. Validate page and limit values.
 * 3. Build filter using orderId, action and date range.
 * 4. Validate startDate and endDate.
 * 5. Fetch stock audit logs with pagination.
 * 6. Count total matching records.
 * 7. Generate pagination metadata.
 * 8. Return paginated audit logs.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Stock audit logs fetched successfully",
 *   data: {
 *     pagination,
 *     count,
 *     logs
 *   }
 * }
 *
 * @errors
 * 400 - INVALID_PAGINATION
 * 400 - INVALID_START_DATE
 * 400 - INVALID_END_DATE
 * 404 - NO_LOGS_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */

export const getStockAuditLogs = async (req, res) => {
  try {
    /* =========================
       QUERY PARAMS
    ========================= */
    const {
      orderId,
      action,
      startDate,
      endDate,
      page = 1,
      limit = 10,
    } = req.query;

    const pageNumber = Number(page);
    const limitNumber = Number(limit);

    /* =========================
       VALIDATION
    ========================= */
    if (pageNumber < 1 || limitNumber < 1) {
      return sendError(res, {
        message: "Page and limit must be positive numbers",
        statusCode: 400,
        errorCode: "INVALID_PAGINATION",
      });
    }

    /* =========================
       FILTER BUILDING
    ========================= */
    const filter = {};

    if (orderId) {
      filter.orderId = orderId;
    }

    if (action) {
      filter.action = action.toLowerCase();
    }

    /* ---------- DATE FILTER ---------- */
    if (startDate || endDate) {
      filter.time = {};

      if (startDate) {
        const start = new Date(startDate);
        if (isNaN(start.getTime())) {
          return sendError(res, {
            message: "Invalid startDate format",
            statusCode: 400,
            errorCode: "INVALID_START_DATE",
          });
        }
        filter.time.$gte = start;
      }

      if (endDate) {
        const end = new Date(endDate);
        if (isNaN(end.getTime())) {
          return sendError(res, {
            message: "Invalid endDate format",
            statusCode: 400,
            errorCode: "INVALID_END_DATE",
          });
        }
        filter.time.$lte = end;
      }
    }

    /* =========================
       PAGINATION
    ========================= */
    const skip = (pageNumber - 1) * limitNumber;

    /* =========================
       DB QUERY
    ========================= */
    const [logs, total] = await Promise.all([
      StockAuditLogs.find(filter)
        .sort({ time: -1 })
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      StockAuditLogs.countDocuments(filter),
    ]);

    /* =========================
       NO DATA CASE
    ========================= */
    if (!logs.length) {
      return sendError(res, {
        message: "No stock audit logs found",
        statusCode: 404,
        errorCode: "NO_LOGS_FOUND",
      });
    }

    /* =========================
       PAGINATION META
    ========================= */
    const pagination = getPagination({
      total,
      page: pageNumber,
      limit: limitNumber,
    });

    /* =========================
       SUCCESS RESPONSE
    ========================= */
    return sendSuccess(
      res,
      {
        pagination,
        count: logs.length,
        logs,
      },
      200,
      "Stock audit logs fetched successfully"
    );

  } catch (error) {
    console.error("Get Stock Audit Logs Error:", error);
    return handleError(res, error);
  }
};