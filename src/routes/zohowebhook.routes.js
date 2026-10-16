/**
 * Routes for Zoho payment webhook (not mounted). NOTE: not mounted in app.js, so these endpoints
 * are not live.
 */

import express from "express";
import { zohoWebhookHandler } from "../controllers/zohowebhook/zohowebhook.controller.js";

const router = express.Router();

router.post("/zoho", zohoWebhookHandler);

export default router;
