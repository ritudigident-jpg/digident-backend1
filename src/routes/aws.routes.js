/**
 * Routes for S3 file storage. Mounted at /api/v1/aws (1 endpoints, listed in docs/ENDPOINTS.md).
 *
 * Used by: app.js
 */

import express from "express";
import { generateDownloadPresignedUrl } from "../controllers/aws/aws.controller.js";

const router = express.Router();

router.get("/download-presigned-url", generateDownloadPresignedUrl);

export default router;
