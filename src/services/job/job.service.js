/**
 * Business logic for career job posts. Throws AppError subclasses on failure.
 *
 * Exports: clearJobCache, createJobService, updateJobService, getJobsService,
 * getPublishedJobsService, getJobByIdService, getJobBySlugService, deleteJobService
 * Used by: controllers/job/job.controller.js, services/jobapplication/jobapplication.service.js
 */

import Job from "../../models/job.model.js";
import { generateSlug } from "../../helpers/slug.helper.js";
import { v6 as uuidv6 } from "uuid";
import { sendNotification } from "../notification/notification.service.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import { NotFoundError } from "../../helpers/apperror.helper.js";
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

/**
 * Clear job cache.
 * @returns {Promise<*>}
 */
export const clearJobCache = async () => {
  try {
    const keys = await redisClient.keys("JOB:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("JOB CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS CACHE CLEAR ERROR", { error: err.message });
  }
};

/* =========================================================
   CREATE JOB
========================================================= */
/**
 * Create job.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.employee
 * @returns {Promise<*>}
 */
export const createJobService = async ({ data, employee }) => {
  const baseSlug = generateSlug(data.title);
  let slug = baseSlug;
  let counter = 1;
  while (await Job.findOne({ slug })) {
    slug = `${baseSlug}-${counter++}`;
  }
  const job = await Job.create({
    ...data,
    jobId: uuidv6(),
    slug,
    createdBy: {
      employeeId: employee?.employeeId || null,
      employeeRef: employee?._id || null,
      name: employee?.firstName || null,
      email: employee?.email || null,
    },
    updatedBy: {
      employeeId: employee?.employeeId || null,
      employeeRef: employee?._id || null,
      name: employee?.firstName || null,
      email: employee?.email || null,
    },
  });
  /* ---------- CLEAR CACHE ---------- */
  await clearJobCache();
  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: job._id,
      actionForEmail: null,
      action: job.title,
      permission: "hr.career.create",
      actionType: "Create",
    });
  } catch (err) {
    logger.error("Audit log failed on create job", { error: err.message });
  }
  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "hr.career.create",
      title: "Job Created",
      message: `New job opening added for ${job.title}`,
      type: "JOB_CREATED",
      entityId: job._id,
      entityModel: "Job",
      metadata: {
        jobId: job.jobId,
        title: job.title,
        slug: job.slug,
        createdBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on create job", { error: err.message });
  }
  return job;
};

/* =========================================================
   UPDATE JOB
========================================================= */
/**
 * Update job.
 *
 * @param {object} params
 * @param {*} params.jobId
 * @param {*} params.data
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const updateJobService = async ({ jobId, data, employee }) => {
  const job = await Job.findOne({ jobId });
  if (!job) {
    throw new NotFoundError("Job not found", { code: ERROR_CODES.JOB_NOT_FOUND });
  }

  if (data.title && data.title !== job.title) {
    const baseSlug = generateSlug(data.title);
    let slug = baseSlug;
    let counter = 1;
    while (await Job.findOne({ slug, _id: { $ne: job._id } })) {
      slug = `${baseSlug}-${counter++}`;
    }
    data.slug = slug;
  }

  Object.assign(job, data);

  job.updatedBy = {
    employeeId: employee?.employeeId || null,
    employeeRef: employee?._id || null,
    name: employee?.firstName || null,
    email: employee?.email || null,
  };

  await job.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearJobCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: job._id,
      actionForEmail: null,
      action: job.title,
      permission: "hr.career.update",
      actionType: "Update",
    });
  } catch (err) {
    logger.error("Audit log failed on update job", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id,
      permission: "hr.career.update",
      title: "Job Updated",
      message: `Job "${job.title}" has been updated`,
      type: "JOB_UPDATED",
      entityId: job._id,
      entityModel: "Job",
      metadata: {
        jobId: job.jobId,
        title: job.title,
        slug: job.slug,
        updatedBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on update job", { error: err.message });
  }

  return job;
};

/* =========================================================
   GET JOBS
========================================================= */
/**
 * Get jobs.
 *
 * @param {object} params
 * @param {*} params.pagination
 * @param {*} params.filters
 * @returns {Promise<*>}
 */
export const getJobsService = async ({ pagination, filters }) => {
  const { skip, limit, page } = pagination;
  const { search, status, department, employmentType, workplaceType, experienceLevel } = filters;

  const query = {};

  if (status && status !== "all") query.status = status;
  if (department) query.department = department;
  if (employmentType) query.employmentType = employmentType;
  if (workplaceType) query.workplaceType = workplaceType;
  if (experienceLevel) query.experienceLevel = experienceLevel;
  if (search) query.$text = { $search: search };

  /* ---------- CACHE KEY ---------- */
  const cacheKey = !search
    ? `JOB:LIST:${page}:${limit}:${status || "all"}:${department || "all"}:${employmentType || "all"}:${workplaceType || "all"}:${experienceLevel || "all"}`
    : null;

  /* ---------- CACHE CHECK ---------- */
  if (cacheKey) {
    const cached = await getCache(cacheKey);
    if (cached) {
      logger.debug("CACHE HIT", { cacheKey });
      return cached;
    }
  }

  /* ---------- FETCH ---------- */
  const [jobs, totalItems] = await Promise.all([
    Job.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Job.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    jobs,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };

  /* ---------- STORE CACHE ---------- */
  if (cacheKey) await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET PUBLISHED JOBS
========================================================= */
/**
 * Get published jobs.
 *
 * @param {object} params
 * @param {*} params.pagination
 * @param {*} params.filters
 * @returns {Promise<*>}
 */
export const getPublishedJobsService = async ({ pagination, filters }) => {
  const { skip, limit, page } = pagination;
  const { search, department, employmentType, workplaceType, experienceLevel } = filters;

  const query = { status: "published" };

  if (department) query.department = department;
  if (employmentType) query.employmentType = employmentType;
  if (workplaceType) query.workplaceType = workplaceType;
  if (experienceLevel) query.experienceLevel = experienceLevel;
  if (search) query.$text = { $search: search };

  /* ---------- CACHE KEY ---------- */
  const cacheKey = !search
    ? `JOB:PUBLISHED:${page}:${limit}:${department || "all"}:${employmentType || "all"}:${workplaceType || "all"}:${experienceLevel || "all"}`
    : null;

  /* ---------- CACHE CHECK ---------- */
  if (cacheKey) {
    const cached = await getCache(cacheKey);
    if (cached) {
      logger.debug("CACHE HIT", { cacheKey });
      return cached;
    }
  }

  /* ---------- FETCH ---------- */
  const [jobs, totalItems] = await Promise.all([
    Job.find(query).sort({ isFeatured: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Job.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    jobs,
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };

  /* ---------- STORE CACHE ---------- */
  if (cacheKey) await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET JOB BY ID
========================================================= */
/**
 * Get job by id.
 *
 * @param {object} params
 * @param {*} params.jobId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getJobByIdService = async ({ jobId }) => {
  /* ---------- FETCH ---------- */
  const job = await Job.findOne({ jobId }).lean();
  if (!job) {
    throw new NotFoundError("Job not found", { code: ERROR_CODES.JOB_NOT_FOUND });
  }
  return job;
};

/* =========================================================
   GET JOB BY SLUG
========================================================= */
/**
 * Get job by slug.
 *
 * @param {object} params
 * @param {*} params.slug
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getJobBySlugService = async ({ slug }) => {
  /* ---------- FETCH ---------- */
  const job = await Job.findOne({ slug, status: "published" }).lean();
  if (!job) {
    throw new NotFoundError("Job not found", { code: ERROR_CODES.JOB_NOT_FOUND });
  }
  return job;
};

/* =========================================================
   DELETE JOB
========================================================= */
/**
 * Delete job.
 *
 * @param {object} params
 * @param {*} params.jobId
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteJobService = async ({ jobId, employee }) => {
  const job = await Job.findOne({ jobId });
  if (!job) {
    throw new NotFoundError("Job not found", { code: ERROR_CODES.JOB_NOT_FOUND });
  }

  await job.deleteOne();

  /* ---------- CLEAR CACHE ---------- */
  await clearJobCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: job._id,
      actionForEmail: null,
      action: job.title,
      permission: "career.job.delete",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete job", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id || null,
      permission: "hr.career.delete",
      title: "Job Deleted",
      message: `Job "${job.title}" has been deleted`,
      type: "JOB_DELETED",
      entityId: job._id,
      entityModel: "Job",
      metadata: {
        jobId: job.jobId,
        title: job.title,
        deletedBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete job", { error: err.message });
  }
  return job;
};
