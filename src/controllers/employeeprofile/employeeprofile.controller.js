/**
 * HTTP handlers for employee information (profile sections) and employee documents.
 * Read the request, call the service, send the response. Permissions: see the route file and the
 * owner-or-permission checks inside the services.
 *
 * Used by: routes/employeeprofile.routes.js
 */
import { sendCreated, sendPaginated, sendSuccess } from "../../helpers/response.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";
import { listPagination } from "../../helpers/pagination.helper.js";
import {
  getMyProfileService,
  getProfileService,
  updateMyProfileService,
  updateProfileService,
} from "../../services/employeeprofile/employeeprofile.service.js";
import {
  deleteDocumentService,
  getDocumentDownloadService,
  listDocumentsService,
  uploadDocumentService,
  verifyDocumentService,
} from "../../services/employeeprofile/employeedocument.service.js";

/** GET /employee-profile/me */
export const getMyProfile = asyncHandler(async (req, res) => {
  const data = await getMyProfileService(req.currentUser);
  return sendSuccess(res, { data, message: "Profile fetched" });
});

/** PUT /employee-profile/me { phone?, currentAddress?, permanentAddress?, emergencyContact? } */
export const updateMyProfile = asyncHandler(async (req, res) => {
  const data = await updateMyProfileService(req.currentUser, req.body);
  return sendSuccess(res, { data, message: "Profile updated" });
});

/** GET /employee-profile/:employeeId?reveal=true */
export const getProfile = asyncHandler(async (req, res) => {
  const data = await getProfileService(req.currentUser, req.params.employeeId, { reveal: req.query.reveal });
  return sendSuccess(res, { data, message: "Profile fetched" });
});

/** PUT /employee-profile/:employeeId { account?, personal?, employment?, bank? } */
export const updateProfile = asyncHandler(async (req, res) => {
  const data = await updateProfileService(req.currentUser, req.params.employeeId, req.body);
  return sendSuccess(res, { data, message: "Profile updated" });
});

/** GET /employee-profile/me/documents and /employee-profile/:employeeId/documents */
export const listDocuments = asyncHandler(async (req, res) => {
  const pagination = listPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const employeeId = req.params.employeeId || req.currentUser._id;
  const { items, total } = await listDocumentsService(req.currentUser, employeeId, { ...req.query, ...pagination });
  return sendPaginated(res, { data: items, pagination: { ...pagination, total }, message: "Documents fetched" });
});

/** POST /employee-profile/me/documents and /employee-profile/:employeeId/documents (multipart: file, documentType, title?, expiryDate?) */
export const uploadDocument = asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId || req.currentUser._id;
  const data = await uploadDocumentService(req.currentUser, employeeId, req.file, req.body);
  return sendCreated(res, { data, message: "Document uploaded" });
});

/** GET /employee-profile/documents/:documentId/download -> { url, expiresInSeconds, fileName } */
export const downloadDocument = asyncHandler(async (req, res) => {
  const data = await getDocumentDownloadService(req.currentUser, req.params.documentId);
  return sendSuccess(res, { data, message: "Download link created" });
});

/** PATCH /employee-profile/documents/:documentId/verify { status, rejectionReason? } */
export const verifyDocument = asyncHandler(async (req, res) => {
  const data = await verifyDocumentService(req.currentUser, req.params.documentId, req.body);
  return sendSuccess(res, { data, message: `Document ${data.status.toLowerCase()}` });
});

/** DELETE /employee-profile/documents/:documentId */
export const deleteDocument = asyncHandler(async (req, res) => {
  const data = await deleteDocumentService(req.currentUser, req.params.documentId);
  return sendSuccess(res, { data, message: "Document deleted" });
});
