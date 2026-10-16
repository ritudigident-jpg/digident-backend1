/**
 * Business logic for blog posts, comments and SEO data. Throws AppError subclasses on failure.
 *
 * Exports: createBlogService, getBlogsService, getBlogByIdService, getBlogBySlugService,
 * updateBlogService, deleteBlogService, addBlogCommentService, deleteBlogCommentService and 1 more
 * Used by: controllers/blog/blog.controller.js, controllers/blogview/blogview.controller.js
 */

import Blog from "../../models/blog.model.js";
import slugify from "slugify";
import { v6 as uuidv6 } from "uuid";
import BlogView from "../../models/blogview.model.js";
import { sendNotification } from "../notification/notification.service.js";
import { PermissionAudit } from "../../models/permissionaudit.model.js";
import { redis as redisClient } from "../../config/redis.config.js";
import { uploadToS3, deleteFromS3 } from "../aws/aws.service.js";
import { ERROR_CODES } from "../../constants/errorcodes.constant.js";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../../helpers/apperror.helper.js";
import { logger } from "../../helpers/logger.helper.js";
/* =========================================================
   CACHE CONFIG
========================================================= */
const CACHE_TTL = 60 * 60; // 1 hour

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

const clearBlogCache = async () => {
  try {
    const keys = await redisClient.keys("BLOG:*");
    if (keys.length > 0) {
      await redisClient.del(...keys);
      logger.debug("BLOG CACHE CLEARED", { keys });
    }
  } catch (err) {
    logger.error("REDIS CACHE CLEAR ERROR", { error: err.message });
  }
};

/* =========================================================
   CREATE BLOG
========================================================= */
/**
 * Create blog.
 *
 * @param {object} params
 * @param {*} params.data
 * @param {*} params.featuredImage
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 * @throws {BadRequestError} 400 when the input breaks a rule.
 */
export const createBlogService = async ({ data, featuredImage, employee }) => {
  let featuredUpload = null;
  try {
    const exists = await Blog.findOne({
      $or: [{ title: data.title }, { slug: data.slug }],
      isDeleted: false,
    });
    if (exists) {
      throw new ConflictError("Blog already exists with same title or slug", {
        code: ERROR_CODES.BLOG_ALREADY_EXISTS,
      });
    }
    if (!featuredImage) {
      throw new BadRequestError("Featured image is required", { code: ERROR_CODES.VALIDATION_ERROR });
    }
    /* ---------- UPLOAD FEATURED IMAGE ---------- */
    featuredUpload = await uploadToS3(featuredImage, "blogs/featured");
    const slug = `${slugify(data.title, {
      lower: true,
      strict: true,
      trim: true,
    })}-${uuidv6()}`;

    const blog = await Blog.create({
      ...data,
      slug,
      featuredImage: featuredUpload.url,
      createdBy: employee?._id || null,
    });

    /* ---------- CLEAR CACHE ---------- */
    await clearBlogCache();

    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee?._id,
        actionByEmail: employee?.email,
        actionFor: blog._id,
        action: `Created blog: ${blog.title}`,
        permission: "blog.create",
        actionType: "Create",
      });
    } catch (err) {
      logger.error("Audit log failed on create blog", { error: err.message });
    }

    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee?._id || null,
        permission: "cms.blog.create",
        title: "New Blog Created",
        message: `A new blog "${blog.title}" has been published`,
        type: "BLOG_CREATED",
        entityId: blog._id,
        entityModel: "Blog",
        metadata: {
          blogId: blog._id,
          title: blog.title,
          slug: blog.slug,
          category: blog.category || null,
          createdBy: employee?.email || null,
        },
      });
    } catch (err) {
      logger.error("Notification failed on create blog", { error: err.message });
    }
    return blog;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (featuredUpload?.url) {
      await deleteFromS3(featuredUpload.url);
    }
    throw error;
  }
};

/* =========================================================
   GET BLOGS
========================================================= */
/**
 * Get blogs.
 *
 * @param {object} params
 * @param {*} params.page
 * @param {*} params.limit
 * @param {*} params.skip
 * @param {*} params.status
 * @param {*} params.search
 * @param {*} params.category
 * @returns {Promise<*>}
 */
export const getBlogsService = async ({ page, limit, skip, status, search, category }) => {
  const query = { isDeleted: false };

  if (status && status !== "all") query.status = status;
  if (category) query.category = category;
  if (search) query.$text = { $search: search };

  /* ---------- CACHE KEY ---------- */
  // skip cache for search queries — results change too frequently
  const cacheKey = !search ? `BLOG:LIST:${page}:${limit}:${status || "all"}:${category || "all"}` : null;

  /* ---------- CACHE CHECK ---------- */
  if (cacheKey) {
    const cached = await getCache(cacheKey);
    if (cached) {
      logger.debug("CACHE HIT", { cacheKey });
      return cached;
    }
  }

  /* ---------- FETCH ---------- */
  const [blogs, totalItems] = await Promise.all([
    Blog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Blog.countDocuments(query),
  ]);

  const totalPages = Math.ceil(totalItems / limit);

  const result = {
    pagination: {
      totalItems,
      totalPages,
      currentPage: page,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
    blogs,
  };

  /* ---------- STORE CACHE ---------- */
  if (cacheKey) await setCache(cacheKey, result);

  return result;
};

/* =========================================================
   GET BLOG BY ID
========================================================= */
/**
 * Get blog by id.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getBlogByIdService = async ({ blogId }) => {
  /* ---------- FETCH ---------- */
  const blog = await Blog.findOne({ blogId, isDeleted: false }).lean();
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }
  return blog;
};

/* =========================================================
   GET BLOG BY SLUG
========================================================= */
/**
 * Get blog by slug.
 *
 * @param {object} params
 * @param {*} params.slug
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const getBlogBySlugService = async ({ slug }) => {
  const cacheKey = `BLOG:SLUG:${slug}`;

  /* ---------- CACHE CHECK ---------- */
  const cached = await getCache(cacheKey);
  if (cached) {
    logger.debug("CACHE HIT", { cacheKey });
    return cached;
  }

  /* ---------- FETCH ---------- */
  const blog = await Blog.findOne({
    slug,
    isDeleted: false,
    status: "published",
  }).lean();
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }

  /* ---------- STORE CACHE ---------- */
  await setCache(cacheKey, blog);

  return blog;
};

/* =========================================================
   UPDATE BLOG
========================================================= */
/**
 * Update blog.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @param {*} params.data
 * @param {*} params.featuredImage
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 * @throws {ConflictError} 409 when the record already exists or was already processed.
 */
export const updateBlogService = async ({ blogId, data, featuredImage, employee }) => {
  let featuredUpload;
  try {
    const blog = await Blog.findOne({ blogId, isDeleted: false });
    if (!blog) {
      throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
    }

    if (data.slug) {
      const duplicateSlug = await Blog.findOne({
        blogId: { $ne: blogId },
        slug: data.slug,
        isDeleted: false,
      });
      if (duplicateSlug) {
        throw new ConflictError("Slug already exists", { code: ERROR_CODES.SLUG_ALREADY_EXISTS });
      }
    }

    /* ---------- FEATURED IMAGE ---------- */

    if (featuredImage) {
      if (blog.featuredImage) {
        await deleteFromS3(blog.featuredImage);
      }
      featuredUpload = await uploadToS3(featuredImage, "blogs/featured");
      blog.featuredImage = featuredUpload.url;
    }

    const oldData = {
      title: blog.title,
      status: blog.status,
      category: blog.category,
    };

    Object.keys(data).forEach((key) => {
      if (data[key] !== undefined) blog[key] = data[key];
    });

    blog.updatedBy = employee?._id || null;
    await blog.save();

    /* ---------- CLEAR CACHE ---------- */
    await clearBlogCache();

    /* ---------- AUDIT ---------- */
    try {
      await PermissionAudit.create({
        permissionAuditId: uuidv6(),
        actionBy: employee?._id,
        actionByEmail: employee?.email,
        actionFor: blog._id,
        action: `Updated blog: ${blog.title}`,
        permission: "blog.update",
        actionType: "Update",
      });
    } catch (err) {
      logger.error("Audit log failed on update blog", { error: err.message });
    }

    /* ---------- NOTIFICATION ---------- */
    try {
      await sendNotification({
        sender: employee?._id || null,
        permission: "cms.blog.update",
        title: "Blog Updated",
        message: `Blog "${blog.title}" has been updated`,
        type: "BLOG_UPDATED",
        entityId: blog._id,
        entityModel: "Blog",
        metadata: {
          blogId: blog._id,
          title: blog.title,
          slug: blog.slug,
          category: blog.category || null,
          updatedBy: employee?.email || null,
          previousData: oldData,
        },
      });
    } catch (err) {
      logger.error("Notification failed on update blog", { error: err.message });
    }

    return blog;
  } catch (error) {
    /* ---------- ROLLBACK ---------- */
    if (featuredImage?.url) {
      await deleteFromS3(featuredImage.url);
    }
    throw error;
  }
};

/* =========================================================
   DELETE BLOG
========================================================= */
/**
 * Delete blog.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @param {*} params.employee
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteBlogService = async ({ blogId, employee }) => {
  const blog = await Blog.findOne({ blogId, isDeleted: false });
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }

  blog.isDeleted = true;
  blog.updatedBy = employee?._id || null;
  await blog.save();

  /* ---------- CLEAR CACHE ---------- */
  await clearBlogCache();

  /* ---------- AUDIT ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee?._id,
      actionByEmail: employee?.email,
      actionFor: blog._id,
      action: `Deleted blog: ${blog.title}`,
      permission: "blog.delete",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete blog", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee?._id || null,
      permission: "cms.blog.delete",
      title: "Blog Deleted",
      message: `Blog "${blog.title}" has been deleted`,
      type: "BLOG_DELETED",
      entityId: blog._id,
      entityModel: "Blog",
      metadata: {
        blogId: blog._id,
        title: blog.title,
        slug: blog.slug,
        deletedBy: employee?.email || null,
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete blog", { error: err.message });
  }

  return { blogId: blog.blogId, title: blog.title, deleted: true };
};

/* =========================================================
   ADD COMMENT
========================================================= */
/**
 * Add blog comment.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @param {*} params.data
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const addBlogCommentService = async ({ blogId, data }) => {
  const blog = await Blog.findOne({ blogId, isDeleted: false });
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }

  const comment = {
    commentId: uuidv6(),
    name: data.name,
    company: data.company,
    city: data.city,
    review: data.review,
  };

  blog.comments.push(comment);
  await blog.save();
  /* ---------- CLEAR CACHE FOR THIS BLOG ---------- */
  try {
    await redisClient.del(`BLOG:ID:${blogId}`);
    await redisClient.del(`BLOG:SLUG:${blog.slug}`);
  } catch (err) {
    logger.error("Cache clear failed on add comment", { error: err.message });
  }
  /* ---------- NOTIFY EMPLOYEES WITH blog.comment.moderate PERMISSION ---------- */
  try {
    await sendNotification({
      sender: null,
      permission: "cms.blog.read", // only moderators get this
      title: "New Comment Pending Approval",
      message: `New comment on "${blog.title}" by ${data.name} — awaiting moderation`,
      type: "BLOG_COMMENT_ADDED",
      entityId: blog._id,
      entityModel: "Blog",
      metadata: {
        blogId: blog.blogId,
        blogTitle: blog.title,
        commentId: comment.commentId,
        commenterName: data.name,
        commenterCity: data.city,
      },
    });
  } catch (err) {
    logger.error("Notification failed on add comment", { error: err.message });
  }
  return { blogId, comment: blog.comments.at(-1) };
};

/* =========================================================
   DELETE COMMENT
========================================================= */
/**
 * Delete blog comment.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @param {*} params.commentId
 * @param {*} params.employee
 * @param {*} params.permission
 * @returns {Promise<*>}
 * @throws {ForbiddenError} 403 when the caller may not do this.
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const deleteBlogCommentService = async ({ blogId, commentId, employee, permission }) => {
  if (!employee.permissions?.includes(permission)) {
    throw new ForbiddenError("Unauthorized", { code: ERROR_CODES.UNAUTHORIZED });
  }

  const blog = await Blog.findOne({ blogId, isDeleted: false });
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }

  /* ---------- CAPTURE COMMENT BEFORE DELETE ---------- */
  const comment = blog.comments.find((c) => c.commentId === commentId);
  if (!comment) {
    throw new NotFoundError("Comment not found", { code: ERROR_CODES.COMMENT_NOT_FOUND });
  }

  const result = await Blog.updateOne(
    { blogId, "comments.commentId": commentId },
    { $pull: { comments: { commentId } } }
  );

  if (result.modifiedCount === 0) {
    throw new NotFoundError("Comment not found", { code: ERROR_CODES.COMMENT_NOT_FOUND });
  }

  /* ---------- CLEAR CACHE FOR THIS BLOG ---------- */
  try {
    await redisClient.del(`BLOG:ID:${blogId}`);
    await redisClient.del(`BLOG:SLUG:${blog.slug}`);
  } catch (err) {
    logger.error("Cache clear failed on delete comment", { error: err.message });
  }

  /* ---------- AUDIT (employee action — fully tracked) ---------- */
  try {
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: blog._id,
      action: `Deleted comment on blog: "${blog.title}"`,
      permission: "blog.comment.delete",
      actionType: "Delete",
    });
  } catch (err) {
    logger.error("Audit log failed on delete comment", { error: err.message });
  }

  /* ---------- NOTIFICATION ---------- */
  try {
    await sendNotification({
      sender: employee._id,
      permission: "cms.blog.read",
      title: "Blog Comment Deleted",
      message: `Comment on "${blog.title}" deleted by ${employee.email}`,
      type: "BLOG_COMMENT_DELETED",
      entityId: blog._id,
      entityModel: "Blog",
      metadata: {
        blogId: blog.blogId,
        blogTitle: blog.title,
        commentId,
        deletedBy: employee.email,
        deletedComment: {
          name: comment.name,
          review: comment.review,
          city: comment.city,
          createdAt: comment.createdAt,
        },
      },
    });
  } catch (err) {
    logger.error("Notification failed on delete comment", { error: err.message });
  }

  return { blogId, commentId };
};

/* =========================================================
   INCREASE VIEW (2 MIN RULE)
========================================================= */
/**
 * Increase blog view.
 *
 * @param {object} params
 * @param {*} params.blogId
 * @param {*} params.req
 * @returns {Promise<*>}
 * @throws {NotFoundError} 404 when a record does not exist.
 */
export const increaseBlogViewService = async ({ blogId, req }) => {
  const blog = await Blog.findOne({ blogId, isDeleted: false });
  if (!blog) {
    throw new NotFoundError("Blog not found", { code: ERROR_CODES.BLOG_NOT_FOUND });
  }

  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;
  const userAgent = req.headers["user-agent"] || "";

  // ---------- ATOMIC LOCK (prevents race condition) ----------
  const lockKey = `VIEW_LOCK:${blogId}:${ip}:${userAgent}`;
  const acquired = await redisClient.set(lockKey, "1", { nx: true, ex: 120 }); // 2 min TTL

  if (!acquired) {
    // Duplicate call within 2 min — skip counting
    return { blogId, views: blog.views };
  }

  await BlogView.create({
    blog: blog._id,
    ipAddress: ip,
    userAgent,
    referrer: req.headers.referer || "",
  });
  await Blog.updateOne({ blogId }, { $inc: { views: 1 } });

  try {
    await redisClient.del(`BLOG:ID:${blogId}`);
    await redisClient.del(`BLOG:SLUG:${blog.slug}`);
  } catch (err) {
    logger.error("Cache clear failed on view increment", { error: err.message });
  }

  return { blogId, views: blog.views + 1 };
};
