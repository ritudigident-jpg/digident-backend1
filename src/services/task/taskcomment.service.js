/**
 * Comments on a task, for both sides. An admin (task.manage.read) can read and write on every
 * task; an employee only on tasks assigned to them. Adding a comment also bumps the task's
 * commentCount and activity in the same transaction, and notifies the other people on the task.
 *
 * Used by: controllers/task/task.controller.js
 */
import Task from "../../models/task.model.js";
import TaskComment from "../../models/taskcomment.model.js";
import { ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { TASK_ACTIVITY, TASK_LIMITS, TASK_NOTIFICATION } from "../../constants/task.constants.js";
import { runInTransaction } from "../../helpers/transaction.helper.js";
import { findAssignedTask, findLiveTask, notifyTask } from "./taskcommon.service.js";
import { toPerson } from "./taskrules.js";

const PUBLIC_FIELDS = "-_id commentId taskId author isFromAdmin body createdAt updatedAt";
const PREVIEW_LENGTH = 80;

// The admin side may open any task; the employee side only an assigned one.
const loadTask = (taskId, { employee, isAdmin }) =>
  isAdmin ? findLiveTask(taskId) : findAssignedTask(taskId, employee._id);

/**
 * Every comment of a task, oldest first.
 *
 * @param {string} taskId
 * @param {{ employee: object, isAdmin: boolean }} access
 * @returns {Promise<object[]>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const listCommentsService = async (taskId, access) => {
  await loadTask(taskId, access);
  return TaskComment.find({ taskId, isDeleted: false }).select(PUBLIC_FIELDS).sort({ createdAt: 1 }).lean();
};

/**
 * Adds a comment and tells the assignees and the creator (except the author).
 *
 * @param {string} taskId
 * @param {string} body
 * @param {{ employee: object, isAdmin: boolean }} access
 * @returns {Promise<object>} The new comment.
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const addCommentService = async (taskId, body, access) => {
  const task = await loadTask(taskId, access);
  const author = toPerson(access.employee);
  const now = new Date();
  const comment = await runInTransaction(async (session) => {
    const [created] = await TaskComment.create([{ taskId, author, isFromAdmin: access.isAdmin, body }], {
      session,
    });
    await Task.updateOne(
      { taskId },
      {
        $inc: { commentCount: 1 },
        $push: {
          activity: {
            $each: [{ action: TASK_ACTIVITY.COMMENTED, message: "added a comment", by: author, at: now }],
            $slice: -TASK_LIMITS.ACTIVITY_MAX,
          },
        },
      },
      { session }
    );
    return created;
  });
  const preview = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}...` : body;
  await notifyTask({
    receivers: [...task.assignees.map((person) => person.employeeId), task.createdBy?.employeeId].filter(
      Boolean
    ),
    actor: author,
    type: TASK_NOTIFICATION.COMMENTED,
    title: `New comment on ${task.taskId}`,
    message: `${author.name}: ${preview}`,
    task,
  });
  return TaskComment.findById(comment._id).select(PUBLIC_FIELDS).lean();
};

/**
 * Removes a comment (soft delete). The author may remove their own; an admin may remove any.
 *
 * @param {string} taskId
 * @param {string} commentId
 * @param {{ employee: object, isAdmin: boolean }} access
 * @returns {Promise<{ commentId: string }>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND / TASK_COMMENT_NOT_FOUND
 * @throws {ForbiddenError} 403 FORBIDDEN when an employee removes someone else's comment.
 */
export const deleteCommentService = async (taskId, commentId, access) => {
  await loadTask(taskId, access);
  const comment = await TaskComment.findOne({ taskId, commentId, isDeleted: false });
  if (!comment) {
    throw new NotFoundError("Comment not found", { code: ERROR_CODES.TASK_COMMENT_NOT_FOUND });
  }
  if (!access.isAdmin && String(comment.author.employeeId) !== String(access.employee._id)) {
    throw new ForbiddenError("You can only remove your own comments", { code: ERROR_CODES.FORBIDDEN });
  }
  await runInTransaction(async (session) => {
    await TaskComment.updateOne(
      { _id: comment._id },
      { isDeleted: true, deletedAt: new Date() },
      { session }
    );
    await Task.updateOne({ taskId, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } }, { session });
  });
  return { commentId };
};
