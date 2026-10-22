/**
 * Fixed values for the task module: statuses, priorities, activity types, limits, sort fields and
 * notification types. Permission names live in constants/permissions.constant.js (TASK_*).
 *
 * Used by: models/task.model.js, models/taskcomment.model.js, controllers/task/task.validator.js,
 * services/task/*.js
 */

export const TASK_STATUS = Object.freeze({
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  DONE: "done",
});
export const TASK_STATUSES = Object.freeze(Object.values(TASK_STATUS));

export const TASK_PRIORITY = Object.freeze({
  URGENT: "urgent",
  HIGH: "high",
  NORMAL: "normal",
  LOW: "low",
});
export const TASK_PRIORITIES = Object.freeze(Object.values(TASK_PRIORITY));

// Lower number = more important. Stored on the task so lists can sort by priority.
export const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1, normal: 2, low: 3 });

/** Result of an admin review of a task the assignee submitted (status in_review). */
export const REVIEW_DECISION = Object.freeze({
  APPROVE: "approve",
  CHANGES_REQUESTED: "changes_requested",
});
export const REVIEW_DECISIONS = Object.freeze(Object.values(REVIEW_DECISION));

/** Actions of the admin bulk endpoint. */
export const BULK_ACTION = Object.freeze({
  STATUS: "status",
  PRIORITY: "priority",
  DELETE: "delete",
});
export const BULK_ACTIONS = Object.freeze(Object.values(BULK_ACTION));

export const TASK_ACTIVITY = Object.freeze({
  CREATED: "created",
  UPDATED: "updated",
  STATUS_CHANGED: "status_changed",
  ASSIGNEES_CHANGED: "assignees_changed",
  SUBTASK_TOGGLED: "subtask_toggled",
  SUBMITTED_FOR_REVIEW: "submitted_for_review",
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DELETED: "deleted",
});

export const TASK_LIMITS = Object.freeze({
  TITLE_MAX: 200,
  DESCRIPTION_MAX: 5000,
  TAG_MAX_LENGTH: 30,
  TAGS_MAX: 10,
  ASSIGNEES_MAX: 20,
  SUBTASKS_MAX: 50,
  SUBTASK_TITLE_MAX: 200,
  ESTIMATE_MAX_MINUTES: 100_000,
  COMMENT_MAX: 2000,
  REVIEW_NOTE_MAX: 1000,
  // Only the newest activity entries are kept so a task document never grows without bound.
  ACTIVITY_MAX: 100,
  PAGE_LIMIT_DEFAULT: 25,
  PAGE_LIMIT_MAX: 100,
  BULK_MAX: 100,
  ASSIGNEE_LOOKUP_MAX: 20,
  TAG_LOOKUP_MAX: 50,
  WORKLOAD_ROWS: 8,
  SEARCH_MAX: 100,
});

/** Query value of sortBy -> stored field. */
export const TASK_SORT_FIELDS = Object.freeze({
  dueDate: "dueDate",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  priority: "priorityRank",
  title: "title",
  status: "status",
});

/** Status an assignee may move their own task to (done only when the task needs no review). */
export const EMPLOYEE_SETTABLE_STATUSES = Object.freeze([
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.IN_REVIEW,
  TASK_STATUS.DONE,
]);

/** Quick views of the list endpoints (?view=). */
export const TASK_VIEW = Object.freeze({
  ALL: "all",
  OPEN: "open",
  DUE_TODAY: "due_today",
  OVERDUE: "overdue",
  UPCOMING: "upcoming",
  IN_REVIEW: "in_review",
  COMPLETED: "completed",
});
export const TASK_VIEWS = Object.freeze(Object.values(TASK_VIEW));

/** Days ahead that count as "upcoming" / "due this week". */
export const UPCOMING_DAYS = 7;

export const TASK_ID_PREFIX = "TSK-";
// First number handed out is TASK_NUMBER_START + 1 (TSK-1001), so ids look the same width early on.
export const TASK_NUMBER_START = 1000;
export const TASK_COUNTER_KEY = "task";

/** `type` of in-app notifications sent by the task module. */
export const TASK_NOTIFICATION = Object.freeze({
  ASSIGNED: "TASK_ASSIGNED",
  SUBMITTED: "TASK_SUBMITTED_FOR_REVIEW",
  APPROVED: "TASK_APPROVED",
  CHANGES_REQUESTED: "TASK_CHANGES_REQUESTED",
  COMMENTED: "TASK_COMMENTED",
  STATUS_CHANGED: "TASK_STATUS_CHANGED",
});
export const TASK_ENTITY_MODEL = "Task";
