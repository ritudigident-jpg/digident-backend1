/**
 * ONE-TIME MIGRATION to the per-day attendance model. Safe to run again (idempotent): it only
 * inserts what is missing and only fills fields that are still empty.
 *
 *   node scripts/migrateattendancedays.js                 dry run: prints what would change, saves nothing
 *   node scripts/migrateattendancedays.js --apply         saves
 *   options:  --shift-minutes=330   how far the old stored times are ahead of real UTC (default 330 = 5h30)
 *             --recompute           also recompute worked / expected / extra / status on every AttendanceDay
 *
 * What it does
 *   1. Holidays: admin-created holiday days in the old per-employee arrays (records with dayType
 *      HOLIDAY and recordId "HOLIDAY-<date>") -> one Holiday document per date. The automatic
 *      Sunday entries are skipped (Sundays are a rule now).
 *   2. Attendance: every old record with a punch-in -> one AttendanceDay (unique employee + date).
 *      The old code stored times 5h30 AHEAD of UTC (getISTNow); they are moved back so the database
 *      holds real UTC. The IST date of the record is kept as is. workedMinutes / expectedMinutes /
 *      extraMinutes / status are computed with the current rules. Days with no punch-out become
 *      MISSING_PUNCH_OUT (or keep their pending correction), old rejected corrections stay ABSENT.
 *   3. Punch-out correction requests: requestedPunchOutAt (real UTC) is filled from the old shifted
 *      requestedPunchOut string.
 *   4. Approved leave without per-day data: days are counted (Sundays / holidays skipped) and the
 *      paid quota is applied in date order per employee; totalDays / paidDays / unpaidDays / isPaid set.
 *   5. --apply also creates the indexes of the new collections (unique employee + date, one pending
 *      correction per day, unique holiday date ...).
 *
 * The old collection (EmployeeRecord) is NOT modified, so it stays as a backup.
 * Check the printed samples (old stored value -> new UTC -> IST) before running with --apply.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { EmployeeRecord } from "../src/models/attendance.model.js";
import AttendanceDay from "../src/models/attendanceday.model.js";
import Holiday from "../src/models/holiday.model.js";
import { AdminApproval } from "../src/models/attendanceapproval.model.js";
import PayrollSettings from "../src/models/payrollsettings.model.js";
import EmployeeProfile from "../src/models/employeeprofile.model.js";
import SalaryProfile from "../src/models/salaryprofile.model.js";
import EmployeeDocument from "../src/models/employeedocument.model.js";
import { PayrollMonth, PayrollSnapshot } from "../src/models/payrollmonth.model.js";
import { PAYROLL_SETTINGS_KEY } from "../src/constants/payrollsettings.constant.js";
import {
  allocatePaidLeave,
  classifyWorkedTime,
  countLeaveDays,
  isLatePunch,
  isWeeklyOff,
  mergeSettings,
  shiftMinutesFor,
} from "../src/services/attendance/attendancerules.js";
import { formatIst, istDateKey, minutesBetween, weekdayOf } from "../src/helpers/istdate.helper.js";

const APPLY = process.argv.includes("--apply");
const RECOMPUTE = process.argv.includes("--recompute");
const shiftArgument = process.argv.find((arg) => arg.startsWith("--shift-minutes="));
const SHIFT_MINUTES = shiftArgument ? Number(shiftArgument.split("=")[1]) : 330;
const URI = process.env.MONGODB_URI || process.env.MONGO_URI;
const SAMPLE_COUNT = 3;
const BATCH_SIZE = 500;

const toUtc = (stored) => (stored ? new Date(new Date(stored).getTime() - SHIFT_MINUTES * 60_000) : null);
const log = (...parts) => process.stdout.write(`${parts.join(" ")}\n`);

const flush = async (Model, ops, label) => {
  if (!ops.length) return 0;
  if (APPLY) {
    for (let index = 0; index < ops.length; index += BATCH_SIZE) {
      await Model.bulkWrite(ops.slice(index, index + BATCH_SIZE), { ordered: false });
    }
  }
  log(`  ${label}: ${ops.length} ${APPLY ? "written" : "(dry run)"}`);
  return ops.length;
};

/** Cached fields of a migrated day with a punch-out. */
const storedFields = (settings, holidayDates, date, punchIn, punchOut) => {
  const workedMinutes = minutesBetween(punchIn, punchOut);
  if (holidayDates.has(date) || isWeeklyOff(settings, date)) {
    return { workedMinutes, expectedMinutes: 0, extraMinutes: workedMinutes, status: "PRESENT" };
  }
  const expectedMinutes = shiftMinutesFor(settings, weekdayOf(date));
  const result = classifyWorkedTime(settings, workedMinutes, expectedMinutes);
  return { workedMinutes, expectedMinutes, extraMinutes: result.extraMinutes, status: result.status };
};

const run = async () => {
  if (!URI) throw new Error("Set MONGODB_URI");
  await mongoose.connect(URI);
  log(APPLY ? "APPLY mode - changes will be saved" : "DRY RUN - nothing is saved (add --apply to save)");
  log(`Old times are taken as ${SHIFT_MINUTES} minutes ahead of UTC.\n`);
  const settings = mergeSettings((await PayrollSettings.findOne({ key: PAYROLL_SETTINGS_KEY }).lean()) || {});
  const today = istDateKey();

  /* ---------- 1. Holidays ---------- */
  log("1. Holidays");
  const legacyDocs = await EmployeeRecord.find().lean();
  const holidayTitles = new Map();
  for (const doc of legacyDocs) {
    for (const record of doc.records || []) {
      if (record.dayType?.includes("HOLIDAY") && String(record.recordId).startsWith("HOLIDAY-")) {
        holidayTitles.set(record.date, record.leaveReason || "Holiday");
      }
    }
  }
  await flush(
    Holiday,
    [...holidayTitles].map(([date, title]) => ({
      updateOne: { filter: { date }, update: { $setOnInsert: { date, title, type: "PUBLIC" } }, upsert: true },
    })),
    "holiday dates found"
  );
  const holidayDates = new Set([...holidayTitles.keys(), ...(await Holiday.find().select("date").lean()).map((h) => h.date)]);

  /* ---------- 2. Attendance days ---------- */
  log("\n2. Attendance days");
  const attendanceOps = [];
  let samples = 0;
  for (const doc of legacyDocs) {
    for (const record of doc.records || []) {
      if (!record.punchIn) continue;
      const punchIn = toUtc(record.punchIn);
      const punchOut = toUtc(record.punchOut);
      if (punchOut && punchOut < punchIn) continue;
      const legacyStatus = record.status || [];
      let fields;
      if (punchOut) {
        fields = storedFields(settings, holidayDates, record.date, punchIn, punchOut);
      } else if (legacyStatus.includes("ABSENT")) {
        fields = { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, status: "ABSENT" };
      } else {
        fields = { workedMinutes: 0, expectedMinutes: 0, extraMinutes: 0, status: record.date < today ? "MISSING_PUNCH_OUT" : "OPEN" };
      }
      if (samples < SAMPLE_COUNT) {
        log(`  sample ${record.date}: stored ${new Date(record.punchIn).toISOString()} -> UTC ${punchIn.toISOString()} -> IST ${formatIst(punchIn)}`);
        samples += 1;
      }
      attendanceOps.push({
        updateOne: {
          filter: { employee: doc.employee, date: record.date },
          update: {
            $setOnInsert: {
              employee: doc.employee,
              date: record.date,
              recordId: record.recordId,
              punchIn,
              punchOut,
              isLate: isLatePunch(settings, punchIn),
              punchOutSource: punchOut ? "MIGRATION" : null,
              requiresAdminApproval: Boolean(record.requiresAdminApproval && !punchOut),
              adminAdjusted: Boolean(record.adminAdjusted),
              migratedFromRecordId: record.recordId,
              ...fields,
            },
          },
          upsert: true,
        },
      });
    }
  }
  await flush(AttendanceDay, attendanceOps, "attendance days (inserted only when missing)");

  if (RECOMPUTE) {
    const days = await AttendanceDay.find({ punchOut: { $ne: null } }).lean();
    await flush(
      AttendanceDay,
      days.map((day) => ({
        updateOne: { filter: { _id: day._id }, update: { $set: storedFields(settings, holidayDates, day.date, day.punchIn, day.punchOut) } },
      })),
      "attendance days recomputed"
    );
  }

  /* ---------- 3. Punch-out correction requests ---------- */
  log("\n3. Punch-out correction requests");
  const requests = await AdminApproval.find({ requestType: "FORGOT_PUNCH_OUT", requestedPunchOutAt: null }).lean();
  const requestOps = [];
  for (const request of requests) {
    const parsed = new Date(request.requestData?.requestedPunchOut);
    if (Number.isNaN(parsed.getTime())) continue;
    const actual = toUtc(parsed);
    requestOps.push({
      updateOne: {
        filter: { _id: request._id, requestedPunchOutAt: null },
        update: { $set: { requestedPunchOutAt: actual, "requestData.requestedPunchOutAt": actual.toISOString(), "requestData.tzNormalized": true } },
      },
    });
  }
  await flush(AdminApproval, requestOps, "requests normalised to UTC");

  /* ---------- 4. Approved leave without per-day data ---------- */
  log("\n4. Approved leave");
  const leaves = await AdminApproval.find({ requestType: "LEAVE", status: "APPROVED", "days.0": { $exists: false } })
    .sort({ "requestData.fromDate": 1 })
    .lean();
  const usedByEmployee = new Map();
  for (const leave of await AdminApproval.find({ requestType: "LEAVE", status: "APPROVED", "days.0": { $exists: true } }).lean()) {
    const used = usedByEmployee.get(String(leave.employee)) || {};
    for (const day of leave.days) used[day.date.slice(0, 7)] = (used[day.date.slice(0, 7)] || 0) + (day.paidFraction || 0);
    usedByEmployee.set(String(leave.employee), used);
  }
  const leaveOps = [];
  for (const leave of leaves) {
    const data = leave.requestData || {};
    const counted = countLeaveDays({
      fromDate: String(data.fromDate).slice(0, 10),
      toDate: String(data.toDate).slice(0, 10),
      leaveDuration: data.leaveDuration || "FULL_DAY",
      holidayDates,
      settings,
    });
    const used = usedByEmployee.get(String(leave.employee)) || {};
    const allocation = allocatePaidLeave({ days: counted.days, leaveType: data.leaveType, settings, usedByMonth: used });
    for (const day of allocation.days) used[day.date.slice(0, 7)] = (used[day.date.slice(0, 7)] || 0) + day.paidFraction;
    usedByEmployee.set(String(leave.employee), used);
    leaveOps.push({
      updateOne: {
        filter: { _id: leave._id, "days.0": { $exists: false } },
        update: {
          $set: {
            days: allocation.days,
            totalDays: counted.totalDays,
            paidDays: allocation.paidDays,
            unpaidDays: allocation.unpaidDays,
            isPaid: allocation.unpaidDays === 0 && allocation.paidDays > 0,
            "requestData.totalDays": counted.totalDays,
          },
        },
      },
    });
  }
  await flush(AdminApproval, leaveOps, "approved leaves given per-day paid data");

  /* ---------- 5. Indexes ---------- */
  if (APPLY) {
    log("\n5. Indexes");
    for (const Model of [AttendanceDay, Holiday, AdminApproval, PayrollSettings, SalaryProfile, PayrollMonth, PayrollSnapshot, EmployeeProfile, EmployeeDocument]) {
      try {
        await Model.createIndexes();
        log(`  ${Model.modelName}: ok`);
      } catch (error) {
        log(`  ${Model.modelName}: FAILED - ${error.message} (fix the duplicate data shown, then run again)`);
      }
    }
  }

  await mongoose.disconnect();
  log("\nDone.");
};

run().catch(async (error) => {
  process.stderr.write(`Migration failed: ${error.stack || error.message}\n`);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
