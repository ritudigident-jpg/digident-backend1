/**
 * Business logic of the ADMIN task screens: create, list, view, edit, change status, review
 * (approve / request changes), delete, bulk actions, dashboard summary, and the assignee and tag
 * lookups the task form uses. Every function takes validated values and the acting employee, and
 * throws AppError subclasses. Employee-side logic is in taskemployee.service.js.
 *
 * Writes load the document and save() it (not updateOne) so the model hook keeps priorityRank and
 * completedAt correct; the bulk endpoint sets those fields itself.
 *
 * Used by: controllers/task/task.controller.js
 */
import Task, { TaskCounter } from "../../models/task.model.js";
import Employee from "../../models/employee.model.js";
import { BadRequestError, ConflictError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  BULK_ACTION,
  PRIORITY_RANK,
  REVIEW_DECISION,
  TASK_ACTIVITY,
  TASK_COUNTER_KEY,
  TASK_LIMITS,
  TASK_NOTIFICATION,
  TASK_STATUS,
} from "../../constants/task.constants.js";
import { isDuplicateKeyError } from "../../helpers/transaction.helper.js";
import {
  addActivity,
  buildSummary,
  findLiveTask,
  listTasksPage,
  notifyTask,
  toObjectId,
  todayKey,
  toPublicTask,
} from "./taskcommon.service.js";
import {
  buildTaskFilter,
  describeTaskChanges,
  diffAssignees,
  formatTaskId,
  mergeSubtasks,
  reviewDecisionError,
  statusAfterReview,
  statusLabel,
  toPerson,
} from "./taskrules.js";

const CREATE_ATTEMPTS = 3;
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Turns assignee ids into person snapshots, checking each is an active employee.
 * Example: ["66f...a1", "66f...b2"] -> [{ employeeId, name: "Priya Patel", email }, ...].
 *
 * @param {string[]} assigneeIds
 * @returns {Promise<Array<{ employeeId: *, name: string, email: string }>>}
 * @throws {BadRequestError} 400 TASK_ASSIGNEE_INVALID when an id is unknown or deleted.
 */
const resolveAssignees = async (assigneeIds = []) => {
  if (!assigneeIds.length) return [];
  const employees = await Employee.find({ _id: { $in: assigneeIds }, isDeleted: false })
    .select("_id firstName lastName email")
    .lean();
  const found = new Map(employees.map((employee) => [String(employee._id), employee]));
  const missing = assigneeIds.filter((id) => !found.has(String(id)));
  if (missing.length) {
    throw new BadRequestError("Some assignees are not active employees", {
      code: ERROR_CODES.TASK_ASSIGNEE_INVALID,
      details: missing.map((id) => ({ field: "assigneeIds", message: `Employee ${id} not found` })),
    });
  }
  return assigneeIds.map((id) => toPerson(found.get(String(id))));
};

const nextTaskId = async () => {
  const counter = await TaskCounter.findOneAndUpdate(
    { _id: TASK_COUNTER_KEY },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  ).lean();
  return formatTaskId(counter.seq);
};

const notifyNewAssignees = (task, employeeIds, actor) =>
  notifyTask({
    receivers: employeeIds,
    actor,
    type: TASK_NOTIFICATION.ASSIGNED,
    title: "New task assigned",
    message: `${actor.name} assigned you "${task.title}" (${task.taskId})${task.dueDate ? `, due ${task.dueDate}` : ""}`,
    task,
  });

/**
 * Creates a task with the next id (TSK-1001, TSK-1002 ...) and notifies the assignees.
 *
 * @param {object} data Validated body of POST /task/admin/tasks (assigneeIds instead of assignees).
 * @param {object} actor Person snapshot of the admin.
 * @returns {Promise<object>} The created task (detail shape).
 * @throws {BadRequestError} 400 TASK_ASSIGNEE_INVALID
 * @throws {ConflictError} 409 DUPLICATE_KEY if no free id was found (only after manual data edits).
 */
export const createTaskService = async ({ assigneeIds = [], subtasks = [], ...data }, actor) => {
  const assignees = await resolveAssignees(assigneeIds);
  // The counter alone prevents clashes; the retry only covers ids inserted by hand.
  for (let attempt = 1; attempt <= CREATE_ATTEMPTS; attempt += 1) {
    const task = new Task({
      ...data,
      taskId: await nextTaskId(),
      assignees,
      subtasks: mergeSubtasks([], subtasks, actor),
      createdBy: actor,
      updatedBy: actor,
    });
    addActivity(task, TASK_ACTIVITY.CREATED, "created this task", actor);
    try {
      await task.save();
    } catch (error) {
      if (isDuplicateKeyError(error) && attempt < CREATE_ATTEMPTS) continue;
      if (isDuplicateKeyError(error)) {
        throw new ConflictError("Could not allocate a task id, please retry", {
          code: ERROR_CODES.DUPLICATE_KEY,
          cause: error,
        });
      }
      throw error;
    }
    await notifyNewAssignees(
      task,
      assignees.map((person) => person.employeeId),
      actor
    );
    return toPublicTask(task.taskId);
  }
  return null;
};

/**
 * One page of all tasks with filters (status, priority, assignee, tag, search, view, due range).
 *
 * @param {object} query Validated query of GET /task/admin/tasks.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export const listTasksService = async (query) => {
  const filter = buildTaskFilter(
    { ...query, assignee: query.assignee ? toObjectId(query.assignee) : undefined },
    { todayKey: todayKey() }
  );
  return listTasksPage(filter, query);
};

/**
 * @param {string} taskId
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const getTaskService = (taskId) => toPublicTask(taskId);

/**
 * Edits a task. Only the fields sent change. Assignees are replaced by `assigneeIds` when sent;
 * newly added people are notified. The checklist keeps who ticked an item when its subtaskId is kept.
 *
 * @param {string} taskId
 * @param {object} data Validated body of PUT /task/admin/tasks/:taskId.
 * @param {object} actor
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 * @throws {BadRequestError} 400 TASK_ASSIGNEE_INVALID, or VALIDATION_ERROR when due date < start date.
 */
export const updateTaskService = async (taskId, { assigneeIds, subtasks, ...data }, actor) => {
  const task = await findLiveTask(taskId);
  const changes = { ...data };
  if (assigneeIds) changes.assignees = await resolveAssignees(assigneeIds);
  if (subtasks) changes.subtasks = mergeSubtasks(task.subtasks, subtasks, actor);

  const startDate = changes.startDate !== undefined ? changes.startDate : task.startDate;
  const dueDate = changes.dueDate !== undefined ? changes.dueDate : task.dueDate;
  if (startDate && dueDate && dueDate < startDate) {
    throw new BadRequestError("Due date cannot be before the start date", {
      code: ERROR_CODES.VALIDATION_ERROR,
      details: [{ field: "dueDate", message: "Due date cannot be before the start date" }],
    });
  }

  const entries = describeTaskChanges(task.toObject(), changes);
  const { added } = changes.assignees ? diffAssignees(task.assignees, changes.assignees) : { added: [] };
  task.set({ ...changes, updatedBy: actor });
  entries.forEach(([action, message]) => addActivity(task, action, message, actor));
  await task.save();
  if (added.length) await notifyNewAssignees(task, added, actor);
  return toPublicTask(taskId);
};

/**
 * Moves a task to any status (admins are not bound by the review workflow). Assignees are told.
 *
 * @param {string} taskId
 * @param {string} status
 * @param {object} actor
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const changeTaskStatusService = async (taskId, status, actor) => {
  const task = await findLiveTask(taskId);
  if (task.status === status) return toPublicTask(taskId);
  task.status = status;
  task.updatedBy = actor;
  addActivity(task, TASK_ACTIVITY.STATUS_CHANGED, `moved this to ${statusLabel(status)}`, actor);
  await task.save();
  await notifyTask({
    receivers: task.assignees.map((person) => person.employeeId),
    actor,
    type: TASK_NOTIFICATION.STATUS_CHANGED,
    title: "Task status changed",
    message: `${actor.name} moved "${task.title}" to ${statusLabel(status)}`,
    task,
  });
  return toPublicTask(taskId);
};

/**
 * Records the admin's decision on a submitted task: approve -> done, changes requested ->
 * back to in progress with the note shown to the assignee.
 *
 * @param {string} taskId
 * @param {{ decision: string, note?: string }} review
 * @param {object} actor
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 * @throws {ConflictError} 409 TASK_NOT_IN_REVIEW when the task is not waiting for review.
 * @throws {BadRequestError} 400 VALIDATION_ERROR when changes are requested without a note.
 */
export const reviewTaskService = async (taskId, { decision, note = "" }, actor) => {
  const task = await findLiveTask(taskId);
  const problem = reviewDecisionError(task, decision, note);
  if (problem?.code === "NOT_IN_REVIEW") {
    throw new ConflictError(problem.message, { code: ERROR_CODES.TASK_NOT_IN_REVIEW });
  }
  if (problem) {
    throw new BadRequestError(problem.message, {
      code: ERROR_CODES.VALIDATION_ERROR,
      details: [{ field: "note", message: problem.message }],
    });
  }
  const isApproved = decision === REVIEW_DECISION.APPROVE;
  task.status = statusAfterReview(decision);
  task.review = { ...task.review?.toObject?.(), reviewedAt: new Date(), reviewedBy: actor, decision, note };
  task.updatedBy = actor;
  addActivity(
    task,
    isApproved ? TASK_ACTIVITY.APPROVED : TASK_ACTIVITY.CHANGES_REQUESTED,
    isApproved ? "approved this task" : `requested changes: ${note}`,
    actor
  );
  await task.save();
  await notifyTask({
    receivers: task.assignees.map((person) => person.employeeId),
    actor,
    type: isApproved ? TASK_NOTIFICATION.APPROVED : TASK_NOTIFICATION.CHANGES_REQUESTED,
    title: isApproved ? "Task approved" : "Changes requested",
    message: isApproved
      ? `${actor.name} approved "${task.title}"`
      : `${actor.name} asked for changes on "${task.title}": ${note}`,
    task,
  });
  return toPublicTask(taskId);
};

/**
 * Soft-deletes a task (kept in the database with isDeleted = true).
 *
 * @param {string} taskId
 * @param {object} actor
 * @returns {Promise<{ taskId: string }>}
 * @throws {NotFoundError} 404 TASK_NOT_FOUND
 */
export const deleteTaskService = async (taskId, actor) => {
  const task = await findLiveTask(taskId);
  task.isDeleted = true;
  task.deletedAt = new Date();
  task.deletedBy = actor;
  task.updatedBy = actor;
  addActivity(task, TASK_ACTIVITY.DELETED, "deleted this task", actor);
  await task.save();
  return { taskId };
};

/**
 * Same change on many tasks at once (the list's "batch edit"). One updateMany, so it is atomic per
 * task; derived fields (priorityRank, completedAt) are set here because save() hooks do not run.
 * Example: { taskIds: ["TSK-1001", "TSK-1002"], action: "status", value: "done" } -> { matched: 2, modified: 2 }.
 *
 * @param {{ taskIds: string[], action: string, value?: string }} request
 * @param {object} actor
 * @returns {Promise<{ matched: number, modified: number }>}
 */
export const bulkUpdateTasksService = async ({ taskIds, action, value }, actor) => {
  const now = new Date();
  const filter = { taskId: { $in: taskIds }, isDeleted: false };
  let set = { updatedBy: actor };
  let entry;
  if (action === BULK_ACTION.STATUS) {
    set = { ...set, status: value, completedAt: value === TASK_STATUS.DONE ? now : null };
    entry = { action: TASK_ACTIVITY.STATUS_CHANGED, message: `moved this to ${statusLabel(value)}` };
    filter.status = { $ne: value };
  } else if (action === BULK_ACTION.PRIORITY) {
    set = { ...set, priority: value, priorityRank: PRIORITY_RANK[value] };
    entry = { action: TASK_ACTIVITY.UPDATED, message: "changed priority" };
    filter.priority = { $ne: value };
  } else {
    set = { ...set, isDeleted: true, deletedAt: now, deletedBy: actor };
    entry = { action: TASK_ACTIVITY.DELETED, message: "deleted this task" };
  }
  const result = await Task.updateMany(filter, {
    $set: set,
    $push: { activity: { $each: [{ ...entry, by: actor, at: now }], $slice: -TASK_LIMITS.ACTIVITY_MAX } },
  });
  return { matched: result.matchedCount, modified: result.modifiedCount };
};

/**
 * Admin dashboard: counts for every task plus the open workload per assignee.
 *
 * @returns {Promise<object>}
 */
export const getAdminSummaryService = () => buildSummary({}, { includeWorkload: true });

/**
 * Active employees for the assignee picker, matched on name, email or employee code.
 * Example: search "pri" -> [{ _id, employeeId: "EMP012", name: "Priya Patel", email, role: 3 }].
 *
 * @param {string} [search]
 * @returns {Promise<object[]>}
 */
export const searchAssigneesService = async (search = "") => {
  const filter = { isDeleted: false };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ firstName: pattern }, { lastName: pattern }, { email: pattern }, { employeeId: pattern }];
  }
  const employees = await Employee.find(filter)
    .select("_id employeeId firstName lastName email role")
    .sort({ firstName: 1, lastName: 1 })
    .limit(TASK_LIMITS.ASSIGNEE_LOOKUP_MAX)
    .lean();
  return employees.map((employee) => ({
    _id: employee._id,
    employeeId: employee.employeeId,
    name: toPerson(employee).name,
    email: employee.email,
    role: employee.role,
  }));
};

/**
 * Tags already in use, most used first, for the tag picker.
 *
 * @returns {Promise<Array<{ tag: string, count: number }>>}
 */
export const listTagsService = async () => {
  const rows = await Task.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: TASK_LIMITS.TAG_LOOKUP_MAX },
  ]);
  return rows.map((row) => ({ tag: row._id, count: row.count }));
};
