/**
 * Business logic for YouTube videos shown on the website. Throws AppError subclasses on failure.
 *
 * Exports: getYTDocService, addVideoService, getVideoByIdService, updateVideoService,
 * deleteVideoService
 * Used by: controllers/video/video.controller.js
 */

import YTVideo from "../../models/video.model.js";
import Employee from "../../models/employee.model.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { v6 as uuidv6 } from "uuid";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";

/* =========================================================
   CACHE CONFIG
========================================================= */
const CACHE_TTL = 60 * 60;

/* =========================================================
   CACHE HELPERS
========================================================= */
const getCache = async (key) => {
  try {
    const cached = await redisClient.get(key);
    if (!cached) return null;
    return JSON.parse(cached);
  } catch (err) {
    logger.error("REDIS GET CACHE ERROR", { error: err.message });
    return null;
  }
};

const setCache = async (key, data) => {
  try {
    await redisClient.set(key, JSON.stringify(data), { ex: CACHE_TTL });
  } catch (err) {
    logger.error("REDIS SET CACHE ERROR", { error: err.message });
  }
};

const clearYTVideoCache = async () => {
  try {
    const keys = await redisClient.keys("YTVIDEO:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("YT VIDEO CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS CLEAR CACHE ERROR", { error: err.message });
  }
};

/* =========================================================
   GET ALL VIDEOS
========================================================= */
/**
 * Get YouTube document.
 *
 * @param {object} params
 * @param {*} [params.page]
 * @param {*} [params.limit]
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const getYTDocService = async ({ page = 1, limit = 10 }) => {
  const pageNum = Math.max(Number(page) || 1, 1);
  const limitNum = Math.max(Number(limit) || 10, 1);
  const skipNum = (pageNum - 1) * limitNum;

  /* ---------- CACHE KEY ---------- */
  const cacheKey = `YTVIDEO:ALL:${pageNum}:${limitNum}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("YT VIDEO CACHE HIT", { cacheKey });
    return cached;
  }

  /* ---------- GET OR CREATE DOC ---------- */
  let doc = await YTVideo.findOne().lean();
  if (!doc) {
    const created = await YTVideo.create({ videos: [] });
    doc = created.toObject();
  }

  /* ---------- EDGE CASE: empty videos ---------- */
  if (!Array.isArray(doc.videos) || doc.videos.length === 0) {
    return {
      pagination: {
        totalItems: 0,
        totalPages: 0,
        currentPage: pageNum,
        nextPage: null,
        prevPage: null,
        limit: limitNum,
      },
      videos: [],
    };
  }

  /* ---------- PAGINATION ---------- */
  const totalItems = doc.videos.length;
  const totalPages = Math.ceil(totalItems / limitNum);

  /* ---------- EDGE CASE: page out of range ---------- */
  if (pageNum > totalPages) {
    throw new BadRequestError(`Page ${pageNum} does not exist. Total pages: ${totalPages}`, {
      code: ERROR_CODES.PAGE_OUT_OF_RANGE,
    });
  }

  const paginatedVideos = doc.videos.slice(skipNum, skipNum + limitNum);

  const result = {
    pagination: {
      totalItems,
      totalPages,
      currentPage: pageNum,
      nextPage: pageNum < totalPages ? pageNum + 1 : null,
      prevPage: pageNum > 1 ? pageNum - 1 : null,
      limit: limitNum,
    },
    videos: paginatedVideos,
  };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   ADD VIDEO
========================================================= */
/**
 * Add video.
 *
 * @param {object} params
 * @param {*} params.title
 * @param {*} params.link
 * @param {*} params.permission
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const addVideoService = async ({ title, link, permission, userEmail }) => {
  /* ---------- EDGE CASE: missing fields ---------- */
  if (!title?.trim() || !link?.trim()) {
    throw new BadRequestError("Title and link are required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  /* ---------- EDGE CASE: basic URL check ---------- */
  try {
    new URL(link);
  } catch {
    throw new BadRequestError("Invalid video link URL", { code: ERROR_CODES.INVALID_URL });
  }

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({ email: userEmail, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- GET OR CREATE DOC ---------- */
  let doc = await YTVideo.findOne();
  if (!doc) {
    doc = await YTVideo.create({ videos: [] });
  }

  /* ---------- EDGE CASE: duplicate link ---------- */
  const duplicateLink = doc.videos.find((v) => v.link.trim().toLowerCase() === link.trim().toLowerCase());
  if (duplicateLink) {
    throw new ConflictError("A video with this link already exists", {
      code: ERROR_CODES.DUPLICATE_VIDEO_LINK,
    });
  }

  /* ---------- CREATE VIDEO ---------- */
  const newVideo = {
    ytVideoId: uuidv6(),
    title: title.trim(),
    link: link.trim(),
  };

  doc.videos.push(newVideo);
  await doc.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearYTVideoCache();

  /* ---------- AUDIT ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: doc._id,
    action: `Added YouTube Video | ${newVideo.title}`,
    permission: permission || "video.create",
    actionType: "Create",
    metadata: {
      ytVideoId: newVideo.ytVideoId,
      title: newVideo.title,
      link: newVideo.link,
    },
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "cms.video.create",
      title: "New YouTube Video Added",
      message: `YouTube video "${newVideo.title}" added by ${employee.email}`,
      type: "YOUTUBE_VIDEO_CREATED",
      entityId: newVideo.ytVideoId,
      entityModel: "YTVideo",
      metadata: {
        ytVideoId: newVideo.ytVideoId,
        title: newVideo.title,
        link: newVideo.link,
        createdBy: employee.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on video add", { error: err.message });
  }

  return { video: newVideo };
};

/* =========================================================
   GET VIDEO BY ID
========================================================= */
/**
 * Get video by id.
 *
 * @param {object} params
 * @param {*} params.ytVideoId
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getVideoByIdService = async ({ ytVideoId }) => {
  /* ---------- EDGE CASE: missing id ---------- */
  if (!ytVideoId?.trim()) {
    throw new BadRequestError("ytVideoId is required", { code: ERROR_CODES.VALIDATION_ERROR });
  }

  /* ---------- CACHE CHECK ---------- */
  const cacheKey = `YTVIDEO:ID:${ytVideoId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("YT VIDEO CACHE HIT", { cacheKey });
    return cached;
  }

  /* ---------- FETCH DOC ---------- */
  const doc = await YTVideo.findOne().lean();
  if (!doc) {
    throw new NotFoundError("No video document found", { code: ERROR_CODES.DOC_NOT_FOUND });
  }

  /* ---------- FIND VIDEO ---------- */
  const video = doc.videos.find((v) => v.ytVideoId === ytVideoId);
  if (!video) {
    throw new NotFoundError("Video not found", { code: ERROR_CODES.VIDEO_NOT_FOUND });
  }

  const result = { video };

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   UPDATE VIDEO
========================================================= */
/**
 * Update video.
 *
 * @param {object} params
 * @param {*} params.ytVideoId
 * @param {*} params.title
 * @param {*} params.link
 * @param {*} params.permission
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {BadRequestError} 400 when the input breaks a rule.
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateVideoService = async ({ ytVideoId, title, link, permission, userEmail }) => {
  /* ---------- EDGE CASE: nothing to update ---------- */
  if (!title?.trim() && !link?.trim()) {
    throw new BadRequestError("At least one field (title or link) is required to update", {
      code: ERROR_CODES.NOTHING_TO_UPDATE,
    });
  }

  /* ---------- EDGE CASE: URL validation ---------- */
  if (link) {
    try {
      new URL(link);
    } catch {
      throw new BadRequestError("Invalid video link URL", { code: ERROR_CODES.INVALID_URL });
    }
  }

  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({ email: userEmail, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- FETCH DOC ---------- */
  const doc = await YTVideo.findOne();
  if (!doc) {
    throw new NotFoundError("No video document found", { code: ERROR_CODES.DOC_NOT_FOUND });
  }

  /* ---------- FIND VIDEO ---------- */
  const video = doc.videos.find((v) => v.ytVideoId === ytVideoId);
  if (!video) {
    throw new NotFoundError("Video not found", { code: ERROR_CODES.VIDEO_NOT_FOUND });
  }

  /* ---------- EDGE CASE: duplicate link (excluding self) ---------- */
  if (link) {
    const duplicateLink = doc.videos.find(
      (v) => v.link.trim().toLowerCase() === link.trim().toLowerCase() && v.ytVideoId !== ytVideoId
    );
    if (duplicateLink) {
      throw new ConflictError("Another video with this link already exists", {
        code: ERROR_CODES.DUPLICATE_VIDEO_LINK,
      });
    }
  }

  /* ---------- TRACK CHANGES FOR AUDIT ---------- */
  const changes = {};
  if (title?.trim() && title.trim() !== video.title) {
    changes.title = { from: video.title, to: title.trim() };
    video.title = title.trim();
  }
  if (link?.trim() && link.trim() !== video.link) {
    changes.link = { from: video.link, to: link.trim() };
    video.link = link.trim();
  }

  /* ---------- EDGE CASE: no actual change ---------- */
  if (Object.keys(changes).length === 0) {
    throw new BadRequestError("No changes detected — values are the same as existing", {
      code: ERROR_CODES.NO_CHANGES_DETECTED,
    });
  }

  await doc.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearYTVideoCache();

  /* ---------- AUDIT ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: doc._id,
    action: `Updated YouTube Video | ${video.title}`,
    permission: permission || "video.update",
    actionType: "Update",
    metadata: {
      ytVideoId: video.ytVideoId,
      changes,
    },
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "cms.video.update",
      title: "YouTube Video Updated",
      message: `YouTube video "${video.title}" updated by ${employee.email}`,
      type: "YOUTUBE_VIDEO_UPDATED",
      entityId: video.ytVideoId,
      entityModel: "YTVideo",
      metadata: {
        ytVideoId: video.ytVideoId,
        title: video.title,
        link: video.link,
        changes,
        updatedBy: employee.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on video update", { error: err.message });
  }

  return { video };
};

/* =========================================================
   DELETE VIDEO
========================================================= */
/**
 * Delete video.
 *
 * @param {object} params
 * @param {*} params.ytVideoId
 * @param {*} params.permission
 * @param {*} params.userEmail
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteVideoService = async ({ ytVideoId, permission, userEmail }) => {
  /* ---------- FETCH EMPLOYEE ---------- */
  const employee = await Employee.findOne({ email: userEmail, isDeleted: false });
  if (!employee) {
    throw new NotFoundError("Employee not found", { code: ERROR_CODES.EMPLOYEE_NOT_FOUND });
  }

  /* ---------- FETCH DOC ---------- */
  const doc = await YTVideo.findOne();
  if (!doc) {
    throw new NotFoundError("No video document found", { code: ERROR_CODES.DOC_NOT_FOUND });
  }

  /* ---------- FIND VIDEO ---------- */
  const videoToDelete = doc.videos.find((v) => v.ytVideoId === ytVideoId);
  if (!videoToDelete) {
    throw new NotFoundError("Video not found", { code: ERROR_CODES.VIDEO_NOT_FOUND });
  }

  /* ---------- DELETE VIDEO ---------- */
  doc.videos = doc.videos.filter((v) => v.ytVideoId !== ytVideoId);
  await doc.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearYTVideoCache();

  /* ---------- AUDIT ---------- */
  const audit = await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: doc._id,
    action: `Deleted YouTube Video | ${videoToDelete.title}`,
    permission: permission || "video.delete",
    actionType: "Delete",
    metadata: {
      ytVideoId: videoToDelete.ytVideoId,
      title: videoToDelete.title,
      link: videoToDelete.link,
    },
  });

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "cms.video.delete",
      title: "YouTube Video Deleted",
      message: `YouTube video "${videoToDelete.title}" deleted by ${employee.email}`,
      type: "YOUTUBE_VIDEO_DELETED",
      entityId: videoToDelete.ytVideoId,
      entityModel: "YTVideo",
      metadata: {
        ytVideoId: videoToDelete.ytVideoId,
        title: videoToDelete.title,
        link: videoToDelete.link,
        deletedBy: employee.email,
        auditId: audit._id,
      },
    });
  } catch (err) {
    logger.error("Notification failed on video delete", { error: err.message });
  }

  return { deletedVideoId: ytVideoId };
};
