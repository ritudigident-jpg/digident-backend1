/**
 * Routes for Zoho Mail (account lookup, OAuth setup and sending e-mail). Mounted at /api (1
 * endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { getAccountId } from "../controllers/zoho/zoho.controller.js";

const router = express.Router();

router.get("/zoho/accounts", getAccountId);

export default router;
