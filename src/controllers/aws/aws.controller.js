/**
 * HTTP handlers for S3 file storage: read the request, call the service, send the response. No
 * business logic here.
 *
 * Exports: generateDownloadPresignedUrl
 * Used by: routes/aws.routes.js
 */

/**
 * S3 file download links.
 * NOTE: this route has no auth middleware, so anyone with a file URL can get a download link.
 * See docs/quality/REPORT.md ("decisions").
 *
 * Route: GET /api/v1/aws/download-presigned-url?file=<full S3 URL>
 * Used by: routes/aws.routes.js
 */
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { BadRequestError } from "../../helpers/apperror.helper.js";
import { sendSuccess } from "../../helpers/response.helper.js";
import { createDownloadUrlService } from "../../services/aws/aws.service.js";

/**
 * Returns a 10-minute download link for one S3 file.
 * Response keeps the old top-level `downloadUrl` next to `data` (see API_RESPONSE_MIGRATION.md).
 */
export const generateDownloadPresignedUrl = asyncHandler(async (req, res) => {
  const { file } = req.query;
  if (!file) throw new BadRequestError("file is required");
  const downloadUrl = await createDownloadUrlService(file);
  return sendSuccess(res, {
    data: { downloadUrl },
    message: "Download URL generated",
    legacyTopLevel: { downloadUrl },
  });
});
