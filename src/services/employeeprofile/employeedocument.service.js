/**
 * Employee documents: upload, list, download, verify, delete.
 *
 * File rules: PDF / JPG / PNG only, max 5 MB, type checked from the file's bytes (not its name or
 * declared type), stored privately in S3 under a random key, metadata only in MongoDB. Downloads
 * go through a permission check and return a 5-minute signed URL; every download, verification
 * and deletion is audited.
 *
 * Access: the employee for their own documents (upload, list, download, delete while not
 * verified); employee.document.read to list / download anyone's; employee.document.verify to
 * verify / reject / delete; employee.profile.update to upload for someone else.
 *
 * Exports: uploadDocumentService, listDocumentsService, getDocumentDownloadService,
 * verifyDocumentService, deleteDocumentService
 * Used by: controllers/employeeprofile/employeeprofile.controller.js
 */
import { v4 as uuidv4 } from "uuid";
import EmployeeDocument from "../../models/employeedocument.model.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { PERMISSIONS } from "../../constants/permissions.constant.js";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, detectFileType } from "../../helpers/filetype.helper.js";
import { writeHrAudit } from "../../helpers/hraudit.helper.js";
import { employeeHasPermission } from "../../middlewares/permission.middleware.js";
import { createPrivateDownloadUrl, deletePrivateObject, uploadPrivateObject } from "../aws/aws.service.js";
import { findActiveEmployeeById } from "../employee/employeelookup.service.js";

const isSelf = (actor, employeeId) => String(actor._id) === String(employeeId);

const toPublic = (document) => ({
  documentId: document._id,
  employee: document.employee,
  documentType: document.documentType,
  title: document.title,
  originalName: document.originalName,
  mimeType: document.mimeType,
  sizeBytes: document.sizeBytes,
  expiryDate: document.expiryDate,
  status: document.status,
  rejectionReason: document.rejectionReason,
  uploadedBy: document.uploadedBy,
  verifiedBy: document.verifiedBy,
  verifiedAt: document.verifiedAt,
  createdAt: document.createdAt,
});

const notFound = () => new NotFoundError("Document not found", { code: ERROR_CODES.DOCUMENT_NOT_FOUND });

/**
 * Uploads one document for an employee.
 *
 * @param {object} actor req.currentUser
 * @param {string} employeeId
 * @param {{ buffer: Buffer, size: number, originalname: string } | undefined} file multer memory file
 * @param {{ documentType: string, title?: string, expiryDate?: string }} meta
 * @returns {Promise<object>}
 * @throws {BadRequestError} 400 NO_FILE_UPLOADED / FILE_TOO_LARGE / INVALID_FILE_TYPE
 * @throws {ForbiddenError} 403 PERMISSION_DENIED when uploading for someone else without employee.profile.update
 */
export const uploadDocumentService = async (actor, employeeId, file, meta) => {
  if (!isSelf(actor, employeeId) && !employeeHasPermission(actor, PERMISSIONS.PROFILE_UPDATE)) {
    throw new ForbiddenError("You can upload only your own documents", { code: ERROR_CODES.PERMISSION_DENIED });
  }
  if (!file?.buffer?.length) throw new BadRequestError("Choose a file to upload", { code: ERROR_CODES.NO_FILE_UPLOADED });
  if (file.size > MAX_DOCUMENT_BYTES) throw new BadRequestError("File is larger than 5 MB", { code: ERROR_CODES.FILE_TOO_LARGE });
  const mimeType = detectFileType(file.buffer);
  if (!mimeType) {
    throw new BadRequestError("Only PDF, JPG or PNG files are allowed", { code: ERROR_CODES.INVALID_FILE_TYPE });
  }
  const employee = await findActiveEmployeeById(employeeId);
  const storageKey = `employee-documents/${employee._id}/${uuidv4()}.${ALLOWED_DOCUMENT_TYPES[mimeType]}`;
  await uploadPrivateObject({ key: storageKey, buffer: file.buffer, contentType: mimeType });

  let document;
  try {
    document = await EmployeeDocument.create({
      employee: employee._id,
      documentType: meta.documentType,
      title: meta.title || "",
      storageKey,
      originalName: String(file.originalname || "document").slice(0, 200),
      mimeType,
      sizeBytes: file.size,
      expiryDate: meta.expiryDate || null,
      uploadedBy: actor._id,
    });
  } catch (error) {
    await deletePrivateObject(storageKey);
    throw error;
  }
  await writeHrAudit({
    actor,
    targetEmployeeId: employee._id,
    action: "document.upload",
    permission: isSelf(actor, employeeId) ? "self" : PERMISSIONS.PROFILE_UPDATE,
    actionType: "create",
    details: { documentId: String(document._id), documentType: meta.documentType },
  });
  return toPublic(document.toObject());
};

/**
 * Documents of an employee, newest first, paginated.
 *
 * @param {object} actor
 * @param {string} employeeId
 * @param {{ skip: number, limit: number, status?: string }} query
 * @returns {Promise<{ items: object[], total: number }>}
 * @throws {NotFoundError} 404 when the actor may not see them
 */
export const listDocumentsService = async (actor, employeeId, { skip, limit, status }) => {
  if (!isSelf(actor, employeeId) && !employeeHasPermission(actor, PERMISSIONS.DOCUMENT_READ)) throw notFound();
  const filter = { employee: employeeId, isDeleted: false, ...(status ? { status } : {}) };
  const [documents, total] = await Promise.all([
    EmployeeDocument.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("verifiedBy", "firstName lastName").lean(),
    EmployeeDocument.countDocuments(filter),
  ]);
  return { items: documents.map(toPublic), total };
};

/**
 * Short-lived download link after a permission check; the download is audited.
 *
 * @param {object} actor
 * @param {string} documentId
 * @returns {Promise<{ url: string, expiresInSeconds: number, fileName: string }>}
 * @throws {NotFoundError} 404 DOCUMENT_NOT_FOUND (also when not allowed)
 */
export const getDocumentDownloadService = async (actor, documentId) => {
  const document = await EmployeeDocument.findOne({ _id: documentId, isDeleted: false }).select("+storageKey").lean();
  if (!document) throw notFound();
  const isOwner = isSelf(actor, document.employee);
  if (!isOwner && !employeeHasPermission(actor, PERMISSIONS.DOCUMENT_READ)) throw notFound();
  const link = await createPrivateDownloadUrl(document.storageKey, document.originalName);
  await writeHrAudit({
    actor,
    targetEmployeeId: document.employee,
    action: "document.download",
    permission: isOwner ? "self" : PERMISSIONS.DOCUMENT_READ,
    actionType: "view",
    details: { documentId: String(document._id), documentType: document.documentType },
  });
  return { ...link, fileName: document.originalName };
};

/**
 * Marks a document VERIFIED or REJECTED (reason required for rejection).
 *
 * @param {object} actor
 * @param {string} documentId
 * @param {{ status: "VERIFIED" | "REJECTED", rejectionReason?: string }} input
 * @returns {Promise<object>}
 * @throws {NotFoundError} 404 DOCUMENT_NOT_FOUND
 */
export const verifyDocumentService = async (actor, documentId, { status, rejectionReason }) => {
  const document = await EmployeeDocument.findOneAndUpdate(
    { _id: documentId, isDeleted: false },
    {
      $set: {
        status,
        rejectionReason: status === "REJECTED" ? rejectionReason : null,
        verifiedBy: actor._id,
        verifiedAt: new Date(),
      },
    },
    { new: true }
  ).lean();
  if (!document) throw notFound();
  await writeHrAudit({
    actor,
    targetEmployeeId: document.employee,
    action: `document.${status.toLowerCase()}`,
    permission: PERMISSIONS.DOCUMENT_VERIFY,
    details: { documentId: String(document._id), documentType: document.documentType },
  });
  return toPublic(document);
};

/**
 * Deletes a document: the owner while it is not VERIFIED, or someone with employee.document.verify.
 * Metadata is kept (isDeleted) for the audit trail; the stored file is removed.
 *
 * @param {object} actor
 * @param {string} documentId
 * @returns {Promise<{ documentId: string }>}
 * @throws {NotFoundError} 404 DOCUMENT_NOT_FOUND
 * @throws {ForbiddenError} 403 PERMISSION_DENIED (owner deleting a verified document)
 */
export const deleteDocumentService = async (actor, documentId) => {
  const document = await EmployeeDocument.findOne({ _id: documentId, isDeleted: false }).select("+storageKey").lean();
  if (!document) throw notFound();
  const canManage = employeeHasPermission(actor, PERMISSIONS.DOCUMENT_VERIFY);
  if (!canManage) {
    if (!isSelf(actor, document.employee)) throw notFound();
    if (document.status === "VERIFIED") {
      throw new ForbiddenError("A verified document can only be removed by HR", { code: ERROR_CODES.PERMISSION_DENIED });
    }
  }
  await EmployeeDocument.updateOne({ _id: documentId }, { $set: { isDeleted: true, deletedAt: new Date() } });
  await deletePrivateObject(document.storageKey);
  await writeHrAudit({
    actor,
    targetEmployeeId: document.employee,
    action: "document.delete",
    permission: canManage ? PERMISSIONS.DOCUMENT_VERIFY : "self",
    actionType: "delete",
    details: { documentId: String(document._id), documentType: document.documentType },
  });
  return { documentId };
};
