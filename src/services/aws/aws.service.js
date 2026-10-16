/**
 * Business logic for S3 file storage. Throws AppError subclasses on failure.
 *
 * Exports: uploadToS3, deleteFromS3, createDownloadUrlService, uploadPrivateObject,
 * createPrivateDownloadUrl, deletePrivateObject
 * Used by: 8 files, e.g. controllers/aws/aws.controller.js,
 * controllers/jobapplication/jobapplication.controller.js, services/banner/banner.service.js,
 * services/blog/blog.service.js
 */

/**
 * Amazon S3 helpers: upload a file from disk, delete a file by URL, create a download link.
 * Failures from S3 are thrown as ExternalServiceError (502) with the original error as cause.
 *
 * Used by: controllers/aws, controllers/jobapplication and the services that store images
 */
import fs from "node:fs";
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3Client, awsConfig } from "../../config/aws.config.js";
import { AppError, BadRequestError, ExternalServiceError } from "../../helpers/apperror.helper.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { logger } from "../../helpers/logger.helper.js";

const DOWNLOAD_URL_EXPIRES_SECONDS = 10 * 60;

const publicUrlFor = (key) => `https://${awsConfig.bucket}.s3.amazonaws.com/${key}`;

/**
 * Uploads a multer file (stored on disk) to S3 and removes the temporary file afterwards.
 * Example: folder "careers/resumes" -> key "careers/resumes/1729050000000-cv.pdf".
 *
 * @param {{ path: string, originalname: string, mimetype: string }} file Multer disk file.
 * @param {string} folder S3 folder.
 * @returns {Promise<{ key: string, url: string }>}
 * @throws {ExternalServiceError} When S3 rejects the upload.
 */
export const uploadToS3 = async (file, folder) => {
  const key = `${folder}/${Date.now()}-${file.originalname}`;
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        Body: fs.createReadStream(file.path),
        ContentType: file.mimetype,
      })
    );
    return { key, url: publicUrlFor(key) };
  } catch (error) {
    throw new ExternalServiceError("File upload failed", { cause: error });
  } finally {
    fs.promises
      .unlink(file.path)
      .catch((error) =>
        logger.warn("Temporary upload file not removed", { path: file.path, error: error.message })
      );
  }
};

/**
 * Deletes a file from S3 by its full URL. Best-effort: a failure is logged, never thrown,
 * because it is used to clean up after another failure.
 *
 * @param {string} fileUrl Full S3 URL.
 * @returns {Promise<void>}
 */
export const deleteFromS3 = async (fileUrl) => {
  if (!fileUrl) return;
  try {
    const key = decodeURIComponent(new URL(fileUrl).pathname.substring(1));
    await s3Client.send(new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: key }));
  } catch (error) {
    logger.error("S3 delete failed", { fileUrl, error });
  }
};

/**
 * Creates a download link for an S3 file that is valid for 10 minutes.
 *
 * @param {string} fileUrl Full S3 URL.
 * @returns {Promise<string>} Pre-signed download URL.
 * @throws {BadRequestError} When fileUrl is not a valid URL.
 * @throws {ExternalServiceError} When S3 cannot sign the URL.
 */
export const createDownloadUrlService = async (fileUrl) => {
  let key;
  try {
    key = decodeURIComponent(new URL(fileUrl).pathname.slice(1));
  } catch (error) {
    throw new BadRequestError("file must be a full S3 URL", { cause: error });
  }
  try {
    return await getSignedUrl(s3Client, new GetObjectCommand({ Bucket: awsConfig.bucket, Key: key }), {
      expiresIn: DOWNLOAD_URL_EXPIRES_SECONDS,
    });
  } catch (error) {
    throw new ExternalServiceError("Failed to generate download URL", { cause: error });
  }
};

/* -------------------------------------------------------------------------------------------
 * PRIVATE objects (employee documents): random keys chosen by the caller, server-side encryption,
 * never a public URL. Read only through a short-lived signed URL after a permission check.
 * ----------------------------------------------------------------------------------------- */
const S3_TIMEOUT_MS = 15_000;
const PRIVATE_DOWNLOAD_URL_EXPIRES_SECONDS = 5 * 60;

const assertStorageConfigured = () => {
  if (!awsConfig.bucket || !awsConfig.region) {
    throw new AppError("File storage is not configured", { code: ERROR_CODES.STORAGE_NOT_CONFIGURED });
  }
};

/**
 * Stores a buffer privately. Example key: "employee-documents/<employeeId>/<uuid>.pdf".
 *
 * @param {{ key: string, buffer: Buffer, contentType: string }} input
 * @returns {Promise<void>}
 * @throws {AppError} 500 STORAGE_NOT_CONFIGURED
 * @throws {ExternalServiceError} 502 when S3 rejects or times out
 */
export const uploadPrivateObject = async ({ key, buffer, contentType }) => {
  assertStorageConfigured();
  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
        ACL: "private",
      }),
      { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }
    );
  } catch (error) {
    throw new ExternalServiceError("File upload failed", { cause: error });
  }
};

/**
 * Signed download link to a private object, valid for 5 minutes, downloaded under `fileName`.
 *
 * @param {string} key
 * @param {string} fileName
 * @returns {Promise<{ url: string, expiresInSeconds: number }>}
 * @throws {ExternalServiceError} 502 when S3 cannot sign the URL
 */
export const createPrivateDownloadUrl = async (key, fileName) => {
  assertStorageConfigured();
  try {
    const safeName = String(fileName).replace(/[^A-Za-z0-9._-]/g, "_");
    const url = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: awsConfig.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
      }),
      { expiresIn: PRIVATE_DOWNLOAD_URL_EXPIRES_SECONDS }
    );
    return { url, expiresInSeconds: PRIVATE_DOWNLOAD_URL_EXPIRES_SECONDS };
  } catch (error) {
    throw new ExternalServiceError("Failed to generate download URL", { cause: error });
  }
};

/**
 * Deletes a private object. Best-effort (used for cleanup): failures are logged, never thrown.
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
export const deletePrivateObject = async (key) => {
  if (!key || !awsConfig.bucket) return;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: awsConfig.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS),
    });
  } catch (error) {
    logger.error("S3 private delete failed", { key, error });
  }
};
