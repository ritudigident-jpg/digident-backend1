/**
 * Server entry point: loads and checks the environment, builds the Express app (security, parsing,
 * logging, CORS, routes, error handling), connects MongoDB and Redis, starts Socket.IO and the
 * cron jobs, and shuts everything down cleanly on SIGTERM / SIGINT or a fatal error.
 *
 * Order matters:
 *   1. env.config.js is imported first (other config files read process.env when loaded).
 *   2. Error handlers (notFoundHandler, errorHandler) are registered after every route.
 *
 * Every route is listed in docs/ENDPOINTS.md (npm run endpoints).
 */
import { env } from "./config/env.config.js";

import http from "node:http";
import express from "express";
import passport from "passport";
import cookieParser from "cookie-parser";
import cors from "cors";
import mongoose from "mongoose";

import connectDB from "./config/db.config.js";
import setupPassport from "./config/passport.config.js";
import { redis } from "./config/redis.config.js";
import { initSocket } from "./config/socket.config.js";
import { getAllowedOrigins, buildCorsOptions } from "./config/cors.config.js";
import {
  helmetMiddleware,
  generalRateLimiter,
  authRateLimiter,
  STRICT_LIMIT_PATHS,
} from "./config/security.config.js";

import { requestIdMiddleware } from "./middlewares/requestid.middleware.js";
import { morganMiddleware } from "./middlewares/logger.middleware.js";
import { clientIpMiddleware, ipAnalyticsMiddleware } from "./middlewares/ipanalytics.middleware.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";
import { logger } from "./helpers/logger.helper.js";
import { stopAllJobs } from "./helpers/cronjob.helper.js";

import { bestSellerCronJob } from "./jobs/bestseller.job.js";
import { autoAbsentCronJob } from "./jobs/automarkabsent.job.js";
import { startCouponExpiryCron } from "./jobs/couponexpiry.job.js";

import razorpayWebhookRoutes from "./routes/razorpaywebhook.routes.js";
import oauthRouter from "./routes/zohoauth.routes.js";
import zohoRoutes from "./routes/zoho.routes.js";
import userRoutes from "./routes/users.routes.js";
import addressRoutes from "./routes/addresses.routes.js";
import brandRoutes from "./routes/brands.routes.js";
import employeeRoutes from "./routes/employees.routes.js";
import categoryRoutes from "./routes/categories.routes.js";
import contactRoutes from "./routes/contacts.routes.js";
import couponRoutes from "./routes/coupons.routes.js";
import bannerRoutes from "./routes/banners.routes.js";
import cartRoutes from "./routes/carts.routes.js";
import ipAnalyticsRoutes from "./routes/ipanalytics.routes.js";
import videoRoutes from "./routes/videos.routes.js";
import reviewRoutes from "./routes/reviews.routes.js";
import productRoutes from "./routes/products.routes.js";
import stockAuditRoutes from "./routes/stockauditlogs.routes.js";
import permissionRoutes from "./routes/permissions.routes.js";
import orderRoutes from "./routes/orders.routes.js";
import libraryLogRoutes from "./routes/librarylogs.routes.js";
import awsUploadRoutes from "./routes/aws.routes.js";
import attendanceRoutes from "./routes/attendance.routes.js";
import careerRoutes from "./routes/careers.routes.js";
import blogRoutes from "./routes/blogs.routes.js";
import invoiceRoutes from "./routes/invoices.routes.js";
import productReviewRoutes from "./routes/productreviews.routes.js";
import testimonialRoutes from "./routes/testimonials.routes.js";
import notificationRoutes from "./routes/notifications.routes.js";
import leadRoutes from "./routes/leads.routes.js";
import manualOrderRoutes from "./routes/manualorders.routes.js";
import creditNoteRoutes from "./routes/creditnotes.routes.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = express();
const allowedOrigins = getAllowedOrigins();

/* ----------------------------- Request basics ---------------------------- */
app.set("trust proxy", true);
app.use(requestIdMiddleware);
app.use(helmetMiddleware);
app.use(express.json());

// Razorpay webhook. NOTE: express.json() above already parses this body, so the raw-body
// signature check in the controller cannot work. See docs/quality/REPORT.md ("decisions") before
// moving this line above express.json(): that switches real refund processing on.
app.use("/api/webhook", razorpayWebhookRoutes);

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morganMiddleware);
app.use(passport.initialize());
setupPassport();
app.use(cors(buildCorsOptions(allowedOrigins)));

/* ------------------------------ Health check ----------------------------- */
app.get("/", (req, res) => {
  res.status(200).json({ success: true, message: "Server is running successfully 🚀" });
});

/* ------------------------- Rate limits and analytics ---------------------- */
app.use(STRICT_LIMIT_PATHS, authRateLimiter);
app.use("/api", generalRateLimiter);
app.use(clientIpMiddleware);
app.use(ipAnalyticsMiddleware);

/* --------------------------------- Routes -------------------------------- */
app.use("/oauth", oauthRouter);
app.use("/api", zohoRoutes);
app.use("/api/v1/user", userRoutes);
app.use("/api/v1/user/address", addressRoutes);
app.use("/api/v1/brand", brandRoutes);
app.use("/api/v1/employee", employeeRoutes);
app.use("/api/v1/category", categoryRoutes);
app.use("/api/v1/contact", contactRoutes);
app.use("/api/v1/coupons", couponRoutes);
app.use("/api/v1/banner", bannerRoutes);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/ipAnalytics", ipAnalyticsRoutes);
app.use("/api/v1/video", videoRoutes);
app.use("/api/v1/rating", reviewRoutes);
app.use("/api/v1/product", productRoutes);
app.use("/api/v1/stock-audit", stockAuditRoutes);
app.use("/api/v1/permission", permissionRoutes);
app.use("/api/v1/order", orderRoutes);
app.use("/api/v1/librarylog", libraryLogRoutes);
app.use("/api/v1/aws", awsUploadRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/career", careerRoutes);
app.use("/api/v1/blog", blogRoutes);
app.use("/api/v1/invoice", invoiceRoutes);
app.use("/api/v1/product-review", productReviewRoutes);
app.use("/api/v1/notification", notificationRoutes);
app.use("/api/v1/leads", leadRoutes);
app.use("/api/v1/manual-order", manualOrderRoutes);
app.use("/api/v1/credit-note", creditNoteRoutes);
app.use("/api/v1/testimonial", testimonialRoutes);

/* ----------------------- Error handling (always last) --------------------- */
app.use(notFoundHandler);
app.use(errorHandler);

/* ------------------------------ Start / stop ----------------------------- */
const server = http.createServer(app);
const io = initSocket(server, allowedOrigins);
let isShuttingDown = false;

/**
 * Stops accepting requests, stops cron jobs, closes Socket.IO and MongoDB, then exits.
 * Forces the exit after SHUTDOWN_TIMEOUT_MS so a stuck connection cannot keep the process alive.
 *
 * @param {string} reason Why we are shutting down (signal name or error type).
 * @param {number} [exitCode=0]
 */
const shutdown = async (reason, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info("Shutting down", { reason });
  setTimeout(() => process.exit(exitCode || 1), SHUTDOWN_TIMEOUT_MS).unref();
  try {
    stopAllJobs();
    await new Promise((resolve) => io.close(() => resolve()));
    if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
    await mongoose.connection.close();
  } catch (error) {
    logger.error("Error during shutdown", { error });
  } finally {
    process.exit(exitCode);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { error: reason });
  shutdown("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", { error });
  shutdown("uncaughtException", 1);
});

const startServer = async () => {
  try {
    await connectDB();
    await redis.ping();
    bestSellerCronJob();
    autoAbsentCronJob();
    startCouponExpiryCron();
    server.listen(env.PORT, () => {
      logger.info("Server started", {
        url: `http://localhost:${env.PORT}`,
        socketIo: true,
        environment: env.NODE_ENV,
      });
    });
  } catch (error) {
    logger.error("Server failed to start", { error });
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== "test") startServer();

export default app;
