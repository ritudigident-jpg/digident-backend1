/**
 * Routes for Razorpay webhook (refund events). Mounted at /api/webhook (1 endpoints, listed in
 * docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { razorpayWebhook } from "../controllers/razorpaywebhook/razorpaywebhook.controller.js";

const router = express.Router();

// MUST USE RAW BODY FOR SIGNATURE VERIFY
router.post("/razorpay", express.raw({ type: "application/json" }), razorpayWebhook);

export default router;
