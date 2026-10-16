/**
 * HTTP handlers for holidays: list (everyone), and create / list / edit / delete (Holiday Manager).
 * Bodies are validated in the route file (Joi). Re-exported by attendance.controller.js.
 *
 * Used by: controllers/attendance/attendance.controller.js
 */
import { sendCreated, sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  createHolidayService,
  deleteHolidayService,
  getHolidaysService,
  listHolidaysForAdminService,
  updateHolidayService,
} from "../../services/attendance/attendance.service.js";

/** POST /attendance/admin/holiday { date, title, type? } */
export const createHoliday = asyncHandler(async (req, res) => {
  const data = await createHolidayService(req.body, req.user);
  return sendCreated(res, { data, message: "Holiday stored successfully" });
});

/** GET /attendance/holidays?type=all|past|upcoming&year - same { date, reason } items as before, plus title / type. */
export const getHolidays = asyncHandler(async (req, res) => {
  const data = await getHolidaysService(req.query.type, req.query.year);
  return sendSuccess(res, { data, message: "Holiday list fetched successfully" });
});

/** GET /attendance/admin/holidays?year&page&limit */
export const listHolidaysForAdmin = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
  const { items, total } = await listHolidaysForAdminService({ ...req.query, ...pagination });
  return sendPaginated(res, { data: items, pagination: { ...pagination, total }, message: "Holidays fetched" });
});

/** PUT /attendance/admin/holiday/:holidayId { date?, title?, type? } */
export const updateHoliday = asyncHandler(async (req, res) => {
  const data = await updateHolidayService(req.params.holidayId, req.body, req.currentUser);
  return sendSuccess(res, { data, message: "Holiday updated" });
});

/** DELETE /attendance/admin/holiday/:holidayId */
export const deleteHoliday = asyncHandler(async (req, res) => {
  const data = await deleteHolidayService(req.params.holidayId);
  return sendSuccess(res, { data, message: "Holiday deleted" });
});
