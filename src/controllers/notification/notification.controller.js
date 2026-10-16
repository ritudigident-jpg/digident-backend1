/**
 * HTTP handlers for in-app notifications to employees (stored and pushed with Socket.IO): read the
 * request, call the service, send the response. No business logic here.
 *
 * Exports: getNotifications, getUnreadNotificationCount, markNotificationAsRead,
 * markAllNotificationsAsRead, deleteNotification, deleteAllNotifications, sendCustomNotification
 * Used by: routes/notifications.routes.js
 */

// controllers/notification.controller.js

import Employee from "../../models/employee.model.js";

import {
  getNotificationsService,
  getUnreadNotificationCountService,
  markNotificationAsReadService,
  markAllNotificationsAsReadService,
  deleteNotificationService,
  deleteAllNotificationsService,
  sendNotification,
} from "../../services/notification/notification.service.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function getNotifications
 *
 * @route GET /api/notifications
 *
 * @description
 * Fetch all notifications of the logged-in employee with pagination.
 *
 * @process
 * 1. Get logged-in employee using req.user.email.
 * 2. Verify employee is not deleted.
 * 3. Fetch notifications with page & limit.
 * 4. Return paginated notifications.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Notifications fetched successfully",
 *   data: NotificationsObject
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getNotifications = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
    isDeleted: false,
  });
  const notifications = await getNotificationsService({
    employeeId: employee._id,
    page: req.query.page,
    limit: req.query.limit,
  });
  return sendSuccess(res, { data: notifications, message: "Notifications fetched successfully" });
});

/**
 * @function getUnreadNotificationCount
 *
 * @route GET /api/notifications/unread-count
 *
 * @description
 * Get total unread notification count for the logged-in employee.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Count unread notifications.
 * 3. Return unread count.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Unread count fetched successfully",
 *   data: { unreadCount }
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const getUnreadNotificationCount = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
    isDeleted: false,
  });

  const count = await getUnreadNotificationCountService({
    employeeId: employee._id,
  });

  return sendSuccess(res, { data: { unreadCount: count }, message: "Unread count fetched successfully" });
});

/**
 * @function markNotificationAsRead
 *
 * @route PATCH /api/notifications/:notificationId/read
 *
 * @description
 * Mark a specific notification as read.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Validate notification ownership.
 * 3. Mark notification as read.
 * 4. Return updated notification.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Notification marked as read",
 *   data: NotificationObject
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 404 - NOTIFICATION_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const markNotificationAsRead = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  const result = await markNotificationAsReadService({
    notificationId: req.params.notificationId,
    employeeId: employee._id,
  });

  return sendSuccess(res, { data: result, message: "Notification marked as read" });
});

/**
 * @function markAllNotificationsAsRead
 *
 * @route PATCH /api/notifications/read-all
 *
 * @description
 * Mark all unread notifications of the logged-in employee as read.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Mark all unread notifications as read.
 * 3. Return updated result.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All notifications marked as read",
 *   data: ResultObject
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  const result = await markAllNotificationsAsReadService({
    employeeId: employee._id,
  });

  return sendSuccess(res, { data: result, message: "All notifications marked as read" });
});

/**
 * @function deleteNotification
 *
 * @route DELETE /api/notifications/:notificationId
 *
 * @description
 * Delete a specific notification of the logged-in employee.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Verify notification belongs to employee.
 * 3. Delete notification.
 * 4. Return success response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Notification deleted successfully",
 *   data: ResultObject
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 404 - NOTIFICATION_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const deleteNotification = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  const result = await deleteNotificationService({
    notificationId: req.params.notificationId,
    employeeId: employee._id,
  });

  return sendSuccess(res, { data: result, message: "Notification deleted successfully" });
});

/**
 * @function deleteAllNotifications
 *
 * @route DELETE /api/notifications
 *
 * @description
 * Delete all notifications of the logged-in employee.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Delete all notifications.
 * 3. Return success response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "All notifications deleted successfully",
 *   data: ResultObject
 * }
 *
 * @errors
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const deleteAllNotifications = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  const result = await deleteAllNotificationsService({
    employeeId: employee._id,
  });

  return sendSuccess(res, { data: result, message: "All notifications deleted successfully" });
});

/**
 * @function sendCustomNotification
 *
 * @route POST /api/notifications/send
 *
 * @description
 * Send a custom notification to one or multiple employees.
 *
 * @process
 * 1. Get logged-in employee.
 * 2. Read notification payload from request body.
 * 3. Call notification service.
 * 4. Store notification(s).
 * 5. Trigger realtime notification (if enabled).
 * 6. Return success response.
 *
 * @response
 * 200 {
 *   success: true,
 *   message: "Notification sent successfully"
 * }
 *
 * @errors
 * 400 - VALIDATION_ERROR
 * 404 - EMPLOYEE_NOT_FOUND
 * 500 - INTERNAL_SERVER_ERROR
 */
export const sendCustomNotification = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({
    email: req.user.email,
  });

  const { receivers, permission, title, message, type, entityId, entityModel, metadata } = req.body;

  await sendNotification({
    receivers,
    permission,
    sender: employee._id,
    title,
    message,
    type,
    entityId,
    entityModel,
    metadata,
  });

  return sendSuccess(res, { data: null, message: "Notification sent successfully" });
});
