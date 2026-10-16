/**
 * Routes for stock change history. Mounted at /api/v1/stock-audit (1 endpoints, listed in
 * docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { getStockAuditLogs } from "../controllers/stockauditlog/stockauditlog.controller.js";

const router = express.Router();

router.get("/get", getStockAuditLogs);

export default router;
