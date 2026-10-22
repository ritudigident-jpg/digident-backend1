/**
 * Business logic of the EMPLOYEE task screens ("My tasks"): list and view the tasks assigned to
 * me, my dashboard counts, move my task through the workflow (start, submit for review, mark done
 * when no review is needed) and tick checklist items. An employee only ever sees tasks they are
 * assigned to; any other task id answers 404.
 *
 * Used by: controllers/task/task.controller.js
 */
import { ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { TASK_ACTIVITY, TASK_NOTIFICATION, TASK_STATUS } from "../../constants/task.constants.js";
import {
  addActivity,
  buildSummary,
  findAssignedTask,
  listTasksPage,
  notifyTask,
  toObjectId,
  todayKey,
  toPublicTask,
} from "./taskcommon.service.js";
import { buildTaskFilter, employeeStatusChangeError, statusLabel, toPerson } from "./taskrules.js";

/**
 * One page of my tasks. Same filters as the admin list except `assignee` (always me).
 *
 * @param {{ _id: * }} employee req.currentUser
 * @param {object} query Validated query of GET /task/my/tasks.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const listMyTasksService = async (employee, query) => {
  const filter = buildTaskFilter(query, { todayKey: todayKey(), assigneeId: toObjectId(employee._id) });
  return listTasksPage(filter, query);
};

/**
 * @param {{ _id: * }} employee
 * @param {string} taskId
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND when missing or not assigned to me.
 */
export const getMyTaskService = async (employee, taskId) => {
  await findAssignedTask(taskId, employee._id);
  return toPublicTask(taskId);
};

/**
 * My dashboard counts (per status, overdue, due today, upcoming, completed last 7 days).
 *
 * @param {{ _id: * }} employee
 * @returns {Promise<object>}
 */
export const getMySummaryService = (employee) =>
  buildSummary({ "assignees.employeeId": toObjectId(employee._id) });

/**
 * Moves my task to another status, following the workflow (see taskrules.employeeStatusChangeError).
 * Submitting for review stores who submitted and an optional note, and tells the task's creator.
 * Example: in_progress -> in_review with note "PR #42 ready" -> creator gets "Task submitted for review".
 *
 * @param {object} employee req.currentUser
 * @param {string} taskId
 * @param {{ status: string, note?: string }} change
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 * @throws {ForbiddenError} 403 TASK_STATUS_NOT_ALLOWED when the workflow does not allow the move.
 */
export const changeMyTaskStatusService = async (employee, taskId, { status, note = "" }) => {
  const task = await findAssignedTask(taskId, employee._id);
  const problem = employeeStatusChangeError(task, status);
  if (problem) throw new ForbiddenError(problem, { code: ERROR_CODES.TASK_STATUS_NOT_ALLOWED });
  if (task.status === status) return toPublicTask(taskId);

  const actor = toPerson(employee);
  const isSubmit = status === TASK_STATUS.IN_REVIEW;
  task.status = status;
  task.updatedBy = actor;
  if (isSubmit) {
    task.review = {
      submittedAt: new Date(),
      submittedBy: actor,
      reviewedAt: null,
      reviewedBy: null,
      decision: null,
      note,
    };
    addActivity(
      task,
      TASK_ACTIVITY.SUBMITTED_FOR_REVIEW,
      note ? `submitted for review: ${note}` : "submitted for review",
      actor
    );
  } else {
    addActivity(task, TASK_ACTIVITY.STATUS_CHANGED, `moved this to ${statusLabel(status)}`, actor);
  }
  await task.save();

  if (task.createdBy?.employeeId) {
    await notifyTask({
      receivers: [task.createdBy.employeeId],
      actor,
      type: isSubmit ? TASK_NOTIFICATION.SUBMITTED : TASK_NOTIFICATION.STATUS_CHANGED,
      title: isSubmit ? "Task submitted for review" : "Task status changed",
      message: isSubmit
        ? `${actor.name} submitted "${task.title}" (${task.taskId}) for review`
        : `${actor.name} moved "${task.title}" to ${statusLabel(status)}`,
      task,
    });
  }
  return toPublicTask(taskId);
};

/**
 * Ticks or unticks one checklist item of my task. Not allowed once the task is done.
 *
 * @param {object} employee
 * @param {string} taskId
 * @param {string} subtaskId
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND / SUBTASK_NOT_FOUND
 * @throws {ForbiddenError} 403 TASK_STATUS_NOT_ALLOWED when the task is done.
 */
export const toggleMySubtaskService = async (employee, taskId, subtaskId) => {
  const task = await findAssignedTask(taskId, employee._id);
  if (task.status === TASK_STATUS.DONE) {
    throw new ForbiddenError("This task is completed; its checklist can no longer change", {
      code: ERROR_CODES.TASK_STATUS_NOT_ALLOWED,
    });
  }
  const subtask = task.subtasks.find((item) => item.subtaskId === subtaskId);
  if (!subtask) {
    throw new NotFoundError(`Checklist item ${subtaskId} not found`, { code: ERROR_CODES.SUBTASK_NOT_FOUND });
  }
  const actor = toPerson(employee);
  subtask.isDone = !subtask.isDone;
  subtask.doneAt = subtask.isDone ? new Date() : null;
  subtask.doneBy = subtask.isDone ? actor : null;
  task.updatedBy = actor;
  addActivity(
    task,
    TASK_ACTIVITY.SUBTASK_TOGGLED,
    `${subtask.isDone ? "completed" : "reopened"} "${subtask.title}"`,
    actor
  );
  await task.save();
  return toPublicTask(taskId);
};
