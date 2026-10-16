/**
 * Routes for employee information and documents. Mounted at /api/v1/employee-profile (listed in
 * docs/ENDPOINTS.md). Every route needs a login. "me" routes act on the caller; the others check
 * a permission fixed here (or owner-or-permission inside the service for documents).
 *
 * Used by: app.js
 */
import express from "express";
import auth from "../middlewares/auth.middleware.js";
import { attachCurrentEmployee, requirePermission } from "../middlewares/permission.middleware.js";
import { validate, validateObjectIdParams } from "../middlewares/validate.middleware.js";
import { uploadDocument as uploadDocumentFile } from "../middlewares/multer.middleware.js";
import { PERMISSIONS } from "../constants/permissions.constant.js";
import {
  deleteDocument,
  downloadDocument,
  getMyProfile,
  getProfile,
  listDocuments,
  updateMyProfile,
  updateProfile,
  uploadDocument,
  verifyDocument,
} from "../controllers/employeeprofile/employeeprofile.controller.js";
import {
  documentListQuerySchema,
  documentMetaSchema,
  myProfileSchema,
  profileSchema,
  revealQuerySchema,
  verifyDocumentSchema,
} from "../controllers/employeeprofile/employeeprofile.validator.js";

const router = express.Router();

/* ---------------- Own profile and documents ---------------- */
router.get("/me", auth, attachCurrentEmployee, getMyProfile);
router.put("/me", auth, attachCurrentEmployee, validate(myProfileSchema), updateMyProfile);
router.get("/me/documents", auth, attachCurrentEmployee, validate(documentListQuerySchema, "query"), listDocuments);
router.post(
  "/me/documents",
  auth,
  attachCurrentEmployee,
  uploadDocumentFile.single("file"),
  validate(documentMetaSchema),
  uploadDocument
);

/* ---------------- Documents by id (owner or permission, checked in the service) ---------------- */
router.get("/documents/:documentId/download", auth, attachCurrentEmployee, validateObjectIdParams("documentId"), downloadDocument);
router.patch(
  "/documents/:documentId/verify",
  auth,
  requirePermission(PERMISSIONS.DOCUMENT_VERIFY),
  validateObjectIdParams("documentId"),
  validate(verifyDocumentSchema),
  verifyDocument
);
router.delete("/documents/:documentId", auth, attachCurrentEmployee, validateObjectIdParams("documentId"), deleteDocument);

/* ---------------- Any employee (admins / HR) ---------------- */
router.get(
  "/:employeeId",
  auth,
  requirePermission(PERMISSIONS.PROFILE_READ),
  validateObjectIdParams("employeeId"),
  validate(revealQuerySchema, "query"),
  getProfile
);
router.put(
  "/:employeeId",
  auth,
  requirePermission(PERMISSIONS.PROFILE_UPDATE),
  validateObjectIdParams("employeeId"),
  validate(profileSchema),
  updateProfile
);
router.get(
  "/:employeeId/documents",
  auth,
  requirePermission(PERMISSIONS.DOCUMENT_READ),
  validateObjectIdParams("employeeId"),
  validate(documentListQuerySchema, "query"),
  listDocuments
);
router.post(
  "/:employeeId/documents",
  auth,
  requirePermission(PERMISSIONS.PROFILE_UPDATE),
  validateObjectIdParams("employeeId"),
  uploadDocumentFile.single("file"),
  validate(documentMetaSchema),
  uploadDocument
);

export default router;
