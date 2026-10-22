/**
 * Task routes, mounted at /api/v1/task (app.js; listed in docs/ENDPOINTS.md, explained in
 * docs/TASKS.md).
 *
 * Admin routes (/admin/...) need a permission fixed on the server (constants/permissions.constant.js):
 *   task.manage.read / create / update / delete. Super Admin always passes. Create them and give
 *   them to Admins with: node scripts/seedhrpermissions.js --apply
 * Employee routes (/my/...) only need a login; they only ever touch tasks assigned to the caller.
 *
 * Used by: app.js
 */
import express from "express";
import {
  addMyTaskComment,
  addTaskCommentAdmin,
  bulkUpdateTasks,
  changeMyTaskStatus,
  changeTaskStatus,
  createTask,
  deleteMyTaskComment,
  deleteTask,
  deleteTaskCommentAdmin,
  getAdminSummary,
  getMySummary,
  getMyTask,
  getTask,
  listMyTaskComments,
  listMyTasks,
  listTags,
  listTaskCommentsAdmin,
  listTasks,
  reviewTask,
  searchAssignees,
  toggleMySubtask,
  updateTask,
} from "../controllers/task/task.controller.js";
import {
  adminListQuerySchema,
  adminStatusSchema,
  assigneeQuerySchema,
  bulkSchema,
  commentParamsSchema,
  commentSchema,
  createTaskSchema,
  employeeListQuerySchema,
  employeeStatusSchema,
  reviewSchema,
  subtaskParamsSchema,
  taskIdParamsSchema,
  updateTaskSchema,
} from "../controllers/task/task.validator.js";
import auth from "../middlewares/auth.middleware.js";
import { attachCurrentEmployee, requirePermission } from "../middlewares/permission.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { PERMISSIONS } from "../constants/permissions.constant.js";

const router = express.Router();

const canRead = requirePermission(PERMISSIONS.TASK_READ);
const canCreate = requirePermission(PERMISSIONS.TASK_CREATE);
const canUpdate = requirePermission(PERMISSIONS.TASK_UPDATE);
const canDelete = requirePermission(PERMISSIONS.TASK_DELETE);
const canAssign = requirePermission(PERMISSIONS.TASK_CREATE, PERMISSIONS.TASK_UPDATE);
const taskParams = validate(taskIdParamsSchema, "params");

/* ================= ADMIN ROUTES ================= */
router.get("/admin/summary", auth, canRead, getAdminSummary);
router.get("/admin/assignees", auth, canAssign, validate(assigneeQuerySchema, "query"), searchAssignees);
router.get("/admin/tags", auth, canRead, listTags);
router.post("/admin/tasks/bulk", auth, canUpdate, validate(bulkSchema), bulkUpdateTasks);
router.post("/admin/tasks", auth, canCreate, validate(createTaskSchema), createTask);
router.get("/admin/tasks", auth, canRead, validate(adminListQuerySchema, "query"), listTasks);
router.get("/admin/tasks/:taskId", auth, canRead, taskParams, getTask);
router.put("/admin/tasks/:taskId", auth, canUpdate, taskParams, validate(updateTaskSchema), updateTask);
router.patch(
  "/admin/tasks/:taskId/status",
  auth,
  canUpdate,
  taskParams,
  validate(adminStatusSchema),
  changeTaskStatus
);
router.post("/admin/tasks/:taskId/review", auth, canUpdate, taskParams, validate(reviewSchema), reviewTask);
router.delete("/admin/tasks/:taskId", auth, canDelete, taskParams, deleteTask);
router.get("/admin/tasks/:taskId/comments", auth, canRead, taskParams, listTaskCommentsAdmin);
router.post(
  "/admin/tasks/:taskId/comments",
  auth,
  canRead,
  taskParams,
  validate(commentSchema),
  addTaskCommentAdmin
);
router.delete(
  "/admin/tasks/:taskId/comments/:commentId",
  auth,
  canRead,
  validate(commentParamsSchema, "params"),
  deleteTaskCommentAdmin
);

/* ================= EMPLOYEE ROUTES ================= */
router.get("/my/summary", auth, attachCurrentEmployee, getMySummary);
router.get("/my/tasks", auth, attachCurrentEmployee, validate(employeeListQuerySchema, "query"), listMyTasks);
router.get("/my/tasks/:taskId", auth, attachCurrentEmployee, taskParams, getMyTask);
router.patch(
  "/my/tasks/:taskId/status",
  auth,
  attachCurrentEmployee,
  taskParams,
  validate(employeeStatusSchema),
  changeMyTaskStatus
);
router.patch(
  "/my/tasks/:taskId/subtasks/:subtaskId",
  auth,
  attachCurrentEmployee,
  validate(subtaskParamsSchema, "params"),
  toggleMySubtask
);
router.get("/my/tasks/:taskId/comments", auth, attachCurrentEmployee, taskParams, listMyTaskComments);
router.post(
  "/my/tasks/:taskId/comments",
  auth,
  attachCurrentEmployee,
  taskParams,
  validate(commentSchema),
  addMyTaskComment
);
router.delete(
  "/my/tasks/:taskId/comments/:commentId",
  auth,
  attachCurrentEmployee,
  validate(commentParamsSchema, "params"),
  deleteMyTaskComment
);

export default router;
