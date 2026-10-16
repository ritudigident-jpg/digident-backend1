/**
 * Routes for API usage per IP address per month. Mounted at /api/v1/ipAnalytics (3 endpoints,
 * listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import {
  getAllIpAnalytics,
  getIpAnalytics,
  ipAnalyticsDashboard,
} from "../controllers/ipanalytics/ipanalytics.controller.js";

const router = express.Router();

/**
 * GET /api/v1/ip-analytics
 */
router.get("/", getIpAnalytics);
router.get("/all", getAllIpAnalytics);
router.get("/dashboard", ipAnalyticsDashboard);

export default router;
