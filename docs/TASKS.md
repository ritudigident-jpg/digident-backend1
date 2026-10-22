# Task module

Admins create tasks and assign them to employees. Employees work through them and submit them for
review, and an admin approves the task or sends it back. Base URL: `/api/v1/task`. Every response
uses the standard format in [API_CONVENTIONS.md](API_CONVENTIONS.md).

## Workflow

```
todo -> in_progress -> in_review (employee submits) -> done (admin approves)
                            \-> in_progress (admin requests changes, note required)
```

- If a task has `requiresReview: false`, the employee can mark it `done` directly. Such a task has no `in_review` step.
- Once a task is `done`, the employee can no longer change it. Only an admin can reopen it.
- Admins can move any task to any status.
- Rules: `src/services/task/taskrules.js` (unit tested in `tests/taskrules.test.js`).

## Setup (one time)

```
node scripts/seedhrpermissions.js --apply
```

This creates `task.manage.read / create / update / delete` and gives them to every Super Admin and
Admin. To give them to other roles, use the Permissions screen. Super Admin always passes the checks.
Employees need no permission for the `/my/...` routes.

## Data

| Field | Notes |
|---|---|
| `taskId` | `TSK-1001`, `TSK-1002` ... (atomic counter, used in every URL) |
| `status` | `todo`, `in_progress`, `in_review`, `done` |
| `priority` | `urgent`, `high`, `normal`, `low` |
| `startDate`, `dueDate` | IST date `"YYYY-MM-DD"` or `null` |
| `estimateMinutes` | integer or `null` |
| `assignees` | `[{ employeeId, name, email }]`, filled in by the server from `assigneeIds` |
| `subtasks` | checklist: `[{ subtaskId, title, isDone, doneAt, doneBy }]` |
| `review` | `{ submittedAt, submittedBy, reviewedAt, reviewedBy, decision, note }` |
| computed | `isOverdue`, `isDueToday`, `daysLeft`, `checklist: { done, total }` (IST) |

## Admin endpoints (`task.manage.*`)

| Method | Path | Permission | Body / query |
|---|---|---|---|
| GET | `/admin/summary` | read | Counts plus `workload` per assignee |
| GET | `/admin/tasks` | read | `?view&status&priority&assignee&tag&search&dueFrom&dueTo&sortBy&order&page&limit` |
| POST | `/admin/tasks` | create | `{ title*, description, status, priority, tags[], assigneeIds[], startDate, dueDate, estimateMinutes, requiresReview, subtasks[{title,isDone}] }` |
| GET | `/admin/tasks/:taskId` | read | Detail with `activity` (newest first) |
| PUT | `/admin/tasks/:taskId` | update | Any create field. Only the fields you send change. Keep a `subtaskId` to keep that item's history |
| PATCH | `/admin/tasks/:taskId/status` | update | `{ status }` |
| POST | `/admin/tasks/:taskId/review` | update | `{ decision: "approve" \| "changes_requested", note }` (`note` is required when you request changes) |
| DELETE | `/admin/tasks/:taskId` | delete | Soft delete |
| POST | `/admin/tasks/bulk` | update | `{ taskIds[], action: "status" \| "priority" \| "delete", value }` (max 100) |
| GET | `/admin/assignees` | create or update | `?search=` returns active employees for the assignee picker |
| GET | `/admin/tags` | read | Tags in use, most used first |
| GET / POST | `/admin/tasks/:taskId/comments` | read | POST `{ body }` |
| DELETE | `/admin/tasks/:taskId/comments/:commentId` | read | Admins can delete any comment |

## Employee endpoints (login only; only tasks assigned to the caller, any other id returns 404)

| Method | Path | Body / query |
|---|---|---|
| GET | `/my/summary` | Counts |
| GET | `/my/tasks` | Same query as the admin list, without `assignee` |
| GET | `/my/tasks/:taskId` | Detail |
| PATCH | `/my/tasks/:taskId/status` | `{ status, note }`. `note` is shown to the reviewer when submitting |
| PATCH | `/my/tasks/:taskId/subtasks/:subtaskId` | Ticks or unticks one checklist item |
| GET / POST | `/my/tasks/:taskId/comments` | POST `{ body }` |
| DELETE | `/my/tasks/:taskId/comments/:commentId` | Own comments only |

`view` values: `all`, `open`, `due_today`, `overdue`, `upcoming` (next 7 days), `in_review`, `completed`.
`status` and `priority` accept comma lists, e.g. `?status=todo,in_progress`. `sortBy` values: `dueDate`
(tasks without a date go last), `priority`, `createdAt`, `updatedAt`, `title`, `status`.

## Notifications (in-app and Socket.IO, best effort)

| Type | Sent to | When |
|---|---|---|
| `TASK_ASSIGNED` | Assignees who were just added | A task is created, or assignees are added |
| `TASK_SUBMITTED_FOR_REVIEW` | Task creator | An employee submits a task |
| `TASK_APPROVED` / `TASK_CHANGES_REQUESTED` | Assignees | An admin reviews a task |
| `TASK_STATUS_CHANGED` | Assignees (admin move) or creator (employee move) | The status changes |
| `TASK_COMMENTED` | Assignees and creator | A comment is added |

Nobody is notified about their own action. `entityId` is the `taskId`, so a notification can link to the task.

## Error codes

`TASK_NOT_FOUND` 404 · `SUBTASK_NOT_FOUND` 404 · `TASK_COMMENT_NOT_FOUND` 404 ·
`TASK_STATUS_NOT_ALLOWED` 403 (blocked by the workflow) · `TASK_NOT_IN_REVIEW` 409 ·
`TASK_ASSIGNEE_INVALID` 400 · `VALIDATION_ERROR` 400.

## Files

`routes/task.routes.js` · `controllers/task/task.controller.js`, `task.validator.js` ·
`services/task/task.service.js` (admin), `taskemployee.service.js`, `taskcomment.service.js`,
`taskcommon.service.js`, `taskrules.js` (pure rules) · `models/task.model.js`, `taskcomment.model.js` ·
`constants/task.constants.js`.
