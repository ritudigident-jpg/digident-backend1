/**
 * Database helpers shared by the admin and the employee task services: load a task, check that an
 * employee is an assignee, page through a list, build the dashboard counts, turn a task into its
 * response shape and send task notifications.
 *
 * Exports: todayKey, addActivity, findLiveTask, findAssignedTask, toPublicTask, listTasksPage,
 * buildSummary, notifyTask, toObjectId
 * Used by: services/task/task.service.js, services/task/taskemployee.service.js,
 * services/task/taskcomment.service.js
 */
import mongoose from "mongoose";
import Task from "../../models/task.model.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  TASK_ENTITY_MODEL,
  TASK_LIMITS,
  TASK_STATUS,
  UPCOMING_DAYS,
} from "../../constants/task.constants.js";
import { addDays, istDateKey } from "../../helpers/istdate.helper.js";
import { logger } from "../../helpers/logger.helper.js";
import { sendNotification } from "../notification/notification.service.js";
import { buildTaskSort, decorateTask, shapeSummary } from "./taskrules.js";

const DAY_MS = 86_400_000;

// Left out of list rows: the long text and the activity log are only needed on the detail view.
const LIST_EXCLUDED_FIELDS = {
  activity: 0,
  description: 0,
  __v: 0,
  isDeleted: 0,
  deletedAt: 0,
  deletedBy: 0,
};
const DETAIL_EXCLUDED_FIELDS = "-__v -isDeleted -deletedAt -deletedBy";

/** Today's IST date key ("YYYY-MM-DD"). The one clock of the task module. */
export const todayKey = () => istDateKey(new Date());

/** String or ObjectId -> ObjectId (aggregate() $match does not cast like find() does). */
export const toObjectId = (value) => new mongoose.Types.ObjectId(String(value));

/**
 * Appends an activity entry and keeps only the newest TASK_LIMITS.ACTIVITY_MAX.
 *
 * @param {import("mongoose").Document} task
 * @param {string} action One of TASK_ACTIVITY.
 * @param {string} message e.g. "moved this to Done"
 * @param {object} actor Person snapshot.
 */
export const addActivity = (task, action, message, actor) => {
  task.activity.push({ action, message, by: actor, at: new Date() });
  if (task.activity.length > TASK_LIMITS.ACTIVITY_MAX) {
    task.activity = task.activity.slice(-TASK_LIMITS.ACTIVITY_MAX);
  }
};

const taskNotFound = (taskId) =>
  new NotFoundError(`Task ${taskId} not found`, { code: ERROR_CODES.TASK_NOT_FOUND });

/**
 * Loads a task that is not deleted, as a Mongoose document (so save() runs the model hooks).
 *
 * @param {string} taskId e.g. "TSK-1001"
 * @returns {Promise<import("mongoose").Document>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const findLiveTask = async (taskId) => {
  const task = await Task.findOne({ taskId, isDeleted: false });
  if (!task) throw taskNotFound(taskId);
  return task;
};

/**
 * Loads a task the employee is assigned to. A task of somebody else answers 404 (not 403), so an
 * employee cannot find out which task ids exist.
 *
 * @param {string} taskId
 * @param {*} employeeId Mongo _id of the employee.
 * @returns {Promise<import("mongoose").Document>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const findAssignedTask = async (taskId, employeeId) => {
  const task = await Task.findOne({ taskId, isDeleted: false, "assignees.employeeId": employeeId });
  if (!task) throw taskNotFound(taskId);
  return task;
};

/**
 * One task in the detail response shape: internal fields removed, newest activity first, and the
 * isOverdue / isDueToday / daysLeft / checklist flags added.
 *
 * @param {string} taskId
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const toPublicTask = async (taskId) => {
  const task = await Task.findOne({ taskId, isDeleted: false }).select(DETAIL_EXCLUDED_FIELDS).lean();
  if (!task) throw taskNotFound(taskId);
  task.activity = [...(task.activity || [])].reverse();
  return decorateTask(task, todayKey());
};

/**
 * One page of a task list.
 *
 * @param {object} filter From buildTaskFilter().
 * @param {{ page: number, limit: number, sortBy?: string, order?: string }} query
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const listTasksPage = async (filter, { page, limit, sortBy, order }) => {
  const pipeline = [
    { $match: filter },
    { $addFields: { hasNoDueDate: { $cond: [{ $ifNull: ["$dueDate", false] }, 0, 1] } } },
    { $sort: buildTaskSort(sortBy, order) },
    { $skip: (page - 1) * limit },
    { $limit: limit },
    { $project: { ...LIST_EXCLUDED_FIELDS, hasNoDueDate: 0 } },
  ];
  const [rows, total] = await Promise.all([Task.aggregate(pipeline), Task.countDocuments(filter)]);
  const today = todayKey();
  return { items: rows.map((row) => decorateTask(row, today)), total };
};

/**
 * Dashboard counts for the tasks matching `baseMatch` (all tasks for the admin, one assignee for
 * the employee): per status, open per priority, overdue, due today, upcoming (next 7 days),
 * completed in the last 7 days. With `includeWorkload`, also the open / overdue count per assignee.
 *
 * @param {object} baseMatch Extra conditions, e.g. { "assignees.employeeId": ObjectId }.
 * @param {{ includeWorkload?: boolean }} [options]
 * @returns {Promise<object>} See shapeSummary(); plus `workload` when requested.
 */
export const buildSummary = async (baseMatch = {}, { includeWorkload = false } = {}) => {
  const today = todayKey();
  const open = { status: { $ne: TASK_STATUS.DONE } };
  const countWhere = (match) => [{ $match: match }, { $count: "count" }];
  const facet = {
    byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
    openByPriority: [{ $match: open }, { $group: { _id: "$priority", count: { $sum: 1 } } }],
    overdue: countWhere({ ...open, dueDate: { $ne: null, $lt: today } }),
    dueToday: countWhere({ ...open, dueDate: today }),
    upcoming: countWhere({ ...open, dueDate: { $gt: today, $lte: addDays(today, UPCOMING_DAYS) } }),
    completedRecently: countWhere({
      status: TASK_STATUS.DONE,
      completedAt: { $gte: new Date(Date.now() - UPCOMING_DAYS * DAY_MS) },
    }),
  };
  if (includeWorkload) {
    facet.workload = [
      { $match: open },
      { $unwind: "$assignees" },
      {
        $group: {
          _id: "$assignees.employeeId",
          name: { $last: "$assignees.name" },
          email: { $last: "$assignees.email" },
          open: { $sum: 1 },
          inReview: { $sum: { $cond: [{ $eq: ["$status", TASK_STATUS.IN_REVIEW] }, 1, 0] } },
          overdue: {
            $sum: { $cond: [{ $and: [{ $ne: ["$dueDate", null] }, { $lt: ["$dueDate", today] }] }, 1, 0] },
          },
        },
      },
      { $sort: { open: -1, overdue: -1 } },
      { $limit: TASK_LIMITS.WORKLOAD_ROWS },
    ];
  }
  const [result = {}] = await Task.aggregate([
    { $match: { isDeleted: false, ...baseMatch } },
    { $facet: facet },
  ]);
  const summary = shapeSummary(result);
  if (includeWorkload) {
    summary.workload = (result.workload || []).map(({ _id, ...row }) => ({ employeeId: _id, ...row }));
  }
  return summary;
};

/**
 * Best-effort in-app notification (stored + pushed over Socket.IO). A failure is logged and never
 * fails the request: the task change itself is already saved.
 *
 * @param {object} params
 * @param {Array<*>} params.receivers Employee _ids. The actor is removed (nobody is notified of their own action).
 * @param {object} params.actor Person snapshot of who did it.
 * @param {string} params.type One of TASK_NOTIFICATION.
 * @param {string} params.title
 * @param {string} params.message
 * @param {{ taskId: string }} params.task
 */
export const notifyTask = async ({ receivers, actor, type, title, message, task }) => {
  const actorId = String(actor?.employeeId ?? "");
  const unique = [...new Set((receivers || []).map(String))].filter((id) => id && id !== actorId);
  if (!unique.length) return;
  try {
    await sendNotification({
      receivers: unique,
      sender: actor?.employeeId ?? null,
      title,
      message,
      type,
      entityId: task.taskId,
      entityModel: TASK_ENTITY_MODEL,
      metadata: { taskId: task.taskId },
    });
  } catch (error) {
    logger.error("Task notification failed", { type, taskId: task.taskId, error });
  }
};
