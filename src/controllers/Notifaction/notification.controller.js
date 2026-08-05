// controllers/notification.controller.js

import Employee from "../../models/manage/employee.model.js";

import {
  getNotificationsService,
  getUnreadNotificationCountService,
  markNotificationAsReadService,
  markAllNotificationsAsReadService,
  deleteNotificationService,
  deleteAllNotificationsService,sendNotification 
} from "../../services/notification.service.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { sendError, handleError } from "../../helpers/error.helper.js";

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
export const getNotifications = async (req, res) => {
  try {
    const employee = await Employee.findOne({
      email: req.user.email,
      isDeleted: false,
    });
    const notifications =
      await getNotificationsService({
        employeeId: employee._id,
        page: req.query.page,
        limit: req.query.limit,
      });
    return sendSuccess(
      res,
      notifications,
      200,
      "Notifications fetched successfully"
    );
  } catch (error) {
    return handleError(res, error);
  }
};

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
export const getUnreadNotificationCount =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
        isDeleted: false,
      });

      const count =
        await getUnreadNotificationCountService({
          employeeId: employee._id,
        });

      return sendSuccess(
        res,
        { unreadCount: count },
        200,
        "Unread count fetched successfully"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };

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
export const markNotificationAsRead =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
      });

      const result =
        await markNotificationAsReadService({
          notificationId: req.params.notificationId,
          employeeId: employee._id,
        });

      return sendSuccess(
        res,
        result,
        200,
        "Notification marked as read"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };

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
export const markAllNotificationsAsRead =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
      });

      const result =
        await markAllNotificationsAsReadService({
          employeeId: employee._id,
        });

      return sendSuccess(
        res,
        result,
        200,
        "All notifications marked as read"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };

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
export const deleteNotification =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
      });

      const result =
        await deleteNotificationService({
          notificationId: req.params.notificationId,
          employeeId: employee._id,
        });

      return sendSuccess(
        res,
        result,
        200,
        "Notification deleted successfully"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };

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
export const deleteAllNotifications =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
      });

      const result =
        await deleteAllNotificationsService({
          employeeId: employee._id,
        });

      return sendSuccess(
        res,
        result,
        200,
        "All notifications deleted successfully"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };

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
export const sendCustomNotification =
  async (req, res) => {
    try {
      const employee = await Employee.findOne({
        email: req.user.email,
      });

      const {
        receivers,
        permission,
        title,
        message,
        type,
        entityId,
        entityModel,
        metadata,
      } = req.body;

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

      return sendSuccess(
        res,
        null,
        200,
        "Notification sent successfully"
      );
    } catch (error) {
      return handleError(res, error);
    }
  };