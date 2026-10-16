/**
 * HTTP handlers for employee attendance: punch-in / punch-out, leave, holidays, corrections and
 * admin approvals: read the request, call the service, send the response. No business logic here.
 *
 * Exports: createHoliday, getHolidays
 * Used by: controllers/attendance/attendance.controller.js
 */

/**
 * HTTP handlers for holidays. Re-exported by attendance.controller.js.
 */
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";
import { createHolidayService, getHolidaysService } from "../../services/attendance/attendance.service.js";
import { ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function createHoliday
 *
 * @params
 * body: {
 *   date: string,   // Holiday date in YYYY-MM-DD format
 *   title: string   // Name or reason for the holiday (e.g., "Diwali")
 * }
 *
 * @process
 * 1. Validate that `date` and `title` are provided in the request body.
 * 2. Validate that `date` is a valid date format.
 * 3. Convert `date` to ISO string format (YYYY-MM-DD).
 * 4. Fetch all active (non-deleted) employees.
 * 5. Initialize counters: `updated` and `skipped`.
 * 6. Loop through each employee:
 *    - Fetch EmployeeRecord for that employee.
 *    - If no record exists, increment `skipped` and continue.
 *    - If a record for the given date exists:
 *       - Update the day to be a full-day holiday with the provided `title`.
 *       - Set dayType, status, leaveType, leaveDuration, punchIn/punchOut, etc.
 *    - If no record exists for that date:
 *       - Create a new day entry in the record marked as full-day holiday.
 *    - Save the EmployeeRecord.
 * 7. After processing all employees, return a summary including:
 *    - Total employees
 *    - Number of records updated
 *    - Number of employees skipped
 *
 * @response
 * 201 {
 *   success: true,
 *   message: "Holiday stored successfully",
 *   data: {
 *     date: string,
 *     title: string,
 *     totalEmployees: number,
 *     updated: number,
 *     skipped: number
 *   }
 * }
 *
 * @errors
 * 400 { message: "date and title are required", errorCode: "MISSING_FIELDS" }
 * 400 { message: "Invalid date format", errorCode: "INVALID_DATE_FORMAT" }
 * 500 { message: "Server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const createHoliday = asyncHandler(async (req, res) => {
  const { date, title } = req.body;
  if (!date || !title) {
    throw new ValidationError("date and title are required");
  }
  const result = await createHolidayService(date, title);
  return sendCreated(res, { data: result, message: "Holiday stored successfully" });
});

/**
 * @function getHolidays
 *
 * @params
 * query: {
 *   type?: string // "all" | "past" | "upcoming", default: "all"
 * }
 *
 * @process
 * 1. Determine the current date in IST format.
 * 2. Fetch the logged-in employee using req.user.email.
 * 3. If employee not found or marked deleted, return 404 Employee not found.
 * 4. Fetch the EmployeeRecord for this employee.
 * 5. If no record found, return an empty holiday list.
 * 6. Iterate through the employee records:
 *    - Include only days where dayType includes "HOLIDAY".
 *    - Filter holidays based on the "type" query param:
 *       - "past": include only holidays before today.
 *       - "upcoming": include only holidays on/after today.
 *       - "all": include all holidays.
 *    - Map each holiday to { date, reason }.
 * 7. Sort the holidays by date in ascending order.
 * 8. Return the filtered and sorted holiday list.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "My holiday list fetched successfully",
 *   data: [
 *     { date: string, reason: string },
 *     ...
 *   ]
 * }
 *
 * @errors
 * 404 { message: "Employee not found", errorCode: "EMPLOYEE_NOT_FOUND" }
 * 500 { message: "Internal server error", errorCode: "INTERNAL_SERVER_ERROR" }
 */
export const getHolidays = asyncHandler(async (req, res) => {
  const { type = "all" } = req.query; // all | past | upcoming
  const employeeEmail = req.user.email;
  if (!employeeEmail) {
    throw new ValidationError("Employee email missing in request");
  }
  const holidays = await getHolidaysService(employeeEmail, type);
  return sendSuccess(res, { data: holidays, message: "My holiday list fetched successfully" });
});
