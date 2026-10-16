/**
 * Archives employees that were deleted more than 30 days ago (opt-in, see startEmployeeCleanupCron).
 */
import { scheduleJob } from "../helpers/cronjob.helper.js";
import Employee from "../models/employee.model.js";
import DeletedEmployee from "../models/deleteemployee.model.js";
import { logger } from "../helpers/logger.helper.js";

const ARCHIVE_AFTER_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every midnight: employees deleted more than ARCHIVE_AFTER_DAYS ago are copied to the
 * DeletedEmployee collection and removed from Employee.
 * NOTE: not started anywhere yet (app.js does not call it). Call it from startServer() to enable.
 */
export const startEmployeeCleanupCron = () =>
  scheduleJob("employee-cleanup", "0 0 * * *", async () => {
    const cutoffDate = new Date(Date.now() - ARCHIVE_AFTER_DAYS * DAY_MS);
    const employeesToArchive = await Employee.find({
      isDeleted: true,
      deletedAt: { $lte: cutoffDate },
    });
    for (const emp of employeesToArchive) {
      await DeletedEmployee.create({
        originalEmployeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        email: emp.email,
        personalEmail: emp.personalEmail,
        role: emp.role,
        permissions: emp.permissions,
        createdBy: emp.createdBy,
        isNewEmployee: emp.isNewEmployee,
        deletedAt: emp.deletedAt,
      });
      await Employee.deleteOne({ _id: emp._id });
    }
    logger.debug(`Archived ${employeesToArchive.length} deleted employees`);
  });
