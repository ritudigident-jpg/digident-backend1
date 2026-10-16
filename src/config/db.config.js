/**
 * Connects Mongoose to MONGODB_URI. Throws when the connection fails, so app.js can log it and
 * stop the server instead of running without a database.
 *
 * Used by: app.js
 */
import mongoose from "mongoose";
import { logger } from "../helpers/logger.helper.js";

/**
 * Opens the MongoDB connection.
 *
 * @returns {Promise<typeof mongoose>}
 * @throws {Error} When MongoDB cannot be reached.
 */
const connectDB = async () => {
  const connection = await mongoose.connect(process.env.MONGODB_URI);
  logger.info("MongoDB connected", { host: connection.connection.host });
  return connection;
};

export default connectDB;
