/**
 * Parses JSON text fields of multipart (file upload) requests.
 *
 * Exports: parseMultipartJson
 * Used by: routes/products.routes.js
 */

import { BadRequestError } from "../helpers/apperror.helper.js";
import { ERROR_CODES } from "../constants/errorcodes.constant.js";
/**
 * @function parseMultipartJson
 *
 * @description
 * Middleware to parse stringified JSON fields in a multipart/form-data request.
 * Useful when sending nested JSON objects as form-data.
 *
 * @process
 * 1. Define all fields that may contain JSON strings
 * 2. Loop through each field
 * 3. If the field exists and is a string, attempt to parse it with JSON.parse
 * 4. If parsing fails, return 400 Bad Request with the field name
 * 5. If all fields are parsed successfully, call `next()`
 *
 * @response
 * 400 { success: false, message: "Invalid JSON format in field: <field>" } - if any field contains invalid JSON
 */
export const parseMultipartJson = (req, res, next) => {
  const fields = [
    "brand",
    "description",
    "specification",
    "variants",
    "attributes",
    "tags",
    "labels",
    "customFields",
    "metadata",
    "images",
    "descriptionImageMap",
    "variantImageMap",
    "removeImages",
    "removeDescImages",
    "removeVariantImages",
  ];

  for (const field of fields) {
    if (req.body[field] && typeof req.body[field] === "string") {
      try {
        req.body[field] = JSON.parse(req.body[field]);
      } catch (error) {
        return next(
          new BadRequestError(`Invalid JSON format in field: ${field}`, {
            code: ERROR_CODES.INVALID_JSON,
            details: [{ field, message: "must be valid JSON" }],
            cause: error,
          })
        );
      }
    }
  }
  next();
};
