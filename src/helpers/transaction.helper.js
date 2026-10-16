/**
 * runInTransaction(): runs `work(session)` in a MongoDB transaction (start, commit, abort on error,
 * always end). Use it for writes to several documents that must succeed together, e.g. an approved
 * punch-out correction (request status + attendance day).
 *
 * Example:
 *   await runInTransaction(async (session) => {
 *     await AdminApproval.updateOne({ ... }, { ... }, { session });
 *     await AttendanceDay.updateOne({ ... }, { ... }, { session });
 *   });
 *
 * Used by: services/attendance/*, services/payroll/payroll.service.js
 */
import mongoose from "mongoose";

/**
 * @template T
 * @param {(session: import("mongoose").ClientSession) => Promise<T>} work
 * @returns {Promise<T>}
 */
export const runInTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    throw error;
  } finally {
    await session.endSession();
  }
};

/** True for a MongoDB duplicate-key error (unique index hit). */
export const isDuplicateKeyError = (error) => error?.code === 11000 || error?.cause?.code === 11000;
