/**
 * The task rules as pure functions (no database, no clock: "today" is passed in). Used by the
 * admin and employee task services so both sides follow the same rules. Unit tested in
 * tests/taskrules.test.js.
 *
 * The workflow:
 *   todo -> in_progress -> in_review (assignee submits) -> done (admin approves)
 *                              \-> in_progress (admin requests changes, with a note)
 *   A task with requiresReview = false can be marked done by the assignee directly.
 *   Admins can move a task to any status.
 *
 * Used by: services/task/task.service.js, services/task/taskemployee.service.js
 */
import {
  PRIORITY_RANK,
  REVIEW_DECISION,
  TASK_ID_PREFIX,
  TASK_NUMBER_START,
  TASK_SORT_FIELDS,
  TASK_STATUS,
  TASK_VIEW,
  TASK_ACTIVITY,
  UPCOMING_DAYS,
} from "../../constants/task.constants.js";
import { addDays } from "../../helpers/istdate.helper.js";

const STATUS_LABELS = Object.freeze({
  [TASK_STATUS.TODO]: "To Do",
  [TASK_STATUS.IN_PROGRESS]: "In Progress",
  [TASK_STATUS.IN_REVIEW]: "In Review",
  [TASK_STATUS.DONE]: "Done",
});

/** "in_review" -> "In Review" (for activity and notification text). */
export const statusLabel = (status) => STATUS_LABELS[status] || status;

const DAY_MS = 86_400_000;

const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Task id from the counter value. Example: 1 -> "TSK-1001" (counting starts after TASK_NUMBER_START).
 *
 * @param {number} sequence
 * @returns {string}
 */
export const formatTaskId = (sequence) => `${TASK_ID_PREFIX}${TASK_NUMBER_START + sequence}`;

/**
 * The person snapshot stored on a task from an Employee document.
 * Example: { _id, firstName: "Priya", lastName: "Patel", email } -> { employeeId, name: "Priya Patel", email }.
 *
 * @param {{ _id: *, firstName?: string, lastName?: string, email?: string }} employee
 * @returns {{ employeeId: *, name: string, email: string }}
 */
export const toPerson = (employee) => ({
  employeeId: employee._id,
  name: `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || employee.email || "",
  email: employee.email || "",
});

/** True when the task is assigned to this employee id. */
export const isAssignedTo = (task, employeeId) =>
  (task.assignees || []).some((person) => String(person.employeeId) === String(employeeId));

const OPEN = { status: { $ne: TASK_STATUS.DONE } };

/**
 * Conditions for a quick view. Today and the upcoming window are IST date keys.
 * Example (today "2026-10-22"): overdue -> { status: { $ne: "done" }, dueDate: { $ne: null, $lt: "2026-10-22" } }.
 *
 * @param {string} view One of TASK_VIEWS.
 * @param {string} todayKey "YYYY-MM-DD"
 * @returns {object | null} null for "all".
 */
export const viewCondition = (view, todayKey) => {
  switch (view) {
    case TASK_VIEW.OPEN:
      return OPEN;
    case TASK_VIEW.DUE_TODAY:
      return { ...OPEN, dueDate: todayKey };
    case TASK_VIEW.OVERDUE:
      return { ...OPEN, dueDate: { $ne: null, $lt: todayKey } };
    case TASK_VIEW.UPCOMING:
      return { ...OPEN, dueDate: { $gt: todayKey, $lte: addDays(todayKey, UPCOMING_DAYS) } };
    case TASK_VIEW.IN_REVIEW:
      return { status: TASK_STATUS.IN_REVIEW };
    case TASK_VIEW.COMPLETED:
      return { status: TASK_STATUS.DONE };
    default:
      return null;
  }
};

/**
 * MongoDB filter for the task lists. Every condition is added to one $and, so filters combine
 * (e.g. status=in_progress + view=overdue = overdue tasks that are in progress).
 *
 * @param {object} query Validated list query (see listTasksQuerySchema).
 * @param {object} context
 * @param {string} context.todayKey IST date key of today.
 * @param {*} [context.assigneeId] Forces the list to one assignee (the employee's "my tasks").
 * @returns {object}
 */
export const buildTaskFilter = (query, { todayKey, assigneeId } = {}) => {
  const conditions = [{ isDeleted: false }];
  const assignee = assigneeId ?? query.assignee;
  if (assignee) conditions.push({ "assignees.employeeId": assignee });
  if (query.status?.length) conditions.push({ status: { $in: query.status } });
  if (query.priority?.length) conditions.push({ priority: { $in: query.priority } });
  if (query.tag) conditions.push({ tags: query.tag });
  if (query.dueFrom) conditions.push({ dueDate: { $gte: query.dueFrom } });
  if (query.dueTo) conditions.push({ dueDate: { $ne: null, $lte: query.dueTo } });
  const view = viewCondition(query.view, todayKey);
  if (view) conditions.push(view);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), "i");
    conditions.push({
      $or: [{ title: pattern }, { taskId: pattern }, { tags: pattern }, { "assignees.name": pattern }],
    });
  }
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
};

/**
 * Sort for the lists. Tasks without a due date always go last when sorting by due date
 * (MongoDB would put null first), so the pipeline sorts on a "has no due date" flag first.
 *
 * @param {string} [sortBy="dueDate"]
 * @param {"asc" | "desc"} [order="asc"]
 * @returns {object} $sort stage body.
 */
export const buildTaskSort = (sortBy = "dueDate", order = "asc") => {
  const direction = order === "desc" ? -1 : 1;
  const field = TASK_SORT_FIELDS[sortBy] || TASK_SORT_FIELDS.dueDate;
  if (field === "dueDate") return { hasNoDueDate: 1, dueDate: direction, priorityRank: 1, createdAt: -1 };
  return { [field]: direction, createdAt: -1 };
};

/**
 * Why the assignee may not move their task to `nextStatus`, or null when allowed.
 *   - a done task is closed for the assignee (an admin reopens it);
 *   - a task that needs review cannot be marked done by the assignee (submit it instead);
 *   - a task that needs no review has no "in review" step.
 * Example: { status: "in_progress", requiresReview: true } -> "done" -> reason; -> "in_review" -> null.
 *
 * @param {{ status: string, requiresReview?: boolean }} task
 * @param {string} nextStatus
 * @returns {string | null}
 */
export const employeeStatusChangeError = (task, nextStatus) => {
  if (task.status === nextStatus) return null;
  if (task.status === TASK_STATUS.DONE) {
    return "This task is already completed. Ask an admin to reopen it.";
  }
  const needsReview = task.requiresReview !== false;
  if (nextStatus === TASK_STATUS.DONE && needsReview) {
    return "This task needs an admin review. Submit it for review instead of marking it done.";
  }
  if (nextStatus === TASK_STATUS.IN_REVIEW && !needsReview) {
    return "This task does not need a review. Mark it done instead.";
  }
  return null;
};

/**
 * Why the admin may not record this review decision, or null when allowed.
 * Example: status "in_progress" -> "Only tasks in review can be approved or sent back".
 *
 * @param {{ status: string }} task
 * @param {string} decision One of REVIEW_DECISIONS.
 * @param {string} [note]
 * @returns {{ code: "NOT_IN_REVIEW" | "NOTE_REQUIRED", message: string } | null}
 */
export const reviewDecisionError = (task, decision, note = "") => {
  if (task.status !== TASK_STATUS.IN_REVIEW) {
    return { code: "NOT_IN_REVIEW", message: "Only tasks in review can be approved or sent back" };
  }
  if (decision === REVIEW_DECISION.CHANGES_REQUESTED && !String(note).trim()) {
    return { code: "NOTE_REQUIRED", message: "Tell the assignee what to change" };
  }
  return null;
};

/** Status after a review decision: approve -> done, changes requested -> in progress. */
export const statusAfterReview = (decision) =>
  decision === REVIEW_DECISION.APPROVE ? TASK_STATUS.DONE : TASK_STATUS.IN_PROGRESS;

/**
 * Employee ids added and removed between two assignee lists.
 * Example: [a, b] -> [b, c] gives { added: ["c"], removed: ["a"] }.
 *
 * @param {Array<{ employeeId: * }>} before
 * @param {Array<{ employeeId: * }>} after
 * @returns {{ added: string[], removed: string[] }}
 */
export const diffAssignees = (before = [], after = []) => {
  const beforeIds = new Set(before.map((person) => String(person.employeeId)));
  const afterIds = new Set(after.map((person) => String(person.employeeId)));
  return {
    added: [...afterIds].filter((id) => !beforeIds.has(id)),
    removed: [...beforeIds].filter((id) => !afterIds.has(id)),
  };
};

const FIELD_LABELS = Object.freeze({
  title: "title",
  description: "description",
  priority: "priority",
  tags: "tags",
  startDate: "start date",
  dueDate: "due date",
  estimateMinutes: "estimate",
  subtasks: "checklist",
  requiresReview: "review setting",
});

const sameValue = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * Activity entries for an admin edit: one per kind of change, only for fields that really changed.
 * Example: { status: "done", dueDate: "2026-10-30" } on a todo task due 2026-10-25 ->
 *   [["status_changed", "moved this to Done"], ["updated", "changed due date"]].
 *
 * @param {object} task Current task (plain object or document).
 * @param {object} changes Validated update (assignees already resolved to snapshots).
 * @returns {Array<[string, string]>} [action, message] pairs.
 */
export const describeTaskChanges = (task, changes) => {
  const entries = [];
  if (changes.status && changes.status !== task.status) {
    entries.push([TASK_ACTIVITY.STATUS_CHANGED, `moved this to ${statusLabel(changes.status)}`]);
  }
  if (changes.assignees) {
    const { added, removed } = diffAssignees(task.assignees, changes.assignees);
    if (added.length || removed.length)
      entries.push([TASK_ACTIVITY.ASSIGNEES_CHANGED, "changed the assignees"]);
  }
  const changedFields = Object.keys(FIELD_LABELS).filter((field) => {
    if (!(field in changes)) return false;
    if (field === "subtasks") {
      const shape = (list) => (list || []).map((item) => [item.title, Boolean(item.isDone)]);
      return !sameValue(shape(task.subtasks), shape(changes.subtasks));
    }
    return !sameValue(task[field], changes[field]);
  });
  if (changedFields.length) {
    entries.push([
      TASK_ACTIVITY.UPDATED,
      `changed ${changedFields.map((field) => FIELD_LABELS[field]).join(", ")}`,
    ]);
  }
  return entries;
};

/**
 * Merges a checklist sent by the admin with the stored one: items that keep their subtaskId keep
 * who ticked them and when; new items get a fresh id from the model default.
 *
 * @param {Array<object>} stored
 * @param {Array<{ subtaskId?: string, title: string, isDone?: boolean }>} incoming
 * @param {object} actor Person snapshot of the admin.
 * @param {Date} now
 * @returns {Array<object>}
 */
export const mergeSubtasks = (stored = [], incoming = [], actor = null, now = new Date()) => {
  const byId = new Map(stored.map((item) => [item.subtaskId, item]));
  return incoming.map((item) => {
    const previous = item.subtaskId ? byId.get(item.subtaskId) : null;
    const isDone = Boolean(item.isDone);
    const keepDone = previous && previous.isDone === isDone;
    return {
      ...(previous ? { subtaskId: previous.subtaskId } : {}),
      title: item.title,
      isDone,
      doneAt: isDone ? (keepDone ? previous.doneAt : now) : null,
      doneBy: isDone ? (keepDone ? previous.doneBy : actor) : null,
    };
  });
};

/**
 * Adds the flags every screen needs, computed on the server with the IST date.
 * Example (today "2026-10-22"): due "2026-10-20", status "todo" -> isOverdue true, daysLeft -2.
 *
 * @param {object} task Plain task object.
 * @param {string} todayKey
 * @returns {object} The task with isOverdue, isDueToday, daysLeft and checklist { done, total }.
 */
export const decorateTask = (task, todayKey) => {
  const isOpen = task.status !== TASK_STATUS.DONE;
  const dueDate = task.dueDate || null;
  const daysLeft = dueDate
    ? Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY_MS)
    : null;
  const subtasks = task.subtasks || [];
  return {
    ...task,
    isOverdue: Boolean(isOpen && dueDate && dueDate < todayKey),
    isDueToday: Boolean(isOpen && dueDate === todayKey),
    daysLeft,
    checklist: { done: subtasks.filter((item) => item.isDone).length, total: subtasks.length },
  };
};

/**
 * Turns the $facet result of the summary pipeline into the response shape, with every status and
 * priority present (0 when there are none).
 *
 * @param {object} facet { byStatus: [{ _id, count }], openByPriority: [...], overdue: [{ count }], ... }
 * @returns {object}
 */
export const shapeSummary = (facet = {}) => {
  const countOf = (rows) => rows?.[0]?.count ?? 0;
  const byStatus = Object.fromEntries(Object.values(TASK_STATUS).map((status) => [status, 0]));
  (facet.byStatus || []).forEach((row) => {
    if (row._id in byStatus) byStatus[row._id] = row.count;
  });
  const openByPriority = Object.fromEntries(Object.keys(PRIORITY_RANK).map((priority) => [priority, 0]));
  (facet.openByPriority || []).forEach((row) => {
    if (row._id in openByPriority) openByPriority[row._id] = row.count;
  });
  const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
  const open = total - byStatus[TASK_STATUS.DONE];
  return {
    total,
    open,
    byStatus,
    openByPriority,
    overdue: countOf(facet.overdue),
    dueToday: countOf(facet.dueToday),
    upcoming: countOf(facet.upcoming),
    inReview: byStatus[TASK_STATUS.IN_REVIEW],
    completedLast7Days: countOf(facet.completedRecently),
    completionRate: total ? Math.round((byStatus[TASK_STATUS.DONE] / total) * 100) : 0,
  };
};
