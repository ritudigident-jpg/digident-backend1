/**
 * HTTP handlers for tasks. Thin: read the (already validated) request, call one service, send the
 * standard response. Admin handlers are reached through requirePermission(TASK_*), employee
 * handlers through attachCurrentEmployee; both put the employee on req.currentUser.
 *
 * Routes: routes/task.routes.js (mounted at /api/v1/task)
 */
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { sendCreated, sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import {
  bulkUpdateTasksService,
  changeTaskStatusService,
  createTaskService,
  deleteTaskService,
  getAdminSummaryService,
  getTaskService,
  listTagsService,
  listTasksService,
  reviewTaskService,
  searchAssigneesService,
  updateTaskService,
} from "../../services/task/task.service.js";
import {
  changeMyTaskStatusService,
  getMySummaryService,
  getMyTaskService,
  listMyTasksService,
  toggleMySubtaskService,
} from "../../services/task/taskemployee.service.js";
import {
  addCommentService,
  deleteCommentService,
  listCommentsService,
} from "../../services/task/taskcomment.service.js";
import { toPerson } from "../../services/task/taskrules.js";
import { TASK_STATUS } from "../../constants/task.constants.js";

const actorOf = (req) => toPerson(req.currentUser);
const adminAccess = (req) => ({ employee: req.currentUser, isAdmin: true });
const employeeAccess = (req) => ({ employee: req.currentUser, isAdmin: false });

/* ============================ ADMIN ============================ */

/** POST /task/admin/tasks */
export const createTask = asyncHandler(async (req, res) => {
  const task = await createTaskService(req.body, actorOf(req));
  return sendCreated(res, { data: task, message: "Task created" });
});

/** GET /task/admin/tasks?status&priority&assignee&tag&search&view&dueFrom&dueTo&sortBy&order&page&limit */
export const listTasks = asyncHandler(async (req, res) => {
  const { items, total } = await listTasksService(req.query);
  const { page, limit } = req.query;
  return sendPaginated(res, { data: items, pagination: { page, limit, total }, message: "Tasks fetched" });
});

/** GET /task/admin/summary */
export const getAdminSummary = asyncHandler(async (req, res) => {
  const summary = await getAdminSummaryService();
  return sendSuccess(res, { data: summary, message: "Task summary fetched" });
});

/** GET /task/admin/assignees?search= */
export const searchAssignees = asyncHandler(async (req, res) => {
  const employees = await searchAssigneesService(req.query.search);
  return sendSuccess(res, { data: employees, message: "Employees fetched" });
});

/** GET /task/admin/tags */
export const listTags = asyncHandler(async (req, res) => {
  const tags = await listTagsService();
  return sendSuccess(res, { data: tags, message: "Tags fetched" });
});

/** GET /task/admin/tasks/:taskId */
export const getTask = asyncHandler(async (req, res) => {
  const task = await getTaskService(req.params.taskId);
  return sendSuccess(res, { data: task, message: "Task fetched" });
});

/** PUT /task/admin/tasks/:taskId */
export const updateTask = asyncHandler(async (req, res) => {
  const task = await updateTaskService(req.params.taskId, req.body, actorOf(req));
  return sendSuccess(res, { data: task, message: "Task updated" });
});

/** PATCH /task/admin/tasks/:taskId/status */
export const changeTaskStatus = asyncHandler(async (req, res) => {
  const task = await changeTaskStatusService(req.params.taskId, req.body.status, actorOf(req));
  return sendSuccess(res, { data: task, message: "Task status updated" });
});

/** POST /task/admin/tasks/:taskId/review */
export const reviewTask = asyncHandler(async (req, res) => {
  const task = await reviewTaskService(req.params.taskId, req.body, actorOf(req));
  const message = task.status === TASK_STATUS.DONE ? "Task approved" : "Changes requested";
  return sendSuccess(res, { data: task, message });
});

/** DELETE /task/admin/tasks/:taskId */
export const deleteTask = asyncHandler(async (req, res) => {
  const result = await deleteTaskService(req.params.taskId, actorOf(req));
  return sendSuccess(res, { data: result, message: "Task deleted" });
});

/** POST /task/admin/tasks/bulk */
export const bulkUpdateTasks = asyncHandler(async (req, res) => {
  const result = await bulkUpdateTasksService(req.body, actorOf(req));
  return sendSuccess(res, { data: result, message: `${result.modified} task(s) updated` });
});

/** GET /task/admin/tasks/:taskId/comments */
export const listTaskCommentsAdmin = asyncHandler(async (req, res) => {
  const comments = await listCommentsService(req.params.taskId, adminAccess(req));
  return sendSuccess(res, { data: comments, message: "Comments fetched" });
});

/** POST /task/admin/tasks/:taskId/comments */
export const addTaskCommentAdmin = asyncHandler(async (req, res) => {
  const comment = await addCommentService(req.params.taskId, req.body.body, adminAccess(req));
  return sendCreated(res, { data: comment, message: "Comment added" });
});

/** DELETE /task/admin/tasks/:taskId/comments/:commentId */
export const deleteTaskCommentAdmin = asyncHandler(async (req, res) => {
  const result = await deleteCommentService(req.params.taskId, req.params.commentId, adminAccess(req));
  return sendSuccess(res, { data: result, message: "Comment removed" });
});

/* =========================== EMPLOYEE =========================== */

/** GET /task/my/tasks */
export const listMyTasks = asyncHandler(async (req, res) => {
  const { items, total } = await listMyTasksService(req.currentUser, req.query);
  const { page, limit } = req.query;
  return sendPaginated(res, { data: items, pagination: { page, limit, total }, message: "Tasks fetched" });
});

/** GET /task/my/summary */
export const getMySummary = asyncHandler(async (req, res) => {
  const summary = await getMySummaryService(req.currentUser);
  return sendSuccess(res, { data: summary, message: "Task summary fetched" });
});

/** GET /task/my/tasks/:taskId */
export const getMyTask = asyncHandler(async (req, res) => {
  const task = await getMyTaskService(req.currentUser, req.params.taskId);
  return sendSuccess(res, { data: task, message: "Task fetched" });
});

/** PATCH /task/my/tasks/:taskId/status */
export const changeMyTaskStatus = asyncHandler(async (req, res) => {
  const task = await changeMyTaskStatusService(req.currentUser, req.params.taskId, req.body);
  return sendSuccess(res, { data: task, message: "Task status updated" });
});

/** PATCH /task/my/tasks/:taskId/subtasks/:subtaskId */
export const toggleMySubtask = asyncHandler(async (req, res) => {
  const { taskId, subtaskId } = req.params;
  const task = await toggleMySubtaskService(req.currentUser, taskId, subtaskId);
  return sendSuccess(res, { data: task, message: "Checklist updated" });
});

/** GET /task/my/tasks/:taskId/comments */
export const listMyTaskComments = asyncHandler(async (req, res) => {
  const comments = await listCommentsService(req.params.taskId, employeeAccess(req));
  return sendSuccess(res, { data: comments, message: "Comments fetched" });
});

/** POST /task/my/tasks/:taskId/comments */
export const addMyTaskComment = asyncHandler(async (req, res) => {
  const comment = await addCommentService(req.params.taskId, req.body.body, employeeAccess(req));
  return sendCreated(res, { data: comment, message: "Comment added" });
});

/** DELETE /task/my/tasks/:taskId/comments/:commentId */
export const deleteMyTaskComment = asyncHandler(async (req, res) => {
  const result = await deleteCommentService(req.params.taskId, req.params.commentId, employeeAccess(req));
  return sendSuccess(res, { data: result, message: "Comment removed" });
});
