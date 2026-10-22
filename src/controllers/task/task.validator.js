/**
 * Joi schemas for the task endpoints (admin and employee). Applied in routes/task.routes.js with
 * validate(schema, source) before the controller runs. Unknown keys are removed, so a client that
 * sends `assignees`, `taskId`, `createdBy` or `permission` simply has them dropped.
 *
 * Dates are IST calendar dates "YYYY-MM-DD" (see models/task.model.js). List filters that accept
 * several values take a comma-separated string: ?status=todo,in_progress
 *
 * Used by: routes/task.routes.js
 */
import Joi from "joi";
import { objectId } from "../../middlewares/validate.middleware.js";
import {
  BULK_ACTION,
  BULK_ACTIONS,
  REVIEW_DECISION,
  REVIEW_DECISIONS,
  TASK_LIMITS,
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  TASK_VIEW,
  TASK_VIEWS,
} from "../../constants/task.constants.js";
import { isValidDateKey } from "../../helpers/istdate.helper.js";

const TASK_ID_PATTERN = /^TSK-\d+$/;
// subtaskId / commentId are uuid v6 strings (36 characters); 64 leaves room without allowing junk.
const CHILD_ID_MAX = 64;

const dateKey = () =>
  Joi.string()
    .custom((value, helpers) => (isValidDateKey(value) ? value : helpers.error("any.invalid")))
    .messages({ "any.invalid": "{{#label}} must be a date like 2026-10-22" });

/** "todo,in_progress" -> ["todo", "in_progress"]; every item must be one of `allowed`. */
const csvOf = (allowed) =>
  Joi.alternatives().try(
    Joi.array().items(Joi.string().valid(...allowed)),
    Joi.string().custom((value, helpers) => {
      const items = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const unknown = items.find((item) => !allowed.includes(item));
      return unknown ? helpers.message(`"${unknown}" is not one of ${allowed.join(", ")}`) : items;
    })
  );

const tags = () =>
  Joi.array()
    .items(Joi.string().trim().max(TASK_LIMITS.TAG_MAX_LENGTH))
    .max(TASK_LIMITS.TAGS_MAX)
    .unique((left, right) => left.toLowerCase() === right.toLowerCase())
    .messages({ "array.unique": "Each tag can only be added once" });

const subtasks = () =>
  Joi.array()
    .items(
      Joi.object({
        subtaskId: Joi.string().trim().max(CHILD_ID_MAX),
        title: Joi.string().trim().min(1).max(TASK_LIMITS.SUBTASK_TITLE_MAX).required(),
        isDone: Joi.boolean().default(false),
      })
    )
    .max(TASK_LIMITS.SUBTASKS_MAX);

// Shared by create and update; create marks title as required.
const taskFields = {
  title: Joi.string().trim().min(1).max(TASK_LIMITS.TITLE_MAX),
  description: Joi.string().trim().allow("").max(TASK_LIMITS.DESCRIPTION_MAX),
  status: Joi.string().valid(...TASK_STATUSES),
  priority: Joi.string().valid(...TASK_PRIORITIES),
  tags: tags(),
  assigneeIds: Joi.array().items(objectId()).max(TASK_LIMITS.ASSIGNEES_MAX).unique(),
  startDate: dateKey().allow(null),
  dueDate: dateKey().allow(null),
  estimateMinutes: Joi.number().integer().min(0).max(TASK_LIMITS.ESTIMATE_MAX_MINUTES).allow(null),
  requiresReview: Joi.boolean(),
  subtasks: subtasks(),
};

const dueAfterStart = (value, helpers) =>
  value.startDate && value.dueDate && value.dueDate < value.startDate
    ? helpers.message({ custom: "Due date cannot be before the start date" })
    : value;

/** POST /task/admin/tasks */
export const createTaskSchema = Joi.object({
  ...taskFields,
  title: taskFields.title.required(),
}).custom(dueAfterStart);

/** PUT /task/admin/tasks/:taskId - only the fields sent change; at least one is required. */
export const updateTaskSchema = Joi.object(taskFields)
  .min(1)
  .custom(dueAfterStart)
  .messages({ "object.min": "Send at least one field to change" });

/** PATCH /task/admin/tasks/:taskId/status */
export const adminStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...TASK_STATUSES)
    .required(),
});

/** PATCH /task/my/tasks/:taskId/status - `note` is shown to the reviewer when submitting. */
export const employeeStatusSchema = Joi.object({
  status: Joi.string()
    .valid(...TASK_STATUSES)
    .required(),
  note: Joi.string().trim().allow("").max(TASK_LIMITS.REVIEW_NOTE_MAX),
});

/** POST /task/admin/tasks/:taskId/review */
export const reviewSchema = Joi.object({
  decision: Joi.string()
    .valid(...REVIEW_DECISIONS)
    .required(),
  note: Joi.when("decision", {
    is: REVIEW_DECISION.CHANGES_REQUESTED,
    then: Joi.string().trim().min(1).max(TASK_LIMITS.REVIEW_NOTE_MAX).required(),
    otherwise: Joi.string().trim().allow("").max(TASK_LIMITS.REVIEW_NOTE_MAX),
  }).messages({ "any.required": "Tell the assignee what to change" }),
});

/** POST /task/admin/tasks/bulk */
export const bulkSchema = Joi.object({
  taskIds: Joi.array()
    .items(Joi.string().pattern(TASK_ID_PATTERN))
    .min(1)
    .max(TASK_LIMITS.BULK_MAX)
    .unique()
    .required(),
  action: Joi.string()
    .valid(...BULK_ACTIONS)
    .required(),
  value: Joi.when("action", {
    switch: [
      {
        is: BULK_ACTION.STATUS,
        then: Joi.string()
          .valid(...TASK_STATUSES)
          .required(),
      },
      {
        is: BULK_ACTION.PRIORITY,
        then: Joi.string()
          .valid(...TASK_PRIORITIES)
          .required(),
      },
    ],
    otherwise: Joi.any().strip(),
  }),
});

/** POST /task/.../comments */
export const commentSchema = Joi.object({
  body: Joi.string().trim().min(1).max(TASK_LIMITS.COMMENT_MAX).required(),
});

const listFields = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number()
    .integer()
    .min(1)
    .max(TASK_LIMITS.PAGE_LIMIT_MAX)
    .default(TASK_LIMITS.PAGE_LIMIT_DEFAULT),
  status: csvOf(TASK_STATUSES),
  priority: csvOf(TASK_PRIORITIES),
  tag: Joi.string().trim().max(TASK_LIMITS.TAG_MAX_LENGTH),
  search: Joi.string().trim().allow("").max(TASK_LIMITS.SEARCH_MAX),
  view: Joi.string()
    .valid(...TASK_VIEWS)
    .default(TASK_VIEW.ALL),
  dueFrom: dateKey(),
  dueTo: dateKey(),
  sortBy: Joi.string()
    .valid(...Object.keys(TASK_SORT_FIELDS))
    .default("dueDate"),
  order: Joi.string().valid("asc", "desc").default("asc"),
};

/** GET /task/admin/tasks */
export const adminListQuerySchema = Joi.object({ ...listFields, assignee: objectId() });

/** GET /task/my/tasks */
export const employeeListQuerySchema = Joi.object(listFields);

/** GET /task/admin/assignees?search= */
export const assigneeQuerySchema = Joi.object({
  search: Joi.string().trim().allow("").max(TASK_LIMITS.SEARCH_MAX),
});

/** :taskId */
export const taskIdParamsSchema = Joi.object({
  taskId: Joi.string().pattern(TASK_ID_PATTERN).required().messages({
    "string.pattern.base": "taskId must look like TSK-1001",
  }),
});

/** :taskId/:subtaskId */
export const subtaskParamsSchema = taskIdParamsSchema.keys({
  subtaskId: Joi.string().trim().max(CHILD_ID_MAX).required(),
});

/** :taskId/:commentId */
export const commentParamsSchema = taskIdParamsSchema.keys({
  commentId: Joi.string().trim().max(CHILD_ID_MAX).required(),
});
