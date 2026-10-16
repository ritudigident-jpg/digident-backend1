/**
 * HTTP handlers for YouTube videos shown on the website: read the request, call the service, send
 * the response. No business logic here.
 *
 * Exports: getAllVideos, addVideo, updateVideo, getVideoById, deleteVideo
 * Used by: routes/videos.routes.js
 */

import {
  addVideoService,
  deleteVideoService,
  getVideoByIdService,
  getYTDocService,
  updateVideoService,
} from "../../services/video/video.service.js";
import { sendSuccess, sendCreated } from "../../helpers/response.helper.js";

import { validateAddVideoBody, validateUpdateVideo } from "./video.validator.js";
import { ValidationError } from "../../helpers/apperror.helper.js";
import { asyncHandler } from "../../helpers/asynchandler.helper.js";

/**
 * @function getYTDoc
 *
 * @params
 * query: {
 *   page?: number (default: 1),
 *   limit?: number (default: 12)
 * }
 *
 * @process
 * 1. Extract pagination using getPagination helper
 * 2. Fetch single YouTube document:
 *    - If not exists → create new document with empty videos array
 * 3. Apply in-memory pagination on videos array:
 *    - Use slice(skip, skip + limit)
 * 4. Return paginated videos with metadata
 *
 * @response
 * 200 {
 *   videos: [
 *     {
 *       title: string,
 *       url: string,
 *       thumbnail: string,
 *       createdAt: string
 *     }
 *   ],
 *   pagination: {
 *     totalRecords: number,
 *     totalPages: number,
 *     currentPage: number,
 *     limit: number
 *   }
 * }
 */

/* =========================================================
   GET ALL VIDEOS
========================================================= */
export const getAllVideos = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.max(Number(req.query.limit) || 10, 1);
  const skip = (page - 1) * limit;

  const result = await getYTDocService({ page, limit, skip });

  return sendSuccess(res, { data: result, message: "YouTube videos fetched successfully" });
});

/**
 * @function addVideo
 *
 * @params
 * body: {
 *   title: string (required),
 *   link: string (required),
 *   permission?: string
 * }
 *
 * headers:
 *   Authorization: Bearer token (required)
 *
 * @process
 * 1. Validate request body (title, link required)
 * 2. Extract logged-in user email from req.user
 * 3. Fetch employee from database
 *    - Throw error if employee not found
 * 4. Fetch YouTube document:
 *    - If not exists → create new document
 * 5. Create new video object:
 *    - Generate unique ytVideoId (UUID v6)
 * 6. Push video into videos array
 * 7. Save updated document
 * 8. Create permission audit log:
 *    - Track who added the video
 *    - Store action metadata
 * 9. Return newly added video
 *
 * @response
 * 201 {
 *   video: {
 *     ytVideoId: string,
 *     title: string,
 *     link: string
 *   }
 * }
 */

export const addVideo = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = validateAddVideoBody(req.body);
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  /* ---------- SERVICE ---------- */
  const result = await addVideoService({ ...value, userEmail: req.user.email });

  return sendCreated(res, { data: result, message: "Video added successfully" });
});

/**
 * @function updateVideo
 *
 * @params
 * params: {
 *   ytVideoId: string (required)
 * }
 *
 * body: {
 *   title?: string,
 *   link?: string,
 *   permission?: string
 * }
 *
 * @process
 * 1. Validate ytVideoId and at least one field (title or link)
 * 2. Fetch employee using logged-in user email
 * 3. Fetch YouTube document
 * 4. Find video by ytVideoId
 * 5. Update title and/or link
 * 6. Save document
 * 7. Create permission audit log
 * 8. Return updated video
 *
 * @response
 * 200 {
 *   video: {
 *     ytVideoId: string,
 *     title: string,
 *     link: string
 *   }
 * }
 */

export const updateVideo = asyncHandler(async (req, res) => {
  /* ---------- VALIDATION ---------- */
  const { value, error } = validateUpdateVideo({
    ytVideoId: req.params.ytVideoId,
    ...req.body,
  });
  if (error) {
    throw ValidationError.fromJoi(error);
  }

  /* ---------- SERVICE ---------- */
  const result = await updateVideoService({ ...value, userEmail: req.user.email });

  return sendSuccess(res, { data: result, message: "Video updated successfully" });
});

/**
 * @function getVideoById
 *
 * @params
 * params: {
 *   ytVideoId: string (required)
 * }
 *
 * @process
 * 1. Validate ytVideoId (basic check in controller)
 * 2. Fetch document
 * 3. Find video by ytVideoId
 * 4. Return video
 *
 * @response
 * 200 {
 *   video: { ytVideoId, title, link }
 * }
 */

export const getVideoById = asyncHandler(async (req, res) => {
  const { ytVideoId } = req.params;

  if (!ytVideoId) {
    throw new ValidationError("ytVideoId is required");
  }

  const result = await getVideoByIdService({ ytVideoId });

  return sendSuccess(res, { data: result, message: "Video fetched successfully" });
});

/**
 * @function deleteVideo
 *
 * @params
 * params: {
 *   ytVideoId: string (required)
 * }
 *
 * body: {
 *   permission?: string
 * }
 *
 * @process
 * 1. Validate ytVideoId (basic check)
 * 2. Fetch employee
 * 3. Fetch document
 * 4. Find and remove video
 * 5. Save document
 * 6. Create audit log
 * 7. Return deleted video id
 *
 * @response
 * 200 {
 *   deletedVideoId: string
 * }
 */

export const deleteVideo = asyncHandler(async (req, res) => {
  const { ytVideoId } = req.params;
  const { permission } = req.body;

  if (!ytVideoId) {
    throw new ValidationError("ytVideoId is required");
  }

  const result = await deleteVideoService({
    ytVideoId,
    permission,
    userEmail: req.user.email,
  });

  return sendSuccess(res, { data: result, message: "Video deleted successfully" });
});
