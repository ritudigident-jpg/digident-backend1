/**
 * Daily at 23:55 India time: every attendance day that still has a punch-in but no punch-out
 * (today, or an earlier day the job missed) is marked MISSING_PUNCH_OUT, and the employee gets a
 * notification asking for a correction request. Absence is no longer written as a record: a past
 * working day without a punch-in is ABSENT by rule (services/attendance/attendancerules.js), so
 * the old 19:00 "auto mark absent" job (which ran before an 8-hour day could even end) is retired.
 *
 * Started by: app.js (endOfDayCronJob). Also runnable on its own: markMissingPunchOuts().
 */
import { scheduleJob } from "../helpers/cronjob.helper.js";
import AttendanceDay from "../models/attendanceday.model.js";
import { ATTENDANCE_STATUS } from "../constants/payrollsettings.constant.js";
import { istDateKey, nowUtc } from "../helpers/istdate.helper.js";
import { sendNotification } from "../services/notification/notification.service.js";
import { logger } from "../helpers/logger.helper.js";

const END_OF_DAY_CRON = "0 55 23 * * *"; // 23:55:00 IST every day

/**
 * Marks open sessions up to and including `untilDate` as MISSING_PUNCH_OUT.
 *
 * @param {string} [untilDate] IST date key, default today
 * @returns {Promise<{ marked: number }>}
 */
export const markMissingPunchOuts = async (untilDate = istDateKey(nowUtc())) => {
  const open = await AttendanceDay.find({
    date: { $lte: untilDate },
    punchOut: null,
    status: ATTENDANCE_STATUS.OPEN,
  })
    .select("_id employee date")
    .lean();
  if (!open.length) return { marked: 0 };

  const result = await AttendanceDay.updateMany(
    { _id: { $in: open.map((day) => day._id) }, punchOut: null, status: ATTENDANCE_STATUS.OPEN },
    { $set: { status: ATTENDANCE_STATUS.MISSING_PUNCH_OUT } }
  );

  for (const day of open) {
    try {
      await sendNotification({
        receivers: [day.employee],
        title: "Missing Punch-Out",
        message: `You did not punch out on ${day.date}. Please request a punch-out correction.`,
        type: "MISSING_PUNCH_OUT",
        entityId: String(day._id),
        entityModel: "AttendanceDay",
        metadata: { date: day.date },
      });
    } catch (error) {
      logger.error("Missing punch-out notification failed", { attendanceId: day._id, error });
    }
  }
  return { marked: result.modifiedCount };
};

export const endOfDayCronJob = () => {
  scheduleJob(
    "end-of-day-attendance",
    END_OF_DAY_CRON,
    async () => {
      const { marked } = await markMissingPunchOuts();
      logger.info("End-of-day attendance", { date: istDateKey(nowUtc()), missingPunchOutMarked: marked });
    },
    { timezone: "Asia/Kolkata" }
  );
};
