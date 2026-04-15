import slugify from "slugify";
import { v6 as uuidv6 } from "uuid";

import Blog from "../models/blog/blog.modal.js";
import {PermissionAudit} from "../models/manage/permissionaudit.model.js";
import { uploadToS3, deleteFromS3 } from "./awsS3.service.js";

/* ---------- CALCULATE READING TIME ---------- */
const calculateReadingTime = (content = []) => {
  let totalWords = 0;

  for (const block of content) {
    if (block?.text) {
      totalWords += block.text.trim().split(/\s+/).filter(Boolean).length;
    }

    if (Array.isArray(block?.listItems)) {
      for (const item of block.listItems) {
        totalWords += item.trim().split(/\s+/).filter(Boolean).length;
      }
    }
  }

  return Math.max(1, Math.ceil(totalWords / 200));
};

/* ---------- GENERATE UNIQUE SLUG ---------- */
const generateUniqueSlug = async (title, customSlug = "", excludeId = null) => {
  const baseSlug = slugify(customSlug || title, {
    lower: true,
    strict: true,
    trim: true,
  });

  let finalSlug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await Blog.findOne({
      slug: finalSlug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    }).lean();

    if (!existing) break;

    counter += 1;
    finalSlug = `${baseSlug}-${counter}`;
  }

  return finalSlug;
};

/* ---------- NORMALIZE TAGS ---------- */
const normalizeTags = (tags = []) => {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
};

/* ---------- CLEANUP UPLOADED S3 KEYS ---------- */
const cleanupS3Keys = async (keys = []) => {
  for (const key of keys) {
    if (!key) continue;
    try {
      await deleteFromS3(key);
    } catch (cleanupError) {
      console.error("S3 cleanup failed:", cleanupError.message);
    }
  }
};

/* ---------- BUILD CONTENT WITH S3 URLS ---------- */
const buildContentWithUploads = async ({
  content = [],
  uploadedKeys = [],
  contentImageFiles = [],
  oldContent = [],
  isUpdate = false,
}) => {
  const finalContent = [];

  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    let imageUrl = block.image || "";

    if (typeof block.imageFileIndex === "number") {
      const file = contentImageFiles[block.imageFileIndex];

      if (!file) {
        const err = new Error(
          `Content image file not found for block index ${block.imageFileIndex}`
        );
        err.statusCode = 400;
        throw err;
      }

      const uploaded = await uploadToS3(file, "blog/content");
      imageUrl = uploaded.url;
      if (uploaded.key) uploadedKeys.push(uploaded.key);
    }

    const oldBlock = isUpdate ? oldContent[i] : null;

    finalContent.push({
      ...(oldBlock?.blockId ? { blockId: oldBlock.blockId } : {}),
      type: block.type,
      text: block.text || "",
      level: block.level || 2,
      listItems: Array.isArray(block.listItems) ? block.listItems : [],
      image: imageUrl,
      order: typeof block.order === "number" ? block.order : i,
    });
  }

  return finalContent;
};

/* ---------- CREATE BLOG SERVICE ---------- */
export const createBlogService = async ({ data, files, employee }) => {
  const uploadedKeys = [];

  try {
    const {
      title,
      slug,
      shortDescription,
      content,
      tags = [],
      status = "draft",
      featured = false,
      seo = {},
      permission,
    } = data;

    const exist = await Blog.findOne({ title: title.trim(), isDeleted: false });
    if (exist) {
      const err = new Error("Blog already exists with this title");
      err.statusCode = 409;
      throw err;
    }

    const finalSlug = await generateUniqueSlug(title, slug);

    /* ---------- UPLOAD BANNER IMAGE ---------- */
    let bannerImage = "";
    if (files?.bannerImage?.[0]) {
      const uploadedBanner = await uploadToS3(files.bannerImage[0], "blog/banner");
      bannerImage = uploadedBanner.url;
      if (uploadedBanner.key) uploadedKeys.push(uploadedBanner.key);
    }

    /* ---------- UPLOAD CONTENT IMAGES ---------- */
    const finalContent = await buildContentWithUploads({
      content,
      uploadedKeys,
      contentImageFiles: files?.contentImages || [],
    });

    /* ---------- CREATE BLOG ---------- */
    const blog = await Blog.create({
      title: title.trim(),
      slug: finalSlug,
      shortDescription: shortDescription.trim(),
      bannerImage,
      content: finalContent,
      tags: normalizeTags(tags),
      status,
      featured,
      seo: {
        metaTitle: seo?.metaTitle || "",
        metaDescription: seo?.metaDescription || "",
        keywords: Array.isArray(seo?.keywords)
          ? seo.keywords.map((item) => item.trim()).filter(Boolean)
          : [],
        canonicalUrl: seo?.canonicalUrl || "",
        ogImage: seo?.ogImage || "",
      },
      readingTime: calculateReadingTime(finalContent),
      publishedAt: status === "published" ? new Date() : null,
    });

    /* ---------- AUDIT ---------- */
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: blog._id,
      action: blog.title,
      permission,
      actionType: "Create",
    });

    return blog;
  } catch (error) {
    await cleanupS3Keys(uploadedKeys);
    throw error;
  }
};

/* ---------- UPDATE BLOG SERVICE ---------- */
export const updateBlogService = async ({ blogId, data, files, employee }) => {
  const uploadedKeys = [];
  const oldKeysToDelete = [];

  try {
    const blog = await Blog.findOne({ blogId, isDeleted: false });
    if (!blog) {
      const err = new Error("Blog not found");
      err.statusCode = 404;
      throw err;
    }

    const {
      title,
      slug,
      shortDescription,
      content,
      tags,
      status,
      featured,
      seo,
      permission,
      removeBannerImage = false,
    } = data;

    /* ---------- TITLE / SLUG ---------- */
    if (title !== undefined) blog.title = title.trim();

    if (title !== undefined || slug !== undefined) {
      blog.slug = await generateUniqueSlug(
        title || blog.title,
        slug || blog.slug,
        blog._id
      );
    }

    if (shortDescription !== undefined) {
      blog.shortDescription = shortDescription.trim();
    }

    /* ---------- BANNER IMAGE ---------- */
    if (removeBannerImage && blog.bannerImage) {
      oldKeysToDelete.push(blog.bannerImage);
      blog.bannerImage = "";
    }

    if (files?.bannerImage?.[0]) {
      const uploadedBanner = await uploadToS3(files.bannerImage[0], "blog/banner");
      blog.bannerImage = uploadedBanner.url;
      if (uploadedBanner.key) uploadedKeys.push(uploadedBanner.key);
    }

    /* ---------- CONTENT ---------- */
    if (content !== undefined) {
      const oldContentImages = (blog.content || [])
        .map((item) => item.image)
        .filter(Boolean);

      const finalContent = await buildContentWithUploads({
        content,
        uploadedKeys,
        contentImageFiles: files?.contentImages || [],
        oldContent: blog.content || [],
        isUpdate: true,
      });

      blog.content = finalContent;

      const newContentImages = finalContent.map((item) => item.image).filter(Boolean);

      for (const oldImage of oldContentImages) {
        if (!newContentImages.includes(oldImage)) {
          oldKeysToDelete.push(oldImage);
        }
      }

      blog.readingTime = calculateReadingTime(finalContent);
    }

    /* ---------- OTHER FIELDS ---------- */
    if (tags !== undefined) blog.tags = normalizeTags(tags);
    if (featured !== undefined) blog.featured = featured;

    if (seo !== undefined) {
      blog.seo = {
        metaTitle: seo?.metaTitle || "",
        metaDescription: seo?.metaDescription || "",
        keywords: Array.isArray(seo?.keywords)
          ? seo.keywords.map((item) => item.trim()).filter(Boolean)
          : [],
        canonicalUrl: seo?.canonicalUrl || "",
        ogImage: seo?.ogImage || "",
      };
    }

    if (status !== undefined) {
      blog.status = status;

      if (status === "published" && !blog.publishedAt) {
        blog.publishedAt = new Date();
      }

      if (status !== "published") {
        blog.publishedAt = null;
      }
    }

    await blog.save();

    /* ---------- AUDIT ---------- */
    await PermissionAudit.create({
      permissionAuditId: uuidv6(),
      actionBy: employee._id,
      actionByEmail: employee.email,
      actionFor: blog._id,
      action: blog.title,
      permission,
      actionType: "Update",
    });

    /* ---------- DELETE OLD IMAGES AFTER SUCCESS ---------- */
    await cleanupS3Keys(oldKeysToDelete);

    return blog;
  } catch (error) {
    await cleanupS3Keys(uploadedKeys);
    throw error;
  }
};


/* ---------- GET BLOGS SERVICE ---------- */
export const getBlogsService = async (query) => {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 10, 1), 100);
  const skip = (page - 1) * limit;

  const {
    search,
    status,
    featured,
    sortBy = "createdAt",
    sortOrder = "desc",
  } = query;

  const filter = {
    isDeleted: false,
  };

  /* ---------- SEARCH FILTER ---------- */
  if (search?.trim()) {
    filter.$or = [
      { title: { $regex: search.trim(), $options: "i" } },
      { shortDescription: { $regex: search.trim(), $options: "i" } },
      { tags: { $regex: search.trim(), $options: "i" } },
    ];
  }

  /* ---------- STATUS FILTER ---------- */
  if (status && ["draft", "published", "archived"].includes(status)) {
    filter.status = status;
  }

  /* ---------- FEATURED FILTER ---------- */
  if (featured !== undefined) {
    if (featured === "true" || featured === true) {
      filter.featured = true;
    } else if (featured === "false" || featured === false) {
      filter.featured = false;
    }
  }

  /* ---------- SORT ---------- */
  const allowedSortFields = ["title", "createdAt", "updatedAt", "publishedAt"];
  const finalSortBy = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";
  const finalSortOrder = sortOrder === "asc" ? 1 : -1;

  const [blogs, totalItems] = await Promise.all([
    Blog.find(filter)
      .select({
        _id: 1,
        blogId: 1,
        title: 1,
        slug: 1,
        shortDescription: 1,
        bannerImage: 1,
        tags: 1,
        status: 1,
        featured: 1,
        stats: 1,
        readingTime: 1,
        publishedAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ [finalSortBy]: finalSortOrder })
      .skip(skip)
      .limit(limit)
      .lean(),

    Blog.countDocuments(filter),
  ]);

  return {
    blogs,
    pagination: {
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      currentPage: page,
      nextPage: page * limit < totalItems ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
      limit,
    },
  };
};

/* ---------- GET BLOG BY ID SERVICE ---------- */
export const getBlogByIdService = async (blogId) => {
  const blog = await Blog.findOne({
    blogId,
    isDeleted: false,
  }).lean();

  if (!blog) {
    const err = new Error("Blog not found");
    err.statusCode = 404;
    throw err;
  }

  return blog;
};



/* ---------- DELETE BLOG SERVICE ---------- */
export const deleteBlogService = async ({ blogId, employee, permission }) => {
  const blog = await Blog.findOne({ blogId });

  if (!blog) {
    const err = new Error("Blog not found");
    err.statusCode = 404;
    throw err;
  }

  /* ---------- COLLECT IMAGES ---------- */
  const imagesToDelete = [];

  if (blog.bannerImage) {
    imagesToDelete.push(blog.bannerImage);
  }

  if (Array.isArray(blog.content)) {
    for (const block of blog.content) {
      if (block.image) {
        imagesToDelete.push(block.image);
      }
    }
  }

  /* ---------- DELETE S3 IMAGES ---------- */
  for (const image of imagesToDelete) {
    try {
      await deleteFromS3(image);
    } catch (error) {
      console.error("S3 delete failed:", error.message);
      const err = new Error("Failed to delete blog images from storage");
      err.statusCode = 500;
      throw err;
    }
  }

  /* ---------- DELETE BLOG DOCUMENT ---------- */
  await Blog.deleteOne({ _id: blog._id });

  /* ---------- AUDIT ---------- */
  await PermissionAudit.create({
    permissionAuditId: uuidv6(),
    actionBy: employee._id,
    actionByEmail: employee.email,
    actionFor: blog._id,
    action: blog.title,
    permission,
    actionType: "Delete",
  });

  return {
    blogId: blog.blogId,
    title: blog.title,
  };
};