/**
 * Task rules and request validation: workflow (who may move a task where), review decisions,
 * list filters for the quick views, sorting, assignee diffs, activity text, checklist merging,
 * the overdue flags and the summary shape. No database.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildTaskFilter,
  buildTaskSort,
  decorateTask,
  describeTaskChanges,
  diffAssignees,
  employeeStatusChangeError,
  formatTaskId,
  mergeSubtasks,
  reviewDecisionError,
  shapeSummary,
  statusAfterReview,
  toPerson,
} from "../src/services/task/taskrules.js";
import {
  adminListQuerySchema,
  bulkSchema,
  createTaskSchema,
  reviewSchema,
  taskIdParamsSchema,
  updateTaskSchema,
} from "../src/controllers/task/task.validator.js";

const TODAY = "2026-10-22";
const OPTIONS = { abortEarly: false, stripUnknown: true, convert: true };
const ADMIN = { employeeId: "a".repeat(24), name: "Admin", email: "admin@x.com" };

describe("ids and people", () => {
  test("task ids count up from TSK-1001", () => {
    assert.equal(formatTaskId(1), "TSK-1001");
    assert.equal(formatTaskId(42), "TSK-1042");
  });
  test("person snapshot uses the full name, falling back to the email", () => {
    assert.deepEqual(toPerson({ _id: 1, firstName: "Priya", lastName: "Patel", email: "p@x.com" }), {
      employeeId: 1,
      name: "Priya Patel",
      email: "p@x.com",
    });
    assert.equal(toPerson({ _id: 2, email: "n@x.com" }).name, "n@x.com");
  });
});

describe("employee workflow", () => {
  const task = (status, requiresReview = true) => ({ status, requiresReview });
  test("can start, pause and submit a task that needs review", () => {
    assert.equal(employeeStatusChangeError(task("todo"), "in_progress"), null);
    assert.equal(employeeStatusChangeError(task("in_progress"), "todo"), null);
    assert.equal(employeeStatusChangeError(task("in_progress"), "in_review"), null);
    assert.equal(employeeStatusChangeError(task("in_review"), "in_progress"), null, "may withdraw a submit");
  });
  test("cannot mark a reviewed task done", () => {
    assert.match(employeeStatusChangeError(task("in_progress"), "done"), /review/);
  });
  test("can mark a no-review task done, but not submit it", () => {
    assert.equal(employeeStatusChangeError(task("in_progress", false), "done"), null);
    assert.match(employeeStatusChangeError(task("in_progress", false), "in_review"), /does not need/);
  });
  test("a done task is closed for the assignee", () => {
    assert.match(employeeStatusChangeError(task("done"), "in_progress"), /already completed/);
  });
  test("same status is a no-op, not an error", () => {
    assert.equal(employeeStatusChangeError(task("done"), "done"), null);
  });
});

describe("admin review", () => {
  test("only tasks in review can be decided", () => {
    assert.equal(reviewDecisionError({ status: "in_progress" }, "approve").code, "NOT_IN_REVIEW");
    assert.equal(reviewDecisionError({ status: "in_review" }, "approve"), null);
  });
  test("requesting changes needs a note", () => {
    assert.equal(
      reviewDecisionError({ status: "in_review" }, "changes_requested", "  ").code,
      "NOTE_REQUIRED"
    );
    assert.equal(reviewDecisionError({ status: "in_review" }, "changes_requested", "Fix typo"), null);
  });
  test("approve -> done, changes requested -> in progress", () => {
    assert.equal(statusAfterReview("approve"), "done");
    assert.equal(statusAfterReview("changes_requested"), "in_progress");
  });
});

describe("list filter", () => {
  test("no filters: only live tasks", () => {
    assert.deepEqual(buildTaskFilter({ view: "all" }, { todayKey: TODAY }), { isDeleted: false });
  });
  test("overdue = open with a due date before today", () => {
    const filter = buildTaskFilter({ view: "overdue" }, { todayKey: TODAY });
    assert.deepEqual(filter.$and[1], { status: { $ne: "done" }, dueDate: { $ne: null, $lt: TODAY } });
  });
  test("upcoming = next 7 days, today excluded", () => {
    const filter = buildTaskFilter({ view: "upcoming" }, { todayKey: TODAY });
    assert.deepEqual(filter.$and[1].dueDate, { $gt: TODAY, $lte: "2026-10-29" });
  });
  test("the employee's own id always wins over a query assignee", () => {
    const filter = buildTaskFilter({ assignee: "other" }, { todayKey: TODAY, assigneeId: "me" });
    assert.deepEqual(filter.$and[1], { "assignees.employeeId": "me" });
  });
  test("filters combine and search is regex-escaped", () => {
    const filter = buildTaskFilter(
      { status: ["todo"], priority: ["high"], tag: "Bug", search: "a+b", view: "open" },
      { todayKey: TODAY }
    );
    assert.equal(filter.$and.length, 6);
    assert.equal(filter.$and[5].$or[0].title.source, "a\\+b");
  });
});

describe("sort", () => {
  test("due date sorts tasks without a date last", () => {
    assert.deepEqual(Object.keys(buildTaskSort("dueDate", "asc")).slice(0, 2), ["hasNoDueDate", "dueDate"]);
  });
  test("priority sorts by the stored rank", () => {
    assert.deepEqual(buildTaskSort("priority", "asc"), { priorityRank: 1, createdAt: -1 });
  });
});

describe("changes and checklist", () => {
  test("assignee diff", () => {
    const before = [{ employeeId: "a" }, { employeeId: "b" }];
    const after = [{ employeeId: "b" }, { employeeId: "c" }];
    assert.deepEqual(diffAssignees(before, after), { added: ["c"], removed: ["a"] });
  });
  test("activity only names fields that really changed", () => {
    const task = {
      status: "todo",
      title: "A",
      dueDate: "2026-10-25",
      tags: ["x"],
      assignees: [],
      subtasks: [],
    };
    const entries = describeTaskChanges(task, {
      status: "done",
      title: "A",
      dueDate: "2026-10-30",
      tags: ["x"],
    });
    assert.deepEqual(entries, [
      ["status_changed", "moved this to Done"],
      ["updated", "changed due date"],
    ]);
  });
  test("merging keeps who ticked an existing item", () => {
    const doneAt = new Date("2026-10-20T10:00:00Z");
    const stored = [{ subtaskId: "s1", title: "Old", isDone: true, doneAt, doneBy: { name: "Priya" } }];
    const now = new Date("2026-10-22T10:00:00Z");
    const merged = mergeSubtasks(
      stored,
      [{ subtaskId: "s1", title: "Renamed", isDone: true }, { title: "New" }],
      ADMIN,
      now
    );
    assert.equal(merged[0].subtaskId, "s1");
    assert.equal(merged[0].doneAt, doneAt);
    assert.equal(merged[0].doneBy.name, "Priya");
    assert.equal(merged[1].subtaskId, undefined, "new items get an id from the model");
    assert.equal(merged[1].isDone, false);
  });
});

describe("flags and summary", () => {
  test("overdue, due today and days left use the IST date", () => {
    assert.equal(decorateTask({ status: "todo", dueDate: "2026-10-20" }, TODAY).isOverdue, true);
    assert.equal(decorateTask({ status: "todo", dueDate: "2026-10-20" }, TODAY).daysLeft, -2);
    assert.equal(decorateTask({ status: "done", dueDate: "2026-10-20" }, TODAY).isOverdue, false);
    assert.equal(decorateTask({ status: "todo", dueDate: TODAY }, TODAY).isDueToday, true);
    assert.equal(decorateTask({ status: "todo", dueDate: null }, TODAY).daysLeft, null);
  });
  test("checklist progress", () => {
    const task = decorateTask({ status: "todo", subtasks: [{ isDone: true }, { isDone: false }] }, TODAY);
    assert.deepEqual(task.checklist, { done: 1, total: 2 });
  });
  test("summary fills every status and computes the completion rate", () => {
    const summary = shapeSummary({
      byStatus: [
        { _id: "todo", count: 3 },
        { _id: "done", count: 1 },
      ],
      overdue: [{ count: 2 }],
    });
    assert.deepEqual(summary.byStatus, { todo: 3, in_progress: 0, in_review: 0, done: 1 });
    assert.equal(summary.open, 3);
    assert.equal(summary.overdue, 2);
    assert.equal(summary.dueToday, 0);
    assert.equal(summary.completionRate, 25);
  });
});

describe("validation", () => {
  test("create needs a title, drops client-only fields", () => {
    assert.ok(createTaskSchema.validate({}, OPTIONS).error);
    const { value } = createTaskSchema.validate(
      { title: "  Fix login  ", assignees: [{ name: "fake" }], taskId: "X", permission: "p" },
      OPTIONS
    );
    assert.deepEqual(value, { title: "Fix login" });
  });
  test("due date must be a real date not before the start date", () => {
    assert.ok(createTaskSchema.validate({ title: "A", dueDate: "2026-02-30" }, OPTIONS).error);
    const { error } = createTaskSchema.validate(
      { title: "A", startDate: "2026-10-22", dueDate: "2026-10-21" },
      OPTIONS
    );
    assert.match(error.message, /before the start date/);
  });
  test("update needs at least one field", () => {
    assert.ok(updateTaskSchema.validate({}, OPTIONS).error);
    assert.equal(updateTaskSchema.validate({ priority: "high" }, OPTIONS).error, undefined);
  });
  test("list query parses comma lists and rejects unknown values", () => {
    const { value } = adminListQuerySchema.validate({ status: "todo,in_review", page: "2" }, OPTIONS);
    assert.deepEqual(value.status, ["todo", "in_review"]);
    assert.equal(value.page, 2);
    assert.equal(value.limit, 25);
    assert.ok(adminListQuerySchema.validate({ status: "todo,nope" }, OPTIONS).error);
  });
  test("review: changes requested needs a note", () => {
    assert.ok(reviewSchema.validate({ decision: "changes_requested" }, OPTIONS).error);
    assert.equal(reviewSchema.validate({ decision: "approve" }, OPTIONS).error, undefined);
  });
  test("bulk: value depends on the action", () => {
    assert.ok(bulkSchema.validate({ taskIds: ["TSK-1001"], action: "status", value: "nope" }, OPTIONS).error);
    const { value } = bulkSchema.validate({ taskIds: ["TSK-1001"], action: "delete", value: "x" }, OPTIONS);
    assert.equal(value.value, undefined);
  });
  test("task id format", () => {
    assert.ok(taskIdParamsSchema.validate({ taskId: "abc" }, OPTIONS).error);
    assert.equal(taskIdParamsSchema.validate({ taskId: "TSK-1001" }, OPTIONS).error, undefined);
  });
});
