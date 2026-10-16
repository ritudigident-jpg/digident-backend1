/**
 * Socket.IO server: tracks which employee is online on which sockets (onlineUsers) for live
 * notifications.
 *
 * Exports: onlineUsers, initSocket, getIO
 * Used by: app.js, services/notification/notification.service.js
 */

import { Server } from "socket.io";
import { logger } from "../helpers/logger.helper.js";

export const onlineUsers = new Map();
let io;
/**
 * Init socket.
 *
 * @param {*} server
 * @param {*} allowedOrigins
 * @returns {*}
 */
export const initSocket = (server, allowedOrigins) => {
  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST"],
    },
  });
  io.on("connection", (socket) => {
    logger.debug("Socket Connected", { id: socket.id });
    const userId = socket.handshake.auth.userId;
    logger.debug("Handshake auth", { auth: socket.handshake.auth });
    if (userId) {
      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, []);
      }

      onlineUsers.get(userId).push(socket.id);

      logger.debug("User Connected", { userId });
    }

    socket.on("disconnect", () => {
      logger.debug("Socket Disconnected", { id: socket.id });

      if (userId) {
        const sockets = onlineUsers.get(userId) || [];
        const updated = sockets.filter((id) => id !== socket.id);

        if (updated.length === 0) {
          onlineUsers.delete(userId);
        } else {
          onlineUsers.set(userId, updated);
        }
      }
    });
  });

  return io;
};

/**
 * Get io.
 * @returns {*}
 */
export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized");
  }
  return io;
};
