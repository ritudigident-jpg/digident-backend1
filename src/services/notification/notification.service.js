/**
 * Business logic for in-app notifications to employees (stored and pushed with Socket.IO). Throws
 * AppError subclasses on failure.
 *
 * Exports: getNotificationsService, getUnreadNotificationCountService,
 * markNotificationAsReadService, markAllNotificationsAsReadService, deleteNotificationService,
 * deleteAllNotificationsService, sendNotification
 * Used by: 20 files, e.g. config/passport.config.js,
 * controllers/notification/notification.controller.js, controllers/user/user.controller.js,
 * services/attendance/attendance.service.js
 */

import Employee from "../../models/employee.model.js";
import { getIO } from "../../config/socket.config.js";
import { onlineUsers } from "../../config/socket.config.js";
import Notification from "../../models/notification.model.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";

/**
 * Get notifications.
 *
 * @param {object} params
 * @param {*} params.employeeId
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 */
export const getNotificationsService = async ({ employeeId, page = 1, limit = 10 }) => {
  page = Number(page) || 1;
  limit = Number(limit) || 10;

  const skip = (page - 1) * limit;

  /* ---------- GET NOTIFICATIONS ---------- */

  const notifications = await Notification.find({
    receiver: employeeId,
  })
    .populate("sender", "name email")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  /* ---------- TOTAL ITEMS ---------- */

  const totalItems = await Notification.countDocuments({
    receiver: employeeId,
  });

  /* ---------- TOTAL PAGES ---------- */

  const totalPages = Math.ceil(totalItems / limit);

  /* ---------- NEXT PAGE ---------- */
  const nextPage = page < totalPages ? page + 1 : null;
  /* ---------- PREVIOUS PAGE ---------- */
  const prevPage = page > 1 ? page - 1 : null;
  return {
    notifications,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage,
      prevPage,
      limit,
    },
  };
};

/**
 * Get unread notification count.
 *
 * @param {object} params
 * @param {*} params.employeeId
 * @returns {Promise<*>}
 */
export const getUnreadNotificationCountService = async ({ employeeId }) => {
  return Notification.countDocuments({
    receiver: employeeId,
    isRead: false,
  });
};

/**
 * Mark notification as read.
 *
 * @param {object} params
 * @param {*} params.notificationId
 * @param {*} params.employeeId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const markNotificationAsReadService = async ({ notificationId, employeeId }) => {
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      receiver: employeeId,
    },
    {
      isRead: true,
    },
    {
      new: true,
    }
  );

  if (!notification) {
    throw new NotFoundError("Notification not found");
  }

  return notification;
};

/**
 * Mark all notifications as read.
 *
 * @param {object} params
 * @param {*} params.employeeId
 * @returns {Promise<*>}
 */
export const markAllNotificationsAsReadService = async ({ employeeId }) => {
  await Notification.updateMany(
    {
      receiver: employeeId,
      isRead: false,
    },
    {
      isRead: true,
    }
  );

  return {
    success: true,
  };
};

/**
 * Delete notification.
 *
 * @param {object} params
 * @param {*} params.notificationId
 * @param {*} params.employeeId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteNotificationService = async ({ notificationId, employeeId }) => {
  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    receiver: employeeId,
  });

  if (!notification) {
    throw new NotFoundError("Notification not found");
  }

  return {
    success: true,
  };
};

/**
 * Delete all notifications.
 *
 * @param {object} params
 * @param {*} params.employeeId
 * @returns {Promise<*>}
 */
export const deleteAllNotificationsService = async ({ employeeId }) => {
  await Notification.deleteMany({
    receiver: employeeId,
  });

  return {
    success: true,
  };
};

/**
 * Send notification.
 *
 * @param {object} params
 * @param {*} [params.receivers]
 * @param {*} [params.permission]
 * @param {*} [params.sender]
 * @param {*} params.title
 * @param {*} params.message
 * @param {*} params.type
 * @param {*} [params.entityId]
 * @param {*} [params.entityModel]
 * @param {*} [params.metadata]
 * @returns {Promise<*>}
 */
export const sendNotification = async ({
  receivers = [],
  permission = null,
  sender = null,
  title,
  message,
  type,
  entityId = null,
  entityModel = null,
  metadata = {},
}) => {
  const io = getIO();
  let employees = [];

  /* ---------- DIRECT RECEIVERS ---------- */

  if (receivers.length > 0) {
    employees = await Employee.find({
      _id: { $in: receivers },
    }).select("_id");
  }

  /* ---------- PERMISSION BASED ---------- */

  if (permission) {
    employees = await Employee.find({
      permissions: { $in: [permission] },
    }).select("_id");
  }

  /* ---------- REMOVE DUPLICATES ---------- */

  const uniqueEmployees = [...new Map(employees.map((emp) => [emp._id.toString(), emp])).values()];

  /* ---------- SAVE + SOCKET ---------- */

  for (const emp of uniqueEmployees) {
    const notification = await Notification.create({
      receiver: emp._id,
      sender,
      title,
      message,
      type,
      entityId,
      entityModel,
      metadata,
    });

    const socketIds = onlineUsers.get(emp._id.toString());

    if (socketIds?.length) {
      socketIds.forEach((socketId) => {
        io.to(socketId).emit("newNotification", notification);
      });
    }
  }
};
