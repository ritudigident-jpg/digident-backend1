/**
 * Routes for this area. Mounted at /oauth (1 endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { exchangeZohoAuthCode } from "../controllers/zoho/zoho.controller.js";

const router = express.Router();

router.get("/redirect", exchangeZohoAuthCode);

export default router;
