/**
 * Daily at 19:00 India time: every employee without an attendance record for today gets an ABSENT record.
 *
 * Started by: app.js (autoAbsentCronJob)
 */
import { scheduleJob } from "../helpers/cronjob.helper.js";
import { v6 as uuidv6 } from "uuid";
import { EmployeeRecord } from "../models/attendance.model.js";
import { logger } from "../helpers/logger.helper.js";

export const autoAbsentCronJob = () => {
  const getISTDate = () => {
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return istNow.toISOString().split("T")[0]; // YYYY-MM-DD
  };
  scheduleJob(
    "auto-mark-absent",
    "0 0 19 * * *", // 7:00 PM IST daily
    async () => {
      logger.debug("Running Auto Absent Cron Job...");
      const today = getISTDate();
      const allEmployeeRecords = await EmployeeRecord.find();
      if (!allEmployeeRecords.length) {
        logger.debug("No Employee Records Found. Skipping...");
        return;
      }
      let updatedCount = 0;
      for (const empRecord of allEmployeeRecords) {
        if (!empRecord.records) {
          empRecord.records = [];
        }

        const todayRecord = empRecord.records.find((r) => r.date === today);

        if (todayRecord) {
          logger.debug("Already Exists");
          continue;
        }

        logger.debug("ADDING ABSENT FOR", { today });

        empRecord.records.push({
          recordId: uuidv6(),
          date: today,
          dayType: ["WORKING"],
          punchIn: null,
          punchOut: null,
          status: ["ABSENT"],
          totalWorkedTime: {
            hours: 0,
            minutes: 0,
          },
          leaveType: null,
          leaveDuration: null,
          fromDate: null,
          toDate: null,
          leaveStatus: null,
          leaveReason: null,
          requiresAdminApproval: false,
          adminAdjusted: false,
        });

        // IMPORTANT
        empRecord.markModified("records");

        await empRecord.save();

        logger.debug("SAVED SUCCESSFULLY");

        updatedCount++;
      }
      logger.debug(`Auto Absent Cron Completed | Date: ${today} | Absent Marked: ${updatedCount}`);
    },
    {
      timezone: "Asia/Kolkata",
    }
  );
};
